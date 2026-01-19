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
import { heyClient } from "./hey-client"
import {
  type BubbleUpSlot,
  bubbleUp,
  ignoreThread,
  markAsNotSpam,
  markAsSpam,
  markAsUnseen,
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
import { replyToEmail, sendEmail } from "./tools/send"

function sanitiseError(error: unknown): string {
  if (error instanceof Error) {
    // Remove any file paths, URLs, emails, or sensitive info
    return error.message
      .replace(/\/[^\s]+/g, "[path]")
      .replace(/Bearer [^\s]+/g, "[token]")
      .replace(/https?:\/\/[^\s]+/g, "[url]")
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]")
  }
  return "An unknown error occurred"
}

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
    name: "hey_read_email",
    description:
      "Read the full content of an email by ID. Returns cached content unless force_refresh=true.",
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
    description: "Reply to an email thread",
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
      },
      required: ["thread_id", "body"],
    },
  },

  // Organisation tools
  {
    name: "hey_set_aside",
    description: "Move an email to Set Aside for later",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The email ID to set aside",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "hey_reply_later",
    description: "Move an email to Reply Later",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The email ID to mark for reply later",
        },
      },
      required: ["id"],
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
      "Schedule an email to bubble up (reappear) at a specific time slot",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The topic/thread ID to schedule",
        },
        slot: {
          type: "string",
          enum: ["morning", "afternoon", "evening", "weekend"],
          description: "When to bubble up the email",
        },
      },
      required: ["id", "slot"],
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
    name: "hey-mcp",
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
        result = await replyToEmail({ threadId, body: body.trim() })
        break
      }

      // Organisation tools
      case "hey_set_aside": {
        const id = validateId(args?.id)
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
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
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        result = await replyLater(id)
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
        const id = validateId(args?.id)
        const slot = args?.slot as BubbleUpSlot
        if (!id) {
          return {
            content: [
              { type: "text", text: "Error: id is required and must be valid" },
            ],
            isError: true,
          }
        }
        if (
          !slot ||
          !["morning", "afternoon", "evening", "weekend"].includes(slot)
        ) {
          return {
            content: [
              {
                type: "text",
                text: "Error: slot is required and must be one of: morning, afternoon, evening, weekend",
              },
            ],
            isError: true,
          }
        }
        result = await bubbleUp(id, slot)
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
  console.error("[hey-mcp] Starting Hey.com MCP server...")

  // Initialize cache database
  try {
    getDatabase()
    console.error("[hey-mcp] Cache database initialized")
  } catch (error) {
    console.error(
      "[hey-mcp] Warning: Could not initialize cache:",
      sanitiseError(error),
    )
  }

  // Validate session on startup
  try {
    await heyClient.ensureSession()
    console.error("[hey-mcp] Session validated successfully")
  } catch (error) {
    console.error(
      "[hey-mcp] Warning: Could not validate session:",
      sanitiseError(error),
    )
    console.error("[hey-mcp] Authentication may be required on first tool use")
  }

  // Set up periodic maintenance
  const maintenanceInterval = setInterval(
    () => {
      try {
        runMaintenance()
      } catch (error) {
        console.error("[hey-mcp] Maintenance error:", sanitiseError(error))
      }
    },
    5 * 60 * 1000,
  ) // Every 5 minutes

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.error("[hey-mcp] Shutting down...")
    clearInterval(maintenanceInterval)
    closeDatabase()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    console.error("[hey-mcp] Shutting down...")
    clearInterval(maintenanceInterval)
    closeDatabase()
    process.exit(0)
  })

  // Start stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error("[hey-mcp] Server running on stdio transport")
}

main().catch((error) => {
  console.error("[hey-mcp] Fatal error:", sanitiseError(error))
  process.exit(1)
})
