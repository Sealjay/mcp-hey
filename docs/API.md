# Hey.com API Reference

This document describes the reverse-engineered Hey.com web API endpoints used by hey-mcp.

> **Warning**: This API is reverse-engineered and may change without notice. Keep this documentation current as you discover changes.

## Table of Contents

- [Base Configuration](#base-configuration)
- [Authentication](#authentication)
- [Required Headers](#required-headers)
- [CSRF Protection](#csrf-protection)
- [Rate Limiting](#rate-limiting)
- [Endpoints](#endpoints)
  - [Reading Emails](#reading-emails)
  - [Inbox Views](#inbox-views)
  - [Search](#search)
  - [Sending Emails](#sending-emails)
  - [Organisation](#organisation)
  - [Thread Status](#thread-status)
  - [Labels](#labels)
  - [Collections](#collections)
- [HTML Response Structure](#html-response-structure)
- [Session Management](#session-management)
- [Known Issues](#known-issues)
- [Changelog](#changelog)

---

## Base Configuration

```
Base URL: https://app.hey.com
Compose Page: /messages/new
```

---

## Authentication

Hey.com uses session-based authentication with cookies:

| Cookie | Purpose |
|--------|---------|
| `session_token` | Main session cookie (Rails signed cookie) |
| `device_token` | Device identification token (Rails signed cookie) |
| `x_user_agent` | User agent string |
| `time_zone` | User's timezone |
| `color_scheme` | UI theme preference |

> **Note**: Cookie names changed from `_hey_session` to `session_token` as of late 2025. The auth helper extracts all Hey.com cookies automatically.

---

## Required Headers

All requests must include browser-realistic headers to avoid detection:

```http
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

---

## CSRF Protection

Write operations (POST, PUT, DELETE) require a CSRF token from the HTML meta tag:

```html
<meta name="csrf-token" content="[token]">
```

Include in requests as header: `X-CSRF-Token: [token]`

---

## Rate Limiting

Response headers indicate rate limit status:

| Header | Description |
|--------|-------------|
| `x-ratelimit-limit` | Maximum requests allowed |
| `x-ratelimit-remaining` | Requests remaining in current window |
| `x-ratelimit-reset` | Unix timestamp when limit resets |

**Best practices:**
- Add delays when `remaining < 50`
- Wait until `reset` timestamp when `remaining = 0`

---

## Hey.com View Model

Hey.com organizes email differently from traditional email clients. Instead of folders or archives, it uses a triage-based system:

### Primary Views

| View | Endpoint | Purpose |
|------|----------|---------|
| **Imbox** | `/imbox` | Important emails from approved senders |
| **The Feed** | `/feedbox` | Newsletters, marketing, and notifications |
| **Paper Trail** | `/paper_trail` | Receipts, confirmations, and transactional emails |

### Working Stacks

| Stack | Endpoint | Purpose |
|-------|----------|---------|
| **Set Aside** | `/set_aside` | Temporary holding area for emails to revisit |
| **Reply Later** | `/reply_later` | Emails that need a response |

### Access Control

| View | Endpoint | Purpose |
|------|----------|---------|
| **Screener** | `/clearances` | New senders waiting for approval |
| **Trash** | `/topics/trash` | Deleted emails |
| **Spam** | `/topics/spam` | Spam-marked emails |
| **Drafts** | `/entries/drafts` | Unsent email drafts |

### Key Concepts

1. **No Archive**: Hey.com doesn't have a traditional archive. Once processed, emails remain in their primary view (Imbox/Feed/Paper Trail) until deleted.

2. **Screener First**: New senders must be approved via the Screener before their emails appear in primary views.

3. **View Assignment**: When screening in a sender, you choose which view their emails go to (Imbox, Feed, or Paper Trail).

4. **Bubble Up**: Emails in Set Aside can be scheduled to "bubble up" (reappear in Imbox) at a future time.

---

## Endpoints

### Reading Emails

#### GET /postings/{id}

Get a single email posting/entry (primary endpoint for viewing individual emails).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Posting ID |

**Response:** HTML page with email content

---

#### GET /topics/{id}

Get an email thread (conversation).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |

**Response:** HTML page with email thread content

---

#### GET /messages/{id}

Get a single email message.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Message ID |

**Response:** HTML page with email content

---

#### GET /messages/{id}.text

Get a single email message in RFC822 text format.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Message ID |

**Response:** Plain text email content

---

### Inbox Views

#### GET /imbox

List emails in the Imbox (important emails).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `page` | number | query | Page number (optional) |

**Response:** HTML page with email list

---

#### GET /feedbox

List emails in The Feed (newsletters, notifications).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `page` | number | query | Page number (optional) |

**Response:** HTML page with email list

---

#### GET /paper_trail

List emails in Paper Trail (receipts, confirmations).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `page` | number | query | Page number (optional) |

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

### Search

#### GET /search

Quick search endpoint (used for autocomplete). Returns basic search results.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `q` | string | query | Search query string |

**Response:** HTML page with search results

---

#### GET /advanced_search

Full search page with filtering options (From, To, Subject, Date range, Label).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `q` | string | query | Search query string |

**Response:** HTML page with:
- **Contacts** section: Matching email addresses
- **Messages** section: Matching email threads

> **Note**: Both `/search` and `/advanced_search` work. The MCP uses `/search` for simplicity; the web UI uses `/advanced_search` for the full results page.

---

### Sending Emails

#### POST /entries

Send a new email.

**Content-Type:** `application/x-www-form-urlencoded`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `acting_sender_id` | string | Yes | Your Hey account ID |
| `acting_sender_email` | string | Yes | Your Hey email address |
| `entry[addressed][directly][]` | string | Yes | Recipient email (repeat for multiple) |
| `entry[addressed][copied][]` | string | No | CC recipient email (repeat for multiple) |
| `message[subject]` | string | Yes | Email subject |
| `message[content]` | string | Yes | Email body (HTML supported) |

**Response:** Redirect to the new message

---

#### POST /topics/{id}/messages

Reply to an email thread.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/thread ID |

**Content-Type:** `application/x-www-form-urlencoded`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `acting_sender_id` | string | Yes | Your Hey account ID |
| `acting_sender_email` | string | Yes | Your Hey email address |
| `message[content]` | string | Yes | Reply body (HTML supported) |

**Response:** Redirect to the thread

---

### Organisation

#### PUT /entries/{id}/set_aside

Move an email to Set Aside.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Entry ID |

**Response:** 200 OK or redirect

---

#### DELETE /entries/{id}/set_aside

Remove an email from Set Aside.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Entry ID |

**Response:** 200 OK or redirect

---

#### PUT /entries/{id}/reply_later

Move an email to Reply Later.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Entry ID |

**Response:** 200 OK or redirect

---

#### DELETE /entries/{id}/reply_later

Remove an email from Reply Later.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Entry ID |

**Response:** 200 OK or redirect

---

#### PUT /entries/{id}/read

Mark an email as read.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Entry ID |

**Response:** 200 OK or redirect

---

#### DELETE /entries/{id}/read

Mark an email as unread.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Entry ID |

**Response:** 200 OK or redirect

---

#### POST /clearances/{id}

Screen in (approve) or screen out (reject) a sender.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Clearance ID (from screener page HTML) |

**Content-Type:** `application/x-www-form-urlencoded`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `_method` | string | Yes | `patch` |
| `status` | string | Yes | `approved` (screen in) or `denied` (screen out) |

**Response:** 200 OK or redirect

---

#### POST /postings/bubble_up

Schedule emails to bubble back up to Imbox.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `posting_ids[]` | string | query | Posting ID(s) to bubble up (repeat for multiple) |
| `slot` | string | query | When to bubble up (see values below) |

**Slot Values:**

| Value | Description |
|-------|-------------|
| `now` | Immediately |
| `today` | Later today (typically 18:00) |
| `tomorrow` | Tomorrow morning (typically 08:00) |
| `weekend` | This weekend (typically Saturday 08:00) |
| `next_week` | Next week (typically Monday 08:00) |

**Example:** `POST /postings/bubble_up?posting_ids[]=12345&slot=tomorrow`

**Response:** 200 OK or redirect

#### POST /topics/{id}/bubble_up

Alternative endpoint for scheduling a single topic to bubble up.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic ID |
| `slot` | string | query | When to bubble up (same values as above) |

**Example:** `POST /topics/1906880181/bubble_up?slot=tomorrow`

**Response:** 200 OK or redirect

> **Note**: Both `/postings/bubble_up` and `/topics/{id}/bubble_up` endpoints work. The postings endpoint supports multiple IDs; the topics endpoint is simpler for single items.

---

#### POST /postings/{id}/muting

Ignore/mute a thread (stop receiving notifications).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Posting ID |

**Response:** 200 OK or redirect

---

#### DELETE /postings/{id}/muting

Un-ignore/unmute a thread.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Posting ID |

**Response:** 200 OK or redirect

---

### Thread Status

#### POST /topics/{id}/status/trashed

Move a thread to Trash.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/status/active

Restore a thread from Trash.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/status/spam

Mark a thread as Spam.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/status/ham

Mark a thread as Not Spam (restore from spam).

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |

**Response:** 200 OK or redirect

---

#### POST /topics/{id}/unseen

Mark a thread as unseen/unread.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |

**Response:** 200 OK or redirect

---

### Labels

#### GET /folders

List all labels/folders.

**Response:** HTML page with all labels and their folder IDs

---

#### GET /folders/{id}

View emails with a specific label.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Folder/Label ID |

**Response:** HTML page with labelled emails

---

#### GET /my/navigation

Get the navigation menu (includes all folders/labels).

**Response:** HTML fragment with navigation structure

---

#### POST /topics/{id}/filings

Add a label to a thread.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |
| `folder_id` | string | query | Label/folder ID to apply |

**Response:** 200 OK or redirect

---

#### DELETE /topics/{id}/filings

Remove a label from a thread.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |
| `folder_id` | string | query | Label/folder ID to remove |

**Response:** 200 OK or redirect

---

### Collections

#### GET /collections

List all collections.

**Response:** HTML page with collection list

---

#### GET /collections/{id}

View emails in a specific collection.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Collection ID |

**Response:** HTML page with collection emails

---

#### POST /topics/{id}/collecting

Add a thread to a collection.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |
| `collection_id` | string | query | Collection ID to add to |

**Response:** 200 OK or redirect

---

#### DELETE /topics/{id}/collecting

Remove a thread from a collection.

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `id` | string | path | Topic/Thread ID |
| `collection_id` | string | query | Collection ID to remove from |

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

---

## Session Management

When a session expires, requests return a 302 redirect to `/sign_in`. The hey-mcp client detects this and triggers re-authentication.

---

## Known Issues

1. **Turbo Streams**: Some endpoints use Turbo Streams for partial updates, which may require special handling
2. **File attachments**: Upload flow not yet implemented
3. **Bulk operations**: Some bulk operations may use different endpoint patterns

---

## Changelog

| Date | Change |
|------|--------|
| 2025-12 | Cookie name changed from `_hey_session` to `session_token` |
| 2025-01 | Documented correct bubble up endpoint as `/postings/bubble_up?posting_ids[]={id}` |
| 2025-01 | Documented compose page URL as `/messages/new` |
