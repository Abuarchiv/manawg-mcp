# Task 3 Report: MCP resources and tools

## Status

Completed best-effort implementation for Task 3 in `/Users/abu/Company/manawg-mcp`.

- Added MCP server construction via `McpServer`.
- Registered exactly the v1 resources:
  - `manawg://current/dashboard`
  - `manawg://current/shopping`
- Registered exactly the v1 tools:
  - `shopping_add`
  - `chore_complete`
- Added stdio startup via `serveStdio`.
- Used `createManaWgClient(loadConfig())` for runtime wiring.
- Did not modify `/Users/abu/Company/manawg-app`.
- Did not start subagents.

## Commit SHA(s)

- Implementation: `c4713fc775b6a29a49df7bed615bc2bc1988596f` (`feat: expose ManaWG resources and tools over MCP`)

## RED

Command:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test -- test/server.test.ts
```

Result:

```text
FAIL test/server.test.ts
Error: Cannot find module '../src/server.js' imported from '/Users/abu/Company/manawg-mcp/test/server.test.ts'
Test Files 1 failed (1)
Tests no tests
```

This confirmed the MCP server entry was missing before implementation.

## GREEN

Command:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test -- test/server.test.ts && PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck && PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm build
```

Result:

```text
test/server.test.ts (2 tests) PASS
pnpm typecheck PASS
pnpm build PASS
```

Node runtime used for gates:

```text
v22.23.2
```

## Files

- `src/server.ts`
  - Exports `buildServer(client)`.
  - Registers the two resources and two tools through the official SDK.
  - Converts client failures to `isError: true` tool results.
- `src/index.ts`
  - Exports `start()`.
  - Starts stdio with `serveStdio(() => buildServer(createManaWgClient(loadConfig())))`.
  - Writes readiness only to stderr.
- `test/server.test.ts`
  - Covers MCP discovery for exact v1 resources and tools.
  - Covers `shopping_add` validated tool-call forwarding.
- `package.json`
  - Adds `build`.
  - Adds allowed runtime/dev SDK dependencies.
- `pnpm-lock.yaml`
  - Created by pnpm for the installed packages.

## Bedenken

- The active shell default was Node `v26.7.0`; all required gates were run with Node 22 by prepending `/opt/homebrew/opt/node@22/bin` to `PATH`.
- The first build attempt failed because the existing `tsconfig.json` includes tests while `rootDir` was set to `src`; the build script now compiles only `src/*.ts`.
- That failed build attempt emitted untracked `test/*.js` artifacts; they were removed before committing.
- Tool-call tests currently cover discovery and `shopping_add`; `chore_complete`, resource reads, and tool error results are implemented but not covered by additional Task-3 tests.
- No official SDK API blocker remained after switching the test harness to `InMemoryTransport.createLinkedPair()`.
