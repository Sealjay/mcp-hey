---
paths:
  - "src/tools/**/*.ts"
  - "docs/API.md"
---

# Hey.com API Endpoint Patterns

## Entity Model

Hey.com has three entity levels. Understanding which ID type an endpoint expects is critical.

| Entity | ID field | Scope | URL pattern |
|--------|----------|-------|-------------|
| **Posting** | `postingId` | List item in a view (Imbox, Feed, etc.) | `/postings/*` with `posting_ids` form field |
| **Topic** | `topicId` | Thread/conversation | `/topics/{id}/*` |
| **Entry** | `entryId` | Single message within a thread | `/entries/{id}/*` |

- **List view** (Imbox page) uses posting-based bulk endpoints
- **Thread view** (inside a conversation) uses topic-based single endpoints
- **Per-message actions** (delete one message in a thread) use entry-based endpoints with `_method=put`

Our MCP tools should prefer **topic-based** endpoints for single-thread operations. Use posting-based only for operations that have no topic equivalent (e.g. `removeFromSetAside`, `removeFromReplyLater`).

## Endpoint Rules

- **Box moves** (Set Aside, Reply Later, Paper Trail, Feed, Imbox) use `POST /topics/{topicId}/moves?box_id={boxId}` from thread context, or `POST /postings/moves?box_id={boxId}` with `posting_ids` from list context
- The `box_id` is account-specific; extract it from page HTML forms using `data-bulk-actions-target` attributes (e.g. "trailboxButton", "asideboxButton")
- **Status endpoints** (`/topics/{id}/status/trashed`, `/topics/{id}/status/active`, etc.) require `_method=put` in the POST form body — bare POST returns 404
- **Non-status actions** (`/topics/{id}/unseen`, `/topics/{id}/filings`) do NOT need `_method` override
- **Label removal** requires `_method=delete` in the POST form body: `POST /topics/{id}/filings?folder_id={labelId}` with `_method=delete`
- Always verify new endpoints against the live Hey.com UI (Chrome DevTools Network tab or Claude-in-Chrome) before implementing
- Document any new or changed endpoint in `docs/API.md` immediately, including a changelog entry
- Add the tool to `docs/TOOLS.md` and `docs/hey-features-doc.md` — every tool in `src/index.ts` must appear in both
