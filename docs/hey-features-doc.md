# Hey.com Features Documentation

Last verified: 2026-01-19

This document tracks all Hey.com features discovered through UI exploration and their MCP tool implementation status.

## Feature Matrix

### Main Views

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| List Imbox | Main Nav > Imbox | `GET /imbox` | `hey_list_imbox` | **Implemented** |
| Imbox Summary | N/A | `GET /imbox` + parsing | `hey_imbox_summary` | **Implemented** |
| List Feed | Main Nav > The Feed | `GET /feedbox` | `hey_list_feed` | **Implemented** |
| List Paper Trail | Main Nav > Paper Trail | `GET /paper_trail` | `hey_list_paper_trail` | **Implemented** |
| List Set Aside | Main Nav > Set Aside | `GET /set_aside` | `hey_list_set_aside` | **Implemented** |
| List Reply Later | Main Nav > Reply Later | `GET /reply_later` | `hey_list_reply_later` | **Implemented** |
| List Screener | Main Nav > Screener | `GET /clearances` | `hey_list_screener` | **Implemented** |
| List Trash | Main Nav > Trash | `GET /topics/trash` | `hey_list_trash` | **Implemented** |
| List Spam | Main Nav > Spam | `GET /topics/spam` | `hey_list_spam` | **Implemented** |
| List Drafts | Main Nav > Drafts | `GET /entries/drafts` | `hey_list_drafts` | **Implemented** |
| List Sent | Main Nav > Sent | `GET /sent` | `hey_list_sent` | MISSING |
| List Previously Seen | Main Nav > Previously Seen | `GET /previously_seen` | `hey_list_previously_seen` | MISSING |
| List Screened Out | Main Nav > Screened Out | `GET /screened_out` | `hey_list_screened_out` | MISSING |
| List All Files | Main Nav > All Files | `GET /files` | `hey_list_files` | MISSING |
| List Everything | Main Nav > Everything | `GET /everything` | `hey_list_everything` | MISSING |

### Email Reading

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| Read Email | Click email | `GET /postings/{id}` | `hey_read_email` | **Implemented** |
| Read Thread | Click email | `GET /topics/{id}` | `hey_read_email` | **Implemented** |
| View Original (text) | Message menu > View original | `GET /messages/{id}.text` | `hey_read_email` (format=text) | **Implemented** |
| Download Original | Message menu > Download original | `GET /messages/{id}.eml` | - | MISSING |

### Email Composition

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| Send New Email | + Write button | `POST /entries` | `hey_send_email` | **Implemented** |
| Reply to Thread | Reply Now button | `POST /topics/{id}/messages` | `hey_reply` | **Implemented** |
| Forward Email | More > Forward | `GET /entries/{id}/forwards/new` + `POST /messages` | `hey_forward` | **Implemented** |
| Save Draft | Save draft button | TBD | `hey_save_draft` | MISSING |
| Delete Draft | Trash icon in compose | TBD | `hey_delete_draft` | MISSING |
| Schedule Send | Send > Later at scheduled time | TBD | `hey_schedule_send` | MISSING |
| Send with Bubble Up | Send > Now and Bubble Up | TBD | `hey_send_with_bubble_up` | MISSING |

### Email Organisation

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| Set Aside | Action bar | `PUT /entries/{id}/set_aside` | `hey_set_aside` | **Implemented** |
| Remove from Set Aside | Action bar | `DELETE /entries/{id}/set_aside` | `hey_unset_aside` | **Implemented** |
| Reply Later | Action bar | `PUT /entries/{id}/reply_later` | `hey_reply_later` | **Implemented** |
| Remove from Reply Later | Action bar | `DELETE /entries/{id}/reply_later` | `hey_remove_reply_later` | **Implemented** |
| Bubble Up | Action bar | `POST /postings/bubble_up?posting_ids[]={id}&slot={slot}` | `hey_bubble_up` | **Implemented** |
| Mark as Unseen | More > Mark Unseen | `POST /topics/{id}/unseen` | `hey_mark_unseen` | **Implemented** |
| Trash | More > Trash | `POST /topics/{id}/status/trashed` | `hey_trash` | **Implemented** |
| Restore from Trash | (in Trash view) | `POST /topics/{id}/status/active` | `hey_restore` | **Implemented** |
| Mark as Spam | Message menu > Report spam | `POST /topics/{id}/status/spam` | `hey_spam` | **Implemented** |
| Mark as Not Spam | (in Spam view) | `POST /topics/{id}/status/ham` | `hey_not_spam` | **Implemented** |
| Ignore Thread | More > Ignore this thread | `POST /postings/{id}/muting` | `hey_ignore_thread` | **Implemented** |
| Unignore Thread | More > Stop ignoring | `DELETE /postings/{id}/muting` | `hey_unignore_thread` | **Implemented** |
| Move to View | More > Move... | TBD | `hey_move_to_view` | MISSING |

