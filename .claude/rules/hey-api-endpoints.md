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
- **Bubble-up family** uses `POST /topics/{topicId}/bubble_up*` exclusively (`bubble_up_now`, `bubble_up?slot=…`, `bubble_up?slot=custom&waiting_on=true`, and `DELETE /topics/{topicId}/bubble_up` to pop). Verified against the live Hey UI 2026-05-11 — every bubble-up form on `/topics/{id}/bubble_up/menu` posts to a `/topics/{topicId}/…` URL. Posting IDs return 404; do **not** add a `/postings/bubble_up` fallback (it accepts a different ID type and masks the wrong-ID signal).
- The `box_id` is account-specific; extract it from page HTML forms using `data-bulk-actions-target` attributes (e.g. "trailboxButton", "asideboxButton")
- **Status endpoints** (`/topics/{id}/status/trashed`, `/topics/{id}/status/active`, etc.) require `_method=put` in the POST form body — bare POST returns 404
- **Non-status actions** (`/topics/{id}/unseen`, `/topics/{id}/filings`) do NOT need `_method` override
- **Label removal** requires `_method=delete` in the POST form body: `POST /topics/{id}/filings?folder_id={labelId}` with `_method=delete`
- Always verify new endpoints against the live Hey.com UI (Chrome DevTools Network tab or Claude-in-Chrome) before implementing
- Document any new or changed endpoint in `docs/API.md` immediately, including a changelog entry
- Add the tool to `docs/TOOLS.md` and `docs/hey-features-doc.md` — every tool in `src/index.ts` must appear in both

## Unread detection

- Listing views mark unread (unseen) postings with a screen-reader marker `<span id="unseen_posting_{postingId}">`, **not** a `posting--unread` class (which no longer exists). A posting is unread iff that marker is present.
- **New ("Power Through") count**: `GET /imbox/unseen` declares its size via `data-list-size-value` (no pagination). This is the source for `hey_imbox_summary`'s `newCount` — it can't be derived from the `/imbox` first page, which holds only the bubbled-up section. A plain **GET is read-only** (does not mark seen — count is stable across repeated GETs); only *advancing through* the messages marks them seen.
- Two distinct metrics: the **new count** (`/imbox/unseen` size — small, current arrivals) vs. the **total never-opened backlog** (count of `unseen_posting_` markers across paginated `/imbox` — can be far larger). Don't conflate them.

## Per-tool ID type (canonical)

When introducing or changing a tool, match its MCP param name to the ID type its Hey endpoint actually accepts. Mis-naming is a confidence game — the model picks the wrong field from list responses and we get 404s.

| Tool | Endpoint | ID required | MCP param |
|------|----------|-------------|-----------|
| `hey_bubble_up` | `POST /topics/{id}/bubble_up_now`, `POST /topics/{id}/bubble_up?slot=…` | **topicId** | `topic_id` |
| `hey_bubble_up_if_no_reply` | `POST /topics/{id}/bubble_up?slot=custom&waiting_on=true` | **topicId** | `topic_id` |
| `hey_pop_bubble` | `DELETE /topics/{id}/bubble_up` | **topicId** | `topic_id` |
| `hey_set_aside`, `hey_reply_later`, `hey_move_to` | `POST /topics/{id}/moves?box_id=…` | topicId | `id` |
| `hey_mark_unseen` | `POST /topics/{id}/unseen` | topicId | `topic_id` |
| `hey_label`, `hey_collection` | `POST /topics/{id}/filings…` | topicId | `id` |
| `hey_set_status` | `POST /entries/{id}/status/{action}` (fallback `POST /postings/trash` for Paper Trail bundles) | entryId (postingId for bundles) | `id` |
| `hey_unset_aside`, `hey_remove_reply_later` | `POST /postings/moves?box_id={imboxBoxId}` | postingId | `posting_id` |
| `hey_thread_mute` | `POST /postings/{id}/muting` | postingId | `posting_id` |
| `hey_mark_seen` (per-item) | `POST /postings/seen` with `posting_ids` | postingId | `posting_id` |
| `hey_read_status` | `POST /entries/{id}/status/{read|unread}` | entryId | `id` |
