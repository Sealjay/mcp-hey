#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

import {
  closeDatabase,
  getCacheStats,
  getDatabase,
  getMessageCount,
  getUnreadCount,
  runMaintenance,
} from "./cache"
import { sanitiseError } from "./errors"
import { heyClient } from "./hey-client"
import { downloadAttachment, getCalendarInvite } from "./tools/attachments"
import {
  type BubbleUpSlot,
  addLabel,
  addToCollection,
  bubbleUp,
  bubbleUpIfNoReply,
  ignoreThread,
  markAllSeen,
  markAsNotSpam,
  markAsRead,
  markAsSpam,
  markAsUnread,
  markAsUnseen,
  markPostingSeen,
  moveTo,
  popBubble,
  removeFromCollection,
  removeFromReplyLater,
  removeFromSetAside,
  removeLabel,
  replyLater,
  restoreFromTrash,
  screenIn,
  screenInById,
  screenOut,
  screenOutById,
  setAside,
  trashEmail,
  unignoreThread,
} from "./tools/organise"
import {
  getImboxSummary,
  listCollectionEmails,
  listCollections,
  listDrafts,
  listFeed,
  listImbox,
  listLabelEmails,
  listLabels,
  listPaperTrail,
  listReplyLater,
  listScreener,
  listSetAside,
  listSpam,
  listTrash,
  readEmail,
  searchEmails,
} from "./tools/read"
import {
  forwardEmail,
  isValidEmail,
  replyToEmail,
  sendEmail,
} from "./tools/send"

/**
 * Validate and clamp a numeric parameter within bounds.
 */
function clampNumber(
  value: unknown,
  defaultVal: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return defaultVal
  }
  return Math.max(min, Math.min(Math.floor(value), max))
}

/**
 * Validate a string ID parameter.
 * IDs should be alphanumeric with reasonable length.
 */
function validateId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  // IDs should be 1-100 chars, alphanumeric with hyphens/underscores
  if (trimmed.length === 0 || trimmed.length > 100) {
    return null
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return null
  }
  return trimmed
}

/**
 * Validate a search query parameter.
 */
function validateQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  // Queries should be 1-500 chars
  if (trimmed.length === 0 || trimmed.length > 500) {
    return null
  }
  return trimmed
}

/**
 * Validate an email address.
 * Delegates to the shared isValidEmail from tools/send.
 */
function validateEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim().toLowerCase()
  if (!isValidEmail(trimmed)) {
    return null
  }
  return trimmed
}

/**
 * Validate an attachment id, e.g. "part-1". The format is fixed by
 * listAttachmentsForEmail; we accept the same shape here.
 */
function validateAttachmentId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 64) return null
  if (!/^part-\d+$/.test(trimmed)) return null
  return trimmed
}

/**
 * Validate an attachment save path. We accept any non-empty string under
 * 1024 chars and let downloadAttachment resolve `~` expansion. Returning
 * `null` indicates the caller supplied a value that is not a string;
 * `undefined` is reserved for "use the default".
 */
function validateSavePath(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 1024) return null
  return trimmed
}

