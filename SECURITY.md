# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Reporting a Vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/Sealjay/mcp-hey/security/advisories/new). Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Non-sensitive bugs (crashes, parsing errors, UX issues) should go on the [public issue tracker](https://github.com/Sealjay/mcp-hey/issues) instead.

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
