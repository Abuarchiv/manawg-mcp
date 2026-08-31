# Task 2 Bericht

## Status

DONE

## Commit-SHA(s)

- `4497eda` — `feat: add safe ManaWG HTTP adapter`

## RED-Phase

Ausgeführt unter Node 22:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test -- test/manawg-client.test.ts
```

Erwarteter erster Fehler vor `src/manawg-client.ts`:

```text
FAIL  test/manawg-client.test.ts
Error: Cannot find module '../src/manawg-client.js' imported from '/Users/abu/Company/manawg-mcp/test/manawg-client.test.ts'
Tests  no tests
```

## GREEN-Phase und Typecheck

Ausgeführt unter Node 22:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test -- test/manawg-client.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test -- test/manawg-client.test.ts && PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
```

Beobachtet:

```text
✓ test/manawg-client.test.ts (15 tests)
Test Files  1 passed (1)
Tests       15 passed (15)
```

`tsc --noEmit` lief ohne Diagnostik durch.

Verwendete Versionen:

- Node `v22.23.2` — `/opt/homebrew/opt/node@22/bin/node`
- pnpm `9.15.9`

## Geänderte Dateien

- `src/manawg-client.ts`
- `test/manawg-client.test.ts`
- `.superpowers/sdd/2026-08-31-manawg-mcp/task-2-report.md`

`createManaWgClient` ist als tiefer HTTP-Adapter umgesetzt und verwendet die vorhandene `AppConfig` aus Task 1. Der Adapter baut URL-kodierte Pfade für WG-Code und Chore-ID, sendet auf allen Requests `x-manawg-member-id` und `x-manawg-member-token`, nutzt natives `fetch` mit `AbortSignal.timeout(config.timeoutMs)`, erzeugt pro Write genau einen UUID-`Idempotency-Key`, wiederverwendet diesen bei genau einem Retry für HTTP `502`, `503` oder `504` und übersetzt Upstream-Fehler in stabile, sichere Fehlermeldungen ohne Secret-Leak.

Die Tests decken Lesepfade, Write-Header, JSON-Body, URL-Encoding, Retry mit identischem Idempotency-Key, No-Retry für `400`, `401`, `403`, `404`, `409` und `429` sowie sichere Fehlerübersetzung für HTTP- und Transportfehler ab.

## Bedenken

Keine. `graphify-out/graph.json` ist in diesem Checkout nicht vorhanden, daher war kein Graphify-Update möglich. Der ManaWG-App-Checkout `/Users/abu/Company/manawg-app` wurde nicht verändert.

## Round 1 — Task-Review-Fix

### Status

DONE

### Commit-SHA(s)

- `fdca1f0` — `fix: tighten ManaWG client error redaction`

### RED

Ausgeführt unter Node 22:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test -- test/manawg-client.test.ts
```

Beobachtet: `17 tests | 2 failed`. Die neuen Redaction-Fälle schlugen vor der Implementierung erwartungsgemäß fehl:

```text
× falls back to the HTTP status when the upstream code is unknown or secret-bearing
  expected 'secret:aaaaaaaa...' to be 'upstream_http_409'

× sanitizes response body read failures
  expected 'secret:aaaaaaaa...' to be 'upstream_http_500'
```

### GREEN und Typecheck

Ausgeführt unter Node 22:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test -- test/manawg-client.test.ts && PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
```

Beobachtet:

```text
✓ test/manawg-client.test.ts (17 tests)
Test Files  1 passed (1)
Tests       17 passed (17)
```

`tsc --noEmit` lief ohne Diagnostik durch.

### Geänderte Dateien

- `src/manawg-client.ts`
- `test/manawg-client.test.ts`
- `.superpowers/sdd/2026-08-31-manawg-mcp/task-2-report.md`

Die No-Retry-Tests verwenden jetzt echte stabile ManaWG-Codes statt offener Platzhalter. Ergänzt wurden gezielte Redaction-Tests für einen unbekannten beziehungsweise secret-bearing Upstream-`code` und für einen Fehler beim Lesen des Response-Bodys.

Der Adapter akzeptiert jetzt nur noch eine explizite, begrenzte Allowlist stabiler ManaWG-Fehlercodes. Unbekannte oder ungültige `code`-Werte werden auf `upstream_http_<status>` zurückgeführt. Fehler beim Lesen oder Decodieren des Response-Bodys werden ebenfalls sicher in `upstream_http_<status>` übersetzt, sodass weder reflektierte Secret-Werte noch beliebiger Upstream-Text in MCP-Fehlern landen.

### Bedenken

Keine. Die bestehenden Retry-, Header- und URL-Encoding-Regeln blieben unverändert, und der ManaWG-App-Checkout wurde nicht verändert.
