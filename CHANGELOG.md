# Changelog

## 0.3.0 (2026-11-19)

### Added

- 13 tools, so an agent no longer dead-ends where the app has a route:
  - `chore_complete_undo` takes back your latest chore completion; `chore_complete` now says to
    keep its `completion` for it.
  - `chore_swap_request` asks the flat to take over a chore (a noticeboard post tied to the chore,
    with push).
  - `shopping_update` renames a shopping item or changes its quantity, guarded by
    `expectedUpdatedAt` and `expectedBoughtAt`.
  - `event_occurrence_change` cancels (`cancel`) or detaches into a one-off event (`detach`) one
    date of a recurring event. Destructive tool, gated by `MANAWG_ALLOW_DESTRUCTIVE`.
  - `invite_create`, `invites_list`, `invite_revoke` and `invite_email` manage invite links, the
    only way to add flatmates (`invite_revoke` is destructive).
  - `calendar_subscription_create` and, as destructive tools, `calendar_subscription_rotate` and
    `calendar_subscription_revoke` complete the calendar feed lifecycle next to
    `calendar_subscription_get`. The feed URL is a secret; the descriptions tell the agent to
    show it to the user only.
  - `imports_list` and, as a destructive tool, `import_undo` list and take back an import.
- Reverse API surface check (`test/api-surface.test.ts`): every route of the app snapshot is either
  called by a tool or resource or listed with a reason as intentionally not exposed, so a new app
  route cannot go unnoticed.
- Resource templates list their entities in `resources/list` and complete `{id}`, so resource
  pickers in clients such as VS Code can fill them. Listing fails soft.
- `MANAWG_TOOLSETS` registers only the named tool groups (plus `overview`), so a client that
  struggles with long tool lists can get a short one. Unset keeps every tool.
- Server metadata (`description`, `websiteUrl`, icons) in `initialize` and in `server.json`.
- Clients on the 2026-07-28 protocol revision may cache `tools/list`, `prompts/list`,
  `resources/templates/list` and `server/discover` for an hour.

### Changed

- Every tool description now says what the tool does, when to use it instead of its siblings,
  who may call it, what it changes or notifies and which error codes it returns.
- Every tool input field carries a schema description: where the value comes from, its unit and
  what the default means.
- `note_react` is marked `idempotentHint`, since it sets the reaction to a given state.
- `chore_update` takes `title` and `expectedUpdatedAt` (the stale-save guard) and says so; the
  description no longer claims the title cannot change.
- `activity_get` gains an optional `limit` (80 to 320, default 80). `chat_messages` pages back
  with `beforeId` only: the `before` parameter was never read by the app and is gone.
- `recurring_create` and `recurring_update` accept `currency: "EUR"` only. The app rejects
  anything else with `recurring_currency_unsupported`, so the schema now refuses it locally.
- `import_preview` and `import_commit` describe all five sources, including `tricount_csv` and
  `settleup_csv`.
- Every call has one 45 second deadline across attempts, retries and the flat lookup. When it
  passes, the tool answers `timeout`.
- The release workflow checks the tag against `package.json`, `server.json` and the changelog,
  sets `latest` only for final releases and creates the GitHub Release from this file.
  `pnpm smoke` runs in CI without credentials.
- Fixes since 0.2.1: app API contract matched, HTTP transport hardened, `capPayload` no longer
  loops on one-item arrays, `glama.json` added.

### Fixed

- A `401` caused by a wrong flat or membership (`not_a_member`, `member_deactivated`) no longer
  wipes the session; only `auth_required` triggers a refresh. A refresh uses the session's own
  refresh token, and the bootstrap token is tried at most once per process.
- Two processes sharing the session cache no longer log each other out: when a refresh is
  rejected, a newer session written by the other process is adopted instead of deleted. The cache
  file is written to a temporary file with mode `0600` and renamed over the old one.
- A retried `DELETE` that finds the row already gone returns `{ deleted: true, alreadyGone: true }`
  instead of a misleading `404`. A `PATCH` with an `expected*` guard is no longer replayed after
  a network error, since the first attempt may have been applied.

### Security

- CORS: the preflight answers the headers the browser asks for (`Access-Control-Request-Headers`,
  `Vary`), and the default allow list includes `mcp-method` and `mcp-name`, so MCP Inspector and
  2.x SDK clients get through it.
- `MANAWG_HTTP_CORS=1` without an API key (keyless loopback) no longer sends
  `Access-Control-Allow-Origin: *` and no longer skips the Origin check: only `localhost`,
  `127.0.0.1` and `[::1]` origins pass, others get `403` (preflight included). With an API key or
  OAuth the answer stays `*`, since a foreign page holds no credential. This changes behaviour for
  keyless self-hosters who called the endpoint from a non-loopback web page; the hosted server
  uses OAuth and is unaffected.

