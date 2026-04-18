import { parse as parseHtml } from "node-html-parser"
import { invalidateForAction } from "../cache"
import { heyClient } from "../hey-client"
import { withCsrfRetry } from "./http-helpers"

// Debug mode - set via environment variable
const DEBUG = process.env.HEY_MCP_DEBUG === "true"

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    console.error(`[mcp-hey:send] ${message}`, data ?? "")
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

interface RedirectClassification {
  type: "success" | "auth_failure" | "validation_error"
  messageId?: string
  warning?: string
}

/**
 * Classify a 302 redirect Location header from Hey.com form submissions.
 */
export function classifyRedirect(response: Response): RedirectClassification {
  const location = response.headers.get("location") ?? ""

  if (location.includes("/sign_in")) {
    return { type: "auth_failure" }
  }

  const messageMatch = location.match(/\/messages\/(\d+)/)
  if (messageMatch) {
    return { type: "success", messageId: messageMatch[1] }
  }

  const topicMatch = location.match(/\/topics\/(\d+)/)
  if (topicMatch) {
    return { type: "success", messageId: topicMatch[1] }
  }

  if (location.includes("/imbox") || location.includes("/sent")) {
    return { type: "success" }
  }

  if (location.includes("/messages/new") || location.includes("/entries/new")) {
    return { type: "validation_error" }
  }

  // Unknown redirect - treat as success but log a warning
  debugLog("Unknown redirect location, treating as success", location)
  return {
    type: "success",
    warning: `Unexpected redirect to: ${location}`,
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

    const response = await withCsrfRetry(() =>
      heyClient.postForm("/messages", formData),
    )

    if (response.status >= 200 && response.status < 300) {
      safeInvalidateCache("send")
      return { success: true }
    }
    if (response.status === 302) {
      const classification = classifyRedirect(response)

      if (classification.type === "auth_failure") {
        return { success: false, error: "Session expired, please retry" }
      }
      if (classification.type === "validation_error") {
        return {
          success: false,
          error: "Hey.com rejected the email (redirected back to compose form)",
        }
      }

      safeInvalidateCache("send")
      return { success: true, messageId: classification.messageId }
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
    const response = await withCsrfRetry(() =>
      heyClient.postForm("/messages", formData),
    )

    if (response.status >= 200 && response.status < 300) {
      safeInvalidateCache("forward")
      return { success: true }
    }
    if (response.status === 302) {
      const classification = classifyRedirect(response)

      if (classification.type === "auth_failure") {
        return { success: false, error: "Session expired, please retry" }
      }
      if (classification.type === "validation_error") {
        return {
          success: false,
          error:
            "Hey.com rejected the forward (redirected back to compose form)",
        }
      }

      safeInvalidateCache("forward")
      return { success: true, messageId: classification.messageId }
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

interface ReplyContext {
  entryId: string
  subject: string
  participantEmails: string[]
}

/**
 * Extract reply context from a thread page: entry ID, subject, and participant emails.
 */
async function getReplyContext(threadId: string): Promise<ReplyContext> {
  const html = await heyClient.fetchHtml(`/topics/${threadId}`)
  const root = parseHtml(html)

  // Extract entry ID from reply form action: /entries/{id}/replies
  let entryId: string | undefined

  const replyForm = root.querySelector('form[action*="/replies"]')
  if (replyForm) {
    const action = replyForm.getAttribute("action") ?? ""
    const match = action.match(/\/entries\/(\d+)\/replies/)
    if (match) {
      debugLog("Found reply entry ID from form action", match[1])
      entryId = match[1]
    }
  }

  if (!entryId) {
    const replyLink = root.querySelector('a[href*="/replies/new"]')
    if (replyLink) {
      const href = replyLink.getAttribute("href") ?? ""
      const match = href.match(/\/entries\/(\d+)\/replies\/new/)
      if (match) {
        debugLog("Found reply entry ID from link", match[1])
        entryId = match[1]
      }
    }
  }

  if (!entryId) {
    throw new Error(
      "Could not find reply form on thread page. The thread may not support replies.",
    )
  }

  // Extract subject from page title (format: "Subject - Hey")
  let subject = ""
  const titleEl = root.querySelector("title")
  if (titleEl) {
    subject = titleEl.text.replace(/\s*[-–—]\s*Hey\s*$/, "").trim()
  }

  // Extract participant emails from avatar alt text: "Name <email@example.com>"
  const participantEmails: string[] = []
  for (const avatar of root.querySelectorAll("img.avatar")) {
    const alt = avatar.getAttribute("alt") ?? ""
    const emailMatch = alt.match(/<([^>]+@[^>]+)>/)
    if (emailMatch && !participantEmails.includes(emailMatch[1])) {
      participantEmails.push(emailMatch[1])
    }
  }

  debugLog("Reply context", { entryId, subject, participantEmails })
  return { entryId, subject, participantEmails }
}

export async function replyToEmail(params: ReplyParams): Promise<SendResult> {
  const { threadId, body } = params

  if (!body.trim()) {
    return { success: false, error: "Reply body is required" }
  }

  try {
    // Fetch thread context (entry ID, subject, participants)
    const replyContext = await getReplyContext(threadId)
    const accountInfo = await getAccountInfo()

    // Step 1: Create reply draft via POST to /entries/{entryId}/replies
    const draftFormData = new URLSearchParams()
    draftFormData.append("acting_sender_id", accountInfo.senderId)
    draftFormData.append("message[content]", body)
    draftFormData.append("message[auto_quoting]", "false")

    debugLog("Step 1: Creating reply draft", {
      entryId: replyContext.entryId,
      threadId,
    })
    const createResponse = await heyClient.post(
      `/entries/${replyContext.entryId}/replies`,
      draftFormData,
    )

    debugLog("Draft creation response", {
      status: createResponse.status,
      location: createResponse.headers.get("location"),
    })

    // Extract draft ID from redirect Location header
    // Hey redirects to /topics/{id}?expanded_draft={draftId}
    let draftId: string | undefined
    const location = createResponse.headers.get("location") ?? ""

    const draftMatch = location.match(/expanded_draft=(\d+)/)
    if (draftMatch) {
      draftId = draftMatch[1]
    }

    if (!draftId) {
      const msgMatch = location.match(/\/messages\/(\d+)/)
      if (msgMatch) {
        draftId = msgMatch[1]
      }
    }

    // Last resort: try the response body
    if (!draftId) {
      const responseBody = await createResponse.text()
      const bodyMatch =
        responseBody.match(/expanded_draft=(\d+)/) ||
        responseBody.match(/\/messages\/(\d+)/)
      if (bodyMatch) {
        draftId = bodyMatch[1]
      }
    }

    if (!draftId) {
      return {
        success: false,
        error:
          "Reply draft created but could not extract draft ID to send it. Check Hey drafts.",
      }
    }

    debugLog("Extracted draft ID", { draftId })

    // Step 2: Send the draft via PATCH /messages/{draftId}
    // The draft entry ID IS the message ID. Hey's send form uses:
    //   POST /messages/{id} with _method=patch (Rails method override)
    //   data-remote="true" data-turbo-frame="_top"
    // Recipients and subject are NOT pre-populated in the draft.
    const recipientEmails = replyContext.participantEmails.filter(
      (e) => e.toLowerCase() !== accountInfo.senderEmail.toLowerCase(),
    )

    const sendFormData = new URLSearchParams()
    sendFormData.append("_method", "patch")
    sendFormData.append("acting_sender_id", accountInfo.senderId)
    sendFormData.append("remember_last_sender", "true")

    for (const email of recipientEmails.length > 0
      ? recipientEmails
      : [accountInfo.senderEmail]) {
      sendFormData.append("entry[addressed][directly][]", email)
    }

    const replySubject = replyContext.subject.startsWith("Re:")
      ? replyContext.subject
      : `Re: ${replyContext.subject}`
    sendFormData.append("message[subject]", replySubject)
    sendFormData.append("message[content]", body)
    sendFormData.append("entry[scheduled_delivery]", "false")
    sendFormData.append("entry[scheduled_bubble_up]", "false")
    sendFormData.append("commit", "Send email")

    debugLog("Step 2: Sending draft via PATCH", {
      draftId,
      recipients: recipientEmails,
      subject: replySubject,
    })

    const sendResponse = await withCsrfRetry(() =>
      heyClient.postTurbo(`/messages/${draftId}`, sendFormData),
    )

    debugLog("Send response", {
      status: sendResponse.status,
      location: sendResponse.headers.get("location"),
    })

    if (sendResponse.status >= 200 && sendResponse.status < 300) {
      safeInvalidateCache("reply")
      return { success: true, messageId: draftId }
    }

    if (sendResponse.status === 302) {
      const classification = classifyRedirect(sendResponse)

      if (classification.type === "auth_failure") {
        return { success: false, error: "Session expired, please retry" }
      }

      safeInvalidateCache("reply")
      return { success: true, messageId: draftId }
    }

    return {
      success: false,
      error: `Reply draft ${draftId} created but send failed with status ${sendResponse.status}. Check Hey drafts.`,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}
