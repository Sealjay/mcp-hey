# Hey.com API Reference

This document describes the reverse-engineered Hey.com web API endpoints used by hey-mcp.

## Base URL

```
https://app.hey.com
```

## Authentication

Hey.com uses session-based authentication with cookies. The primary authentication cookies are:

- `_hey_session` - Main session cookie
- `remember_user_token` - Long-lived authentication token (optional)

## Required Headers

All requests must include browser-realistic headers to avoid detection:

```
Host: app.hey.com
sec-ch-ua: "Chromium";v="125", "Google Chrome";v="125"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "macOS"
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: navigate
Sec-Fetch-User: ?1
Sec-Fetch-Dest: document
Accept-Encoding: gzip, deflate, br
Accept-Language: en-GB,en;q=0.9
Cookie: [session cookies]
```

## CSRF Protection

Write operations (POST, PUT, DELETE) require a CSRF token. The token is included in the HTML response as a meta tag:

```html
<meta name="csrf-token" content="[token]">
```

Include this token in requests as:
- Header: `X-CSRF-Token: [token]`

## Rate Limiting

Hey.com implements rate limiting. Headers in responses include:

- `x-ratelimit-limit` - Maximum requests allowed
- `x-ratelimit-remaining` - Requests remaining in current window
- `x-ratelimit-reset` - Unix timestamp when limit resets

Best practices:
- Add delays when `remaining < 50`
- Wait until `reset` timestamp when `remaining = 0`

## Endpoints

### Reading Endpoints

#### GET /imbox
List emails in the Imbox (important emails).

**Query Parameters:**
- `page` (optional): Page number for pagination

**Response:** HTML page with email list

---

#### GET /feedbox
List emails in The Feed (newsletters, notifications).

**Query Parameters:**
- `page` (optional): Page number for pagination

**Response:** HTML page with email list

---

#### GET /paper_trail
List emails in Paper Trail (receipts, confirmations).

**Query Parameters:**
- `page` (optional): Page number for pagination

**Response:** HTML page with email list

---

#### GET /set_aside
List emails in the Set Aside stack.

**Response:** HTML page with email list

---

#### GET /reply_later
List emails in the Reply Later stack.

**Response:** HTML page with email list

---

#### GET /clearances
List emails waiting in the Screener.

**Response:** HTML page with screener entries

---

#### GET /topics/{id}
Get a single email thread (HTML format).

**Path Parameters:**
- `id`: Topic/Thread ID

**Response:** HTML page with email thread content

---

#### GET /messages/{id}
Get a single email message (HTML format).

**Path Parameters:**
- `id`: Message ID

**Response:** HTML page with email content

---

#### GET /messages/{id}.text
Get a single email message (RFC822 text format).

**Path Parameters:**
- `id`: Message ID

**Response:** Plain text email content

---

#### GET /search
Search emails.

**Query Parameters:**
- `q`: Search query string

**Response:** HTML page with search results

---

#### GET /topics/trash
List trashed emails.

**Response:** HTML page with trashed emails

---

#### GET /topics/spam
List spam emails.

**Response:** HTML page with spam emails

---

#### GET /entries/drafts
List draft emails.

**Response:** HTML page with drafts

---

### Labels/Folders Endpoints

#### GET /folders
List all labels.

**Response:** HTML page with all labels and their folder IDs

---

#### GET /folders/{id}
View emails with a specific label.

**Path Parameters:**
- `id`: Folder/Label ID

**Response:** HTML page with labelled emails

---

#### GET /my/navigation
Get the navigation menu (includes all folders/labels).

**Response:** HTML fragment with navigation structure

---

### Sending Endpoints

#### POST /entries
Send a new email.

**Content-Type:** `application/x-www-form-urlencoded`

**Form Fields:**
- `acting_sender_id`: Your Hey account ID
- `acting_sender_email`: Your Hey email address
- `entry[addressed][directly][]`: Recipient email (repeat for multiple)
- `entry[addressed][copied][]`: CC recipient email (repeat for multiple)
- `message[subject]`: Email subject
- `message[content]`: Email body (HTML supported)

**Response:** Redirect to the new message

---

#### POST /topics/{id}/messages
Reply to an email thread.

**Path Parameters:**
- `id`: Topic/thread ID

**Content-Type:** `application/x-www-form-urlencoded`

**Form Fields:**
- `acting_sender_id`: Your Hey account ID
- `acting_sender_email`: Your Hey email address
- `message[content]`: Reply body (HTML supported)

