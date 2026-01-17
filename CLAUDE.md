# Hey.com MCP Server

## Project Purpose
A local MCP server providing Claude with read/write access to Hey.com email accounts. Uses reverse-engineered Hey.com web APIs with browser-identical HTTP requests to avoid detection.

## Architecture
- **MCP Server**: Bun/TypeScript, stdio transport, ~30MB idle memory
- **Auth Helper**: Python/pywebview, spawns on-demand for login via system webview
- **Communication**: File-based session sharing via `data/hey-cookies.json`

## Key Design Decisions
- Uses curl_cffi (via Python subprocess) for TLS/HTTP2 fingerprint matching when needed
- Bun's native fetch for lightweight requests with custom headers
- No bundled Chromium - uses system webview for auth to minimise footprint
- Session cookies stored locally, never credentials
- Rate limiting respected via x-ratelimit header parsing

## Tech Stack
- Runtime: Bun 1.1+
- Language: TypeScript (strict mode)
- Auth: Python 3.10+ with pywebview
- MCP SDK: @modelcontextprotocol/sdk
- Testing: Bun test runner

## File Structure
```
src/
  index.ts           # MCP server entry point
  hey-client.ts      # HTTP client with cookie injection
  session.ts         # Session management and validation
  tools/             # MCP tool implementations
    read.ts          # Email reading tools
    send.ts          # Email sending tools
    organise.ts      # Organisation tools (set aside, reply later)
auth/
  hey-auth.py        # Python auth helper
data/
  hey-cookies.json   # Session storage (gitignored)
docs/
  API.md             # Hey.com API surface documentation
  TOOLS.md           # MCP tool reference
```

## Commands
- `bun run dev` - Start MCP server in development mode
- `bun run build` - Build for production
- `bun test` - Run tests
- `python auth/hey-auth.py` - Manual auth trigger

## Important Patterns
- All HTTP requests must include browser-realistic headers
- CSRF tokens fetched fresh before write operations
- Exponential backoff on rate limits
- Session validity checked on startup and before sensitive operations

## Security Notes
- Cookies stored with 600 permissions
- No credentials ever stored
- Auth happens entirely in Hey's webview
- MCP uses stdio transport (no network exposure)

## Development Workflow

**Always use `bun`, not `npm`.**

```sh
# Run tests (Bun's native test runner)
bun test
bun test -- -t "test name"      # Single suite

# Lint and format (Biome)
bun run lint                    # Check for issues
bun run format                  # Fix issues (lint + format)

# Python (UV + Ruff)
uv run ruff check .             # Lint
uv run ruff format .            # Format
```

## Commit Conventions

Use conventional commit format. Valid commit types:
- `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `cicd`, `revert`, `WIP`

## Pre-Commit Checklist

- Run formatting and linting checks
- Ensure all tests pass
- Use US English for all code and documentation
