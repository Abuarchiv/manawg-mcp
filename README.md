# manawg-mcp

MCP server for a [ManaWG](https://github.com/Abuarchiv/manawg-app) household. Node 22, stdio transport,
65 tools and 12 resources over the same HTTP API the web app uses.

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

## Resources (12)

`manawg://current/` + `dashboard`, `members`, `expenses`, `recurring`, `shopping`, `inventory`,
`chores`, `notes`, `chat`, `events`, `absences`, `activity` — each returns the live JSON payload of
the matching route, `mimeType: application/json`.

## Tools (65)

| Domain | Tools |
| --- | --- |
| Overview | `wg_overview`, `dashboard_get`, `activity_get`, `search`, `export_get` |
| Finance | `expenses_list`, `expense_create`, `expense_update`, `expense_delete`†, `expense_split_settle`, `settlement_preview`, `settlement_commit`, `balances_get`, `reminders_list`, `reminder_send`† |
| Recurring | `recurring_list`, `recurring_get`, `recurring_create`, `recurring_update`, `recurring_delete`† |
| Shopping | `shopping_list`, `shopping_add`, `shopping_set_bought`, `shopping_remove`†, `shopping_clear_bought`† |
| Inventory | `inventory_list`, `inventory_add`, `inventory_update`, `inventory_consume`, `inventory_remove`† |
| Chores | `chores_list`, `chore_get`, `chore_create`, `chore_update`, `chore_complete`, `chore_delete`† |
| Notes | `notes_list`, `note_create`, `note_update`, `note_delete`†, `note_comment`, `note_comment_update`, `note_comment_delete`†, `note_react` |
| Chat | `chat_messages`, `chat_send`, `chat_edit`, `chat_react`, `chat_mark_read`, `chat_unread`, `chat_delete`† |
| Calendar | `events_list`, `event_get`, `event_create`, `event_update`, `event_delete`†, `absences_list`, `absence_create`, `absence_delete`† |
| Members | `members_list`, `member_get`, `member_update`†, `notifications_get`, `notifications_update`, `wg_update`† |

† destructive: only registered when `MANAWG_ALLOW_DESTRUCTIVE=1` (14 tools), and annotated with
`destructiveHint`. Read tools are annotated `readOnlyHint`.

Input schemas mirror the API contract (money in `amountCents`, ISO datetimes with offset, split
counts, lengths). Every tool returns the route payload as text plus `structuredContent`.

## Error contract

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
pnpm test        # vitest (97 tests, no credentials needed)
pnpm build       # tsc to dist/
pnpm smoke       # stdio handshake against dist/: tools, resources, destructive gate
pnpm inspector   # MCP Inspector (web UI) against dist/index.js
pnpm live-check  # read-only probes against the real deployment (credentials required)
```

## Security boundaries

- Keep credentials out of git and logs; only `.env.example` placeholders are committed.
- The credential file and the session cache stay mode `0600` outside the repo.
- Never set `MEMBER_SESSION_SECRET`.
- Error text is generated locally from an allowlist — upstream response bodies are not forwarded.
