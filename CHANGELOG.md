# Changelog

## 0.2.0 (unreleased)

### Added

- Supabase session auth: password/refresh-token sign-in, `sb-*-auth-token` cookie serialization
  (chunked like `@supabase/ssr`), session cache with `0600` permissions, `Set-Cookie` ingestion and
  a single retry on `401 auth_required`.
- `Origin` header on every request so cross-origin writes pass the app middleware.
- Declarative tool registry: 65 tools across overview, finance, recurring, shopping, inventory,
  chores, notes, chat, calendar and members, each with title, description, input schema and
  annotations (`readOnlyHint`/`destructiveHint`).
- 12 JSON resources under `manawg://current/*` replacing the two V1 resources.
- `MANAWG_ALLOW_DESTRUCTIVE` gate for the 14 destructive tools, off by default.
- Structured tool errors: allowlisted upstream code, `retry_after_s` for rate limits, truncated
  `details` for validation failures.
- Biome configuration, `pnpm lint`, CI workflow, `.env.example` and the read-only
  `pnpm live-check` probe (app/Supabase reachability plus seven data probes).
- Identity bootstrap: `memberId`/`memberToken` are read from `GET /api/wg/[code]` after the
  first successful session and cached in `identity.json` (`0600`); both env variables are now
  optional overrides.
- `pnpm smoke` (credential-free stdio handshake against `dist/`) and `pnpm inspector`
  (MCP Inspector against `dist/index.js`).
- Three gap-closing reads: `note_comments` (announcement comment thread), `recurring_advance`
  (advance preview via `PATCH /recurring-expenses`) and the account-scoped `wg_list`
  (every household of the signed-in account) — 68 tools now, 54 registered by default.
- Account scope for the HTTP client: `scope: 'account'` skips the WG code in the path and the
  identity bootstrap, and backs the new `manawg://current/wg` resource (13 resources).
- Four entity resource templates, `manawg://current/{event|chore|member|recurring}/{id}`, for the
  routes that answer `GET` on their own.
- Four prompts: `daily_brief`, `shopping_run`, `payment_reminder` and `settlement_plan` — all of
  them read-only instructions that name the tools to call and refuse the destructive step.
- Streamable HTTP transport (`MANAWG_TRANSPORT=http`) next to stdio: `createMcpHandler` served
  from `node:http`, an unauthenticated `GET /health` probe for orchestrators, an optional
  `MANAWG_HTTP_API_KEY` bearer gate on the MCP path, and `404` everywhere else.
- Retry policy in the HTTP client: up to two extra attempts (200 ms, 800 ms) for `429` with a
  short `Retry-After`, `500`/`502`/`503`/`504` and network failures, reusing the idempotency key on
  writes; rate limits beyond the window still surface `retry_after_s`.
- Readiness endpoint `GET /ready` plus graceful shutdown: `SIGTERM`/`SIGINT` flips it to `503` for
  `MANAWG_DRAIN_MS`, then the listener and open streams close; inbound `headersTimeout` (15 s) and
  `requestTimeout` (60 s) are set explicitly.
- `MANAWG_HTTP_CORS` (default off) for browser clients and a single-flight fix so a concurrent
  `invalidate()` cannot discard a sign-in that is already in flight.
- Container image: multi-stage `Dockerfile` (pnpm build, prod-pruned `node_modules`, non-root user,
  `/data` caches, `HEALTHCHECK`), an image build plus HTTP smoke test as a second CI job, and a
  release workflow that pushes `ghcr.io/abuarchiv/manawg-mcp:<version>` on every `v*` tag.

### Changed

- `MANAWG_BASE_URL`, `MANAWG_WG_CODE` and the Supabase settings (`MANAWG_SUPABASE_URL`,
  `MANAWG_SUPABASE_PUBLISHABLE_KEY`, and either `MANAWG_SUPABASE_REFRESH_TOKEN` or
  `MANAWG_EMAIL`/`MANAWG_PASSWORD`) are the required set; `MANAWG_MEMBER_ID` and
  `MANAWG_MEMBER_TOKEN` became optional bootstrap overrides.
- `chore_complete` now takes `{ id }` instead of `{ choreId }`.
- The HTTP client exposes a single generic `call({ path, method, query, body })` instead of
  one method per route.
- Resource read failures now report the same allowlisted code, `retry_after_s` and truncated
  `details` as tool failures instead of a bare `ManaWG request failed`.
- The advertised server version comes from `package.json` instead of a second hard-coded copy.
- A configuration error exits with a single `config_error: …` line instead of a stack trace.

### Fixed

- V1 could never complete a request: routes require a live Supabase session and an `Origin`
  header, neither of which the server sent. Both are now provided and verified by
  `pnpm live-check`.
