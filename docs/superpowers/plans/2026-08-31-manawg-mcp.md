# ManaWG MCP Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone stdio MCP adapter that lets an AI agent read one ManaWG WG and perform two safe, idempotent actions through the existing HTTP API.

**Architecture:** `McpServer` is the protocol adapter. A single `ManaWgClient` module owns configuration, URL construction, auth headers, timeout, idempotency, retry, JSON decoding, and upstream error translation. The server handlers only validate MCP inputs and call that client; no ManaWG source or database is imported.

**Tech Stack:** Node.js 22.x, pnpm 9.x, TypeScript ESM, `@modelcontextprotocol/server` v2, `zod` v4, Vitest, native `fetch` and `crypto.randomUUID()`.

**Spec:** `docs/superpowers/specs/2026-08-31-manawg-mcp-design.md`

## Global Constraints

- Project root is `/Users/abu/Company/manawg-mcp`; do not modify `/Users/abu/Company/manawg-app`.
- Runtime is Node `22.x`; package manager is pnpm `9.x`.
- MCP transport is stdio; stdout contains only MCP JSON-RPC, and logs use stderr.
- Runtime dependencies are `@modelcontextprotocol/server` and `zod`; do not add an HTTP framework or dotenv.
- Credentials come from `MANAWG_BASE_URL`, `MANAWG_WG_CODE`, `MANAWG_MEMBER_ID`, and `MANAWG_MEMBER_TOKEN`; never accept or log `MEMBER_SESSION_SECRET`.
- V1 exposes exactly two resources (`manawg://current/dashboard`, `manawg://current/shopping`) and two tools (`shopping_add`, `chore_complete`).
- Writes send `Idempotency-Key`; retry only once for 502/503/504 with the same key; never retry 4xx or 429.
- Credential values, auth headers, complete credential-bearing URLs, and secret-bearing bodies must not appear in logs or error text.
- Every production function has a focused test, and each test must be observed failing before its implementation is written.

## File Map

- Create: `.gitignore` — ignore build output, dependencies, local env files, and test artifacts.
- Create: `.nvmrc` — pin `22`.
- Create: `package.json` — ESM package metadata, scripts, and minimal dependencies.
- Create: `tsconfig.json` — strict TypeScript ESM configuration.
- Create: `src/config.ts` — validate environment and return a redacted-safe configuration.
- Create: `src/manawg-client.ts` — deep ManaWG HTTP adapter.
- Create: `src/server.ts` — register the two resources and two tools.
- Create: `src/index.ts` — load config and serve stdio; stderr-only startup/shutdown diagnostics.
- Create: `test/config.test.ts` — configuration/redaction contract.
- Create: `test/manawg-client.test.ts` — HTTP/auth/retry/error contract.
- Create: `test/server.test.ts` — MCP discovery and handler contract against a local HTTP stub.
- Create: `README.md` — setup, host configuration, tool/resource contract, and security limits.

### Task 1: Bootstrap and configuration

**Files:**
- Create: `.gitignore`, `.nvmrc`, `package.json`, `tsconfig.json`
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces `AppConfig = { baseUrl: string; wgCode: string; memberId: string; memberToken: string; timeoutMs: number }`.
- Produces `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`.

- [ ] **Step 1: Write the failing configuration tests**

```ts
function validEnv(): NodeJS.ProcessEnv {
  return {
    MANAWG_BASE_URL: 'https://example.test/',
    MANAWG_WG_CODE: 'WG123',
    MANAWG_MEMBER_ID: '00000000-0000-4000-8000-000000000001',
    MANAWG_MEMBER_TOKEN: 'a'.repeat(64),
  };
}

it('rejects missing required credentials without echoing their values', () => {
  expect(() => loadConfig({ MANAWG_BASE_URL: 'https://example.test' })).toThrow('MANAWG_WG_CODE');
});

it('accepts a valid configuration and normalizes the base URL', () => {
  expect(loadConfig(validEnv()).baseUrl).toBe('https://example.test');
});
```

- [ ] **Step 2: Run the focused test and verify it fails because `loadConfig` is missing**

Run: `pnpm test -- test/config.test.ts`

Expected: FAIL with an import or missing-function error, not a passing test.

- [ ] **Step 3: Add the minimal strict ESM project and implement `loadConfig`**

Validate an absolute `http` or `https` URL, non-empty WG code, UUID member ID, and 64-character hexadecimal member token. Trim values before validation. Never include env values in thrown errors. Use `timeoutMs = 10_000` as an internal constant.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `pnpm test -- test/config.test.ts && pnpm typecheck`