**Response:** Redirect to the thread

---

### Organisation Endpoints

#### PUT /entries/{id}/set_aside
Move an email to Set Aside.

**Path Parameters:**
- `id`: Entry ID

**Response:** 200 OK or redirect

---

#### DELETE /entries/{id}/set_aside
Remove an email from Set Aside.

**Path Parameters:**
- `id`: Entry ID

**Response:** 200 OK or redirect

---

#### PUT /entries/{id}/reply_later
Move an email to Reply Later.

**Path Parameters:**
- `id`: Entry ID

**Response:** 200 OK or redirect

---

#### DELETE /entries/{id}/reply_later
Remove an email from Reply Later.

**Path Parameters:**
- `id`: Entry ID

**Response:** 200 OK or redirect

---

#### POST /clearances/{id}
Screen in a sender (approve). The clearance ID is found from the screener page.

**Path Parameters:**
- `id`: Clearance ID

**Response:** 200 OK or redirect

---

#### POST /screener/approvals
Approve a sender (screen in) by email address.

**Content-Type:** `application/x-www-form-urlencoded`

**Form Fields:**
- `sender_email`: Email address to approve

**Response:** 200 OK or redirect

---

#### POST /screener/rejections
Reject a sender (screen out).

**Content-Type:** `application/x-www-form-urlencoded`

**Form Fields:**
- `sender_email`: Email address to reject

**Response:** 200 OK or redirect

---

#### PUT /entries/{id}/read
Mark an email as read.

**Path Parameters:**
- `id`: Entry ID

**Response:** 200 OK or redirect

---

#### DELETE /entries/{id}/read
Mark an email as unread.

**Path Parameters:**
- `id`: Entry ID

**Response:** 200 OK or redirect

---

### Thread Status Endpoints

#### POST /topics/{id}/status/trashed
Move a thread to Trash.

**Path Parameters:**
- `id`: Topic/Thread ID

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/status/active
Restore a thread from Trash (make active again).

**Path Parameters:**
- `id`: Topic/Thread ID

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/status/spam
Mark a thread as Spam.

**Path Parameters:**
- `id`: Topic/Thread ID

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/status/ham
Mark a thread as Not Spam (restore from spam).

**Path Parameters:**
- `id`: Topic/Thread ID

**Response:** 200 OK or redirect

---

### Thread Action Endpoints

#### POST /topics/{id}/unseen
Mark a thread as unseen/unread.

**Path Parameters:**
- `id`: Topic/Thread ID

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/bubble_up
Schedule a thread to bubble back up to Imbox.

**Path Parameters:**
- `id`: Topic/Thread ID

**Query Parameters:**
- `slot`: When to bubble up. Values include:
  - `now` - Immediately
  - `today` - Later today (typically 18:00)
  - `tomorrow` - Tomorrow morning (typically 08:00)
  - `weekend` - This weekend (typically Saturday 08:00)
  - `next_week` - Next week (typically Monday 08:00)

**Response:** 200 OK or redirect

---

#### POST /postings/{id}/muting
Ignore/mute a thread (stop receiving notifications).

**Path Parameters:**
- `id`: Posting ID

**Response:** 200 OK or redirect

---

#### DELETE /postings/{id}/muting
Un-ignore/unmute a thread (resume receiving notifications).

**Path Parameters:**
- `id`: Posting ID

**Response:** 200 OK or redirect

---

## HTML Response Structure

Hey.com uses Hotwire/Turbo for dynamic updates. Email lists are typically contained in:

- `turbo-frame` elements with IDs like `entry_{id}` or `posting_{id}`
- Elements with `data-entry-id` or `data-posting-id` attributes
- CSS classes like `.posting`, `.entry`, `.sender`, `.subject`

### Email Entry Structure

```html
<div data-entry-id="12345" class="posting">
  <div class="sender">John Doe</div>
  <div class="subject">Hello World</div>
  <div class="snippet">Preview of email content...</div>
  <time datetime="2024-01-15T10:30:00Z">Jan 15</time>
</div>
```

## Session Expiry

When a session expires, requests return a 302 redirect to `/sign_in`. The hey-mcp client detects this and triggers re-authentication.

## Notes

- API structure may change as Hey.com updates their frontend
- Some endpoints use Turbo Streams for partial updates
- File attachments use a separate upload flow (not yet implemented)