### Screener

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| Screen In (by email) | Screener view | `POST /clearances/{id}` (status=approved) | `hey_screen_in` | **Implemented** |
| Screen In (by ID) | Screener view | `POST /clearances/{id}` (status=approved) | `hey_screen_in_by_id` | **Implemented** |
| Screen Out (Reject) | Screener view | `POST /clearances/{id}` (status=denied) | `hey_screen_out` | **Implemented** |
| Clear All Screener | Clear all... button | TBD | `hey_clear_screener` | MISSING |

### Labels

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| List Labels | Main Nav > Labels | `GET /folders` | `hey_list_labels` | **Implemented** |
| View Label Emails | Click label | `GET /folders/{id}` | `hey_list_label_emails` | **Implemented** |
| Add Label to Thread | More > Label... | `POST /topics/{id}/filings?folder_id={id}` | `hey_add_label` | **Implemented** |
| Remove Label from Thread | (in label view) | `DELETE /topics/{id}/filings?folder_id={id}` | `hey_remove_label` | **Implemented** |
| Create Label | + New in Labels view | TBD | `hey_create_label` | MISSING |
| Delete Label | Trash icon on label | TBD | `hey_delete_label` | MISSING |

### Collections

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| List Collections | Main Nav > Collections | `GET /collections` | `hey_list_collections` | **Implemented** |
| View Collection Emails | Click collection | `GET /collections/{id}` | `hey_list_collection_emails` | **Implemented** |
| Add to Collection | More > Add thread to Collection | `POST /topics/{id}/collecting?collection_id={id}` | `hey_add_to_collection` | **Implemented** |
| Remove from Collection | (in collection view) | `DELETE /topics/{id}/collecting?collection_id={id}` | `hey_remove_from_collection` | **Implemented** |
| Create Collection | + New in Collections view | TBD | `hey_create_collection` | MISSING |
| Delete Collection | Trash icon on collection | TBD | `hey_delete_collection` | MISSING |

### Workflows (discovered in UI)

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| List Workflows | Main Nav > Workflows | TBD | `hey_list_workflows` | MISSING |
| View Workflow Emails | Click workflow | TBD | `hey_get_workflow_emails` | MISSING |
| Add to Workflow | More > Add thread to Workflow | TBD | `hey_add_to_workflow` | MISSING |

### Search

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| Quick Search | Search bar | `GET /search?q={query}` | `hey_search` | **Implemented** |
| Advanced Search | Search page | `GET /advanced_search?q={query}` | - | MISSING (uses same tool) |

### Cache Management

| Feature | Description | MCP Tool | Status |
|---------|-------------|----------|--------|
| Cache Status | Check cache freshness and statistics | `hey_cache_status` | **Implemented** |

### Contacts

| Feature | UI Location | API Endpoint | MCP Tool | Status |
|---------|-------------|--------------|----------|--------|
| List Contacts | Main Nav > Contacts | TBD | `hey_list_contacts` | MISSING |
| View Contact | Click contact | TBD | `hey_view_contact` | MISSING |
| Create Contact Group | Message menu > Create contact group | TBD | `hey_create_contact_group` | MISSING |

### Other Features

