# mcp-hey

[![Sealjay/mcp-hey MCP server](https://glama.ai/mcp/servers/Sealjay/mcp-hey/badges/score.svg)](https://glama.ai/mcp/servers/Sealjay/mcp-hey)
[![Bun](https://img.shields.io/badge/Bun-1.1+-000000?logo=bun&logoColor=ffffff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=ffffff)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=ffffff)](https://www.python.org/)
[![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-6E44FF)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/github/license/Sealjay/mcp-hey)](LICENCE)
[![GitHub issues](https://img.shields.io/github/issues/Sealjay/mcp-hey)](https://github.com/Sealjay/mcp-hey/issues)
[![GitHub stars](https://img.shields.io/github/stars/Sealjay/mcp-hey?style=social)](https://github.com/Sealjay/mcp-hey)

A local MCP server that gives Claude read/write access to your [Hey.com](https://hey.com) inbox. A Bun/TypeScript server exposes the tools over stdio, and a small Python helper captures session cookies through the system webview at login. No cloud relay, no stored credentials.

> **Unofficial API.** Hey.com has no public API. mcp-hey uses its web endpoints with browser-identical requests, so things can break without notice. The current surface is in [`docs/API.md`](docs/API.md).

## Setup

**Prerequisites:** [Bun](https://bun.sh) 1.1+, Python 3.10+ and a Hey.com account. Tested on macOS and Linux; Windows likely needs WSL.

```bash
git clone https://github.com/Sealjay/mcp-hey.git
cd mcp-hey
bun install
uv pip install -r auth/requirements.txt
bun run dev   # first run: log in to Hey in the webview, then Ctrl+C
```

The helper saves session cookies to `data/hey-cookies.json` (mode `600`). Later runs reuse them until they expire.

## MCP client configuration

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

| Client | Where |
|--------|-------|
| Claude Code | `claude mcp add --transport stdio hey --scope user -- bun run /absolute/path/to/mcp-hey/src/index.ts`, or the block above in `.mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |

Use absolute paths. GUI apps often lack your shell's PATH, so if you see `spawn bun ENOENT`, set `command` to the output of `which bun` (Homebrew: `/opt/homebrew/bin/bun`).

**Docker:** `docker build -t mcp-hey .`, then `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | docker run -i mcp-hey`. The image has no login helper, so mount existing cookies at `data/hey-cookies.json`.

## Tools

37 tools. Parameters, return shapes and errors are in [`docs/TOOLS.md`](docs/TOOLS.md).

| Category | Tools |
|----------|-------|
| Read | `hey_list_emails` (imbox, feed, paper_trail, trash, spam, drafts, sent), `hey_imbox_summary`, `hey_list_set_aside`, `hey_list_reply_later`, `hey_list_screener`, `hey_read_email`, `hey_download_attachment`, `hey_get_calendar_invite` |
| Labels & Collections | `hey_list_labels`, `hey_list_label_emails`, `hey_label`, `hey_list_collections`, `hey_list_collection_emails`, `hey_collection` |
| Send & drafts | `hey_send_email`, `hey_reply`, `hey_forward`, `hey_save_draft`, `hey_edit_draft`, `hey_delete_draft` |
| Triage | `hey_set_aside`, `hey_unset_aside`, `hey_reply_later`, `hey_remove_reply_later`, `hey_move_to`, `hey_set_status`, `hey_mark_unseen`, `hey_mark_seen`, `hey_read_status`, `hey_thread_mute` |
| Bubble up | `hey_bubble_up`, `hey_bubble_up_if_no_reply`, `hey_pop_bubble` |
| Screener | `hey_screen`, `hey_screen_by_id` |
| Search & cache | `hey_search`, `hey_cache_status` |

## Sender groups

Every message a tool returns carries `sender_group`: where Hey delivers new mail from that sender (`imbox`, `feed`, `paper_trail`, `screened_out`, else `unknown`), from the "Deliver their emails to…" setting on their contact page. It describes the sender, not the message.

`hey_search`, `hey_list_set_aside`, `hey_list_reply_later`, `hey_list_label_emails` and `hey_list_collection_emails` take an optional `group`, for example `group: ["imbox"]` to leave out newsletters and receipts. By default (`HEY_SENDER_GROUPS=filter`) tools tag from the local cache and only a filtered call asks Hey; `on` looks up a few senders on every call, `off` removes the field. Details: [`docs/TOOLS.md`](docs/TOOLS.md#filtering-by-sender-group).

## Architecture

| Component | Description |
|-----------|-------------|
| MCP server | Bun/TypeScript on MCP TypeScript SDK v2. stdio serves MCP 2026-07-28 and older revisions; about 30 MB idle |
| Auth helper | Python/pywebview, launched only when cookies are missing or expired |
| Cache | Local SQLite for messages, threads and full-text search |

Requests carry browser-realistic headers, write operations fetch a fresh CSRF token first, and the client backs off on `x-ratelimit`.

## Privacy and limitations

- Only session cookies are stored (mode `600`); login happens in Hey's own page. No telemetry, no network listener.
- **Prompt injection:** this server has [the lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/). A malicious email could try to make Claude exfiltrate others, so review risky actions before approving them.
- No calendar event creation, attachment uploads or real-time notifications. One account per instance.
- Hey's HTML is parsed against English UI strings, so a non-English Hey locale will not work.
- Unusual access patterns could trip Hey's anti-abuse systems despite the rate-limit handling.

Report vulnerabilities via [`SECURITY.md`](SECURITY.md).

## Troubleshooting

- **Webview does not open:** check Python 3.10+ and that `python -c "import webview"` works (Linux needs a webview backend).
- **`401`/`403` after weeks:** the session expired. Delete `data/hey-cookies.json` and run `bun run dev`.
- **Sustained `429`s:** reduce concurrent tool use or wait a few minutes.
- **Auth silently fails after a Hey update:** Hey has renamed session cookies before. See the [`docs/API.md`](docs/API.md) changelog.

## Contributing

Conventional commits; `bun run format`, `bun run lint` and `bun test` must pass; update [`docs/API.md`](docs/API.md) when Hey's behaviour changes. See [`CLAUDE.md`](CLAUDE.md).

## Licence

MIT. See [LICENCE](LICENCE).
