# Hey.com MCP Server

Local MCP server giving Claude read/write access to Hey.com via reverse-engineered web APIs and browser-identical HTTP requests. File layout: [README.md](README.md). Tool surface: [`docs/TOOLS.md`](docs/TOOLS.md). Endpoints: [`docs/API.md`](docs/API.md).

## Architecture

- **MCP server** (`src/index.ts`): Bun, TypeScript strict, `@modelcontextprotocol/server` v2 low-level `Server` with `tools/list` / `tools/call` handlers. `serveStdio` picks the protocol era (2026-07-28 or 2025 `initialize`) per connection. Exits when stdin closes.
- **Auth helper** (`auth/hey-auth.py`): Python/pywebview, spawned on demand; writes session cookies to `data/hey-cookies.json` (mode 600).
- **Cache** (`src/cache/`): SQLite for messages, threads and search.
- **Sender groups** (`src/sender-groups.ts`, `src/contact-box.ts`, `src/sender-group-filter.ts`): `sender_group` on message results from each sender's Hey delivery setting, and the optional `group` filter. Lookups cost Hey requests, so by default only filtered calls make them.

## Commands

Always `bun`, never `npm`.

```sh
bun run dev              # run the server
bun test                 # all tests; bun test -t "name" for one suite
bun run lint             # Biome check
bun run format           # Biome fix
bunx tsc --noEmit        # type check
uv run ruff check . && uv run ruff format .   # Python helper
```

## Rules

- **Correctness over backward compatibility.** Fix the behaviour and the docs; don't add workarounds for broken parameter types.
- Every request carries realistic browser headers. Fetch a fresh CSRF token before writes. Back off on `x-ratelimit`.
- Never store credentials, only session cookies. Validate the session on startup and before sensitive operations.
- Tool descriptions and annotations follow `.claude/rules/mcp-tool-descriptions.md`.

## Hey API changes

The API is reverse-engineered and changes without notice. When you touch an endpoint, record the actual traffic (URL, method, parameters, response codes, cookie names, enum values from the UI) in [`docs/API.md`](docs/API.md) and its changelog. Check that changelog before assuming an endpoint still works.

## Before committing

Conventional commits (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `cicd`, `revert`, `WIP`). Run `bun run format`, `bun run lint`, `bunx tsc --noEmit` and `bun test`, and update `docs/API.md` for any API behaviour you discovered.