| Feature | UI Location | Status |
|---------|-------------|--------|
| HEY World | Main Nav > HEY World | Not planned |
| Clips | Main Nav > Clips | Not planned |
| Snippets | Main Nav > Snippets | Not planned |
| Push Notifications | More > Send me push notifications | Not planned |
| Add Note to Self | More > Add a note to self | MISSING |
| Print Thread | More > Print this thread | Not applicable (browser) |
| Share Thread | More > Share this thread | Not planned |
| Create Event | Message menu > Create event | Not planned |
| Start Another Thread | More > Start another thread | Use `hey_send_email` |

---

## Complete MCP Tool List

All 39 implemented MCP tools:

### Reading Tools (15 tools)
1. `hey_list_imbox` - List emails in the Imbox
2. `hey_imbox_summary` - Get complete Imbox summary with screener count
3. `hey_list_feed` - List emails in The Feed
4. `hey_list_paper_trail` - List emails in Paper Trail
5. `hey_list_set_aside` - List emails in Set Aside
6. `hey_list_reply_later` - List emails in Reply Later
7. `hey_list_screener` - List emails in the Screener
8. `hey_list_trash` - List emails in Trash
9. `hey_list_spam` - List emails in Spam
10. `hey_list_drafts` - List draft emails
11. `hey_list_labels` - List all labels
12. `hey_list_label_emails` - List emails with a specific label
13. `hey_list_collections` - List all collections
14. `hey_list_collection_emails` - List emails in a collection
15. `hey_read_email` - Read full email content (supports html and text formats)

### Search Tool (1 tool)
16. `hey_search` - Search emails by query

### Sending Tools (3 tools)
17. `hey_send_email` - Send a new email
18. `hey_reply` - Reply to an email thread
19. `hey_forward` - Forward an email to new recipients

### Organisation Tools (16 tools)
20. `hey_set_aside` - Move email to Set Aside
21. `hey_unset_aside` - Remove email from Set Aside
22. `hey_reply_later` - Move email to Reply Later
23. `hey_remove_reply_later` - Remove email from Reply Later
24. `hey_bubble_up` - Schedule email to bubble up
25. `hey_mark_unseen` - Mark thread as unseen
26. `hey_trash` - Move thread to Trash
27. `hey_restore` - Restore thread from Trash
28. `hey_spam` - Mark thread as Spam
29. `hey_not_spam` - Mark thread as Not Spam
30. `hey_ignore_thread` - Ignore/mute a thread
31. `hey_unignore_thread` - Unignore/unmute a thread
32. `hey_screen_in` - Approve sender (by email)
33. `hey_screen_in_by_id` - Approve sender (by clearance ID)
34. `hey_screen_out` - Reject sender
35. `hey_add_label` - Add label to thread
36. `hey_remove_label` - Remove label from thread
37. `hey_add_to_collection` - Add thread to collection
38. `hey_remove_from_collection` - Remove thread from collection

### Cache Management (1 tool)
39. `hey_cache_status` - Check cache freshness and statistics

---

## Detailed Feature Documentation

### Bubble Up Time Slots

When scheduling a bubble up, the following slot values are available:

| Slot Value | Description | Typical Time |
|------------|-------------|--------------|
| `now` | Immediately | Now |
| `today` | Later today | 18:00 |
| `tomorrow` | Tomorrow morning | 08:00 |
| `weekend` | This weekend | Saturday 08:00 |
| `next_week` | Next week | Monday 08:00 |

### Screener Workflow

When screening in a sender, you can optionally specify which view their emails should go to:
- Imbox (default) - Important emails
- The Feed - Newsletters/notifications
- Paper Trail - Receipts/transactional

### Advanced Search Filters

| Filter | Description |
|--------|-------------|
| Just in... | Filter by view (Imbox, Feed, Paper Trail, etc.) |
| Has attachments | Emails with file attachments |
| Also these words | Additional search terms (OR) |
| None of these words | Exclude these terms |
| This exact phrase | Exact string match |
| From | Sender email/name |
| To | Recipient email/name |
| Subject | Subject line contains |
| Date range | Start and end dates |
| Label | Filter by label |

---

## Missing Features (Priority Order)

### High Priority
1. `hey_list_sent` - List sent emails
2. `hey_save_draft` / `hey_delete_draft` - Draft management

