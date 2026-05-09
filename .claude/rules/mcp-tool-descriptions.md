---
paths:
  - "src/index.ts"
  - "docs/TOOLS.md"
---

# MCP Tool Description Quality (Glama.ai)

When writing or updating MCP tool descriptions in `src/index.ts`, follow these guidelines to score well on Glama.ai's quality dimensions:

## Required in every description

1. **Purpose with specific verb and resource** — "Move an email thread to Set Aside" not "Set aside an email"
2. **Side effects** — state what changes: "Moves the thread and auto-routes future emails from the sender"
3. **Reversibility** — how to undo: "Reversible via hey_unset_aside (requires postingId from hey_list_set_aside)"
4. **Return shape** — "Returns {success, error?}"
5. **When to use vs alternatives** — "Use for emails you plan to revisit. For emails needing a reply, use hey_reply_later instead"

## Required in parameter descriptions

1. **Which ID type** — "The topic/thread ID (use topicId from hey_list_imbox)" not just "The ID"
2. **Constraints** — mention valid ranges, formats, or enum values
3. **Defaults** — state default values for optional params

## Style

- Front-load the purpose (first sentence = what it does)
- Keep total description under 3 sentences when possible
- Don't repeat what the schema already says
- Use consistent terminology: "email thread" not "email" or "message" or "conversation"

## Avoid

- Descriptions that only restate the function name
- Missing side-effect disclosure (especially for destructive actions like trash, spam, screen_out)
- Missing ID type guidance (agents need to know which ID field to use)
- Missing reversibility info (agents need to know if actions are safe)
