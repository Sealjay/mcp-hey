import { parse as parseHtml } from "node-html-parser"
import { invalidateForAction } from "../cache"
import { heyClient } from "../hey-client"

// Debug mode - set via environment variable
const DEBUG = process.env.HEY_MCP_DEBUG === "true"

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    console.error(`[hey-mcp:send] ${message}`, data ?? "")
  }
}

function safeInvalidateCache(
  action: Parameters<typeof invalidateForAction>[0],
): void {
  try {
    invalidateForAction(action)
  } catch (err) {
    debugLog("Cache invalidation failed (non-fatal)", err)
  }
}

interface AccountInfo {
  senderId: string
  senderEmail: string
}

// Cache account info per session (doesn't change)
const accountInfoCache: { value: AccountInfo | null } = { value: null }

/**
 * Validate an email address format.
 */
function isValidEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase()
  if (trimmed.length === 0 || trimmed.length > 254) {
    return false
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/**
 * Validate all recipients and return invalid ones.
 */
function findInvalidEmails(emails: string[]): string[] {
  return emails.filter((email) => !isValidEmail(email))
}

async function getAccountInfo(): Promise<AccountInfo> {
  // Return cached account info if available
  if (accountInfoCache.value) {
    return accountInfoCache.value
  }

  debugLog("Fetching compose page for account info")
  const composeHtml = await heyClient.fetchHtml("/messages/new")
  const root = parseHtml(composeHtml)

  // Primary: Parse select element (current Hey.com structure as of 2025-01)
  // <select name="acting_sender_id"><option value="123" selected>email@example.com</option></select>
  const senderSelect = root.querySelector("select[name='acting_sender_id']")
  if (senderSelect) {
    const selectedOption =
      senderSelect.querySelector("option[selected]") ||
      senderSelect.querySelector("option") // fallback to first option

    if (selectedOption) {
      const senderId = selectedOption.getAttribute("value")
      const senderEmail = selectedOption.text.trim()

      if (senderId && senderEmail && isValidEmail(senderEmail)) {
        debugLog("Extracted account info from select", {
          senderId,
          senderEmail,
        })
        const accountInfo = { senderId, senderEmail }
        accountInfoCache.value = accountInfo
        return accountInfo
      }
    }
  }

  // Fallback 1: Legacy input elements (older Hey.com HTML structure)
  const senderIdInput = root.querySelector("[name='acting_sender_id']")
  const senderEmailInput = root.querySelector("[name='acting_sender_email']")

  const legacySenderId = senderIdInput?.getAttribute("value")
  const legacySenderEmail = senderEmailInput?.getAttribute("value")

  if (legacySenderId && legacySenderEmail) {
    debugLog("Extracted account info from legacy inputs", {
      senderId: legacySenderId,
      senderEmail: legacySenderEmail,
    })
    const accountInfo = {
      senderId: legacySenderId,
      senderEmail: legacySenderEmail,
    }
    accountInfoCache.value = accountInfo
    return accountInfo
  }

  // Fallback 2: Data attributes
  const accountId = root
    .querySelector("[data-account-id]")
    ?.getAttribute("data-account-id")
  const accountEmail = root
    .querySelector("[data-account-email]")
    ?.getAttribute("data-account-email")

  if (accountId && accountEmail) {
    debugLog("Extracted account info from data attributes", {
      accountId,
      accountEmail,
    })
    const accountInfo = { senderId: accountId, senderEmail: accountEmail }
    accountInfoCache.value = accountInfo
    return accountInfo
  }

  // Debug: Log HTML snippet on failure
  debugLog(
    "Failed to extract account info. HTML snippet:",
    composeHtml.substring(0, 2000),
  )

  throw new Error("Could not determine Hey.com account information")
}

export interface SendEmailParams {
  to: string[]
  subject: string
  body: string
  cc?: string[]
}

export interface SendResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  const { to, subject, body, cc } = params

  if (to.length === 0) {
    return { success: false, error: "At least one recipient is required" }
  }

  // Validate recipient email formats
  const invalidTo = findInvalidEmails(to)
  if (invalidTo.length > 0) {
    return {
      success: false,
      error: `Invalid recipient email(s): ${invalidTo.join(", ")}`,
    }
  }

  // Validate CC email formats if present
  if (cc && cc.length > 0) {
    const invalidCc = findInvalidEmails(cc)
    if (invalidCc.length > 0) {
      return {
        success: false,
        error: `Invalid CC email(s): ${invalidCc.join(", ")}`,
      }
    }
  }

  if (!subject.trim()) {
    return { success: false, error: "Subject is required" }
  }

  if (!body.trim()) {
    return { success: false, error: "Body is required" }
  }

  try {
    const accountInfo = await getAccountInfo()
    const csrfToken = await heyClient.getCsrfToken()

    const formData = new URLSearchParams()
    formData.append("acting_sender_id", accountInfo.senderId)
    formData.append("acting_sender_email", accountInfo.senderEmail)

    // Add recipients
    for (const recipient of to) {
      formData.append("entry[addressed][directly][]", recipient.trim())
    }

    // Add CC recipients if present
    if (cc && cc.length > 0) {
      for (const ccRecipient of cc) {
        formData.append("entry[addressed][copied][]", ccRecipient.trim())
      }
    }

    formData.append("message[subject]", subject)
    formData.append("message[content]", body)

    const response = await heyClient.post("/entries", formData, csrfToken)

    if (response.status >= 200 && response.status < 300) {
      // Try to extract message ID from response
      const location = response.headers.get("location")
      const messageId = location?.match(/\/messages\/(\d+)/)?.[1]

      // Invalidate cache after successful send
      safeInvalidateCache("send")

      return { success: true, messageId }
    }
    if (response.status === 302) {
      // Redirect usually means success
      const location = response.headers.get("location")
      const messageId = location?.match(/\/messages\/(\d+)/)?.[1]

      // Invalidate cache after successful send
      safeInvalidateCache("send")

      return { success: true, messageId }
    }
    return {
      success: false,
      error: `Request failed with status ${response.status}`,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

export interface ForwardParams {
  entryId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  body?: string
}

export async function forwardEmail(params: ForwardParams): Promise<SendResult> {
  const { entryId, to, cc, bcc, body: extraBody } = params

  if (to.length === 0) {
    return { success: false, error: "At least one recipient is required" }
  }

  const invalidTo = findInvalidEmails(to)
  if (invalidTo.length > 0) {
    return {
      success: false,
      error: `Invalid recipient email(s): ${invalidTo.join(", ")}`,
    }
  }

  if (cc && cc.length > 0) {
    const invalidCc = findInvalidEmails(cc)
    if (invalidCc.length > 0) {
      return {
        success: false,
        error: `Invalid CC email(s): ${invalidCc.join(", ")}`,
      }
    }
  }

  if (bcc && bcc.length > 0) {
    const invalidBcc = findInvalidEmails(bcc)
    if (invalidBcc.length > 0) {
      return {
        success: false,
        error: `Invalid BCC email(s): ${invalidBcc.join(", ")}`,
      }
    }
  }

  try {
    // Fetch the forward page to get pre-populated subject and body
    // Try multiple endpoints - listings return topicId but forward may need entryId
    const forwardEndpoints = [
      `/entries/${entryId}/forwards/new`,
      `/topics/${entryId}/forwards/new`,
    ]

    let forwardHtml = ""
    let forwardLastError: Error | null = null

    for (const endpoint of forwardEndpoints) {
      try {
        debugLog(`Fetching forward page: ${endpoint}`)
        forwardHtml = await heyClient.fetchHtml(endpoint)
        debugLog(`Success with endpoint: ${endpoint}`)
        break
      } catch (err) {
        forwardLastError = err as Error
        debugLog(`${endpoint} failed:`, (err as Error).message)
      }
    }

    if (!forwardHtml && forwardLastError) {
      throw forwardLastError
    }

    const root = parseHtml(forwardHtml)

    // Extract pre-populated subject
    const subjectInput = root.querySelector("input[name='message[subject]']")
    const subject =
      subjectInput?.getAttribute("value") || `Fwd: (entry ${entryId})`

    // Extract pre-populated forwarded content from the hidden field
    const contentInput =
      root.querySelector("input[name='message[content]']") ||
      root.querySelector("textarea[name='message[content]']")
    const forwardedContent =
      contentInput?.getAttribute("value") || contentInput?.text || ""

    // Combine user body with forwarded content
    const fullBody = extraBody
      ? `${extraBody}<br><br>${forwardedContent}`
      : forwardedContent

    if (!fullBody.trim()) {
      return {
        success: false,
        error: "Could not extract forwarded message content",
      }
    }

    const accountInfo = await getAccountInfo()
    const csrfToken = await heyClient.getCsrfToken()

    const formData = new URLSearchParams()
    formData.append("acting_sender_id", accountInfo.senderId)

    for (const recipient of to) {
      formData.append("entry[addressed][directly][]", recipient.trim())
    }

    if (cc && cc.length > 0) {
      for (const ccRecipient of cc) {
        formData.append("entry[addressed][copied][]", ccRecipient.trim())
      }
    }

    if (bcc && bcc.length > 0) {
      for (const bccRecipient of bcc) {
        formData.append("entry[addressed][blindcopied][]", bccRecipient.trim())
      }
    }

    formData.append("message[subject]", subject)
    formData.append("message[content]", fullBody)

    debugLog("Forwarding email", { entryId, to, subject })
    const response = await heyClient.post("/messages", formData, csrfToken)

    if (response.status >= 200 && response.status < 300) {
      const location = response.headers.get("location")
      const messageId = location?.match(/\/messages\/(\d+)/)?.[1]
      safeInvalidateCache("forward")
      return { success: true, messageId }
    }
    if (response.status === 302) {
      const location = response.headers.get("location")
      const messageId = location?.match(/\/messages\/(\d+)/)?.[1]
      safeInvalidateCache("forward")
      return { success: true, messageId }
    }
    return {
      success: false,
      error: `Request failed with status ${response.status}`,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

export interface ReplyParams {
  threadId: string
  body: string
}

export async function replyToEmail(params: ReplyParams): Promise<SendResult> {
  const { threadId, body } = params

  if (!body.trim()) {
    return { success: false, error: "Reply body is required" }
  }

  try {
    const accountInfo = await getAccountInfo()
    const csrfToken = await heyClient.getCsrfToken()

    const formData = new URLSearchParams()
    formData.append("acting_sender_id", accountInfo.senderId)
    formData.append("acting_sender_email", accountInfo.senderEmail)
    formData.append("message[content]", body)

    // Replies go to the thread's messages endpoint
    const response = await heyClient.post(
      `/topics/${threadId}/messages`,
      formData,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      // Invalidate cache after successful reply
      safeInvalidateCache("reply")

      return { success: true }
    }
    if (response.status === 302) {
      // Invalidate cache after successful reply
      safeInvalidateCache("reply")

      return { success: true }
    }
    return {
      success: false,
      error: `Request failed with status ${response.status}`,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}
