# Hey.com MCP Server

A local MCP server providing Claude with read/write access to Hey.com email accounts. Uses reverse-engineered Hey.com web APIs with browser-identical HTTP requests to avoid detection.

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Commands](#commands)
- [Development Workflow](#development-workflow)
- [Design Decisions](#design-decisions)
- [Important Patterns](#important-patterns)
- [Security](#security)
- [API Documentation Maintenance](#api-documentation-maintenance)
- [Commit Conventions](#commit-conventions)
- [Pre-Commit Checklist](#pre-commit-checklist)

> **File layout**: see [README.md](README.md) "Project structure". For the tool surface, see [`docs/TOOLS.md`](docs/TOOLS.md); for reverse-engineered endpoints, [`docs/API.md`](docs/API.md).

---

## Architecture

| Component | Description |
|-----------|-------------|
| MCP Server | Bun/TypeScript, stdio transport, ~30MB idle memory |
| Auth Helper | Python/pywebview, spawns on-demand for login via system webview |
| Communication | File-based session sharing via `data/hey-cookies.json` |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun 1.1+ |
| Language | TypeScript (strict mode) |
| Auth | Python 3.10+ with pywebview |
| MCP SDK | @modelcontextprotocol/sdk |
| Testing | Bun test runner |
| Linting | Biome |

---

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start MCP server in development mode |
| `bun run build` | Build for production |
| `bun test` | Run all tests |
| `bun test -- -t "name"` | Run single test suite |
| `python auth/hey-auth.py` | Manual auth trigger |

---

## Development Workflow

**Always use `bun`, not `npm`.**

### TypeScript (Biome)

```sh
bun run lint             # Check for issues
bun run format           # Fix issues (lint + format)
```

### Python (UV + Ruff)

```sh
uv run ruff check .      # Lint
uv run ruff format .     # Format
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| curl_cffi via Python subprocess | TLS/HTTP2 fingerprint matching when needed |
| Bun's native fetch | Lightweight requests with custom headers |
| No bundled Chromium | System webview for auth minimises footprint |
| Local cookie storage | Never store credentials, only session cookies |
| Rate limit parsing | Respect `x-ratelimit` headers |
| **Correctness over backward compatibility** | When fixing bugs or updating APIs, prefer correct behaviour over maintaining broken backward compatibility. Update documentation and require correct parameter types rather than adding workarounds. |

---

## Important Patterns

| Pattern | Details |
|---------|---------|
| Browser-realistic headers | All HTTP requests must include realistic headers |
| CSRF tokens | Fetched fresh before write operations |
| Rate limiting | Exponential backoff when limits approached |
| Session validation | Checked on startup and before sensitive operations |

---

## Security

| Measure | Implementation |
|---------|----------------|
| Cookie permissions | Stored with 600 permissions |
| Credential handling | No credentials ever stored |
| Auth flow | Happens entirely in Hey's webview |
| Transport | MCP uses stdio (no network exposure) |

---

## API Documentation Maintenance

> **IMPORTANT**: The Hey.com API is reverse-engineered and may change without notice. Keep `docs/API.md` current as you work.

When investigating or fixing Hey.com API issues:

| Task | Action |
|------|--------|
| Capture requests | Use Chrome automation to record actual network traffic |
| Document endpoints | Include exact URLs, methods, parameters, response codes |
| Track cookie names | Hey.com may change these (e.g., `session_token` vs `_hey_session`) |
| Record enum values | Capture actual values from UI (e.g., bubble up time slots) |
| Update docs | If an endpoint has changed, update immediately |

The authoritative log of endpoint changes lives in [`docs/API.md`](docs/API.md#changelog). Consult it before assuming an endpoint still works.

---

## Commit Conventions

Use conventional commit format.

**Valid types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `cicd`, `revert`, `WIP`

---

## Pre-Commit Checklist

- [ ] Run `bun run format` and `bun run lint`
- [ ] Ensure all tests pass with `bun test`
- [ ] Update `docs/API.md` if any API behaviour was discovered or changed
