# Contributing to manawg-mcp

Thanks for helping. This repository is the MCP server only. Problems with the app itself belong in
the [app repository](https://github.com/Abuarchiv/manawg/issues/new/choose).

## Before you start

- **Small fixes** (a wrong schema, a broken tool, a typo): open a pull request directly.
- **New tools or larger changes:** open an issue first and agree on the approach.
- **Security problems:** see [SECURITY.md](SECURITY.md), never a public issue.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Run it locally

You need Node.js 22 and pnpm 9.

```sh
git clone https://github.com/<you>/manawg-mcp.git   # your fork
cd manawg-mcp
corepack enable
pnpm install
pnpm build
```

Tests, lint and typecheck need no credentials. `pnpm live-check` talks to a real ManaWG instance and
needs the env file described in the [README](README.md#setup).

## Rules for changes

- **Follow the app's API.** A tool calls exactly one app route with the body the route accepts.
  When the app changes a route, update the tool, its input schema and `test/fixtures/app-routes.json`
  together.
- **Destructive tools stay gated.** Anything that deletes or cannot be undone registers only with
  `MANAWG_ALLOW_DESTRUCTIVE=1` and carries `destructiveHint`.
- **No upstream text in errors.** Failures map to a code from the allowlist in `src/errors.ts`.
- **Changelog.** Note user-visible changes under the unreleased version in
  [CHANGELOG.md](CHANGELOG.md).

## Before you open the pull request

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm smoke
```

Describe what changed and why, and link the issue if there is one. Keep a pull request to one
topic.

## Licence

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), like the rest of the repository.
