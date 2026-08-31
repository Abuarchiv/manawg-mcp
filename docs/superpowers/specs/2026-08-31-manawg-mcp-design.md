# ManaWG MCP Adapter Design

## Goal

Provide AI agents with a small, reliable MCP interface to one configured ManaWG account without modifying the ManaWG application.

## Scope

The project is a standalone Node.js 22 / pnpm 9 TypeScript ESM process at `/Users/abu/Company/manawg-mcp`. It speaks MCP over stdio and calls the existing ManaWG HTTP routes. It never connects directly to Postgres, imports ManaWG source files, or changes the ManaWG app checkout.

The configured process is bound to one WG share code and one member identity. Credentials are loaded from an external environment file. The MCP process sends `x-manawg-member-id` and `x-manawg-member-token` to the app; `MEMBER_SESSION_SECRET` never leaves the app.

## MCP interface

Resources:

- `manawg://current/dashboard` reads `/api/wg/{code}/dashboard`.
- `manawg://current/shopping` reads `/api/wg/{code}/shopping`.

Tools:

- `shopping_add({ name, quantity? })` calls `POST /api/wg/{code}/shopping`.
- `chore_complete({ choreId })` calls `POST /api/wg/{code}/chores/{choreId}/complete`.

Tool inputs are validated at the MCP trust boundary. `name` is 1–120 trimmed characters, `quantity` is optional and at most 40 trimmed characters, and `choreId` is a UUID. The MCP always generates one UUID Idempotency-Key per write call. It may retry a failed transport request once for HTTP 502, 503, or 504 with the same key; it never retries 4xx or 429 responses.

## Error and logging rules

ManaWG errors with `{ error, code? }` become safe MCP tool errors. Credentials, authorization headers, complete credential-bearing URLs, request bodies containing secrets, and upstream response dumps never appear in errors or logs. `stdout` is reserved for MCP JSON-RPC; diagnostics use `stderr`.

## Explicit non-goals

V1 does not expose admin actions, deletes, PayPal, uploads, notifications, chat, WG creation/join, dynamic WG switching, prompts, remote HTTP transport, OAuth, or direct database access. A remote deployment is a separate design because it requires TLS, per-request identity, OAuth/PKCE, scope enforcement, rate limits, CORS/origin protection, and revocable credentials.

## Verification

The project must pass `pnpm typecheck`, `pnpm test`, and `pnpm build`. Tests cover configuration validation and redaction, HTTP request construction and error/retry behavior, MCP resource/tool discovery, and tool calls against a local HTTP stub. A live check, when credentials are supplied, is read-only against dashboard and shopping endpoints.
