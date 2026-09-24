# manawg-mcp

MCP server for a [ManaWG](https://github.com/Abuarchiv/manawg-app) household. Node 22, stdio or
streamable HTTP transport, 68 tools, 13 resources, 4 resource templates and 4 prompts over the
same HTTP API the web app uses.

## Setup

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

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `MANAWG_BASE_URL` | yes | Origin of the ManaWG app, e.g. `https://manawg.example` |
| `MANAWG_WG_CODE` | yes | 8-character share code of the household |
| `MANAWG_MEMBER_ID` + `MANAWG_MEMBER_TOKEN` | no | Identity override; normally bootstrapped from the app (see below) |
| `MANAWG_SUPABASE_URL` | yes | Supabase project URL behind the app |
| `MANAWG_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable/anon key |
| `MANAWG_SUPABASE_REFRESH_TOKEN` | one of | Long-lived refresh token for sign-in |
| `MANAWG_EMAIL` + `MANAWG_PASSWORD` | one of | Password sign-in instead of a refresh token |
| `MANAWG_ALLOW_DESTRUCTIVE` | no | `1`/`true` registers destructive tools (default off) |
| `MANAWG_SESSION_CACHE` | no | Session cache path (default `~/.config/manawg-mcp/session.json`) |
| `MANAWG_IDENTITY_CACHE` | no | Bootstrapped identity cache (default `~/.config/manawg-mcp/identity.json`) |
| `MANAWG_TRANSPORT` | no | `stdio` (default) or `http` |
| `MANAWG_HTTP_HOST` | no | Bind address for `http` (default `127.0.0.1`, `0.0.0.0` in the container) |
| `MANAWG_HTTP_PORT` | no | Port for `http` (default `8080`) |
| `MANAWG_HTTP_PATH` | no | MCP endpoint path for `http` (default `/mcp`) |
| `MANAWG_HTTP_API_KEY` | no | Bearer token guarding the MCP endpoint, minimum 16 characters |
| `MANAWG_HTTP_CORS` | no | `1` allows any browser origin to call the endpoint (default off) |
| `MANAWG_DRAIN_MS` | no | Milliseconds `/ready` reports `503` before shutdown (default 5000) |

Only `MANAWG_WG_CODE` and one sign-in mode have to be filled in by hand.

## Auth model

The web app guards every `/api/wg/[code]` route with a live Supabase session and an
`Origin` check, so member headers alone are not enough. The server therefore:

1. signs in with the refresh token or the email/password pair,
2. stores the session in `session.json` (mode `0600`) and refreshes it before it expires,
3. serializes it into `sb-<project>-auth-token` cookies exactly the way `@supabase/ssr`
   expects (3180-byte chunks for long sessions),
4. reads `memberId` (and `memberToken` when the deployed app returns one) from
   `GET /api/wg/[code]` once the session works and caches it in `identity.json` (mode `0600`),
   skipping the request when `MANAWG_MEMBER_ID` and `MANAWG_MEMBER_TOKEN` are both set in the
   environment,
5. sends `Origin: <MANAWG_BASE_URL>` and the member headers on every request,
6. ingests `Set-Cookie` rotations the app returns and retries once on `401 auth_required`.

## Host start

Load the env file and run the server, or register it in your MCP host:

```bash
set -a; source ~/.config/manawg-mcp/env; set +a
node dist/index.js
```

Claude Code:

```bash
claude mcp add manawg --env-file ~/.config/manawg-mcp/env -- node /Users/abu/Company/manawg-mcp/dist/index.js
```

## Deployment

### HTTP transport

```bash
set -a; source ~/.config/manawg-mcp/env; set +a
export MANAWG_TRANSPORT=http MANAWG_HTTP_HOST=0.0.0.0 MANAWG_HTTP_PORT=8080
export MANAWG_HTTP_API_KEY="$(openssl rand -hex 32)"
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

### Docker

```bash
docker build -t manawg-mcp .
docker run -d --name manawg-mcp -p 8080:8080 \
  --env-file ~/.config/manawg-mcp/env \
  -v manawg-mcp-data:/data \
  -e MANAWG_TRANSPORT=http -e MANAWG_HTTP_HOST=0.0.0.0 \
  manawg-mcp
curl http://127.0.0.1:8080/health
```

The image is a multi-stage build, runs as a non-root user, keeps the session and identity caches
in `/data` (`MANAWG_SESSION_CACHE` and `MANAWG_IDENTITY_CACHE` point there by default) and carries
a `HEALTHCHECK` against `/health`. CI builds and smoke-tests the image on every push; pushing a
`v*` tag publishes `ghcr.io/abuarchiv/manawg-mcp:<version>` and `:latest` to GHCR.

## Resources (13)

`manawg://current/` + `dashboard`, `members`, `expenses`, `recurring`, `shopping`, `inventory`,
`chores`, `notes`, `chat`, `events`, `absences`, `activity`, `wg` — each returns the live JSON
payload of the matching route, `mimeType: application/json`. `wg` is account-scoped (all households
of the signed-in account, no WG code in the path).

### Resource templates (4)

`manawg://current/{event|chore|member|recurring}/{id}` resolve one entity by UUID — the four
routes that answer `GET` on their own. Everything else is listed as a static resource because the
app has no single-entity `GET` for it.

## Prompts (4)

| Prompt | Arguments | Purpose |
| --- | --- | --- |
| `daily_brief` | `fokus` | Dashboard, activity, shopping, chores and calendar in up to 10 bullets |
| `shopping_run` | – | Shopping list merged with the pantry, grouped into one tour list |
| `payment_reminder` | `ton` | Draft only: friendly reminder for open balances, never sends |
| `settlement_plan` | – | Minimal transfers from `balances_get` + `settlement_preview`, never commits |

Prompts return instructions plus tool names; the destructive steps stay gated behind an explicit
confirmation.

## Tools (68)

| Domain | Tools |
| --- | --- |
| Overview | `wg_list`, `wg_overview`, `dashboard_get`, `activity_get`, `search`, `export_get` |
| Finance | `expenses_list`, `expense_create`, `expense_update`, `expense_delete`†, `expense_split_settle`, `settlement_preview`, `settlement_commit`, `balances_get`, `reminders_list`, `reminder_send`† |
| Recurring | `recurring_list`, `recurring_get`, `recurring_advance`, `recurring_create`, `recurring_update`, `recurring_delete`† |
| Shopping | `shopping_list`, `shopping_add`, `shopping_set_bought`, `shopping_remove`†, `shopping_clear_bought`† |
| Inventory | `inventory_list`, `inventory_add`, `inventory_update`, `inventory_consume`, `inventory_remove`† |
| Chores | `chores_list`, `chore_get`, `chore_create`, `chore_update`, `chore_complete`, `chore_delete`† |
| Notes | `notes_list`, `note_create`, `note_update`, `note_delete`†, `note_comments`, `note_comment`, `note_comment_update`, `note_comment_delete`†, `note_react` |
| Chat | `chat_messages`, `chat_send`, `chat_edit`, `chat_react`, `chat_mark_read`, `chat_unread`, `chat_delete`† |
| Calendar | `events_list`, `event_get`, `event_create`, `event_update`, `event_delete`†, `absences_list`, `absence_create`, `absence_delete`† |
| Members | `members_list`, `member_get`, `member_update`†, `notifications_get`, `notifications_update`, `wg_update`† |

† destructive: only registered when `MANAWG_ALLOW_DESTRUCTIVE=1` (14 tools), and annotated with
`destructiveHint`. Read tools are annotated `readOnlyHint`.

Input schemas mirror the API contract (money in `amountCents`, ISO datetimes with offset, split
counts, lengths). Every tool returns the route payload as text plus `structuredContent`.

## Error contract

Transient failures are retried inside the server: up to two extra attempts (200 ms, 800 ms) for
`429` with a short `Retry-After`, `5xx` and network errors, always with the same idempotency key on
writes. Longer rate limits are not slept out — they surface immediately as
`ManaWG request failed: too_many_requests retry_after_s=<n>`.

Tool and resource failures never carry upstream messages, URLs or credentials:

- `ManaWG request failed: <code>` with `code` drawn from a fixed allowlist
  (`validation_errors`, `splits_sum_mismatch`, `shopping_item_duplicate`, `too_many_requests`, …);
- unknown codes fall back to `upstream_http_<status>` or `upstream_network_error`;
- rate limits add `retry_after_s=<n>`, validation errors add a truncated `details` snippet;
- invalid arguments are rejected by the MCP layer before any request is sent.

## Not exposed on purpose

PayPal orders/captures, CSV/OCR imports, the calendar feed URL (contains a feed secret), push
subscription endpoints, `test_notification`, joining/claiming members and WG deletion. Set
`MANAWG_ALLOW_DESTRUCTIVE=1` to enable the destructive tools listed above.

## Development

```bash
pnpm lint        # biome check
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest (121 tests, no credentials needed)
pnpm build       # tsc to dist/
pnpm smoke       # stdio handshake against dist/: tools, resources, templates, prompts, gate
pnpm inspector   # MCP Inspector (web UI) against dist/index.js
pnpm live-check  # read-only probes against the real deployment (credentials required)
```

## Security boundaries

- Keep credentials out of git and logs; only `.env.example` placeholders are committed.
- The credential file and the session cache stay mode `0600` outside the repo.
- Never set `MEMBER_SESSION_SECRET`.
- Error text is generated locally from an allowlist — upstream response bodies are not forwarded.
