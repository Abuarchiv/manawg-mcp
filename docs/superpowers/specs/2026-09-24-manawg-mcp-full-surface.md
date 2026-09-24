# ManaWG MCP — full surface (2026-09-24)

Replaces the V1 design (two tools, two resources) with the complete read/write surface of
`/api/wg/[code]` plus the session auth V1 was missing.

## Context

V1 was never executed against the real app. Three findings define this spec:

1. Every `/api/wg/[code]` route calls `requireWgMember`, which needs a live Supabase session
   (`authorization` header or `sb-*-auth-token*` cookies). Member headers alone return
   `401 auth_required`.
2. Mutating routes additionally fail the middleware `cross_origin_blocked` check unless the
   request carries an `Origin` header matching the app.
3. The MCP is an agent-facing CLI surface: stdio transport, no remote HTTP endpoint, no OAuth.

## Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | The MCP signs into Supabase itself (refresh token **or** email/password) and replays the session as cookies | Matches what the app reads; no app change, no custom auth endpoint |
| D2 | Cookie serialization mirrors `@supabase/ssr` 0.12.5 (`sb-<project>-auth-token`, chunked at 3180 chars, URI-encoded) | Anything else is silently ignored by `getAuthenticatedUser` |
| D3 | Session persisted at `~/.config/manawg-mcp/session.json`, mode `0600` | Repeated cold starts must not re-prompt or rate-limit sign-in |
| D4 | `Set-Cookie` from app responses is ingested; `401 auth_required` triggers exactly one invalidate-and-retry | Middleware may rotate the session mid-flight |
| D5 | `Origin: <MANAWG_BASE_URL>` on every request, redirects rejected | Cross-origin writes are blocked otherwise; redirects must not leak member headers |
| D6 | Tools are declared in a registry (`src/tools/*.ts`) with title, description, schema, annotations | 65 hand-written `registerTool` blocks would drift in quality |
| D7 | Destructive tools (deletes, member/WG settings, reminder pushes) are not registered unless `MANAWG_ALLOW_DESTRUCTIVE=1` | An agent must not be able to destroy data by default |
| D8 | Errors surface only allowlisted codes, never upstream messages | Response bodies can carry input echoes and upstream detail |
| D9 | PayPal, imports, calendar feed, push subscriptions, `test_notification`, member join/claim and WG deletion stay out of scope | Money movement, secrets, and one-shot identity flows are out of scope for V2 |
| D10 | `MANAWG_MEMBER_ID`/`MANAWG_MEMBER_TOKEN` are optional; without them the client reads both from `GET /api/wg/[code]` after the first working session and caches them in `identity.json` (`0600`) | The app derives the member token server-side, so operators cannot look it up themselves; setup reduces to the WG code plus one sign-in mode |

## Surface

- **65 tools** over 10 domains (see README table), every input schema mirroring the route
  contract: `amountCents` 1..100000000, ISO datetimes with offset, split sums, lengths,
  `delta` -100..0, chat cursor pairs, pagination bounds.
- **12 resources** `manawg://current/{dashboard,members,expenses,recurring,shopping,inventory,chores,notes,chat,events,absences,activity}`.
- **Tool result**: `content[0].text = JSON.stringify(payload)` plus `structuredContent`;
  failures return `isError` with `ManaWG request failed[: code][ (details)][ retry_after_s=n]`.

## Gates

- No commit/push without an explicit request; no secrets in files, logs or errors.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm smoke` green; `pnpm live-check`
  green once real credentials exist (read-only probes only).
- Destructive tools remain unregistered unless the operator opts in.
- The app repo stays untouched — no OpenSpec change, no route edits.