Expected: PASS with no stdout diagnostics other than test output.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .nvmrc package.json tsconfig.json src/config.ts test/config.test.ts
git commit -m "chore: bootstrap standalone ManaWG MCP adapter"
```

### Task 2: ManaWG HTTP adapter

**Files:**
- Create: `src/manawg-client.ts`
- Test: `test/manawg-client.test.ts`

**Interfaces:**
- Consumes `AppConfig` from Task 1.
- Produces `createManaWgClient(config: AppConfig, fetchImpl?: typeof fetch)` with `getDashboard()`, `getShopping()`, `addShoppingItem(input)`, and `completeChore(choreId)` methods.

- [ ] **Step 1: Write failing client tests**

```ts
const validConfig: AppConfig = {
  baseUrl: 'https://example.test',
  wgCode: 'WG123',
  memberId: '00000000-0000-4000-8000-000000000001',
  memberToken: 'a'.repeat(64),
  timeoutMs: 10_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

it('sends member headers and reads dashboard JSON', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(validConfig, fetchMock);
  await client.getDashboard();
  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.test/api/wg/WG123/dashboard',
    expect.objectContaining({ headers: expect.any(Headers) }),
  );
});

it('retries one transient write with the same idempotency key', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 503)).mockResolvedValueOnce(jsonResponse({ item: { id: '1' } }));
  await createManaWgClient(validConfig, fetchMock).addShoppingItem({ name: 'Milch' });
  expect(fetchMock.mock.calls[0][1].headers.get('Idempotency-Key')).toBe(fetchMock.mock.calls[1][1].headers.get('Idempotency-Key'));
});
```

- [ ] **Step 2: Run `pnpm test -- test/manawg-client.test.ts` and verify the missing adapter causes the expected failure**

- [ ] **Step 3: Implement URL construction, headers, timeout, JSON decoding, safe errors, and one transient retry**

Use native `fetch`, `AbortSignal.timeout(config.timeoutMs)`, and `randomUUID()`. Encode the WG code and chore ID as path segments. Send `x-manawg-member-id`, `x-manawg-member-token`, and `Idempotency-Key` on writes. Map upstream `{ error, code? }` into an error whose message contains only the stable error code or `upstream_http_<status>`.

- [ ] **Step 4: Run client tests and typecheck**

Run: `pnpm test -- test/manawg-client.test.ts && pnpm typecheck`

Expected: PASS, including no-retry tests for 400, 401, 403, 404, 409, and 429.

- [ ] **Step 5: Commit**

```bash
git add src/manawg-client.ts test/manawg-client.test.ts
git commit -m "feat: add safe ManaWG HTTP adapter"
```

### Task 3: MCP resources and tools

**Files:**
- Create: `src/server.ts`, `src/index.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes `createManaWgClient` from Task 2.
- Produces `buildServer(client)` and `start()`.
- Registers resource URIs `manawg://current/dashboard` and `manawg://current/shopping`.
- Registers tools `shopping_add({ name, quantity? })` and `chore_complete({ choreId })`.

- [ ] **Step 1: Write failing MCP discovery and call tests**

```ts
it('exposes exactly the v1 resources and tools', async () => {
  const client = await connectTestServer(buildServer(fakeManaWgClient()));
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['shopping_add', 'chore_complete']);
  expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual([
    'manawg://current/dashboard',
    'manawg://current/shopping',
  ]);
});

it('calls shopping_add with validated input', async () => {
  const fake = fakeManaWgClient();
  const client = await connectTestServer(buildServer(fake));
  await client.callTool({ name: 'shopping_add', arguments: { name: 'Milch', quantity: '2' } });
  expect(fake.addShoppingItem).toHaveBeenCalledWith({ name: 'Milch', quantity: '2' });
});
```

- [ ] **Step 2: Run `pnpm test -- test/server.test.ts` and verify the server is missing**

- [ ] **Step 3: Register resources and tools with Zod v4 schemas**

Return JSON resource contents with `application/json`. Return concise human-readable tool text plus structured JSON when the SDK supports it. Convert client errors into `isError: true` tool results without exposing credentials. Do not log from tool handlers.

- [ ] **Step 4: Implement stdio startup**

Use `serveStdio(() => buildServer(createManaWgClient(loadConfig())))` from `@modelcontextprotocol/server/stdio`. Log only `ManaWG MCP server ready` to stderr. Never use `console.log`.

- [ ] **Step 5: Run server tests, typecheck, and build**

Run: `pnpm test -- test/server.test.ts && pnpm typecheck && pnpm build`

Expected: PASS and a runnable `dist/index.js`.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/index.ts test/server.test.ts
git commit -m "feat: expose ManaWG resources and tools over MCP"
```

### Task 4: Documentation and verification

**Files:**
- Create: `README.md`
- Modify: `package.json` only if a verification script is needed.

- [ ] **Step 1: Document external credential file and host configuration**

Document `/Users/abu/.config/manawg-mcp/env` with placeholders only, `chmod 600`, and a host command using an absolute Node-22 executable plus `dist/index.js`. State that `MEMBER_SESSION_SECRET` must never be provided.

- [ ] **Step 2: Run the complete local gate**

Run: `pnpm typecheck && pnpm test && pnpm build`

Expected: all checks pass; no credentials are needed for unit tests.

- [ ] **Step 3: Run MCP Inspector only when available**

Run: `pnpm exec @modelcontextprotocol/inspector node dist/index.js`

Expected: the inspector lists exactly two resources and two tools. If the inspector package is unavailable, record that as an environment limitation rather than adding a runtime dependency.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md package.json
git commit -m "docs: document ManaWG MCP setup and limits"
```
