# Hey MCP Tools Reference

This document provides detailed documentation for all MCP tools provided by hey-mcp.

## Reading Tools

### hey_list_imbox

List emails in the Hey.com Imbox (important emails that need attention).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return |
| page | number | No | 1 | Page number for pagination |

**Returns:**
```json
[
  {
    "id": "12345",
    "from": "John Doe",
    "fromEmail": "john@example.com",
    "subject": "Meeting tomorrow",
    "snippet": "Hi, just wanted to confirm...",
    "date": "2024-01-15T10:30:00Z",
    "unread": true
  }
]
```

**Example:**
```json
{
  "name": "hey_list_imbox",
  "arguments": {
    "limit": 10,
    "page": 1
  }
}
```

---

### hey_list_feed

List emails in The Feed (newsletters, notifications, updates).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return |
| page | number | No | 1 | Page number for pagination |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_paper_trail

List emails in Paper Trail (receipts, confirmations, transactional emails).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number | No | 25 | Maximum number of emails to return |
| page | number | No | 1 | Page number for pagination |

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_set_aside

List emails in the Set Aside stack (emails saved for later).

**Parameters:** None

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_reply_later

List emails in the Reply Later stack (emails pending response).

**Parameters:** None

**Returns:** Same structure as `hey_list_imbox`

---

### hey_list_screener

List emails waiting in the Screener (new senders awaiting approval).

**Parameters:** None

**Returns:** Same structure as `hey_list_imbox`

---

### hey_read_email

Read the full content of an email by ID.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | Yes | - | The email ID to read |
| format | string | No | "html" | Format: "html" or "text" |

**Returns:**
```json
{
  "id": "12345",
  "from": "John Doe",
  "fromEmail": "john@example.com",
  "to": ["me@hey.com"],
  "cc": ["other@example.com"],
  "subject": "Meeting tomorrow",
  "body": "<p>Hi, just wanted to confirm...</p>",
  "date": "2024-01-15T10:30:00Z",
  "threadId": "67890"
}
```

**Example:**
```json
{
  "name": "hey_read_email",
  "arguments": {
    "id": "12345",
    "format": "html"
  }
}
```

---

### hey_search

Search emails by query.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | Yes | - | Search query |
| limit | number | No | 25 | Maximum number of results |

**Returns:** Same structure as `hey_list_imbox`

**Example:**
```json
{
  "name": "hey_search",
  "arguments": {
    "query": "invoice 2024",
    "limit": 10
  }
}
```

---

## Sending Tools

### hey_send_email

Send a new email.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| to | string[] | Yes | - | List of recipient email addresses |
| subject | string | Yes | - | Email subject line |
| body | string | Yes | - | Email body content (HTML supported) |
| cc | string[] | No | - | List of CC recipient email addresses |

**Returns:**
```json
{
  "success": true,
  "messageId": "12345"
}
```

**Example:**
```json
{
  "name": "hey_send_email",
  "arguments": {
    "to": ["recipient@example.com"],
    "subject": "Hello!",
    "body": "<p>This is a test email.</p>",
    "cc": ["copy@example.com"]
  }
}
```

---

### hey_reply

Reply to an email thread.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| thread_id | string | Yes | - | The thread/topic ID to reply to |
| body | string | Yes | - | Reply body content (HTML supported) |

**Returns:**
```json
{
  "success": true
}
```

**Example:**
```json
{
  "name": "hey_reply",
  "arguments": {
    "thread_id": "67890",
    "body": "<p>Thanks for the update!</p>"
  }
}
```

---

## Organisation Tools

### hey_set_aside

Move an email to Set Aside for later.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| id | string | Yes | - | The email ID to set aside |

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
| id | string | Yes | - | The email ID to mark for reply later |

**Returns:**
```json
{
  "success": true
}
```

---

### hey_screen_in

Approve a sender from the Screener (allow future emails to arrive in Imbox).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sender_email | string | Yes | - | The sender email address to approve |

**Returns:**
```json
{
  "success": true
}
```

**Example:**
```json
{
  "name": "hey_screen_in",
  "arguments": {
    "sender_email": "newsletter@company.com"
  }
}
```

---

### hey_screen_out

Reject a sender from the Screener (block future emails).

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sender_email | string | Yes | - | The sender email address to reject |

**Returns:**
```json
{
  "success": true
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

Common errors:
- `Failed to authenticate with Hey.com` - Session invalid, re-auth needed
- `Session expired, please retry` - Session expired mid-request
- `[parameter] is required` - Missing required parameter
- `Request failed with status [code]` - Hey.com returned an error

## Notes

- All dates are returned in ISO 8601 format
- Email bodies may contain HTML
- Thread IDs are needed for replies and can be found in `hey_read_email` response
- The Screener tools work with email addresses, not email IDs
