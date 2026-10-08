# Changelog

## 0.2.0 (unreleased)

### Fixed (contract audit against the app routes)

- `wg_create` called `/api/wg/wg`; it now posts to `/api/wg`, and `creatorName` is limited to 80.
- Removed the `search` tool: the app has no search route, every call was a 404.
- `settlement_commit` sent the raw preview as `expected`; the app rejects unknown keys, so it is now
  reduced to `currency`, `netCents`, `settleableCents` and `splits[id, amountCents]`.
- `recurring_advance` takes only `id` + `expectedNextDueAt` (any override silently switched the app
  to a template edit); `expense_create` gained `recurringExpenseId` / `expectedRecurringNextDueAt`
  for booking a due charge; `recurring_update` accepts `expectedNextDueAt`.
- `chore_create` no longer drops `intervalMonths` (monthly cadence is `recurrenceType: months`);
  `recurrenceType` is `days|months`. `inventory_consume` rejects `delta: 0`, `chat_send` allows 20
  mentions, `event_update` can clear `description`/`location`/`recurrence`/`endsAt` with `null`.
- `export_get` returned `{}` for `format: csv`; non-JSON responses now come back as
  `{ contentType, content }`, `sections` is sent for JSON, and oversized strings are capped.
- `member_claim` sends the legacy proof headers (`legacyMemberToken` input) the app requires.
- The error allowlist grew from 130 to 239 codes, so conflicts such as `chore_changed`,
  `expense_conflict`, `not_admin`, `message_deleted` or `payload_changed` reach the model instead of
  `upstream_http_409`.
- Tool descriptions corrected where they promised behaviour the app does not have (permissions,
  response fields, limits, error codes).

### Added

- `chat_unreact` (DELETE of an own reaction) — the only way to undo `chat_react`.
- End-to-end test (`test/e2e.test.ts`) running the real session controller, client and MCP server
  against a local stub that enforces Origin, the Supabase cookie and idempotency keys.

### Changed

- The member identity bootstrap, `identity.json` and `MANAWG_MEMBER_ID` / `MANAWG_MEMBER_TOKEN` /
  `MANAWG_IDENTITY_CACHE` are gone: the app resolves the member from the session cookie and never
  returned a member token. The variables are ignored if still set.
- Internals split into focused modules: `errors.ts` (allowlist, `ManaWgError`, `describeError`),
  `register.ts` (resources, prompts, tools), `version.ts`, `ids.ts`; `auth.ts` Set-Cookie handling is
  pure functions; the build uses `tsconfig.build.json` instead of a long command line.

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
- Seven coverage tools closing the D9 gaps: `import_preview` (read-only POST), `import_commit`,
  `paypal_order_create`, `paypal_capture`, `member_claim`, `calendar_subscription_get` and the
  account-scoped `wg_create` — 75 tools now, 56 registered by default, 19 behind the destructive
  gate.
- Payload bounds for every read: resources and tool results are capped at 100 KB
  (`src/payload.ts`, arrays shrink from the largest one), and the `expenses` resource keeps the
  newest 100 entries — both announced through a `_mcp.truncated` marker instead of silent cuts.

### Changed

- Tool annotations gained an explicit `readOnly` override so a side-effect-free POST such as
  `import_preview` advertises `readOnlyHint` instead of looking like a write.
- `expenses_list` accepts `limit` (1..500, default 100) and `offset`, slices the unpaginated
  `/expenses` route MCP-side and returns `total`/`hasMore` next to the page.

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
