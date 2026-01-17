# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a template repository for projects using a Python backend with Microsoft Agent Framework and TypeScript/React frontend. It targets Azure Static Web Apps deployment.

## Template Modularity

This template includes configuration for multiple languages (.NET, Python, TypeScript). After creating a project from this template:

- **Remove unused config files**: Delete `pyproject.toml` if not using Python, `package.json`/`biome.json` if not using TypeScript
- **Optimize devcontainer**: Remove unused extensions and tooling from `.devcontainer/` for faster builds

> **Claude Code**: When working on a project derived from this template (not sealjay-template itself), prompt the user to optimize the devcontainer by removing unused languages and tooling.

## Repository Structure

- `backend/` - Agentic AI Python backend services
- `frontend/` - TypeScript & React frontend
- `docs/` - Documentation including PRD, technical specs, and ADRs
- `docs/adr/` - Architecture Decision Records

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
uv run pytest                   # Test
```

## Language-Specific Standards

### Python
- Use UV for package management
- Use Ruff for linting and formatting
- Use `async`/`await` for all AI operations
- Use Pydantic for data validation, SQLAlchemy for DB
- Apply type hints to all function signatures

### TypeScript/React
- Use Bun as runtime, package manager, bundler, and test runner
- Use Biome for linting and formatting
- Use functional components with hooks
- Use CSS modules for styling
- Use interfaces for data structures, prefer immutable data

### Testing
- **TypeScript**: `bun test` for unit tests, @testing-library/* for components (optional), Playwright for e2e (optional)
- **Python**: pytest for unit tests, integration tests for inter-agent workflows
- Place unit/component tests in `__tests__/` or use `.test.ts[x]` suffix
- Place e2e tests in `e2e/` with `.spec.ts` suffix

## Commit Conventions

Use conventional commit format. Valid commit types:
- `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `cicd`, `revert`, `WIP`

Scopes: `infra`, `cicd`, or custom

## ADR Guidelines

- ADRs are immutable once accepted - create new ones to supersede
- File format: `NNNN-title-with-hyphens.md` (lowercase, sequential)
- Always update `docs/adr/index.md` when adding new ADRs
- Never modify the ADR template at `docs/adr/template.md`

## Pre-Commit Checklist

- Run formatting and linting checks
- Ensure all tests pass
- Update ADRs for architectural decisions
- Use US English for all code and documentation