// Tool definitions
const tools: Tool[] = [
  // Reading tools
  {
    name: "hey_list_emails",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List emails in a Hey.com folder/view. Returns cached results unless force_refresh=true. Each email includes id, topicId, postingId, entryId, from, subject, date, and unread status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        folder: {
          type: "string",
          enum: ["imbox", "feed", "paper_trail", "trash", "spam", "drafts"],
          description:
            "The folder/view to list emails from: imbox (important), feed (newsletters), paper_trail (receipts), trash, spam, or drafts",
        },
        limit: {
          type: "number",
          description: "Maximum number of emails to return (default: 25)",
        },
        page: {
          type: "number",
          description: "Page number for pagination (default: 1)",
        },
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
      required: ["folder"],
    },
  },
  {
    name: "hey_imbox_summary",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "Get a complete Imbox summary including screener count, bubbled up emails, and new emails. Use this for a comprehensive view of the inbox state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
    },
  },
  {
    name: "hey_list_set_aside",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List emails in the Set Aside stack. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
    },
  },
  {
    name: "hey_list_reply_later",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List emails in the Reply Later stack. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
    },
  },
  {
    name: "hey_list_screener",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List emails waiting in the Screener. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
    },
  },
  {
    name: "hey_list_labels",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List all labels/folders in Hey.com. Returns array of {id, name, color?}. Use the id with hey_label or hey_list_label_emails.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "hey_list_label_emails",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List emails with a specific label. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        label_id: {
          type: "string",
          description: "The label/folder ID to list emails from",
        },
        limit: {
          type: "number",
          description: "Maximum number of emails to return (default: 25)",
        },
        page: {
          type: "number",
          description: "Page number for pagination (default: 1)",
        },
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
      required: ["label_id"],
    },
  },
  {
    name: "hey_list_collections",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List all collections in Hey.com. Returns array of {id, name}. Use the id with hey_collection or hey_list_collection_emails.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "hey_list_collection_emails",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "List emails in a specific collection. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        collection_id: {
          type: "string",
          description: "The collection ID to list emails from",
        },
        limit: {
          type: "number",
          description: "Maximum number of emails to return (default: 25)",
        },
        page: {
          type: "number",
          description: "Page number for pagination (default: 1)",
        },
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
      required: ["collection_id"],
    },
  },
  {
    name: "hey_label",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Add or remove a label on an email thread. Returns {success, error?}. Use hey_list_labels to discover available label IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: {
          type: "string",
          description: "The topic/thread ID to label or unlabel",
        },
        label_id: {
          type: "string",
          description:
            "The label ID to add or remove (use hey_list_labels to see available labels)",
        },
        action: {
          type: "string",
          enum: ["add", "remove"],
          description: "Whether to add or remove the label",
        },
      },
      required: ["topic_id", "label_id", "action"],
    },
  },
  {
    name: "hey_collection",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Add or remove an email thread from a collection. Returns {success, error?}. Use hey_list_collections to discover collection IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: {
          type: "string",
          description:
            "The topic/thread ID to add to or remove from the collection",
        },
        collection_id: {
          type: "string",
          description:
            "The collection ID (use hey_list_collections to see available collections)",
        },
        action: {
          type: "string",
          enum: ["add", "remove"],
          description:
            "Whether to add or remove the thread from the collection",
        },
      },
      required: ["topic_id", "collection_id", "action"],
    },
  },
  {
    name: "hey_read_email",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "Read an email thread's full content. Returns all messages in the thread via entries[] array (each with entryId, from, to, cc, date, body). Also returns attachments[] metadata and calendar_invites[] when present — use hey_download_attachment to save files to disk, or hey_get_calendar_invite to parse .ics details. Use format='html' (default) for rich content with thread entries, or format='text' for decoded RFC822 plain text of the first message.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description:
            "The topic/thread ID or entry ID to read (use topicId from list operations for full threads)",
        },
        format: {
          type: "string",
          enum: ["html", "text"],
          description:
            "html (default): rich HTML with all thread entries. text: decoded plain text of the first message only",
        },
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and fetch fresh data (default: false)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_download_attachment",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Download a single attachment from an email and save it to disk. First call hey_read_email to get the attachments[] array with IDs, filenames, and sizes, then call this tool with the attachment_id to save the file. Returns {local_path, filename, size, mime}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        email_id: {
          type: "string",
          description:
            "The email's topic or entry ID (same ID used with hey_read_email — topic IDs are resolved automatically)",
        },
        attachment_id: {
          type: "string",
          description:
            "The attachment ID from hey_read_email's attachments array (e.g. 'part-1')",
        },
        save_path: {
          type: "string",
          description:
            "Optional path or directory to save into. Must be within ~/. Defaults to ~/Downloads/hey-attachments/<date>/<filename>. Trailing '/' is treated as a directory. Duplicate filenames are auto-numbered (invite-1.ics, invite-2.ics).",
        },
      },
      required: ["email_id", "attachment_id"],
    },
  },
  {
    name: "hey_get_calendar_invite",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "Extract and parse a calendar invite (.ics) from an email. First call hey_read_email — if calendar_invites[] is present, call this tool to get full details: title, start, end, location, attendees, organizer, description, and raw_ics. To save the .ics file to disk, use hey_download_attachment instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        email_id: {
          type: "string",
          description:
            "The email's topic or entry ID (same ID used with hey_read_email — topic IDs are resolved automatically)",
        },
        attachment_id: {
          type: "string",
          description:
            "Optional attachment ID when the email has multiple .ics parts",
        },
      },
      required: ["email_id"],
    },
  },
  {
    name: "hey_search",
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      "Search emails by query. Uses local FTS cache first, then network. Use force_refresh for real-time results.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 25)",
        },
        force_refresh: {
          type: "boolean",
          description: "Bypass cache and search via network (default: false)",
        },
      },
      required: ["query"],
    },
  },

  // Sending tools
  {
    name: "hey_send_email",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Send a new email immediately (no draft stage). Returns {success, error?}. Use for standalone outbound messages; use hey_reply for thread responses, or hey_forward to share existing emails with new recipients.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "List of recipient email addresses",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body content (HTML supported)",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "List of CC recipient email addresses",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "hey_reply",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Reply to an email thread. By default the reply goes to the other thread participants (your own address is automatically excluded). Prefer this over hey_send_email any time you're responding to an existing thread — it preserves threading on both ends. Pass `to` to redirect the reply to specific recipients: useful for chasing your own threads (where the default would loop back to you), for redirecting away from a mailing-list address onto a specific person, or for any case where you want the response to land somewhere other than the default participants. Use hey_send_email only for genuinely new conversations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        thread_id: {
          type: "string",
          description: "The thread/topic ID to reply to",
        },
        body: {
          type: "string",
          description: "Reply body content (HTML supported)",
        },
        to: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional override of the To: line. Replaces the auto-detected participants. Use to: (a) chase your own thread without looping back to yourself, (b) redirect a mailing-list reply to a specific person, or (c) generally target the reply at recipients other than the thread defaults.",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional CC override. Only honoured when `to` is also provided.",
        },
      },
      required: ["thread_id", "body"],
    },
  },

  {
    name: "hey_forward",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Forward an existing email to new recipients immediately. The original thread remains unchanged. Returns {success, error?}. Use instead of hey_send_email when sharing existing content; use hey_reply for responding within a thread.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entry_id: {
          type: "string",
          description: "The entry ID of the email to forward",
        },
        to: {
          type: "array",
          items: { type: "string" },
          description: "List of recipient email addresses",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "List of CC recipient email addresses",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "List of BCC recipient email addresses",
        },
        body: {
          type: "string",
          description:
            "Optional message to include above the forwarded content",
        },
      },
      required: ["entry_id", "to"],
    },
  },

  // Organisation tools
  {
    name: "hey_set_aside",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Move an email thread to Set Aside for later. Reversible via hey_unset_aside (requires postingId from hey_list_set_aside). Returns {success, error?}. Use for emails you plan to revisit but want out of the Imbox. Does not affect future emails from the sender.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description:
            "The topic or entry ID to set aside (use topicId or entryId from list operations)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_reply_later",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Move an email thread to Reply Later. Reversible via hey_remove_reply_later (requires postingId from hey_list_reply_later). Returns {success, error?}. Use for emails you intend to respond to but not right now.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description:
            "The topic or entry ID to mark for reply later (use topicId or entryId from list operations)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_unset_aside",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Remove an email from Set Aside (move it back to the Imbox or its original location). Requires the posting_id from hey_list_set_aside.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description:
            "The posting ID to remove from Set Aside (use postingId from hey_list_set_aside)",
        },
      },
      required: ["posting_id"],
    },
  },
  {
    name: "hey_remove_reply_later",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      'Remove an email from Reply Later (mark as "Done", moving it back to the Imbox). Requires the posting_id from hey_list_reply_later.',
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description:
            "The posting ID to remove from Reply Later (use postingId from hey_list_reply_later)",
        },
      },
      required: ["posting_id"],
    },
  },
  {
    name: "hey_screen",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Approve or reject a sender by email address. Approve: routes the sender's current and future emails into the chosen destination (defaults to imbox). Reject (a.k.a. screen out): blocks the sender from sending you further emails — works for both pending screener entries AND already-approved senders (falls back to the contact-page 'Screened Out' affordance via /contacts/{id}/clearance). Reject does NOT flag emails as spam; existing emails are left untouched. Reversible from the Hey UI by visiting the contact page; not yet exposed via MCP. Returns {success, error?}. Use hey_list_screener to see pending senders, or hey_screen_by_id for clearance IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sender_email: {
          type: "string",
          description: "The sender's email address",
        },
        action: {
          type: "string",
          enum: ["approve", "reject"],
          description:
            "approve: allow this sender's emails through (routed to `destination`). reject: block future emails from this sender. Does not flag as spam, does not move existing emails. Reversible via the Hey UI's contact page.",
        },
        destination: {
          type: "string",
          enum: ["imbox", "feed", "paper_trail"],
          description:
            "Where future emails from this sender land when approved: imbox (default, important mail), feed (newsletters/updates), paper_trail (receipts/automated). Ignored when action is reject.",
        },
      },
      required: ["sender_email", "action"],
    },
  },
  {
    name: "hey_screen_by_id",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Approve or reject a first-time sender from the Screener by clearance ID. Approve: allows future emails from this sender into the chosen destination (defaults to imbox). Reject: blocks future emails from this sender via the screener. Reversible from the Hey UI's contact page (not yet via MCP). Returns {success, error?}. Use hey_list_screener to get clearance IDs; for senders that have already left the screener, use hey_screen by email instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        clearance_id: {
          type: "string",
          description: "The clearance ID from hey_list_screener",
        },
        action: {
          type: "string",
          enum: ["approve", "reject"],
          description:
            "approve: allow this sender's emails through (routed to `destination`). reject: block future emails from this sender. Does not flag as spam.",
        },
        destination: {
          type: "string",
          enum: ["imbox", "feed", "paper_trail"],
          description:
            "Where future emails from this sender land when approved: imbox (default, important mail), feed (newsletters/updates), paper_trail (receipts/automated). Ignored when action is reject.",
        },
      },
      required: ["clearance_id", "action"],
    },
  },
  {
    name: "hey_set_status",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Change an email thread's status. Returns {success, error?}. Trash and spam are reversible via restore and unspam actions respectively. DESTRUCTIVE: trash removes from Imbox, spam blocks the sender. Paper Trail bundles (postingId-only items with no thread) support action=trash only; spam/restore/unspam on a bundle return an explicit error pointing to the bundle's individual entries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description:
            "The topic/thread ID (use topicId from list operations). For Paper Trail bundles, pass the postingId — trash works via a posting-based fallback, other actions return an error.",
        },
        action: {
          type: "string",
          enum: ["trash", "restore", "spam", "unspam"],
          description:
            "The status action: trash (move to Trash), restore (recover from Trash), spam (mark as spam and block sender), unspam (restore from spam folder)",
        },
      },
      required: ["id", "action"],
    },
  },
  {
    name: "hey_move_to",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Move an email thread between Hey.com views: imbox, feed, or paper_trail. Returns {success, error?}. Use paper_trail for receipts/automated mail, feed for newsletters, imbox to restore. Reversible by moving to a different destination. Does not affect trash, spam, or screener — use hey_set_status or hey_screen for those.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description:
            "The topic/thread ID to move (use topicId from list operations)",
        },
        destination: {
          type: "string",
          enum: ["imbox", "feed", "paper_trail"],
          description:
            "Target view: imbox (important mail), feed (newsletters/updates), paper_trail (receipts/automated)",
        },
      },
      required: ["id", "destination"],
    },
  },
  {
    name: "hey_mark_unseen",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Mark a thread as unseen/unread to reset its read status. Returns {success, error?}. Reading the email via hey_read_email implicitly marks it as seen again. To clear the orange 'New for you' tray dot without re-marking unseen, use hey_mark_seen.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The topic/thread ID to mark as unseen",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_mark_seen",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Clear the orange 'New for you' tray dot — mirrors Hey's 'Mark all as seen' UI affordance. Returns {success, error?}. Pass a posting_id to clear just that one item (POST /postings/seen); omit posting_id to clear the entire Imbox tray in one call (POST /boxes/{imboxId}/observation). Reversible per-item via hey_mark_unseen. Use after triaging or skimming a batch to keep the tray tidy without re-marking threads unread.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description:
            "Optional. The posting ID (from postingId field on list operations) to clear from the New for you tray. When omitted, the entire Imbox tray is marked seen in a single bulk request.",
        },
      },
    },
  },
  {
    name: "hey_read_status",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Set the read/unread status of an email entry. Returns {success, error?}. Reversible by calling again with the opposite status. Operates on individual entries (use entryId), not whole threads. For marking an entire thread as unseen, use hey_mark_unseen instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description:
            "The entry ID to update (use entryId from list operations)",
        },
        status: {
          type: "string",
          enum: ["read", "unread"],
          description: "Target status: read or unread",
        },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "hey_bubble_up",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Schedule an email to bubble up (reappear) at a specific time. Returns {success, error?}. Reversible via hey_pop_bubble. The 'now' slot requires a topicId; other slots accept topicId or postingId.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description:
            "The topic or posting ID to schedule (use topicId for 'now' slot)",
        },
        slot: {
          type: "string",
          enum: [
            "now",
            "today",
            "tomorrow",
            "weekend",
            "next_week",
            "surprise_me",
            "custom",
          ],
          description:
            "When to bubble up: now (immediately), today (evening), tomorrow (morning), weekend (Saturday), next_week (Monday), surprise_me (random), custom (specific date - requires 'date' parameter)",
        },
        date: {
          type: "string",
          description:
            "Date in YYYY-MM-DD format. Required when slot is 'custom', ignored otherwise.",
        },
      },
      required: ["posting_id", "slot"],
    },
  },
  {
    name: "hey_bubble_up_if_no_reply",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Schedule an email to bubble up ONLY if there's no reply by a deadline date. Returns {success, error?}. The email will only reappear if the recipient hasn't replied. Reversible via hey_pop_bubble.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description:
            "The topic or posting ID to schedule (use topicId preferred)",
        },
        date: {
          type: "string",
          description:
            "Deadline date in YYYY-MM-DD format. The email will bubble up only if no reply is received by this date.",
        },
      },
      required: ["posting_id", "date"],
    },
  },
  {
    name: "hey_pop_bubble",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Pop (dismiss) a bubbled-up email so it sinks back into the Imbox. The email is not deleted — it just stops being pinned at the top. Returns {success, error?}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description:
            "The topic or posting ID to pop/unbubble (use topicId preferred)",
        },
      },
      required: ["posting_id"],
    },
  },
  {
    name: "hey_thread_mute",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Mute or unmute a thread (called 'Ignore' in Hey.com's UI). Muting stops notifications for the thread but keeps it in its current view — the thread is not moved or deleted. Returns {success, error?}. Reversible by calling with the opposite action. To check if a thread is currently muted, use hey_read_email — the response includes a 'muted' field.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description:
            "The posting ID of the thread (use postingId from list operations)",
        },
        action: {
          type: "string",
          enum: ["mute", "unmute"],
          description: "mute to stop notifications, unmute to resume them",
        },
      },
      required: ["posting_id", "action"],
    },
  },

  // Cache management tool
  {
    name: "hey_cache_status",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description:
      "Get cache statistics including message counts, cache age, and storage estimate. Read-only with no side effects. Optionally query a specific folder for message/unread counts. Use before force_refresh decisions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        folder: {
          type: "string",
          enum: ["imbox", "feed", "paper_trail", "set_aside", "reply_later"],
          description: "Optional folder to get specific stats for",
        },
      },
    },
  },
]

