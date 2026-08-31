# manawg-mcp

MCP server for ManaWG. Build with Node 22 and run over stdio.

## Setup

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Create the external credential file at `/Users/abu/.config/manawg-mcp/env` with placeholders only:

   ```bash
   MANAWG_BASE_URL=https://manawg.example.invalid
   MANAWG_WG_CODE=WG_CODE_PLACEHOLDER
   MANAWG_MEMBER_ID=00000000-0000-4000-8000-000000000000
   MANAWG_MEMBER_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
   ```

   `MEMBER_SESSION_SECRET` must never be set in this file.

3. Lock the file permissions.

   ```bash
   chmod 600 /Users/abu/.config/manawg-mcp/env
   ```

4. Build the server.

   ```bash
   pnpm build
   ```

Unit tests and typecheck do not need credentials.

## Host start

Load the env file and start the MCP host from the repo root:

```bash
source /Users/abu/.config/manawg-mcp/env
/opt/homebrew/opt/node@22/bin/node dist/index.js
```

## Tool and resource contract

Resources:

- `manawg://current/dashboard` returns the current dashboard as JSON.
- `manawg://current/shopping` returns the current shopping list as JSON.

Tools:

- `shopping_add` accepts `{ name: string, quantity?: string }`.
- `chore_complete` accepts `{ choreId: string }`.

Both tools return safe text on failure and do not expose upstream secrets.

## Security boundaries

- Keep credentials out of git and logs.
- Only the four `MANAWG_*` values above belong in `/Users/abu/.config/manawg-mcp/env`.
- Never provide `MEMBER_SESSION_SECRET`.
- The server exposes exactly the two resources and two tools listed above.
