---
applyTo: "**/*.py"
---

# Python Project Coding Standards

All code must follow the [general coding guidelines](./general-coding.instructions.md).

## Dependency Management

- Use [UV](https://github.com/astral-sh/uv) for package and dependency management.
- Pin major versions, allow minor updates (e.g., `agent-framework>=1.0,<2.0`).
- Include Azure SDK packages for OpenAI integration.

## Linting and Formatting

- Use Ruff for linting and formatting.
- Configure Ruff to support async/await patterns.
- Apply type hints to all function signatures.
- Ensure all linting and formatting checks pass before submission.

## Coding Patterns

### Async/Await

- Use `async`/`await` for all AI-related operations.
- Wrap critical code in `try`/`except` blocks.
- Use `asyncio.gather()` for parallelism.
- Avoid blocking I/O in async functions.

### Error Handling

- Define custom exceptions for domain-specific cases.
- Use structured logging with contextual data.
- Apply circuit breaker patterns for external API calls.
- Add retry logic with exponential backoff for transient errors.

### Agent Communication

- Use Agent Framework's native messaging patterns.
- Ensure proper (de)serialization of agent data.
- Include correlation IDs in all agent requests/responses.
- Use event-driven patterns to decouple agents.

### Data Handling

- Use Pydantic models for data validation.
- Ensure proper serialization for campaign persistence.
- Use SQLAlchemy for all database interactions.
- Provide migration scripts for schema changes.

## Testing

### Test Structure

- Unit tests for agents and plugins.
- Integration tests for inter-agent workflows.
- End-to-end tests for full pipelines.
- Mock all external systems (Azure OpenAI, DBs, etc.).

### AI Testing Patterns

- Use deterministic outputs for reproducibility.
- Include failure scenarios and edge cases.
- Validate prompt outputs.
- Benchmark agent response latency.

## Security and Configuration

### Environment Management

- Store sensitive data in environment variables.
- Never commit secrets or API keys.
- Use Azure Key Vault for production secrets.
- Secure all API endpoints with authentication.

### API Security

- Validate all inputs using Pydantic.
- Apply rate limiting to AI endpoints.
- Log requests for auditing.
- Enforce HTTPS on all external traffic.

## Documentation

### Code Documentation

- Add docstrings to all public functions/methods.
- Include usage examples for non-trivial agents.
- Document all configuration options.
- Maintain ADRs for major architectural changes.

### Agent Documentation

- Describe agent roles and capabilities.
- Provide prompt engineering guidance.
- Document inter-agent communication.
- Include troubleshooting steps for known issues.
