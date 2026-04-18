# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security issue, please [raise a GitHub issue](https://github.com/Sealjay/mcp-hey/issues) with as much detail as possible:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

For issues that you believe should not be disclosed publicly (for example, a flaw in the auth helper that could leak session cookies), open a minimal placeholder issue asking for a private contact channel and I will follow up directly.

## Scope

mcp-hey runs locally and communicates with Claude Desktop or Cursor over stdio. The main security surfaces are:

- **Session cookies** stored in `data/hey-cookies.json` (written with `600` permissions, never transmitted anywhere except back to Hey.com).
- **The Python auth helper** (`auth/hey-auth.py`), which opens a system webview to Hey's login page.
- **Tool inputs** — emails reaching your inbox are attacker-controlled text and can attempt prompt injection against Claude.

Issues in any of those areas are in scope for this repository.

## Upstream Dependencies

mcp-hey reverse-engineers the [Hey.com](https://hey.com) web application and wraps its endpoints for MCP. Many issues are likely to originate upstream rather than in this code:

- **Hey.com service or protocol issues** (auth failures, unexpected rate limits, data exposure) — report through [Hey's support channels](https://hey.com) directly.
- **MCP SDK issues** — report on the [Model Context Protocol TypeScript SDK repo](https://github.com/modelcontextprotocol/typescript-sdk/issues).
- **pywebview issues** — report on the [pywebview repo](https://github.com/r0x0r/pywebview/issues).

If you're unsure where an issue belongs, open one here and we'll triage.
