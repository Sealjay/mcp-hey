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

## MCP `annotations` hints

Every tool definition in `src/index.ts` must include an `annotations` block. These are hints (not guarantees) used by MCP clients to decide things like "should I confirm with the user before running this?".

Per the MCP spec, `destructiveHint` and `idempotentHint` only have meaning when `readOnlyHint: false`. For read-only tools, omit them.

| Tool kind | Annotation block | Examples |
|-----------|------------------|----------|
| Read-only against Hey | `{ readOnlyHint: true, openWorldHint: true }` | `hey_list_emails`, `hey_read_email`, `hey_search`, `hey_imbox_summary` |
| Read-only against local cache only | `{ readOnlyHint: true, openWorldHint: false }` | `hey_cache_status` |
| Triage / additive write (reversible, end-state idempotent) | `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }` | `hey_set_aside`, `hey_move_to`, `hey_mark_seen`, `hey_label`, `hey_bubble_up` |
| Creates new artefacts (not idempotent — repeat calls duplicate) | `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }` | `hey_send_email`, `hey_reply`, `hey_forward`, `hey_download_attachment` |
| Destructive (blocks sender, marks spam, hard-to-reverse) | `{ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }` | `hey_set_status` (covers spam), `hey_screen` / `hey_screen_by_id` (covers reject) |

### Decision rules

- **`readOnlyHint`**: match the user's mental model. `hey_read_email` causes Hey's server to flip per-entry read state as a side effect — still `readOnlyHint: true`, because users universally treat "read message" as non-modifying.
- **`destructiveHint`**: take the worst case across enum actions. `hey_set_status` has reversible (trash, restore, unspam) and destructive (spam) actions; the tool-level annotation can't differentiate, so mark `true`. Over-warning is safer than under-warning.
- **`idempotentHint`**: end-state idempotence, not request-count. `hey_bubble_up` called twice with the same slot replaces the schedule, so it's idempotent. `hey_send_email` called twice sends two emails — not idempotent.
- **`openWorldHint`**: true for any tool that talks to Hey servers, false only for tools whose entire domain is local files / cache.
