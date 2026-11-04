# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report privately through
[GitHub's private vulnerability reporting](https://github.com/Abuarchiv/manawg-mcp/security/advisories/new)
or write to info@manawg.com. Include what is affected, how to reproduce it and what an attacker
could do with it.

ManaWG is maintained by one person. You can expect an acknowledgement within 7 days and a first
assessment within 14 days.

## Scope

- This repository: the MCP server, its HTTP transport and OAuth mode, and the container image
  `ghcr.io/abuarchiv/manawg-mcp`.
- The hosted server at `https://mcp.manawg.com/mcp`, for example a token accepted that should not
  be, or one user's data reaching another.
- The app and its API are covered by the
  [app repository's policy](https://github.com/Abuarchiv/manawg/blob/main/SECURITY.md).
- Not in scope: denial of service through traffic volume, and problems that need an attacker who
  already holds the credential file or the HTTP API key.

## Supported versions

Only the latest release, the latest commit on `main` and the hosted server, which runs `main`,
are supported.