## 0.2.1 (2026-11-04)

### Changed

- Release images are built for `linux/amd64` and `linux/arm64`; 0.2.0 was amd64 only.

## 0.2.0 (2026-11-04)

### Added

- `server.json` for the official MCP Registry, where the hosted server is listed as
  `com.manawg/mcp`.
- `MANAWG_AUTH=oauth`: the HTTP transport acts as an OAuth 2.1 resource server for many users.
  It serves RFC 9728 protected resource metadata, answers `401` with a `resource_metadata`
  challenge, verifies Supabase access tokens against the project's JWKS (issuer, audience, expiry,
  `client_id`) and forwards them to the app as `Authorization: Bearer`. No account is stored.
- Optional `wgCode` on every flat tool. `MANAWG_WG_CODE` is now optional: without it the account's
  only flat is used, several flats answer `wg_code_required`.
- Server instructions on `initialize`, so agents know the order of calls and the guard rails.
- Vercel deployment (`api/mcp.js`, `vercel.json`); `src/http.ts` is now a web-standard handler
  that the Node listener, the Docker image and the Vercel Function share.

- `category` on `expense_create`, `expense_update`, `recurring_create` and `recurring_update`
  (`groceries|household|housing|leisure|transport|other`); expenses created here no longer all land
  in `other`.
- `content` and `expectedUpdatedAt` on `note_update`, `expectedUpdatedAt` on `event_update`, so
  concurrent edits answer `announcement_changed` / `event_changed` instead of overwriting.
- `cash_payment_record` and `cash_payment_void`† for entering and taking back a cash payment over
  the net debt of a pair (`/api/wg/<code>/payments/manual`).

- `chat_unreact` (DELETE of an own reaction) — the only way to undo `chat_react`.
- Regression flows (`test/flows.test.ts`) running the real session controller, client and MCP server
  against a stateful stub app (`test/helpers/app.ts`) that enforces Origin, the Supabase cookie,
  idempotency keys, optimistic locking and strict bodies: session lifecycle, shopping, chores,
  expense → settlement, chat reactions, retries, rate limits, payload bounds, CSV export.
- API surface check (`test/api-surface.test.ts`): every tool and resource must map to a route in
  `test/fixtures/app-routes.json`, a snapshot of the app's `/api/wg` routes.
- Trimmed the unit tests that only restated single paths, defaults or schema limits.

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

- The container image builds on `node:22-alpine`, so every rebuild picks up the current Node 22
  security releases instead of staying on 22.12.
- `wg_create` is no longer gated behind `MANAWG_ALLOW_DESTRUCTIVE`: it only creates.
- `MANAWG_WG_CODE` must be a share code the app issues (8 characters, Crockford base32).

- Tool titles and descriptions, resources and prompts are in English. The prompts answer in the
  language of the conversation; their arguments are now `focus` (`daily_brief`) and `tone`
  (`payment_reminder`) instead of `fokus` and `ton`.
- The inventory tools use the app's English keys for `unit` and `category`.
- The member identity bootstrap, `identity.json` and `MANAWG_MEMBER_ID` / `MANAWG_MEMBER_TOKEN` /
  `MANAWG_IDENTITY_CACHE` are gone: the app resolves the member from the session cookie and never
  returned a member token. The variables are ignored if still set.
- Internals split into focused modules: `errors.ts` (allowlist, `ManaWgError`, `describeError`),
  `register.ts` (resources, prompts, tools), `version.ts`, `ids.ts`; `auth.ts` Set-Cookie handling is
  pure functions; the build uses `tsconfig.build.json` instead of a long command line.

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

### Removed

- `paypal_order_create` and `paypal_capture`: the app no longer has PayPal. Their error codes and
  the `paypalMerchantId` mentions in the member tools are gone.
- `member_claim`: the app removed its claim route for members from before accounts, so the tool,
  the request headers it needed and the codes `account_already_linked`, `member_already_linked` and
  `legacy_proof_required` are gone.

### Fixed

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
- The error allowlist grew from 130 to 241 codes, so conflicts such as `chore_changed`,
  `expense_conflict`, `not_admin`, `message_deleted` or `payload_changed` reach the model instead of
  `upstream_http_409`.
- Tool descriptions corrected where they promised behaviour the app does not have (permissions,
  response fields, limits, error codes).

- V1 could never complete a request: routes require a live Supabase session and an `Origin`
  header, neither of which the server sent. Both are now provided and verified by
  `pnpm live-check`.

### Security

- HTTP transport now requires `MANAWG_HTTP_API_KEY` when bound to a non-loopback host. Keyless
  HTTP remains available on loopback.
