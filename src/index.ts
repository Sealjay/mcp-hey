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
  markAsNotSpam,
  markAsSpam,
  markAsUnseen,
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
import { forwardEmail, replyToEmail, sendEmail } from "./tools/send"

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
 */
function validateEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim().toLowerCase()
  // Basic email validation
  if (trimmed.length === 0 || trimmed.length > 254) {
    return null
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
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
    name: "hey_list_imbox",
    description:
      "List emails in the Hey.com Imbox (important emails). Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
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
    },
  },
  {
    name: "hey_imbox_summary",
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
    name: "hey_list_feed",
    description:
      "List emails in The Feed (newsletters, notifications). Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
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
    },
  },
  {
    name: "hey_list_paper_trail",
    description:
      "List emails in Paper Trail (receipts, confirmations). Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
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
    },
  },
  {
    name: "hey_list_set_aside",
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
    name: "hey_list_trash",
    description:
      "List emails in the Trash. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
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
    },
  },
  {
    name: "hey_list_spam",
    description:
      "List emails in the Spam folder. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
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
    },
  },
  {
    name: "hey_list_drafts",
    description:
      "List draft emails. Returns cached results unless force_refresh=true.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of drafts to return (default: 25)",
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
    },
  },
  {
    name: "hey_list_labels",
    description: "List all labels/folders in Hey.com.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "hey_list_label_emails",
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
    description: "List all collections in Hey.com.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "hey_list_collection_emails",
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
    name: "hey_add_label",
    description: "Add a label to an email thread",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: {
          type: "string",
          description: "The topic/thread ID to label",
        },
        label_id: {
          type: "string",
          description:
            "The label ID to apply (use hey_list_labels to see available labels)",
        },
      },
      required: ["topic_id", "label_id"],
    },
  },
  {
    name: "hey_remove_label",
    description: "Remove a label from an email thread",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: {
          type: "string",
          description: "The topic/thread ID to unlabel",
        },
        label_id: {
          type: "string",
          description: "The label ID to remove",
        },
      },
      required: ["topic_id", "label_id"],
    },
  },
  {
    name: "hey_add_to_collection",
    description: "Add an email thread to a collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: {
          type: "string",
          description: "The topic/thread ID to add to the collection",
        },
        collection_id: {
          type: "string",
          description:
            "The collection ID (use hey_list_collections to see available collections)",
        },
      },
      required: ["topic_id", "collection_id"],
    },
  },
  {
    name: "hey_remove_from_collection",
    description: "Remove an email thread from a collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic_id: {
          type: "string",
          description: "The topic/thread ID to remove from the collection",
        },
        collection_id: {
          type: "string",
          description: "The collection ID",
        },
      },
      required: ["topic_id", "collection_id"],
    },
  },
  {
    name: "hey_read_email",
    description:
      "Read the full content of an email by ID. Returns cached content unless force_refresh=true. Response includes `attachments` (metadata only - id, filename, size, mime, is_calendar) and `calendar_invites` (parsed .ics summaries) when present. Use hey_download_attachment or hey_get_calendar_invite to retrieve content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The email ID to read",
        },
        format: {
          type: "string",
          enum: ["html", "text"],
          description: "Format to return (default: html)",
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
    description:
      "Download a single attachment from an email and save it to disk. Decodes the base64-encoded MIME part and writes it to the supplied path (or ~/Downloads/hey-attachments/<email_id>/<filename> by default). Use the attachment_id from hey_read_email's `attachments` array.",
    inputSchema: {
      type: "object" as const,
      properties: {
        email_id: {
          type: "string",
          description: "The email ID containing the attachment",
        },
        attachment_id: {
          type: "string",
          description:
            "The attachment ID from hey_read_email's attachments array (e.g. 'part-1')",
        },
        save_path: {
          type: "string",
          description:
            "Optional absolute path or directory to save into. Defaults to ~/Downloads/hey-attachments/<email_id>/<filename>. Trailing '/' is treated as a directory.",
        },
      },
      required: ["email_id", "attachment_id"],
    },
  },
  {
    name: "hey_get_calendar_invite",
    description:
      "Extract and parse a calendar invite (.ics) from an email. Returns title, start, end, location, attendees, organizer and the raw ICS body. When an email has multiple .ics parts, supply attachment_id; otherwise the first calendar part is used.",
    inputSchema: {
      type: "object" as const,
      properties: {
        email_id: {
          type: "string",
          description: "The email ID containing the calendar invite",
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
    description: "Send a new email",
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
    description:
      "Reply to an email thread. By default the reply goes to the other thread participants. Pass `to` (and optionally `cc`) to override the recipient line, mirroring Hey's web UI when chasing a thread you started.",
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
            "Optional override of the To: line. Use this when chasing a thread where you sent the most recent message, so the chase lands on the original recipient instead of looping back to your own address.",
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
    description: "Forward an email to new recipients",
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
    description: "Move an email to Set Aside for later",
    inputSchema: {
      type: "object" as const,
      properties: {
        entry_id: {
          type: "string",
          description:
            "The entry ID to set aside (use entryId from list operations)",
        },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "hey_reply_later",
    description: "Move an email to Reply Later",
    inputSchema: {
      type: "object" as const,
      properties: {
        entry_id: {
          type: "string",
          description:
            "The entry ID to mark for reply later (use entryId from list operations)",
        },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "hey_unset_aside",
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
    name: "hey_screen_in",
    description: "Approve a sender from the Screener (allow future emails)",
    inputSchema: {
      type: "object" as const,
      properties: {
        sender_email: {
          type: "string",
          description: "The sender email address to approve",
        },
      },
      required: ["sender_email"],
    },
  },
  {
    name: "hey_screen_out",
    description: "Reject a sender from the Screener (block future emails)",
    inputSchema: {
      type: "object" as const,
      properties: {
        sender_email: {
          type: "string",
          description: "The sender email address to reject",
        },
      },
      required: ["sender_email"],
    },
  },
  {
    name: "hey_screen_in_by_id",
    description:
      "Approve a sender from the Screener by clearance ID (alternative to sender email)",
    inputSchema: {
      type: "object" as const,
      properties: {
        clearance_id: {
          type: "string",
          description: "The clearance ID from the screener list",
        },
      },
      required: ["clearance_id"],
    },
  },
  {
    name: "hey_trash",
    description: "Move an email thread to Trash",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The topic/thread ID to trash",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_restore",
    description: "Restore an email thread from Trash",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The topic/thread ID to restore",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_spam",
    description: "Mark an email thread as Spam",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The topic/thread ID to mark as spam",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_not_spam",
    description: "Mark an email thread as Not Spam (restore from spam folder)",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The topic/thread ID to mark as not spam",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_mark_unseen",
    description: "Mark an email thread as unseen/unread",
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
    name: "hey_bubble_up",
    description:
      "Schedule an email to bubble up (reappear) at a specific time slot. Use 'custom' slot with a date for a specific date, or 'surprise_me' for a random time.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description: "The posting ID to schedule",
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
    description:
      "Schedule an email to bubble up ONLY if there's no reply by a specific date. This is a conditional bubble-up - the email will only reappear if the recipient hasn't replied by the deadline.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description: "The posting ID to schedule",
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
    description:
      "Pop (dismiss) a bubbled-up email so it sinks back into the Imbox. The email is not deleted or archived — it just stops being pinned at the top.",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description: "The posting ID to pop/unbubble",
        },
      },
      required: ["posting_id"],
    },
  },
  {
    name: "hey_ignore_thread",
    description: "Ignore/mute a thread (stop receiving notifications)",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description: "The posting ID to ignore",
        },
      },
      required: ["posting_id"],
    },
  },
  {
    name: "hey_unignore_thread",
    description: "Un-ignore/unmute a thread (resume receiving notifications)",
    inputSchema: {
      type: "object" as const,
      properties: {
        posting_id: {
          type: "string",
          description: "The posting ID to un-ignore",
        },
      },
      required: ["posting_id"],
    },
  },

  // Cache management tool
  {
    name: "hey_cache_status",
    description: "Check cache freshness and statistics",
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
    version: "0.1.0",
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
      case "hey_list_imbox": {
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listImbox({ limit, page, forceRefresh })
        break
      }
      case "hey_imbox_summary": {
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await getImboxSummary({ forceRefresh })
        break
      }
      case "hey_list_feed": {
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listFeed({ limit, page, forceRefresh })
        break
      }
      case "hey_list_paper_trail": {
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listPaperTrail({ limit, page, forceRefresh })
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
      case "hey_list_trash": {
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listTrash({ limit, page, forceRefresh })
        break
      }
      case "hey_list_spam": {
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listSpam({ limit, page, forceRefresh })
        break
      }
      case "hey_list_drafts": {
        const limit = clampNumber(args?.limit, 25, 1, 100)
        const page = clampNumber(args?.page, 1, 1, 1000)
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listDrafts({ limit, page, forceRefresh })
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
      case "hey_add_label": {
        const topicId = validateId(args?.topic_id)
        const labelId = validateId(args?.label_id)
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
        result = await addLabel(topicId, labelId)
        break
      }
      case "hey_remove_label": {
        const topicId = validateId(args?.topic_id)
        const labelId = validateId(args?.label_id)
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
        result = await removeLabel(topicId, labelId)
        break
      }
      case "hey_add_to_collection": {
        const topicId = validateId(args?.topic_id)
        const collectionId = validateId(args?.collection_id)
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
        result = await addToCollection(topicId, collectionId)
        break
      }
      case "hey_remove_from_collection": {
        const topicId = validateId(args?.topic_id)
        const collectionId = validateId(args?.collection_id)
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
        result = await removeFromCollection(topicId, collectionId)
        break
      }
      case "hey_read_email": {
        const id = validateId(args?.id)
        const format = (args?.format as "html" | "text") ?? "html"
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await readEmail(id, format, forceRefresh)
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
        const entryId = validateId(args?.entry_id)
        if (!entryId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: entry_id is required and must be valid (use entryId from list operations)",
              },
            ],
            isError: true,
          }
        }
        result = await setAside(entryId)
        break
      }
      case "hey_reply_later": {
        const entryId = validateId(args?.entry_id)
        if (!entryId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: entry_id is required and must be valid (use entryId from list operations)",
              },
            ],
            isError: true,
          }
        }
        result = await replyLater(entryId)
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
      case "hey_screen_in": {
        const senderEmail = validateEmail(args?.sender_email)
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
        result = await screenIn(senderEmail)
        break
      }
      case "hey_screen_out": {
        const senderEmail = validateEmail(args?.sender_email)
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
        result = await screenOut(senderEmail)
        break
      }
      case "hey_screen_in_by_id": {
        const clearanceId = validateId(args?.clearance_id)
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
        result = await screenInById(clearanceId)
        break
      }
      case "hey_trash": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await trashEmail(id)
        break
      }
      case "hey_restore": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await restoreFromTrash(id)
        break
      }
      case "hey_spam": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await markAsSpam(id)
        break
      }
      case "hey_not_spam": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await markAsNotSpam(id)
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
      case "hey_ignore_thread": {
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
        result = await ignoreThread(postingId)
        break
      }
      case "hey_unignore_thread": {
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
        result = await unignoreThread(postingId)
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
