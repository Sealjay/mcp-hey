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
import { replyLater, screenIn, screenOut, setAside } from "./tools/organise"
import {
  listFeed,
  listImbox,
  listPaperTrail,
  listReplyLater,
  listScreener,
  listSetAside,
  readEmail,
  searchEmails,
} from "./tools/read"
import { replyToEmail, sendEmail } from "./tools/send"

function sanitiseError(error: unknown): string {
  if (error instanceof Error) {
    // Remove any file paths or sensitive info
    return error.message
      .replace(/\/[^\s]+/g, "[path]")
      .replace(/Bearer [^\s]+/g, "[token]")
  }
  return "An unknown error occurred"
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
        const limit = (args?.limit as number) ?? 25
        const page = (args?.page as number) ?? 1
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listImbox({ limit, page, forceRefresh })
        break
      }
      case "hey_list_feed": {
        const limit = (args?.limit as number) ?? 25
        const page = (args?.page as number) ?? 1
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        result = await listFeed({ limit, page, forceRefresh })
        break
      }
      case "hey_list_paper_trail": {
        const limit = (args?.limit as number) ?? 25
        const page = (args?.page as number) ?? 1
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
      case "hey_read_email": {
        const id = args?.id as string
        const format = (args?.format as "html" | "text") ?? "html"
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        if (!id) {
          return {
            content: [{ type: "text", text: "Error: id is required" }],
            isError: true,
          }
        }
        result = await readEmail(id, format, forceRefresh)
        break
      }
      case "hey_search": {
        const query = args?.query as string
        const limit = (args?.limit as number) ?? 25
        const forceRefresh = (args?.force_refresh as boolean) ?? false
        if (!query) {
          return {
            content: [{ type: "text", text: "Error: query is required" }],
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
        const threadId = args?.thread_id as string
        const body = args?.body as string

        if (!threadId || !body) {
          return {
            content: [
              { type: "text", text: "Error: thread_id and body are required" },
            ],
            isError: true,
          }
        }
        result = await replyToEmail({ threadId, body })
        break
      }

      // Organisation tools
      case "hey_set_aside": {
        const id = args?.id as string
        if (!id) {
          return {
            content: [{ type: "text", text: "Error: id is required" }],
            isError: true,
          }
        }
        result = await setAside(id)
        break
      }
      case "hey_reply_later": {
        const id = args?.id as string
        if (!id) {
          return {
            content: [{ type: "text", text: "Error: id is required" }],
            isError: true,
          }
        }
        result = await replyLater(id)
        break
      }
      case "hey_screen_in": {
        const senderEmail = args?.sender_email as string
        if (!senderEmail) {
          return {
            content: [
              { type: "text", text: "Error: sender_email is required" },
            ],
            isError: true,
          }
        }
        result = await screenIn(senderEmail)
        break
      }
      case "hey_screen_out": {
        const senderEmail = args?.sender_email as string
        if (!senderEmail) {
          return {
            content: [
              { type: "text", text: "Error: sender_email is required" },
            ],
            isError: true,
          }
        }
        result = await screenOut(senderEmail)
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
