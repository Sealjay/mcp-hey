import { parse as parseHtml } from "node-html-parser"
import { heyClient } from "../hey-client"

interface AccountInfo {
  senderId: string
  senderEmail: string
}

async function getAccountInfo(): Promise<AccountInfo> {
  const html = await heyClient.fetchHtml("/my/imbox")
  const root = parseHtml(html)

  // Look for account info in the page - typically in a data attribute or form
  const senderInput = root.querySelector(
    "[name='acting_sender_id'], [data-sender-id]",
  )
  const emailInput = root.querySelector(
    "[name='acting_sender_email'], [data-sender-email]",
  )

  // Try to find in compose form or settings link
  const composeLink = root.querySelector("a[href*='/compose'], [data-compose]")
  if (composeLink) {
    // Fetch compose page for more accurate info
    const composeHtml = await heyClient.fetchHtml("/compose")
    const composeRoot = parseHtml(composeHtml)

    const composeSenderId = composeRoot
      .querySelector("[name='acting_sender_id']")
      ?.getAttribute("value")
    const composeSenderEmail = composeRoot
      .querySelector("[name='acting_sender_email']")
      ?.getAttribute("value")

    if (composeSenderId && composeSenderEmail) {
      return { senderId: composeSenderId, senderEmail: composeSenderEmail }
    }
  }

  // Fallback to page-level data attributes
  const senderId =
    senderInput?.getAttribute("value") ||
    senderInput?.getAttribute("data-sender-id") ||
    root.querySelector("[data-account-id]")?.getAttribute("data-account-id")

  const senderEmail =
    emailInput?.getAttribute("value") ||
    emailInput?.getAttribute("data-sender-email") ||
    root
      .querySelector("[data-account-email]")
      ?.getAttribute("data-account-email")

  if (!senderId || !senderEmail) {
    throw new Error("Could not determine Hey.com account information")
  }

  return { senderId, senderEmail }
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

      return { success: true, messageId }
    }
    if (response.status === 302) {
      // Redirect usually means success
      const location = response.headers.get("location")
      const messageId = location?.match(/\/messages\/(\d+)/)?.[1]

      return { success: true, messageId }
    }
    const text = await response.text()
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
      return { success: true }
    }
    if (response.status === 302) {
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
