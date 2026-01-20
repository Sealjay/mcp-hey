# Hey MCP Tools Reference

This document provides detailed documentation for all MCP tools provided by hey-mcp.

**Total Tools: 38**

---

## Table of Contents

- [Reading Tools](#reading-tools) (15 tools)
- [Search Tool](#search-tool) (1 tool)
- [Sending Tools](#sending-tools) (2 tools)
- [Organisation Tools](#organisation-tools) (19 tools)
- [Cache Management](#cache-management) (1 tool)
- [Error Handling](#error-handling)

---

## Reading Tools

### hey_list_imbox

List emails in the Hey.com Imbox (important emails that need attention).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

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

### hey_list_feed

List emails in The Feed (newsletters, notifications, updates).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_paper_trail

List emails in Paper Trail (receipts, confirmations, transactional emails).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

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

### hey_list_trash

List emails in the Trash.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_spam

List emails in the Spam folder.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_drafts

List draft emails.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of drafts to return (1-100) |
| page | number | No | 1 | Page number for pagination |
| force_refresh | boolean | No | false | Bypass cache and fetch fresh data |

**Returns:** Same structure as `hey_list_imbox`

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

Read the full content of an email by ID.

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
    "threadId": "67890"
  },
  "_cache": {...}
}
```

> **Paper Trail Bundles**: Some Paper Trail emails (transactional emails from high-volume senders like banks, Wise, Amazon) are grouped into "bundles". These have only a `postingId` (no `topicId`). The tool automatically tries the bundle endpoint when needed.

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

**Returns:** Same structure as `hey_list_imbox`

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

---

### hey_reply

Reply to an email thread.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| thread_id | string | **Yes** | - | The thread/topic ID to reply to |
| body | string | **Yes** | - | Reply body content (HTML supported) |

**Returns:**
```json
{
  "success": true
}
```

---

## Organisation Tools

### hey_set_aside

Move an email to Set Aside for later.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The email ID to set aside |

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
| id | string | **Yes** | - | The email ID to remove from Set Aside |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_reply_later

Move an email to Reply Later.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The email ID to mark for reply later |

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

**Slot Values:**
| Value | Description | Typical Time |
|-------|-------------|--------------|
| `now` | Immediately | Now |
| `today` | Later today | 18:00 |
| `tomorrow` | Tomorrow morning | 08:00 |
| `weekend` | This weekend | Saturday 08:00 |
| `next_week` | Next week | Monday 08:00 |

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

### hey_trash

Move an email thread to Trash.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic/thread ID to trash |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_restore

Restore an email thread from Trash.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic/thread ID to restore |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_spam

Mark an email thread as Spam.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic/thread ID to mark as spam |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_not_spam

Mark an email thread as Not Spam (restore from spam folder).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | **Yes** | - | The topic/thread ID to mark as not spam |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_ignore_thread

Ignore/mute a thread (stop receiving notifications).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The posting ID to ignore |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_unignore_thread

Un-ignore/unmute a thread (resume receiving notifications).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| posting_id | string | **Yes** | - | The posting ID to un-ignore |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_screen_in

Approve a sender from the Screener (allow future emails). Looks up the clearance ID by sender email.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sender_email | string | **Yes** | - | The sender email address to approve |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_screen_in_by_id

Approve a sender from the Screener by clearance ID (alternative to sender email).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| clearance_id | string | **Yes** | - | The clearance ID from the screener list |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_screen_out

Reject a sender from the Screener (block future emails).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sender_email | string | **Yes** | - | The sender email address to reject |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_add_label

Add a label to an email thread.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| topic_id | string | **Yes** | - | The topic/thread ID to label |
| label_id | string | **Yes** | - | The label ID to apply (use `hey_list_labels` to see available labels) |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_remove_label

Remove a label from an email thread.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| topic_id | string | **Yes** | - | The topic/thread ID to unlabel |
| label_id | string | **Yes** | - | The label ID to remove |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_add_to_collection

Add an email thread to a collection.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| topic_id | string | **Yes** | - | The topic/thread ID to add to the collection |
| collection_id | string | **Yes** | - | The collection ID (use `hey_list_collections` to see available collections) |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_remove_from_collection

Remove an email thread from a collection.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| topic_id | string | **Yes** | - | The topic/thread ID to remove from the collection |
| collection_id | string | **Yes** | - | The collection ID |

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
| **Posting ID** | `postingId` | `hey_bubble_up`, `hey_ignore_thread`, `hey_unignore_thread`, `hey_remove_reply_later`, `hey_read_email` (Paper Trail bundles) |
| **Topic ID** | `topicId` | `hey_reply`, `hey_trash`, `hey_restore`, `hey_spam`, `hey_not_spam`, `hey_add_label`, `hey_remove_label`, `hey_add_to_collection`, `hey_remove_from_collection`, `hey_mark_unseen`, `hey_read_email` (threads) |
| **Entry ID** | `entryId` | `hey_set_aside`, `hey_unset_aside`, `hey_reply_later` |
| **Clearance ID** | `clearanceId` | `hey_screen_in_by_id` |

> **Tip**: When listing emails, the response includes all available ID types. Use the appropriate ID based on the operation you want to perform.
