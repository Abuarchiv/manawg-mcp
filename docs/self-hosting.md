# Self-hosting

Run the server yourself when you want a local agent over stdio, a private HTTP endpoint, or your
own hosted OAuth server in front of your own ManaWG instance. If you only want to connect an
agent to [app.manawg.com](https://app.manawg.com), use the hosted server instead, see the
[README](../README.md#connect-an-agent).

- [Choose a mode](#choose-a-mode) · [Local setup](#local-setup) · [Environment](#environment) ·
  [How sign-in works](#how-sign-in-works) · [HTTP](#http-transport) · [Docker](#docker) ·
  [Hosted with OAuth](#hosted-with-oauth) · [Security boundaries](#security-boundaries)

## Choose a mode

| | Session mode (default) | OAuth mode |
| --- | --- | --- |
| **Who signs in** | The server, with one ManaWG account from the env file | Every user, in the browser, when their client connects |
| **Transport** | stdio or HTTP | HTTP only |
| **Secrets on the server** | Refresh token or password of that account | None |
| **Good for** | Your own agent on your own machine or server | A public server for many users |

You need Node.js 22 and pnpm 9 to run from source.

## Local setup

1. Install and build.

   ```bash
   pnpm install
   pnpm build
   ```

2. Create the credential file from the template and fill in real values:

   ```bash
   mkdir -p ~/.config/manawg-mcp
   cp .env.example ~/.config/manawg-mcp/env
   chmod 600 ~/.config/manawg-mcp/env
   ```

3. Verify connectivity against the real deployment (read-only probes):

   ```bash
   pnpm live-check
   ```

Unit tests, lint and typecheck never need credentials.

### Start

Load the env file and run the server, or register it in your MCP host:

```bash
set -a; source ~/.config/manawg-mcp/env; set +a
node dist/index.js
```

Claude Code:

```bash
claude mcp add manawg --env-file ~/.config/manawg-mcp/env -- node "$(pwd)/dist/index.js"
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `MANAWG_BASE_URL` | yes | Origin of the ManaWG app, e.g. `https://manawg.example` |
| `MANAWG_SUPABASE_URL` | yes | Supabase project URL behind the app |
| `MANAWG_AUTH` | no | `session` (default) or `oauth` |
| `MANAWG_WG_CODE` | no | Default flat (8-character share code); without it the account's only flat is used |
| `MANAWG_SUPABASE_PUBLISHABLE_KEY` | session | Supabase publishable/anon key |
| `MANAWG_SUPABASE_REFRESH_TOKEN` | session, one of | Long-lived refresh token for sign-in |
| `MANAWG_EMAIL` + `MANAWG_PASSWORD` | session, one of | Password sign-in instead of a refresh token |
| `MANAWG_PUBLIC_URL` | oauth | Public `https` URL of the MCP endpoint, e.g. `https://mcp.manawg.example/mcp` |
| `MANAWG_ALLOW_DESTRUCTIVE` | no | `1`/`true` registers destructive tools (default off) |
| `MANAWG_SESSION_CACHE` | no | Session cache path (default `~/.config/manawg-mcp/session.json`) |
| `MANAWG_TRANSPORT` | no | `stdio` (default) or `http` |
| `MANAWG_HTTP_HOST` | no | Bind address for `http` (default `127.0.0.1`, `0.0.0.0` in the container) |
| `MANAWG_HTTP_PORT` | no | Port for `http` (default `8080`) |
| `MANAWG_HTTP_PATH` | no | MCP endpoint path for `http` (default `/mcp`) |
| `MANAWG_HTTP_API_KEY` | no | Bearer token, minimum 16 characters; required when HTTP binds beyond loopback |
| `MANAWG_HTTP_CORS` | no | `1` allows any browser origin to call the endpoint (default off) |
| `MANAWG_DRAIN_MS` | no | Milliseconds `/ready` reports `503` before shutdown (default 5000) |

For stdio, only one sign-in mode has to be filled in by hand. For HTTP on a non-loopback host in
session mode, also set a persistent `MANAWG_HTTP_API_KEY` (for example, generate one with
`openssl rand -hex 32`). `MANAWG_MEMBER_ID`, `MANAWG_MEMBER_TOKEN` and `MANAWG_IDENTITY_CACHE`
from older versions are ignored: the app derives the acting member from the session.

## How sign-in works

The web app guards every `/api/wg/[code]` route with a verified Supabase identity and an
`Origin` check on writes, and resolves the acting member from that identity.

### Session mode

The server signs in one account and therefore:

1. signs in with the refresh token or the email/password pair,
2. stores the session in `session.json` (mode `0600`) and refreshes it before it expires,
3. serializes it into `sb-<project>-auth-token` cookies exactly the way `@supabase/ssr`
   expects (3180-byte chunks for long sessions),
4. sends `Origin: <MANAWG_BASE_URL>` and, on writes, a fresh `Idempotency-Key` on every request,
5. ingests `Set-Cookie` rotations the app returns and retries once on `401 auth_required`.

### OAuth mode

The server holds no account. It follows the [MCP authorization
spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), with the
[Supabase Auth OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server) as the
authorization server:

1. A request without a valid token gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`.
2. That document (RFC 9728) names `<MANAWG_SUPABASE_URL>/auth/v1` as the authorization server. The
   client registers itself there, sends the user through the app's sign-in and consent page and
   receives an access token. `/.well-known/oauth-authorization-server` passes the issuer's RFC 8414
   metadata through for older clients.
3. Each MCP request carries the token. It is verified locally against the project's JWKS
   (`ES256`/`RS256`, issuer, audience `authenticated`, expiry) and must carry a `client_id` claim,
   so a browser session token copied out of the app is refused.
4. The verified token is forwarded to the app as `Authorization: Bearer`. Nothing is stored on
   the server.

Prerequisites on the app side, without which every call answers `auth_required`: the OAuth server
enabled in the Supabase project, with dynamic client registration and the app's consent page
(`/oauth/consent`) as authorization path, and an app version that accepts `Authorization: Bearer`
on `/api/wg/*` (ManaWG does since November 2026; it refuses bearer tokens for deleting a flat and
for every account and auth route).

Limits worth knowing:

- Supabase sets `aud` to `authenticated`, so a token is bound to the user, not to this server: a
  token the user granted another OAuth client of the same project is accepted too. The app's
  member checks still apply to every call.
- `MANAWG_PUBLIC_URL` must end in `MANAWG_HTTP_PATH`, and `MANAWG_WG_CODE` is refused: there is no
  default flat for many users. `manawg://current/*` resources therefore need an account with one
  flat; tools take `wgCode`.
- Each HTTP request builds its own client, so a tool call without `wgCode` costs one extra
  `GET /api/wg/mine`.
- Browser clients (MCP Inspector) also need `MANAWG_HTTP_CORS=1`.
- A JWKS that cannot be loaded answers `500 server_error`, not `401`, so clients keep their token.

## HTTP transport

```bash
# Store a persistent MANAWG_HTTP_API_KEY in the env file before starting the server.
set -a; source ~/.config/manawg-mcp/env; set +a
export MANAWG_TRANSPORT=http MANAWG_HTTP_HOST=0.0.0.0 MANAWG_HTTP_PORT=8080
node dist/index.js
```

- MCP endpoint `http://<host>:8080/mcp` (streamable HTTP, 2025-era requests served stateless),
  reachable by any client that supports the HTTP transport with the header
  `Authorization: Bearer <MANAWG_HTTP_API_KEY>`.
- `GET /health` answers `{"status":"ok",…}` without credentials — the probe for load balancers and
  the container `HEALTHCHECK`. `GET /ready` returns `200` while serving and `503` as soon as
  `SIGTERM`/`SIGINT` arrives, for the `MANAWG_DRAIN_MS` window, then the listener closes. Everything
  else is `404`; an MCP request without the bearer token is `401`.
- Browser clients (MCP Inspector) need `MANAWG_HTTP_CORS=1` — it stays off so an unauthenticated
  endpoint cannot be called from a foreign page.
- Startup failures are a single `config_error: …` line and exit status 1, so a bad deployment
  fails fast instead of booting broken.

## Docker

Every release publishes a multi-arch image (`linux/amd64`, `linux/arm64`) to GHCR. Set a
persistent `MANAWG_HTTP_API_KEY` in the env file first (generate one with `openssl rand -hex 32`).

```bash
docker run -d --name manawg-mcp -p 8080:8080 \
  --env-file ~/.config/manawg-mcp/env \
  -v manawg-mcp-data:/data \
  ghcr.io/abuarchiv/manawg-mcp:latest
curl http://127.0.0.1:8080/health
```

The image serves HTTP on `0.0.0.0:8080`, runs as a non-root user, keeps the session cache in
`/data` (`MANAWG_SESSION_CACHE` points there) and carries a `HEALTHCHECK` against `/health`. Pin a
version tag such as `0.2.1` in production. To build it yourself: `docker build -t manawg-mcp .`

## Hosted with OAuth

This is how `mcp.manawg.com` runs: one Vercel Function from `api/mcp.js` and `vercel.json`. Every
path is rewritten to it, and `src/http.ts` routes `/mcp`, `/health`, `/ready` and the discovery
documents. To run the same in front of your own ManaWG instance:

1. In the Supabase project behind the app, turn on the OAuth 2.1 server (Authentication → OAuth
   Server), allow dynamic client registration, set the authorization path to `/oauth/consent`,
   and use asymmetric JWT signing keys (`ES256` or `RS256`).
2. Import this repository as a Vercel project and set, for Production:

   ```bash
   MANAWG_AUTH=oauth
   MANAWG_PUBLIC_URL=https://mcp.manawg.example/mcp
   MANAWG_BASE_URL=https://manawg.example
   MANAWG_SUPABASE_URL=https://your-project.supabase.co
   MANAWG_HTTP_CORS=1   # lets browser clients such as MCP Inspector connect
   ```

3. Add the domain of `MANAWG_PUBLIC_URL` to the project.
4. Set `NEXT_PUBLIC_MCP_URL` to the same URL in the app, so its settings show users the address
   and the agents they connected.

Check it with `curl https://mcp.manawg.example/health` and a `POST` to `/mcp` without a token,
which must answer `401` with a `resource_metadata` link.

The Vercel entry refuses session mode: functions share no disk, so a rotating refresh token would
be lost between instances. The same variables work for `node dist/index.js` and the Docker image
with `MANAWG_TRANSPORT=http`.

## Security boundaries

- Keep credentials out of git and logs; only `.env.example` placeholders are committed.
- The credential file and the session cache stay mode `0600` outside the repo.
- Error text is generated locally from an allowlist — upstream response bodies are not forwarded.

Report vulnerabilities privately, see [SECURITY.md](../SECURITY.md).
