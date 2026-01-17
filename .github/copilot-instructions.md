# GitHub Copilot Instructions for hey-mcp

## Project Context
This is a local MCP server for Hey.com email integration. It reverse-engineers Hey.com's web interface to provide email access to Claude.

## Code Style
- TypeScript with strict mode enabled
- Use Bun APIs where available (Bun.file, Bun.serve, etc.)
- Prefer async/await over callbacks
- Use snake_case for MCP tool names, camelCase for functions
- No semicolons (Bun/modern JS style)
- Use template literals for string interpolation

## Architecture Rules
- MCP server uses stdio transport only
- All HTTP requests must include realistic browser headers
- CSRF tokens must be fetched fresh before POST requests
- Session validation before any Hey.com API call
- Spawn auth helper as subprocess when session invalid

## Security Requirements
- Never store Hey.com credentials
- Cookie file must have 600 permissions
- Sanitise all error messages in MCP responses
- No secrets in logs

## Testing
- Use Bun's built-in test runner
- Mock HTTP responses for Hey.com endpoints
- Test session expiry handling
- Test rate limit backoff

## Common Patterns

### Making authenticated requests
```typescript
const response = await heyFetch('/my/imbox', {
  headers: await getBrowserHeaders()
})
```

### Tool response format
```typescript
return {
  content: [{
    type: 'text',
    text: JSON.stringify(result, null, 2)
  }]
}
```

### Error handling in tools
```typescript
return {
  content: [{
    type: 'text',
    text: `Error: ${sanitiseError(error)}`
  }],
  isError: true
}
```
