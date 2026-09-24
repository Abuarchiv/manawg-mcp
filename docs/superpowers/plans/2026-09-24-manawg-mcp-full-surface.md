# Plan — ManaWG MCP full surface (2026-09-24)

Execution plan for spec `2026-09-24-manawg-mcp-full-surface`. Status: steps 1–8 done,
step 9 pending real credentials.

| # | Step | Verification |
| --- | --- | --- |
| 1 | Reproduce baseline on Node 22 + pnpm 9.15.9 | `pnpm typecheck`, `pnpm test` (42), `pnpm build` green |
| 2 | Extend `src/config.ts` (Origin, Supabase auth config, session cache path, `MANAWG_ALLOW_DESTRUCTIVE`) | `test/config.test.ts` (24 tests, no secret echo) |
| 3 | Add `src/auth.ts`: sign-in grants, cookie chunking, cache, `Set-Cookie` ingest, invalidate | `test/auth.test.ts` (13 tests) |
| 4 | Rework `src/manawg-client.ts`: generic `call`, `Origin`, cookies, one 401 retry, write retry, allowlisted codes, `redirect: error` | `test/manawg-client.test.ts` (28 tests) |
| 5 | Tool registry (`src/tools/*.ts`) + `src/resources.ts` + `src/server.ts` + `src/index.ts` wiring | `test/server.test.ts` (25 tests): tool/resource sets, routing, validation, safe errors |
| 6 | Biome config + `pnpm lint` (0 diagnostics) | `biome check .` clean |
| 7 | CI workflow, `.env.example`, `scripts/live-check.mjs` | workflow runs lint/typecheck/test/build; live-check fails safely without credentials |
| 8 | README, CHANGELOG, spec + this plan | docs describe the shipped surface |
| 9 | Fill `~/.config/manawg-mcp/env`, run `pnpm live-check` | all seven probes `ok`, `live_check: OK` |

## Risks carried forward

- Cookie chunking must keep matching `@supabase/ssr`; the auth tests pin the single-chunk form and
  round-trip the chunked form.
- The app may add routes; the registry is the single place to extend.
- Rate limits: writes are retried only for 502/503/504 with the same idempotency key; 429 surfaces
  `retry_after_s` instead of retrying.
