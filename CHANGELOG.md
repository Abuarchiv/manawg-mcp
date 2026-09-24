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

### Changed

- `MANAWG_BASE_URL`, `MANAWG_WG_CODE` and the Supabase settings (`MANAWG_SUPABASE_URL`,
  `MANAWG_SUPABASE_PUBLISHABLE_KEY`, and either `MANAWG_SUPABASE_REFRESH_TOKEN` or
  `MANAWG_EMAIL`/`MANAWG_PASSWORD`) are the required set; `MANAWG_MEMBER_ID` and
  `MANAWG_MEMBER_TOKEN` became optional bootstrap overrides.
- `chore_complete` now takes `{ id }` instead of `{ choreId }`.
- The HTTP client exposes a single generic `call({ path, method, query, body })` instead of
  one method per route.

### Fixed

- V1 could never complete a request: routes require a live Supabase session and an `Origin`
  header, neither of which the server sent. Both are now provided and verified by
  `pnpm live-check`.
