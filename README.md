# mcp-hey

[![Sealjay/mcp-hey MCP server](https://glama.ai/mcp/servers/Sealjay/mcp-hey/badges/score.svg)](https://glama.ai/mcp/servers/Sealjay/mcp-hey)
[![Bun](https://img.shields.io/badge/Bun-1.1+-000000?logo=bun&logoColor=ffffff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=ffffff)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=ffffff)](https://www.python.org/)
[![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-6E44FF)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/github/license/Sealjay/mcp-hey)](LICENCE)
[![GitHub issues](https://img.shields.io/github/issues/Sealjay/mcp-hey)](https://github.com/Sealjay/mcp-hey/issues)
[![GitHub stars](https://img.shields.io/github/stars/Sealjay/mcp-hey?style=social)](https://github.com/Sealjay/mcp-hey)

> A local Model Context Protocol (MCP) server that gives Claude read/write access to your [Hey.com](https://hey.com) inbox via reverse-engineered web APIs.

mcp-hey has two moving parts: a Bun/TypeScript MCP server that exposes Hey tools over stdio, and a small Python helper that uses the system webview to capture session cookies at login. Everything runs locally — no cloud relay, no credentials stored, just session cookies on disk.

> **Warning — unofficial API.** Hey.com does not publish a public API; mcp-hey reverse-engineers its web endpoints and pairs them with browser-identical HTTP requests. Things can break without notice. The current documented surface lives in [`docs/API.md`](docs/API.md).

## Features

- Read emails from Imbox, Feed, Paper Trail, Set Aside, Reply Later, Drafts, Trash, and Spam
- Download attachments and parse calendar invites from emails
- Send and reply to email threads
- Search emails across boxes
- Organise mail (set aside, reply later, screen in/out, bubble up)
- Local SQLite cache for faster repeated reads and full-text search
- Lightweight — around 30 MB idle memory
- Browser-identical headers and TLS posture to avoid detection
- Runs entirely on your machine; stdio transport with no network exposure

## Setup

### Prerequisites

- [Bun](https://bun.sh) 1.1 or later
- Python 3.10 or later (plus [UV](https://docs.astral.sh/uv/) if you want to follow the Python tooling in [`CLAUDE.md`](CLAUDE.md))
- A Hey.com account
- **Platform**: developed and tested on macOS and Linux. Windows users will likely need WSL — pywebview's Windows backend is not currently exercised.

### Installation

1. **Clone this repository**

   ```bash
   git clone https://github.com/Sealjay/mcp-hey.git
   cd mcp-hey
   ```

2. **Install dependencies**

   ```bash
   bun install
   uv pip install -r auth/requirements.txt
   ```

3. **First run — authenticate**

   ```bash
   bun run dev
   ```

   1. A system webview opens with Hey.com's login page. Log in normally.
   2. The helper captures session cookies to `data/hey-cookies.json` (permissions `600`) and exits.
   3. Press Ctrl+C — your MCP client will launch its own server instance from here on.
   4. Subsequent runs reuse the stored session until it expires.

## MCP client configuration

All clients below use the same `command`/`args` shape. On macOS, you'll almost certainly need the absolute path to `bun` — see [macOS: `bun` PATH](#macos-bun-path) below.

### Claude Code

The quickest route is the CLI:

```bash
claude mcp add --transport stdio hey --scope user -- bun run /absolute/path/to/mcp-hey/src/index.ts
```

The server is available immediately in the current session.

Alternatively, add to `.mcp.json` at your project root (or `~/.claude.json` for a user-scoped server):

```json
{
  "mcpServers": {
    "hey": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/mcp-hey/src/index.ts"]
    }
  }
}
```

If you edit the file directly, restart the Claude Code session to pick it up.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "hey": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/mcp-hey/src/index.ts"]
    }
  }
}
```

Restart Claude Desktop. You should see `hey` listed as an available integration.

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "hey": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/mcp-hey/src/index.ts"]
    }
  }
}
```

Restart Cursor.

### Docker

A Dockerfile is included for containerised deployments and Glama compatibility.

**Build the image:**

```bash
docker build -t mcp-hey .
```

**Smoke-test the server** (should return a JSON-RPC response listing available tools):

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | docker run -i mcp-hey
```

> **Note:** The Docker image runs the MCP server only. The Python auth helper and webview login are not available inside the container. You must provide pre-existing session cookies via a volume mount to `data/hey-cookies.json` for authenticated operations.

### macOS: `bun` PATH

GUI apps (Claude Desktop, Cursor) and shells launched by Claude Code don't always inherit the PATH from your interactive terminal, so a Homebrew-installed `bun` may fail with `spawn bun ENOENT` or simply never connect. Fix by using the absolute path to `bun` in `command`:

- **Apple Silicon Homebrew** — `/opt/homebrew/bin/bun`
- **Intel Homebrew** — `/usr/local/bin/bun`
- **Manual install** — run `which bun` in your terminal to find it

Example:

```json
{
  "mcpServers": {
    "hey": {
      "command": "/opt/homebrew/bin/bun",
      "args": ["run", "/absolute/path/to/mcp-hey/src/index.ts"]
    }
  }
}
```

## Architecture

| Component | Description |
|-----------|-------------|
| MCP server | Bun/TypeScript, stdio transport, ~30 MB idle memory |
| Auth helper | Python/pywebview, spawns on-demand for login via system webview |
| Cache | Local SQLite store for messages, threads, and search index |
| Communication | File-based session sharing via `data/hey-cookies.json` |

### Data flow

1. MCP client (Claude Code, Claude Desktop, Cursor, etc.) launches `bun run src/index.ts` over stdio.
2. On startup the server validates `data/hey-cookies.json`. If missing or expired it spawns `auth/hey-auth.py`, which opens Hey in a system webview and writes fresh cookies.
3. Tool calls hit Hey.com directly with browser-realistic headers; responses are parsed (HTML via `node-html-parser`) and cached in SQLite.
4. Write operations fetch a fresh CSRF token before submitting.

### Project structure

```
mcp-hey/
  src/
    index.ts           # MCP server entry point
    hey-client.ts      # HTTP client with cookie injection
    session.ts         # Session management and validation
    errors.ts          # Error classes and sanitisation
    cache/             # SQLite cache (db, schema, messages, search)
    tools/             # MCP tool implementations
      read.ts          # Reading and listing
      send.ts          # Send, reply, forward
      organise.ts      # Triage, labels, bubble up, etc.
      http-helpers.ts  # Shared CSRF retry and endpoint fallback
      attachments.ts   # Download attachments, parse calendar invites
    __tests__/         # Test suites
  auth/
    hey-auth.py        # Python auth helper (pywebview)
    requirements.txt
  data/
    hey-cookies.json   # Session storage (gitignored, chmod 600)
  docs/
    API.md             # Hey.com API surface documentation
    TOOLS.md           # MCP tool reference (34 tools)
    hey-features-doc.md  # Hey.com feature mapping
```

## Available tools

34 tools grouped by function. See [`docs/TOOLS.md`](docs/TOOLS.md) for parameters, return shapes, and error behaviour.

| Category | Tools |
|----------|-------|
| Read | `hey_list_emails` (imbox, feed, paper_trail, trash, spam, drafts), `hey_imbox_summary`, `hey_list_set_aside`, `hey_list_reply_later`, `hey_list_screener`, `hey_read_email`, `hey_download_attachment`, `hey_get_calendar_invite` |
| Labels & Collections | `hey_list_labels`, `hey_list_label_emails`, `hey_label`, `hey_list_collections`, `hey_list_collection_emails`, `hey_collection` |
| Send | `hey_send_email`, `hey_reply`, `hey_forward` |
| Triage | `hey_set_aside`, `hey_unset_aside`, `hey_reply_later`, `hey_remove_reply_later`, `hey_move_to`, `hey_set_status`, `hey_mark_unseen`, `hey_mark_seen`, `hey_read_status`, `hey_thread_mute` |
| Bubble up | `hey_bubble_up`, `hey_bubble_up_if_no_reply`, `hey_pop_bubble` |
| Screener | `hey_screen`, `hey_screen_by_id` |
| Search | `hey_search` |
| Cache | `hey_cache_status` |

## Privacy and security

- No credentials are ever stored — only session cookies, written with `600` permissions.
- Authentication happens entirely inside Hey's own login page (system webview).
- All data stays on your machine. No telemetry is emitted by this project.
- MCP uses stdio transport — the server never opens a network listener.
- Session validity is checked on startup and before sensitive operations.

See [`SECURITY.md`](SECURITY.md) for how to report vulnerabilities.

## Limitations

- **Prompt-injection risk**: as with many MCP servers, this one is subject to [the lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/). A malicious email arriving in your inbox could attempt to instruct Claude to exfiltrate other messages. Treat the tool surface accordingly and review risky actions before approving them.
- **Unofficial API**: Hey.com's frontend can change without notice and break things. Expect occasional breakage and check [`docs/API.md`](docs/API.md) for known deltas.
- **No real-time notifications**: polling only.
- **Attachment uploads** are not yet supported.
- **Single account** per MCP server instance.
- **Account risk**: aggressive or abnormal access patterns could in theory trigger Hey's anti-abuse systems. The server respects `x-ratelimit` headers and backs off exponentially, but there are no guarantees.
- **English UI only**: the server parses Hey.com's HTML responses and matches English-language strings (e.g. "You ignored this thread", label names, button text). It will not work correctly if Hey.com is set to a non-English locale.

## Troubleshooting

- **Auth webview does not open** — confirm Python 3.10+ is on `PATH` and `uv pip install -r auth/requirements.txt` succeeded. On Linux ensure a webview backend is available (`python -c "import webview"` should not error).
- **`401`/`403` responses after weeks of use** — your Hey session has expired. Delete `data/hey-cookies.json` and run `bun run dev` again to re-auth.
- **Rate limits (`429`)** — the client respects `x-ratelimit` headers and backs off. If you see sustained 429s, reduce concurrent tool use or wait a few minutes.
- **MCP client can't launch the server** — `args` must be an absolute path, not relative. If `bun` itself fails with `spawn bun ENOENT`, see [macOS: `bun` PATH](#macos-bun-path).
- **Cookie name changed** — Hey has renamed session cookies before (e.g. `_hey_session` → `session_token`, see [`docs/API.md`](docs/API.md) changelog). If auth silently fails after a Hey update, capture fresh cookies and compare.

## Contributing

Contributions welcome via pull request. Please:

- Use conventional commits (`feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `cicd`, `revert`, `WIP`).
- Run `bun run format` and `bun run lint` before pushing (powered by [Biome](https://biomejs.dev/)).
- Ensure `bun test` passes.
- Update [`docs/API.md`](docs/API.md) if you discover or change any Hey.com API behaviour.

See [`CLAUDE.md`](CLAUDE.md) for the full development workflow.

## Licence

MIT Licence — see [LICENCE](LICENCE).