### Medium Priority
4. `hey_list_previously_seen` - View previously seen emails
5. `hey_list_screened_out` - View screened out senders
6. `hey_list_files` - List all attachments
7. `hey_create_label` / `hey_delete_label` - Label management
8. `hey_create_collection` / `hey_delete_collection` - Collection management

### Lower Priority
9. `hey_list_everything` - List all emails
10. `hey_schedule_send` - Schedule email sending
11. `hey_list_workflows` / `hey_add_to_workflow` - Workflow features
12. `hey_list_contacts` - Contact management

---

## Verification Status

| Tool | Tested | Working | Notes |
|------|--------|---------|-------|
| `hey_list_imbox` | [x] | [x] | HTML selectors verified against live site |
| `hey_imbox_summary` | [x] | [x] | Uses same extraction logic as list_imbox |
| `hey_list_feed` | [x] | [x] | HTML selectors verified against live site |
| `hey_list_paper_trail` | [x] | [x] | Uses same extraction logic |
| `hey_list_set_aside` | [x] | [x] | Uses same extraction logic |
| `hey_list_reply_later` | [x] | [x] | Uses same extraction logic |
| `hey_list_screener` | [x] | [x] | Clearance ID extraction verified |
| `hey_list_trash` | [x] | [x] | Uses same extraction logic |
| `hey_list_spam` | [x] | [x] | Uses same extraction logic |
| `hey_list_drafts` | [x] | [x] | Uses same extraction logic |
| `hey_list_labels` | [x] | [x] | Fixed selector to use a[href*='/folders/'] |
| `hey_list_label_emails` | [x] | [x] | Uses same extraction logic |
| `hey_list_collections` | [x] | [x] | HTML selectors verified against live site |
| `hey_list_collection_emails` | [x] | [x] | Uses same extraction logic |
| `hey_read_email` | [x] | [x] | Multiple endpoints verified (postings, topics, entries) |
| `hey_search` | [x] | [x] | Uses same article.posting structure |
| `hey_send_email` | [x] | [x] | Form structure and sender ID verified |
| `hey_reply` | [x] | [x] | POST /topics/{id}/messages endpoint verified |
| `hey_set_aside` | [x] | [x] | Action bar verified in UI |
| `hey_unset_aside` | [x] | [x] | DELETE endpoint pattern verified |
| `hey_reply_later` | [x] | [x] | Action bar verified in UI |
| `hey_remove_reply_later` | [x] | [x] | DELETE endpoint pattern verified |
| `hey_bubble_up` | [x] | [x] | Action bar and slot options verified |
| `hey_mark_unseen` | [x] | [x] | More menu option verified |
| `hey_trash` | [x] | [x] | More menu option verified |
| `hey_restore` | [x] | [x] | Status endpoint pattern verified |
| `hey_spam` | [x] | [x] | Message menu option verified |
| `hey_not_spam` | [x] | [x] | Status endpoint pattern verified |
| `hey_ignore_thread` | [x] | [x] | More menu option verified |
| `hey_unignore_thread` | [x] | [x] | DELETE muting endpoint verified |
| `hey_screen_in` | [x] | [x] | Screener page form structure verified |
| `hey_screen_in_by_id` | [x] | [x] | Clearance endpoint verified |
| `hey_screen_out` | [x] | [x] | Clearance endpoint verified |
| `hey_add_label` | [x] | [x] | More menu Label option verified |
| `hey_remove_label` | [x] | [x] | DELETE filings endpoint verified |
| `hey_add_to_collection` | [x] | [x] | More menu option verified |
| `hey_remove_from_collection` | [x] | [x] | DELETE collecting endpoint verified |
| `hey_cache_status` | [x] | [x] | Internal cache mechanism |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-19 | Initial feature discovery and documentation |
| 2026-01-19 | Updated to reflect actual MCP tool implementation status (38 tools implemented) |
| 2026-01-19 | All 38 tools verified against live Hey.com website |
| 2026-01-19 | Fixed extractLabelsFromHtml to use correct selector (a[href*='/folders/']) |
