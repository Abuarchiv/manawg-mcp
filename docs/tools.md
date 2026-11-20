# Tools, resources and prompts

The reference for everything the server exposes: 87 tools, 13 resources, 4 resource templates and
4 prompts. Each tool calls exactly one route of the ManaWG app API with the body that route
accepts. A test fails when the app has a route that no tool or resource covers.

- [Tools](#tools) · [How writes stay safe](#how-writes-stay-safe) · [Resources](#resources) ·
  [Prompts](#prompts) · [Tool groups](#tool-groups) · [Errors](#errors) ·
  [Not exposed](#not-exposed-on-purpose)

## Tools

Every tool that works inside a flat takes an optional `wgCode` (the share code from `wg_list`).
Without it the call goes to `MANAWG_WG_CODE`, and without that to the account's only flat; an
account in several flats gets `wg_code_required` and passes `wgCode` from then on.

Read tools carry `readOnlyHint`, destructive tools `destructiveHint`. A tool returns the route
payload as text and, when the payload is an object, as `structuredContent`.

Results are bounded so they do not flood the context. A payload above 100 KB loses entries from its
largest array (or its largest string, such as a CSV export) until it fits. Truncation is never
silent: the result carries `"_mcp": { "truncated": true, "fields": […] }`.

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
| `shopping_update` | Edit a shopping item | write |
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
| `chore_complete_undo` | Undo a chore completion | write |
| `chore_delete` | Delete a chore | destructive † |

### Noticeboard

| Tool | What it does | Kind |
| --- | --- | --- |
| `notes_list` | Read the noticeboard | read |
| `note_comments` | Read the comments on a post | read |
| `note_create` | Write a post | write |
| `chore_swap_request` | Ask the flat to take over a chore | write |
| `note_update` | Edit a post | write |
| `note_delete` | Delete a post | destructive † |
| `note_comment` | Add a comment to a post | write |
| `note_comment_update` | Edit your own comment | write |
| `note_comment_delete` | Delete a comment | destructive † |
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
| `event_occurrence_change` | Cancel or move one occurrence | destructive † |
| `absences_list` | Read absences | read |
| `absence_create` | Record an absence | write |
| `absence_delete` | Delete an absence | destructive † |

### Members and settings

| Tool | What it does | Kind |
| --- | --- | --- |
| `members_list` | List members | read |
| `member_get` | Read a member and their open balances | read |
| `member_update` | Move a member out or back in | destructive † |
| `invite_create` | Create an invite link | write |
| `invites_list` | List active invite links | read |
| `invite_revoke` | Revoke an invite link | destructive † |
| `invite_email` | Email an invite link | destructive † |
| `notifications_get` | Read notification settings | read |
| `notifications_update` | Change notification settings | write |
| `wg_update` | Change flat settings (admin) | destructive † |

### Calendar feed, imports and new flats

| Tool | What it does | Kind |
| --- | --- | --- |
| `calendar_subscription_get` | Read the calendar subscription | read |
| `calendar_subscription_create` | Create the calendar subscription | write |
| `calendar_subscription_rotate` | Rotate the calendar subscription URL | destructive † |
| `calendar_subscription_revoke` | Revoke the calendar subscription | destructive † |
| `import_preview` | Preview an import | read |
| `import_commit` | Commit an import | destructive † |
| `imports_list` | List imports that can be undone | read |
| `import_undo` | Undo an import | destructive † |
| `wg_create` | Create a new flat | write |

† Destructive: registered only when `MANAWG_ALLOW_DESTRUCTIVE=1` (22 tools). The hosted server
at `mcp.manawg.com` leaves them off, so it exposes 65 tools. Besides deletions this covers actions
that cannot be taken back or change who can reach the flat: `import_commit` and `import_undo`,
`invite_revoke`, `invite_email` (it mails a join link to an outside address),
`calendar_subscription_rotate` and `calendar_subscription_revoke`, and
`event_occurrence_change` (cancelling a date has no undo). `import_preview` is a POST without side
effects and counts as read.

Imports read Splitwise, Splid, Tricount (older exports only: Tricount dropped export in 2024) and
Settle Up CSV files, or pasted receipt text. `import_commit` can be taken back in one step with
`import_undo`; `imports_list` finds the import id. New flatmates join through an invite link:
`invite_create` returns a link (valid 14 days, 10 joins, at most 20 active links per flat) and
`invite_email` sends one by mail, because the share code alone does not allow joining. The
calendar feed can be created, rotated and revoked; its URL is a secret and shown to the user only.

`activity_get` returns the newest 80 entries by default and up to 320 with `limit`; older history
comes from `export_get`, which returns `{ contentType, content }` with `format: csv`.
`chat_messages` pages back with `beforeId` only. Fixed costs are always in EUR, `recurring_create`
and `recurring_update` accept no other `currency`.

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
- `shopping_update`: read `shopping_list` first and pass both `expectedUpdatedAt` and
  `expectedBoughtAt`.
- `chore_update` takes an optional `expectedUpdatedAt` from `chores_list` or `chore_get`.
- `chore_complete_undo`: pass back the `completion` of the `chore_complete` response and the chore
  state it returned; the app only undoes the caller's latest completion, shortly after it.
- `note_update` and `event_update` take `expectedUpdatedAt`, and `event_occurrence_change` with
  action `detach` too.
- On `chore_occurrence_changed`, `chore_changed`, `shopping_item_changed`, `announcement_changed`
  or `event_changed`, read again and decide before retrying.

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

`manawg://current/` followed by `dashboard`, `members`, `expenses`, `recurring`, `shopping`,
`inventory`, `chores`, `notes`, `chat`, `events`, `absences`, `activity` or `wg`. Each returns the
live JSON payload of the matching route, `mimeType: application/json`. `wg` is account-scoped (all
households of the signed-in account, no WG code in the path).

Resources use the same 100 KB cap and `_mcp` marker as tool results. `expenses` is stricter: it
keeps only the newest 100 entries and at most 40 KB, and the full history is available through
`expenses_list` with `limit`/`offset`.

### Resource templates

`manawg://current/{event|chore|member|recurring}/{id}` resolve one entity by UUID. These are
the four routes that answer `GET` on their own; for everything else the app has no single-entity
`GET`, so it is listed as a static resource.

Each template also lists its entities in `resources/list` (up to 50, named by title, name or
description) and completes `{id}`, so a client's resource picker can offer real entries. If the
listing fails (for example no unique flat is configured), the template just lists nothing.

## Prompts

| Prompt | Arguments | Purpose |
| --- | --- | --- |
| `daily_brief` | `focus` | Dashboard, activity, shopping, chores and calendar in up to 10 bullets |
| `shopping_run` | – | Shopping list merged with the pantry, grouped into one tour list |
| `payment_reminder` | `tone` | Draft only: friendly reminder for open balances, never sends |
| `settlement_plan` | – | Fewest transfers from `dashboard_get` balances and `settlement_preview`; never commits |

Prompts return instructions plus tool names; the destructive steps stay gated behind an explicit
confirmation.

## Tool groups

To keep the tool list short, set `MANAWG_TOOLSETS` to the groups an agent needs, for example
`MANAWG_TOOLSETS=money,shopping`. Unset or `all` registers every group, and `overview` is always
registered because every task starts there. Prompts are offered only when all groups they call are
registered. Resources stay readable either way, so the setting shortens the tool list rather than
restricting access.

| Group | Sections above |
| --- | --- |
| `overview` | Overview |
| `money` | Money |
| `recurring` | Fixed costs |
| `shopping` | Shopping |
| `supplies` | Supplies |
| `chores` | Cleaning rota |
| `notes` | Noticeboard |
| `chat` | Chat |
| `calendar` | Calendar and absences |
| `members` | Members and settings |
| `household` | Calendar feed, imports and new flats |

## Errors

Transient failures are retried inside the server, at most twice more (after 200 ms and 800 ms):
`500`, `502` and `504` responses, `429` and `503` unless `Retry-After` asks for more than 2
seconds, network errors and per-attempt timeouts. Writes reuse their idempotency key on every
attempt. A `PATCH` with an `expected*` guard is not replayed after a network error, a timeout or a
`5xx`, because the first attempt may have been applied; only a `429` is repeated. One call,
retries included, ends after 45 seconds with `timeout`.

A `DELETE` retried after an unclear first attempt that finds the row gone answers
`{ deleted: true, alreadyGone: true }`. Longer waits asked for by a `429` or `503` are not slept
out: they surface immediately, with `retry_after_s=<n>` after the code.

Tool and resource failures carry no upstream message, URL or credential:

- `ManaWG request failed: <code>`. The code is the app's own error code when it is on a fixed
  allowlist (`validation_errors`, `splits_sum_mismatch`, `shopping_item_duplicate`, …). Otherwise
  the HTTP status decides: `401` gives `auth_required`, `403` `access_denied`, `404` `not_found`,
  `429` `too_many_requests`, `5xx` `internal_error` and any other status `upstream_http_<status>`.
- Without a usable response the code is `upstream_network_error` (app unreachable), `timeout`
  (a single attempt or the whole call ran out of time), `auth_failed` (sign-in failed) or
  `invalid_response` (a success answer that cannot be read). The server itself raises
  `wg_code_required`, `no_wg_membership` and `invalid_share_code` when the flat cannot be resolved.
- A `429` or `503` with `Retry-After` adds `retry_after_s=<n>`. Only `validation_errors` adds a truncated `details` snippet
  of the app's field errors (up to 400 characters).
- Invalid arguments are rejected by the MCP layer before any request is sent.

## Not exposed on purpose

Routes the app serves that no tool or resource calls, each with its reason in the
`INTENTIONALLY_UNEXPOSED` map of `test/api-surface.test.ts`; a new app route fails that test until it
gets a tool or an entry there:

- deleting a flat and handing over the admin role (irreversible, stay in the app);
- joining a flat (`POST members`, the invite preview): the invited person does this in the app;
- push subscriptions and `test_notification` (they belong to a browser);
- `DELETE recurring-expenses/{id}`, a duplicate of the collection route `recurring_delete` uses.
