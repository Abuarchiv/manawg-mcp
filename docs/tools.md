# Tools, resources and prompts

The reference for everything the server exposes: 74 tools, 13 resources, 4 resource templates and
4 prompts. Each tool calls exactly one route of the ManaWG app API with the body that route
accepts, so tools and app never disagree about what is allowed.

- [Tools](#tools) · [How writes stay safe](#how-writes-stay-safe) · [Resources](#resources) ·
  [Prompts](#prompts) · [Errors](#errors) · [Not exposed](#not-exposed-on-purpose)

## Tools

Every tool that works inside a flat takes an optional `wgCode` (the share code from `wg_list`).
Without it the call goes to `MANAWG_WG_CODE`, and without that to the account's only flat; an
account in several flats gets `wg_code_required` and passes `wgCode` from then on.

Read tools carry `readOnlyHint`, destructive tools `destructiveHint`. Every tool returns the route
payload as text and as `structuredContent`.

### Overview

| Tool | What it does | Kind |
| --- | --- | --- |
| `wg_list` | List your flats | read |
| `wg_overview` | Flat overview | read |
| `dashboard_get` | Read the dashboard | read |
| `activity_get` | Read the activity feed | read |
| `export_get` | Export flat data | read |

### Money

| Tool | What it does | Kind |
| --- | --- | --- |
| `expenses_list` | Read expenses and payments | read |
| `expense_create` | Create an expense | write |
| `expense_update` | Edit an expense | write |
| `expense_delete` | Delete an expense | destructive † |
| `expense_split_settle` | Mark a split as settled | write |
| `settlement_preview` | Preview a settlement | read |
| `settlement_commit` | Commit a settlement | write |
| `cash_payment_record` | Record a cash payment | write |
| `cash_payment_void` | Void a cash payment | destructive † |
| `balances_get` | Read open balances | read |
| `reminders_list` | Read the reminder history | read |
| `reminder_send` | Send a payment reminder | destructive † |

### Fixed costs

| Tool | What it does | Kind |
| --- | --- | --- |
| `recurring_list` | Read fixed costs | read |
| `recurring_get` | Read one fixed cost | read |
| `recurring_create` | Create a fixed cost | write |
| `recurring_update` | Edit or pause a fixed cost | write |
| `recurring_advance` | Advance a fixed cost now | write |
| `recurring_delete` | Delete a fixed cost | destructive † |

### Shopping

| Tool | What it does | Kind |
| --- | --- | --- |
| `shopping_list` | Read the shopping list | read |
| `shopping_add` | Add a shopping item | write |
| `shopping_set_bought` | Mark an item as bought | write |
| `shopping_remove` | Remove a shopping item | destructive † |
| `shopping_clear_bought` | Clear bought items (admin) | destructive † |

### Supplies

| Tool | What it does | Kind |
| --- | --- | --- |
| `inventory_list` | Read supplies | read |
| `inventory_add` | Add a supply item | write |
| `inventory_update` | Edit a supply item | write |
| `inventory_consume` | Use up stock | write |
| `inventory_remove` | Delete a supply item | destructive † |

### Cleaning rota

| Tool | What it does | Kind |
| --- | --- | --- |
| `chores_list` | Read the cleaning rota | read |
| `chore_get` | Read one chore | read |
| `chore_create` | Create a chore | write |
| `chore_update` | Edit a chore | write |
| `chore_complete` | Complete a chore | write |
| `chore_delete` | Delete a chore | destructive † |

### Noticeboard

| Tool | What it does | Kind |
| --- | --- | --- |
| `notes_list` | Read the noticeboard | read |
| `note_comments` | Read the comments on a post | read |
| `note_create` | Write a post | write |
| `note_update` | Change a post | write |
| `note_delete` | Delete a post | destructive † |
| `note_comment` | Write a comment | write |
| `note_comment_update` | Edit your own comment | write |
| `note_comment_delete` | Delete your own comment | destructive † |
| `note_react` | Set a reaction | write |

### Chat

| Tool | What it does | Kind |
| --- | --- | --- |
| `chat_messages` | Read the chat | read |
| `chat_send` | Send a chat message | write |
| `chat_edit` | Edit a chat message | write |
| `chat_react` | Add a chat reaction | write |
| `chat_unreact` | Remove a chat reaction | write |
| `chat_mark_read` | Mark the chat as read | write |
| `chat_unread` | Count unread messages | read |
| `chat_delete` | Delete a chat message | destructive † |

### Calendar and absences

| Tool | What it does | Kind |
| --- | --- | --- |
| `events_list` | Read calendar events | read |
| `event_get` | Read a calendar event | read |
| `event_create` | Create a calendar event | write |
| `event_update` | Edit a calendar event | write |
| `event_delete` | Delete a calendar event | destructive † |
| `absences_list` | Read absences | read |
| `absence_create` | Record an absence | write |
| `absence_delete` | Delete an absence | destructive † |

### Members and settings

| Tool | What it does | Kind |
| --- | --- | --- |
| `members_list` | List members | read |
| `member_get` | Read a member and their open balances | read |
| `member_update` | Change a member (admin, sensitive) | destructive † |
| `notifications_get` | Read notification settings | read |
| `notifications_update` | Change notification settings | write |
| `wg_update` | Change flat settings (admin) | destructive † |
| `calendar_subscription_get` | Read the calendar subscription | read |

### Imports and new flats

| Tool | What it does | Kind |
| --- | --- | --- |
| `import_preview` | Preview an import | read |
| `import_commit` | Commit an import | destructive † |
| `wg_create` | Create a new flat | write |

† Destructive: registered only when `MANAWG_ALLOW_DESTRUCTIVE=1` (16 tools). The hosted server
at `mcp.manawg.com` leaves them off, so it exposes 58 tools. `import_preview` is a POST without
side effects and counts as read.

`export_get` with `format: csv` returns `{ contentType, content }`.

On `initialize` the server sends short instructions for agents: start with `wg_overview`, pass
`wgCode` for accounts with several flats, money in cents, read before guarded writes, never claim
that money moved, confirm before notifying people.

## How writes stay safe

Input schemas mirror the API contract: money in integer cents (`amountCents`), ISO datetimes with
an offset, split counts and lengths. Invalid arguments are rejected before any request is sent.

Writes that could race with a flatmate take the value the agent last read and fail instead of
overwriting:

- `chore_complete`: read `chores_list` first and pass `nextDueAt` as `expectedNextDueAt` and
  `assignedMemberId` (UUID or null) as `expectedAssignedMemberId`.
- `shopping_set_bought`: read `shopping_list` first and pass `updatedAt` as `expectedUpdatedAt`
  and `boughtAt` (or null) as `expectedBoughtAt`.
- `note_update` and `event_update` take `expectedUpdatedAt`.
- On `chore_occurrence_changed`, `shopping_item_changed`, `announcement_changed` or
  `event_changed`, read again and decide before retrying.

Fixed costs: to book a due charge, call `expense_create` with `recurringExpenseId` and
`expectedRecurringNextDueAt` (the template's `nextDueAt`); the app creates the expense and advances
the template in one step. `recurring_advance` only moves `nextDueAt`.

Debts are settled by hand. `settlement_commit` marks the previewed shares as paid, and
`cash_payment_record` enters a cash payment over the whole net debt of a pair (pass `netCents`
from `settlement_preview` as `expectedNetCents`). A wrong cash payment is taken back with
`cash_payment_void` and entered again. ManaWG never moves money.

Every write carries a fresh `Idempotency-Key`, and retries reuse it, so a request retried over a
bad connection is never booked twice.

## Resources

`manawg://current/` + `dashboard`, `members`, `expenses`, `recurring`, `shopping`, `inventory`,
`chores`, `notes`, `chat`, `events`, `absences`, `activity`, `wg` — each returns the live JSON
payload of the matching route, `mimeType: application/json`. `wg` is account-scoped (all households
of the signed-in account, no WG code in the path).

Reads are bounded so no resource floods the context: every payload is capped at 100 KB (arrays
shrink from the largest one until it fits) and `expenses` additionally keeps only the newest 100
entries. Truncation is never silent — the result carries `"_mcp": { "truncated": true, "fields":
[…] }`, and full history is available through `expenses_list` with `limit`/`offset`.

### Resource templates

`manawg://current/{event|chore|member|recurring}/{id}` resolve one entity by UUID — the four
routes that answer `GET` on their own. Everything else is listed as a static resource because the
app has no single-entity `GET` for it.

## Prompts

| Prompt | Arguments | Purpose |
| --- | --- | --- |
| `daily_brief` | `focus` | Dashboard, activity, shopping, chores and calendar in up to 10 bullets |
| `shopping_run` | – | Shopping list merged with the pantry, grouped into one tour list |
| `payment_reminder` | `tone` | Draft only: friendly reminder for open balances, never sends |
| `settlement_plan` | – | Minimal transfers from `balances_get` + `settlement_preview`, never commits |

Prompts return instructions plus tool names; the destructive steps stay gated behind an explicit
confirmation.

## Errors

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

The calendar feed URL (contains a feed secret), push subscription endpoints, `test_notification`
and WG deletion. Set `MANAWG_ALLOW_DESTRUCTIVE=1` to enable the destructive tools listed above.
