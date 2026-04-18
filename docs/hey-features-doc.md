# Hey.com Feature Matrix

A mapping of Hey.com UI features to their MCP tool (if any). Useful when deciding what to implement next or tracing a UI action to its tool.

Tool definitions and parameters live in [`TOOLS.md`](TOOLS.md). Endpoint details and the authoritative changelog live in [`API.md`](API.md). Where the tables below and `API.md` disagree, trust `API.md`.

## Main Views

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| List Imbox | Imbox | `hey_list_imbox` | Implemented |
| Imbox Summary | (derived) | `hey_imbox_summary` | Implemented |
| List Feed | The Feed | `hey_list_feed` | Implemented |
| List Paper Trail | Paper Trail | `hey_list_paper_trail` | Implemented |
| List Set Aside | Set Aside | `hey_list_set_aside` | Implemented |
| List Reply Later | Reply Later | `hey_list_reply_later` | Implemented |
| List Screener | Screener | `hey_list_screener` | Implemented |
| List Trash | Trash | `hey_list_trash` | Implemented |
| List Spam | Spam | `hey_list_spam` | Implemented |
| List Drafts | Drafts | `hey_list_drafts` | Implemented |
| List Sent | Sent | — | Not implemented |
| List Previously Seen | Previously Seen | — | Not implemented |
| List Screened Out | Screened Out | — | Not implemented |
| List All Files | All Files | — | Not implemented |
| List Everything | Everything | — | Not implemented |

## Email Reading

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| Read Email | Click email | `hey_read_email` | Implemented |
| Read Thread | Click email | `hey_read_email` | Implemented |
| View Original (text) | Message menu > View original | `hey_read_email` (format=text) | Implemented |
| Download Original (.eml) | Message menu > Download original | — | Not implemented |

## Email Composition

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| Send New Email | + Write | `hey_send_email` | Implemented |
| Reply to Thread | Reply Now | `hey_reply` | Implemented |
| Forward Email | More > Forward | `hey_forward` | Implemented |
| Save Draft | Save draft | — | Not implemented |
| Delete Draft | Compose trash | — | Not implemented |
| Schedule Send | Send > Later | — | Not implemented |
| Send with Bubble Up | Send > Now and Bubble Up | — | Not implemented |

## Triage

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| Set Aside | Action bar | `hey_set_aside` | Implemented |
| Remove from Set Aside | Action bar | `hey_unset_aside` | Implemented |
| Reply Later | Action bar | `hey_reply_later` | Implemented |
| Remove from Reply Later ("Done") | Action bar | `hey_remove_reply_later` | Implemented |
| Mark as Unseen | More > Mark Unseen | `hey_mark_unseen` | Implemented |
| Trash | More > Trash | `hey_trash` | Implemented |
| Restore from Trash | (in Trash view) | `hey_restore` | Implemented |
| Mark as Spam | Message menu > Report spam | `hey_spam` | Implemented |
| Mark as Not Spam | (in Spam view) | `hey_not_spam` | Implemented |
| Ignore Thread | More > Ignore this thread | `hey_ignore_thread` | Implemented |
| Unignore Thread | More > Stop ignoring | `hey_unignore_thread` | Implemented |
| Move to View | More > Move… | — | Not implemented |

## Bubble Up

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| Bubble Up (scheduled) | Action bar | `hey_bubble_up` | Implemented |
| Bubble Up If No Reply | Action bar (conditional) | `hey_bubble_up_if_no_reply` | Implemented |
| Pop Bubble (dismiss) | Bubbled-up email | `hey_pop_bubble` | Implemented |

## Screener

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| Screen In (by email) | Screener | `hey_screen_in` | Implemented |
| Screen In (by clearance ID) | Screener | `hey_screen_in_by_id` | Implemented |
| Screen Out | Screener | `hey_screen_out` | Implemented |
| Clear All Screener | Clear all… | — | Not implemented |

## Labels & Collections

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| List Labels | Labels | `hey_list_labels` | Implemented |
| View Label Emails | Click label | `hey_list_label_emails` | Implemented |
| Add Label to Thread | More > Label… | `hey_add_label` | Implemented |
| Remove Label from Thread | (in label view) | `hey_remove_label` | Implemented |
| Create / Delete Label | Labels page | — | Not implemented |
| List Collections | Collections | `hey_list_collections` | Implemented |
| View Collection Emails | Click collection | `hey_list_collection_emails` | Implemented |
| Add to Collection | More > Add thread to Collection | `hey_add_to_collection` | Implemented |
| Remove from Collection | (in collection view) | `hey_remove_from_collection` | Implemented |
| Create / Delete Collection | Collections page | — | Not implemented |

## Search

| Feature | UI Location | MCP Tool | Status |
|---------|-------------|----------|--------|
| Quick Search | Search bar | `hey_search` | Implemented |
| Advanced Search | Search page | — | Not implemented (quick search covers most cases) |

## Not planned

These surfaces exist in the UI but are out of scope for this server:

- HEY World, Clips, Snippets
- Push notifications, event creation
- Workflows, Contacts
- Print / Share thread (browser concerns)
