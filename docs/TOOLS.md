# Hey MCP Tools Reference

This document provides detailed documentation for all MCP tools provided by mcp-hey.

**Total Tools: 34**

---

## Table of Contents

- [Reading Tools](#reading-tools) (12 tools)
- [Search Tool](#search-tool) (1 tool)
- [Sending Tools](#sending-tools) (3 tools)
- [Organisation Tools](#organisation-tools) (17 tools)
- [Cache Management](#cache-management) (1 tool)
- [Error Handling](#error-handling)

---

## Reading Tools

### hey_list_emails

List emails in a Hey.com folder/view. Returns cached results unless force_refresh=true.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| folder | string | **Yes** | - | Folder/view: `imbox`, `feed`, `paper_trail`, `trash`, `spam`, or `drafts` |
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Folder values:**
| Value | Description |
|-------|-------------|
| `imbox` | Important emails that need attention |
| `feed` | Newsletters, notifications, updates |
| `paper_trail` | Receipts, confirmations, transactional emails |
| `trash` | Trashed emails |
| `spam` | Spam-flagged emails |
| `drafts` | Draft emails |

**Returns:**
```json
{
  "data": [
    {
      "id": "1907289505",
      "topicId": "1907289505",
      "entryId": "2027494999",
      "postingId": "12345",
      "from": "John Doe",
      "fromEmail": "john@example.com",
      "subject": "Meeting tomorrow",
      "snippet": "Hi, just wanted to confirm...",
      "date": "2024-01-15T10:30:00Z",
      "unread": true,
      "bubbledUp": false,
      "label": "Work"
    }
  ],
  "_cache": {
    "source": "cache",
    "cached_at": "2024-01-15T10:00:00Z",
    "age_seconds": 300,
    "is_stale": false,
    "hint": "Cached 5 minutes ago"
  }
}
```

---

### hey_imbox_summary

Get a complete Imbox summary including screener count, bubbled up emails, and new emails.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:**
```json
{
  "data": {
    "screenerCount": 3,
    "bubbledUpCount": 1,
    "newCount": 5,
    "emails": [...],
    "bubbledUpEmails": [...]
  },
  "_cache": {...}
}
```

---

### hey_list_set_aside

List emails in the Set Aside stack (emails saved for later).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_reply_later

List emails in the Reply Later stack (emails pending response).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_screener

List emails waiting in the Screener (new senders awaiting approval).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:**
```json
{
  "data": [
    {
      "id": "987654",
      "clearanceId": "987654",
      "from": "newsletter",
      "fromEmail": "newsletter@company.com",
      "subject": "Welcome to our newsletter",
      "snippet": "Thanks for subscribing...",
      "unread": true
    }
  ],
  "_cache": {...}
}
```

---

### hey_list_labels

List all labels/folders in Hey.com.

**Parameters:** None

**Returns:**
```json
[
  {
    "id": "12345",
    "name": "Work",
    "color": "blue"
  },
  {
    "id": "12346",
    "name": "Personal"
  }
]
```

---

### hey_list_label_emails

List emails with a specific label.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| label_id | string | **Yes** | - | The label/folder ID to list emails from |
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_collections

List all collections in Hey.com.

**Parameters:** None

**Returns:**
```json
[
  {
    "id": "98765",
    "name": "Project Alpha"
  },
  {
    "id": "98766",
    "name": "Receipts 2024"
  }
]
```

---

### hey_list_collection_emails

List emails in a specific collection.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| collection_id | string | **Yes** | - | The collection ID to list emails from |
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_read_email

Read the full content of an email by ID. Surface attachment metadata and
parsed calendar invites alongside the body.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The email ID to read (usually `postingId` or `topicId`) |
| format | string | No | "html" | Format: "html" or "text" |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:**
```json
{
  "data": {
    "id": "12345",
    "from": "John Doe",
    "fromEmail": "john@example.com",
    "to": ["me@hey.com"],
    "cc": ["other@example.com"],
    "subject": "Meeting tomorrow",
    "body": "<p>Hi, just wanted to confirm...</p>",
    "date": "2024-01-15T10:30:00Z",
    "threadId": "67890",
    "attachments": [
      { "id": "part-1", "filename": "agenda.pdf", "size": 12480, "mime": "application/pdf", "is_calendar": false },
      { "id": "part-2", "filename": "invite.ics", "size": 1842, "mime": "text/calendar", "is_calendar": true }
    ],
    "calendar_invites": [
      { "id": "part-2", "filename": "invite.ics", "summary": "Lunch with Chris", "start": "2026-05-13T12:00:00Z", "end": "2026-05-13T13:00:00Z", "attendees": ["chris@example.com"] }
    ]
  },
  "_cache": {...}
}
```

> **Attachments are metadata-only**. Use `hey_download_attachment` to write
> the bytes to disk or `hey_get_calendar_invite` to fetch the parsed invite.
> When the response is served from cache, `attachments` and
> `calendar_invites` may be omitted; pass `force_refresh: true` to populate.

> **Paper Trail Bundles**: Some Paper Trail emails (transactional emails from high-volume senders like banks, Wise, Amazon) are grouped into "bundles". These have only a `postingId` (no `topicId`). The tool automatically tries the bundle endpoint when needed.

---

### hey_download_attachment

Download a single attachment from an email and save it to disk. Decodes
the base64 MIME part and writes raw bytes to the supplied path.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| email_id | string | **Yes** | - | The email ID containing the attachment |
| attachment_id | string | **Yes** | - | The `id` from `hey_read_email`'s `attachments` array (e.g. `part-1`) |
| save_path | string | No | `~/Downloads/hey-attachments/<date>/<filename>` | Path or directory within ~/. Trailing `/` = directory. Duplicate filenames auto-numbered (invite-1.ics). |

**Returns:**
```json
{
  "local_path": "/Users/me/Downloads/hey-attachments/2026-05-10/agenda.pdf",
  "filename": "agenda.pdf",
  "size": 12480,
  "mime": "application/pdf"
}
```

---

### hey_get_calendar_invite

Extract and parse a calendar invite (`.ics`) from an email.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| email_id | string | **Yes** | - | The email ID containing the invite |
| attachment_id | string | No | first calendar part | Use when the email has multiple `.ics` parts |

**Returns:**
```json
{
  "title": "Lunch with Chris",
  "start": "2026-05-13T12:00:00Z",
  "end": "2026-05-13T13:00:00Z",
  "location": "Food at 52",
  "attendees": ["chris@example.com", "guest@example.com"],
  "organizer": "organiser@example.com",
  "description": "Bring an appetite.",
  "raw_ics": "BEGIN:VCALENDAR\nVERSION:2.0\n..."
}
```

> Parses SUMMARY, DTSTART, DTEND, LOCATION, ORGANIZER, DESCRIPTION and
> ATTENDEE properties from the first VEVENT. Timezone parameters and RRULE
> expansion are not interpreted - check `raw_ics` if you need them.

---

## Search Tool

### hey_search

Search emails by query. Uses local FTS cache first for speed, then network for fresh results.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | **Yes** | - | Search query (1-500 characters) |
| limit | number | No | 25 | Maximum number of results (1-100) |
| force_refresh | boolean | No | false | Bypass cache and search via network |

**Returns:**
```json
{
  "data": [
    {
      "id": "1946922438",
      "topicId": "1946922438",
      "entryId": "2069500066",
      "from": "John Doe",
      "subject": "Meeting tomorrow",
      "date": "2024-01-15T10:30:00Z"
    }
  ],
  "_cache": {
    "source": "network",
    "cached_at": "2024-01-15T10:00:00Z",
    "age_seconds": 0,
    "is_stale": false,
    "hint": "Fresh data from Hey.com"
  }
}
```

> **Note**: Network search results include `topicId`, `entryId`, subject, sender name, and date. Unlike folder listings, network search results do not include `postingId`, `fromEmail`, `snippet`, `unread`, or `bubbledUp` fields (Hey.com's search page uses a compact result format). FTS cache results may include additional fields if the emails were previously cached from folder listings.

---

## Sending Tools

### hey_send_email

Send a new email.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| to | string[] | **Yes** | - | List of recipient email addresses |
| subject | string | **Yes** | - | Email subject line |
| body | string | **Yes** | - | Email body content (HTML supported) |
| cc | string[] | No | - | List of CC recipient email addresses |

**Returns:**
```json
{
  "success": true,
  "messageId": "12345"
}
```

> **Implementation**: Uses `POST /messages` with browser form headers to submit the email directly.

---

### hey_reply

Reply to an email thread. Prefer this over `hey_send_email` whenever responding to an existing thread — it preserves threading. By default the reply goes to the other thread participants (your own address excluded). Pass `to` (and optionally `cc`) to redirect the recipients — useful for chasing your own threads, replying to a list message at a specific person, or otherwise overriding the default participants.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| thread_id | string | **Yes** | - | The thread/topic ID to reply to |
| body | string | **Yes** | - | Reply body content (HTML supported) |
| to | string[] | No | thread participants minus caller | Override the To: line. Replaces the auto-detected participants. Use to: (a) chase your own thread without looping back to yourself, (b) redirect a mailing-list reply to a specific person, or (c) generally target the reply at recipients other than the thread defaults. |
| cc | string[] | No | - | Optional CC override. Only honoured when `to` is also provided. |

**Returns:**
```json
{
  "success": true,
  "messageId": "12345"
}
```

If the thread has no other detectable participant (e.g. the caller is the only sender so far) and no `to` override is supplied, the tool returns `{ success: false, error: "Could not determine reply recipient..." }` rather than silently posting a topic entry that never leaves Hey.

> **Implementation**: Two-step process -- creates a draft via `POST /entries/{id}/replies`, then sends via `PATCH /messages/{draftId}` with Turbo Stream headers and `_method=patch`. When `to` is supplied it is passed to Hey verbatim as `entry[addressed][directly][]`, replacing the auto-detected participants.

---

### hey_forward

Forward an email to new recipients.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| entry_id | string | **Yes** | - | The entry ID of the email to forward |
| to | string[] | **Yes** | - | List of recipient email addresses |
| cc | string[] | No | - | List of CC recipient email addresses |
| bcc | string[] | No | - | List of BCC recipient email addresses |
| body | string | No | - | Optional message to prepend before forwarded content |

**Returns:**
```json
{
  "success": true,
  "messageId": "12345"
}
```

> **Implementation**: Uses `POST /messages` with browser form headers. Fetches the original email's subject and body from the forward page, prepending any optional `body` text. Uses `entryId` (try `topicId` as fallback).

---

## Organisation Tools

### hey_set_aside

Move an email thread to Set Aside for later. Reversible via `hey_unset_aside`. Does not affect future emails from the sender.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic or entry ID to set aside (use `topicId` or `entryId` from list operations) |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_unset_aside

Remove an email from Set Aside (move it back to the Imbox or its original location).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The posting ID to remove from Set Aside (use `postingId` from `hey_list_set_aside`) |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_reply_later

Move an email thread to Reply Later. Reversible via `hey_remove_reply_later`. Use for emails you intend to respond to but not right now.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic or entry ID to mark for reply later (use `topicId` or `entryId` from list operations) |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_remove_reply_later

Remove an email from Reply Later (mark as "Done", moving it back to the Imbox).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The **posting ID** (from `postingId` field in email data) to remove from Reply Later |

> **Important**: This tool requires the `postingId`, NOT the `topicId` or generic `id`. Get this from the `hey_list_reply_later` response.

**Returns:**
```json
{
  "success": true
}
```

---

### hey_bubble_up

Schedule an email to bubble up (reappear) at a specific time slot.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The posting ID to schedule |
| slot | string | **Yes** | - | When to bubble up (see table below) |
| date | string | No* | - | Date in YYYY-MM-DD format. *Required when slot is `custom`. |

**Slot Values:**
| Value | Description | Typical Time |
|-------|-------------|--------------|
| `now` | Immediately | Now |
| `today` | Later today | 18:00 |
| `tomorrow` | Tomorrow morning | 08:00 |
| `weekend` | This weekend | Saturday 08:00 |
| `next_week` | Next week | Monday 08:00 |
| `surprise_me` | Random time chosen by Hey | Varies |
| `custom` | Specific date | Requires `date` parameter |

**Examples:**

Standard bubble-up:
```json
{
  "posting_id": "12345",
  "slot": "tomorrow"
}
```

Surprise me (random time):
```json
{
  "posting_id": "12345",
  "slot": "surprise_me"
}
```

Custom date:
```json
{
  "posting_id": "12345",
  "slot": "custom",
  "date": "2026-01-28"
}
```

**Returns:**
```json
{
  "success": true
}
```

---

### hey_bubble_up_if_no_reply

Schedule an email to bubble up ONLY if there's no reply by a specific date. This is a conditional bubble-up - the email will only reappear if the recipient hasn't replied by the deadline.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The posting ID to schedule |
| date | string | **Yes** | - | Deadline date in YYYY-MM-DD format |

**Example:**
```json
{
  "posting_id": "12345",
  "date": "2026-01-24"
}
```

**Returns:**
```json
{
  "success": true
}
```

> **Use Case**: Use this tool when you want to be reminded about an email only if the conversation goes cold. If the recipient replies before the deadline, the bubble-up is cancelled automatically.

---

### hey_pop_bubble

Pop (dismiss) a bubbled-up email so it sinks back into the Imbox. The email is not deleted or archived — it just stops being pinned at the top.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The posting ID to pop/unbubble |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_mark_unseen

Mark an email thread as unseen/unread.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic/thread ID to mark as unseen |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_mark_seen

Clear the orange "New for you" tray dot — mirrors Hey's "Mark all as seen" UI affordance. Pass a `posting_id` to clear just that one item; omit it to clear the entire Imbox tray in one bulk call. Reversible per-item via `hey_mark_unseen`.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | No | bulk (whole tray) | Optional. The `postingId` to clear from the New for you tray. When omitted, clears every currently-new item in the Imbox tray. |

**Behaviour:**
- With `posting_id`: `POST /postings/seen` body `posting_ids={postingId}`.
- Without `posting_id`: `POST /boxes/{imboxId}/observation` (account-specific box id discovered at runtime).

**Returns:**
```json
{
  "success": true
}
```

> "Seen" is the tray-level acknowledgement state shown as the orange dot in Hey's UI. It is distinct from per-entry read state (`hey_read_status`) and from the thread-level unseen toggle (`hey_mark_unseen`). Reading or organising a thread does not automatically clear the dot.

---

### hey_read_status

Set the read/unread status of an email entry. Reversible by calling again with the opposite status. Operates on individual entries, not whole threads.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The entry ID to update (use `entryId` from list operations) |
| status | string | **Yes** | - | Target status: `read` or `unread` |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_set_status

Change an email thread's status (trash, restore, spam, unspam). Hits Hey's entry-based status endpoint; the topic is resolved to one of its entries by reading the thread page. For Paper Trail bundles (postingId-only items with no thread): `trash` falls back to `POST /postings/trash`; other actions return an explicit error.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic/thread ID (use `topicId` from list operations). For Paper Trail bundles, pass the `postingId` — `trash` works via fallback, other actions return an error pointing to the bundle's individual entries. |
| action | string | **Yes** | - | Status action (see table below) |

**Action values:**
| Value | Description | Bundle support |
|-------|-------------|----------------|
| `trash` | Move to Trash (reversible via `restore`) | Yes (via `/postings/trash`) |
| `restore` | Recover from Trash | No (open an individual entry inside the bundle) |
| `spam` | Mark as spam and block sender (reversible via `unspam`) | No (Hey's bundle UI does not expose this) |
| `unspam` | Restore from spam folder | No (open an individual entry inside the bundle) |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_move_to

Move an email thread between Hey.com views: Imbox, Feed, or Paper Trail. Reversible by moving to a different destination.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic/thread ID to move (use `topicId` from list operations) |
| destination | string | **Yes** | - | Target view: `imbox`, `feed`, or `paper_trail` |

**Destination values:**
| Value | Description |
|-------|-------------|
| `imbox` | Important emails that need attention |
| `feed` | Newsletters, notifications, updates |
| `paper_trail` | Receipts, confirmations, automated/transactional emails |

**Returns:**
```json
{
  "success": true
}
```

> **Note**: This tool does not cover trash, spam, or screener -- use `hey_set_status` or `hey_screen` for those. Set Aside and Reply Later have their own dedicated tools (`hey_set_aside`, `hey_reply_later`) because they are temporary triage actions with different reversal semantics.

---

### hey_thread_mute

Mute or unmute a thread (called "Ignore" in Hey.com's UI). Muting stops notifications but keeps the thread in its current view.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The posting ID of the thread (use `postingId` from list operations) |
| action | string | **Yes** | - | `mute` to stop notifications, `unmute` to resume them |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_screen

Approve or reject a sender by email address. `reject` (a.k.a. "screen out") works whether the sender is currently pending in the Screener OR already approved — for already-approved senders, the tool falls back to the contact-page "Screened Out" affordance (`POST /contacts/{id}/clearance?status=denied`). Rejection does **not** flag existing emails as spam; it only blocks future emails from this sender.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sender_email | string | **Yes** | - | The sender's email address |
| action | string | **Yes** | - | `approve` to allow emails through, `reject` (a.k.a. screen out) to block future emails from this sender. |
| destination | string | No | `imbox` | When `action=approve`, the view future emails from this sender land in: `imbox` (default), `feed`, or `paper_trail`. Ignored when `action=reject`. |

**Returns:**
```json
{
  "success": true
}
```

> **Note**: `reject` is reversible from the Hey UI (visit the contact page and toggle back). The MCP does not yet surface the re-approval path.

---

### hey_screen_by_id

Approve or reject a first-time sender from the Screener by clearance ID. When approving, optionally route future emails to a non-Imbox destination. For senders that have already left the screener, use `hey_screen` by email instead — it falls back to the contact-page block.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| clearance_id | string | **Yes** | - | The clearance ID from `hey_list_screener` |
| action | string | **Yes** | - | `approve` to allow emails through, `reject` to block future emails. Does not flag as spam. |
| destination | string | No | `imbox` | When `action=approve`, the view future emails from this sender land in: `imbox` (default), `feed`, or `paper_trail`. Ignored when `action=reject`. |

**Returns:**
```json
{
  "success": true
}
```

> **Note**: `reject` is reversible from the Hey UI (visit the contact page and toggle back). The MCP does not yet surface the re-approval path.

---

### hey_label

Add or remove a label on an email thread.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| topic_id | string | **Yes** | - | The topic/thread ID to label or unlabel |
| label_id | string | **Yes** | - | The label ID (use `hey_list_labels` to see available labels) |
| action | string | **Yes** | - | `add` or `remove` |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_collection

Add or remove an email thread from a collection.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| topic_id | string | **Yes** | - | The topic/thread ID |
| collection_id | string | **Yes** | - | The collection ID (use `hey_list_collections` to see available collections) |
| action | string | **Yes** | - | `add` or `remove` |

**Returns:**
```json
{
  "success": true
}
```

---

## Cache Management

### hey_cache_status

Check cache freshness and statistics.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| folder | string | No | - | Optional folder to get specific stats for (`imbox`, `feed`, `paper_trail`, `set_aside`, `reply_later`) |

**Returns:**
```json
{
  "total_messages": 150,
  "total_emails_cached": 85,
  "search_cache_entries": 10,
  "folder_stats": {
    "folder": "imbox",
    "message_count": 45,
    "unread_count": 3
  },
  "global_unread": 12
}
```

---

## Error Handling

All tools return errors in a consistent format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: [error message]"
    }
  ],
  "isError": true
}
```

### Common Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `Failed to authenticate with Hey.com` | Session invalid | Re-run the auth helper |
| `Session expired, please retry` | Session expired mid-request | The MCP will auto-refresh; retry the request |
| `[parameter] is required` | Missing required parameter | Provide the required parameter |
| `[parameter] must be valid` | Invalid parameter format | Check parameter format (IDs: alphanumeric, emails: valid format) |
| `Request failed with status [code]` | Hey.com returned an error | Check if the resource exists |

---

## Notes

- All dates are returned in ISO 8601 format
- Email bodies may contain HTML
- Thread IDs (topicId) are needed for replies and can be found in `hey_read_email` response
- The Screener tools work with email addresses or clearance IDs
- Cache metadata is returned with all read operations to indicate data freshness

### ID Types Reference

Hey.com uses different ID types for different operations. Always use the correct ID type:

| ID Type | Field Name | Used By |
|---------|------------|---------|
| **Posting ID** | `postingId` | `hey_bubble_up`, `hey_bubble_up_if_no_reply`, `hey_pop_bubble`, `hey_thread_mute`, `hey_unset_aside`, `hey_remove_reply_later`, `hey_read_email` (Paper Trail bundles) |
| **Topic ID** | `topicId` | `hey_reply`, `hey_set_status`, `hey_label`, `hey_collection`, `hey_mark_unseen`, `hey_move_to`, `hey_read_email` (threads) |
| **Topic or Entry ID** | `topicId` or `entryId` | `hey_set_aside`, `hey_reply_later` (accepts either, tries topic-based move first then entry-based fallback) |
| **Entry ID** | `entryId` | `hey_forward`, `hey_read_status` |
| **Clearance ID** | `clearanceId` | `hey_screen_by_id` |

> **Tip**: When listing emails, the response includes all available ID types. Use the appropriate ID based on the operation you want to perform.