// Create MCP server
const server = new Server(
  {
    name: "mcp-hey",
    version: "0.3.1",
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools }
})

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    let result: unknown

    switch (name) {
      // Reading tools
      case "hey_list_emails": {
        const folder = args?.folder as string
        const validFolders = [
          "imbox",
          "feed",
          "paper_trail",
          "trash",
          "spam",
          "drafts",
        ]
        if (!folder || !validFolders.includes(folder)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: folder is required and must be one of: imbox, feed, paper_trail, trash, spam, drafts",
              },
            ],
            isError: true,
          }
        }
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        const options = { limit, page, forceRefresh }
        const folderFns: Record<
          string,
          (opts: {
            limit: number
            page: number
            forceRefresh: boolean
          }) => Promise<unknown>
        > = {
          imbox: listImbox,
          feed: listFeed,
          paper_trail: listPaperTrail,
          trash: listTrash,
          spam: listSpam,
          drafts: listDrafts,
        }
        result = await folderFns[folder](options)
        break
      }
      case "hey_imbox_summary": {
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await getImboxSummary({ forceRefresh })
        break
      }
      case "hey_list_set_aside": {
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listSetAside({ forceRefresh })
        break
      }
      case "hey_list_reply_later": {
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listReplyLater({ forceRefresh })
        break
      }
      case "hey_list_screener": {
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listScreener({ forceRefresh })
        break
      }
      case "hey_list_labels": {
        result = await listLabels()
        break
      }
      case "hey_list_label_emails": {
        const labelId = validateId(args?.label_id)
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        if (!labelId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: label_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        result = await listLabelEmails(labelId, { limit, page, forceRefresh })
        break
      }
      case "hey_list_collections": {
        result = await listCollections()
        break
      }
      case "hey_list_collection_emails": {
        const collectionId = validateId(args?.collection_id)
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        if (!collectionId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: collection_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        result = await listCollectionEmails(collectionId, {
          limit,
          page,
          forceRefresh,
        })
        break
      }
      case "hey_label": {
        const topicId = validateId(args?.topic_id)
        const labelId = validateId(args?.label_id)
        const action = args?.action as string
        if (!topicId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: topic_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!labelId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: label_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!action || !["add", "remove"].includes(action)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: action is required (add or remove)",
              },
            ],
            isError: true,
          }
        }
        result =
          action === "add"
            ? await addLabel(topicId, labelId)
            : await removeLabel(topicId, labelId)
        break
      }
      case "hey_collection": {
        const topicId = validateId(args?.topic_id)
        const collectionId = validateId(args?.collection_id)
        const action = args?.action as string
        if (!topicId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: topic_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!collectionId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: collection_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!action || !["add", "remove"].includes(action)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: action is required (add or remove)",
              },
            ],
            isError: true,
          }
        }
        result =
          action === "add"
            ? await addToCollection(topicId, collectionId)
            : await removeFromCollection(topicId, collectionId)
        break
      }
      case "hey_read_email": {
        const id = validateId(args?.id)
        const format = (args?.format as "html" | "text") ?? "html"
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        const maxEntries = args?.max_entries
          ? Math.max(1, Math.min(100, Number(args.max_entries)))
          : undefined
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await readEmail(id, { format, forceRefresh, maxEntries })
        break
      }
      case "hey_download_attachment": {
        const emailId = validateId(args?.email_id)
        const attachmentId = validateAttachmentId(args?.attachment_id)
        const savePath = validateSavePath(args?.save_path)
        if (!emailId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: email_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!attachmentId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: attachment_id is required (e.g. 'part-1' from hey_read_email)",
              },
            ],
            isError: true,
          }
        }
        if (savePath === null) {
          return {
            content: [
              {
                type: "text",
                text: "Error: save_path must be a non-empty string under 1024 chars",
              },
            ],
            isError: true,
          }
        }
        result = await downloadAttachment({
          emailId,
          attachmentId,
          savePath,
        })
        break
      }
      case "hey_get_calendar_invite": {
        const emailId = validateId(args?.email_id)
        const attachmentIdRaw = args?.attachment_id
        const attachmentId =
          attachmentIdRaw === undefined
            ? undefined
            : validateAttachmentId(attachmentIdRaw)
        if (!emailId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: email_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (attachmentIdRaw !== undefined && !attachmentId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: attachment_id must be a valid id (e.g. 'part-1')",
              },
            ],
            isError: true,
          }
        }
        result = await getCalendarInvite({
          emailId,
          attachmentId: attachmentId ?? undefined,
        })
        break
      }
      case "hey_search": {
        const query = validateQuery(args?.query)
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        if (!query) {
          return {
            content: [
              {
                type: "text",
                text: "Error: query is required (1-500 characters)",
              },
            ],
            isError: true,
          }
        }
        result = await searchEmails(query, { limit, forceRefresh })
        break
      }

      // Sending tools
      case "hey_send_email": {
        const to = args?.to as string[]
        const subject = args?.subject as string
        const body = args?.body as string
        const cc = args?.cc as string[] | undefined

        if (!to || !subject || !body) {
          return {
            content: [
              {
                type: "text",
                text: "Error: to, subject, and body are required",
              },
            ],
            isError: true,
          }
        }
        result = await sendEmail({ to, subject, body, cc })
        break
      }
      case "hey_reply": {
        const threadId = validateId(args?.thread_id)
        const body = args?.body as string
        const to = args?.to as unknown
        const cc = args?.cc as unknown

        if (!threadId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: thread_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!body || typeof body !== "string" || body.trim().length === 0) {
          return {
            content: [{ type: "text", text: "Error: body is required" }],
            isError: true,
          }
        }

        if (to !== undefined) {
          if (!Array.isArray(to) || !to.every((e) => typeof e === "string")) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: to must be an array of email address strings",
                },
              ],
              isError: true,
            }
          }
        }

        if (cc !== undefined) {
          if (!Array.isArray(cc) || !cc.every((e) => typeof e === "string")) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: cc must be an array of email address strings",
                },
              ],
              isError: true,
            }
          }
        }

        result = await replyToEmail({
          threadId,
          body: body.trim(),
          to: to as string[] | undefined,
          cc: cc as string[] | undefined,
        })
        break
      }

      case "hey_forward": {
        const entryId = validateId(args?.entry_id)
        const to = args?.to as string[]
        const cc = args?.cc as string[] | undefined
        const bcc = args?.bcc as string[] | undefined
        const body = args?.body as string | undefined

        if (!entryId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: entry_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!to || !Array.isArray(to) || to.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Error: to is required and must be a non-empty array of email addresses",
              },
            ],
            isError: true,
          }
        }
        result = await forwardEmail({
          entryId,
          to,
          cc,
          bcc,
          body: body?.trim(),
        })
        break
      }

      // Organisation tools
      case "hey_set_aside": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              {
                type: "text",
                text: "Error: id is required and must be valid (use topicId from list operations)",
              },
            ],
            isError: true,
          }
        }
        result = await setAside(id)
        break
      }
      case "hey_reply_later": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              {
                type: "text",
                text: "Error: id is required and must be valid (use topicId from list operations)",
              },
            ],
            isError: true,
          }
        }
        result = await replyLater(id)
        break
      }
      case "hey_unset_aside": {
        const postingId = validateId(args?.posting_id)
        if (!postingId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: posting_id is required and must be valid (use postingId from hey_list_set_aside)",
              },
            ],
            isError: true,
          }
        }
        result = await removeFromSetAside(postingId)
        break
      }
      case "hey_remove_reply_later": {
        const postingId = validateId(args?.posting_id)
        if (!postingId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: posting_id is required and must be valid (use postingId from hey_list_reply_later)",
              },
            ],
            isError: true,
          }
        }
        result = await removeFromReplyLater(postingId)
        break
      }
      case "hey_screen": {
        const senderEmail = validateEmail(args?.sender_email)
        const action = args?.action as string
        const destination = args?.destination as
          | "imbox"
          | "feed"
          | "paper_trail"
          | undefined
        if (!senderEmail) {
          return {
            content: [
              {
                type: "text",
                text: "Error: sender_email is required and must be a valid email",
              },
            ],
            isError: true,
          }
        }
        if (!action || !["approve", "reject"].includes(action)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: action is required (approve or reject)",
              },
            ],
            isError: true,
          }
        }
        if (
          destination &&
          !["imbox", "feed", "paper_trail"].includes(destination)
        ) {
          return {
            content: [
              {
                type: "text",
                text: "Error: destination must be one of imbox, feed, paper_trail",
              },
            ],
            isError: true,
          }
        }
        result =
          action === "approve"
            ? await screenIn(senderEmail, destination)
            : await screenOut(senderEmail)
        break
      }
      case "hey_screen_by_id": {
        const clearanceId = validateId(args?.clearance_id)
        const action = args?.action as string
        const destination = args?.destination as
          | "imbox"
          | "feed"
          | "paper_trail"
          | undefined
        if (!clearanceId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clearance_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!action || !["approve", "reject"].includes(action)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: action is required (approve or reject)",
              },
            ],
            isError: true,
          }
        }
        if (
          destination &&
          !["imbox", "feed", "paper_trail"].includes(destination)
        ) {
          return {
            content: [
              {
                type: "text",
                text: "Error: destination must be one of imbox, feed, paper_trail",
              },
            ],
            isError: true,
          }
        }
        result =
          action === "approve"
            ? await screenInById(clearanceId, destination)
            : await screenOutById(clearanceId)
        break
      }
      case "hey_set_status": {
        const id = validateId(args?.id)
        const action = args?.action as string
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        if (
          !action ||
          !["trash", "restore", "spam", "unspam"].includes(action)
        ) {
          return {
            content: [
              {
                type: "text",
                text: "Error: action is required (trash, restore, spam, or unspam)",
              },
            ],
            isError: true,
          }
        }
        const statusFns: Record<string, (id: string) => Promise<unknown>> = {
          trash: trashEmail,
          restore: restoreFromTrash,
          spam: markAsSpam,
          unspam: markAsNotSpam,
        }
        result = await statusFns[action](id)
        break
      }
      case "hey_move_to": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        const destination = args?.destination as
          | "imbox"
          | "feed"
          | "paper_trail"
        if (
          !destination ||
          !["imbox", "feed", "paper_trail"].includes(destination)
        ) {
          return {
            content: [
              {
                type: "text",
                text: "Error: destination is required (imbox, feed, or paper_trail)",
              },
            ],
            isError: true,
          }
        }
        result = await moveTo(id, destination)
        break
      }
      case "hey_mark_unseen": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await markAsUnseen(id)
        break
      }
      case "hey_mark_seen": {
        const postingId =
          args?.posting_id === undefined
            ? undefined
            : validateId(args?.posting_id)
        if (args?.posting_id !== undefined && !postingId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: posting_id must be a valid ID string (omit it to mark the whole Imbox tray seen)",
              },
            ],
            isError: true,
          }
        }
        result = postingId
          ? await markPostingSeen(postingId)
          : await markAllSeen()
        break
      }
      case "hey_read_status": {
        const id = validateId(args?.id)
        const status = args?.status as "read" | "unread"
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        if (!status || !["read", "unread"].includes(status)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: status is required (read or unread)",
              },
            ],
            isError: true,
          }
        }
        result =
          status === "read" ? await markAsRead(id) : await markAsUnread(id)
        break
      }
      case "hey_bubble_up": {
        const postingId = validateId(args?.posting_id)
        const slot = args?.slot as BubbleUpSlot
        const date = args?.date as string | undefined
        if (!postingId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: posting_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        const validSlots = [
          "now",
          "today",
          "tomorrow",
          "weekend",
          "next_week",
          "surprise_me",
          "custom",
        ]
        if (!slot || !validSlots.includes(slot)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: slot is required and must be one of: now, today, tomorrow, weekend, next_week, surprise_me, custom",
              },
            ],
            isError: true,
          }
        }
        result = await bubbleUp(postingId, slot, date)
        break
      }
      case "hey_bubble_up_if_no_reply": {
        const postingId = validateId(args?.posting_id)
        const date = args?.date as string | undefined
        if (!postingId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: posting_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!date) {
          return {
            content: [
              {
                type: "text",
                text: "Error: date is required (YYYY-MM-DD format)",
              },
            ],
            isError: true,
          }
        }
        result = await bubbleUpIfNoReply(postingId, date)
        break
      }
      case "hey_pop_bubble": {
        const postingId = validateId(args?.posting_id)
        if (!postingId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: posting_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        result = await popBubble(postingId)
        break
      }
      case "hey_thread_mute": {
        const postingId = validateId(args?.posting_id)
        const action = args?.action as string
        if (!postingId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: posting_id is required and must be valid",
              },
            ],
            isError: true,
          }
        }
        if (!action || !["mute", "unmute"].includes(action)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: action is required (mute or unmute)",
              },
            ],
            isError: true,
          }
        }
        result =
          action === "mute"
            ? await ignoreThread(postingId)
            : await unignoreThread(postingId)
        break
      }

      // Cache management
      case "hey_cache_status": {
        const folder = args?.folder as string | undefined
        const stats = getCacheStats()
        const unreadCount = getUnreadCount(folder)
        const messageCount = getMessageCount(folder)

        result = {
          ...stats,
          folder_stats: folder
            ? {
                folder,
                message_count: messageCount,
                unread_count: unreadCount,
              }
            : undefined,
          global_unread: getUnreadCount(),
        }
        break
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${sanitiseError(error)}`,
        },
      ],
      isError: true,
    }
  }
})

async function main() {
  console.error("[mcp-hey] Starting Hey.com MCP server...")

  // Initialize cache database
  try {
    getDatabase()
    console.error("[mcp-hey] Cache database initialized")
  } catch (error) {
    console.error(
      "[mcp-hey] Warning: Could not initialize cache:",
      sanitiseError(error),
    )
  }

  // Validate session on startup
  try {
    await heyClient.ensureSession()
    console.error("[mcp-hey] Session validated successfully")
  } catch (error) {
    console.error(
      "[mcp-hey] Warning: Could not validate session:",
      sanitiseError(error),
    )
    console.error("[mcp-hey] Authentication may be required on first tool use")
  }

  // Set up periodic maintenance
  const maintenanceInterval = setInterval(
    () => {
      try {
        runMaintenance()
      } catch (error) {
        console.error("[mcp-hey] Maintenance error:", sanitiseError(error))
      }
    },
    5 * 60 * 1000,
  ) // Every 5 minutes

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.error("[mcp-hey] Shutting down...")
    clearInterval(maintenanceInterval)
    closeDatabase()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    console.error("[mcp-hey] Shutting down...")
    clearInterval(maintenanceInterval)
    closeDatabase()
    process.exit(0)
  })

  // Start stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error("[mcp-hey] Server running on stdio transport")
}

main().catch((error) => {
  console.error("[mcp-hey] Fatal error:", sanitiseError(error))
  process.exit(1)
})
