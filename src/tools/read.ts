import { type HTMLElement, parse as parseHtml } from "node-html-parser"
import { heyClient } from "../hey-client"

export interface Email {
  id: string
  from: string
  fromEmail?: string
  subject: string
  snippet?: string
  date?: string
  unread?: boolean
}

export interface EmailDetail {
  id: string
  from: string
  fromEmail?: string
  to?: string[]
  cc?: string[]
  subject: string
  body: string
  date?: string
  threadId?: string
}

function extractEmailsFromHtml(html: string): Email[] {
  const root = parseHtml(html)
  const emails: Email[] = []

  // Hey.com uses Turbo frames, look for email entries
  // The structure varies but typically includes data-entry-id or similar attributes
  const entries = root.querySelectorAll(
    "[data-entry-id], .posting, [data-posting-id]",
  )

  for (const entry of entries) {
    const id =
      entry.getAttribute("data-entry-id") ||
      entry.getAttribute("data-posting-id") ||
      entry.getAttribute("id")

    if (!id) continue

    // Extract sender info
    const senderEl = entry.querySelector(".sender, .from, [data-sender]")
    const from = senderEl?.text?.trim() || "Unknown"

    // Extract subject
    const subjectEl = entry.querySelector(".subject, .topic-subject, h3, h4")
    const subject = subjectEl?.text?.trim() || "(No subject)"

    // Extract snippet/preview
    const snippetEl = entry.querySelector(
      ".snippet, .preview, .excerpt, .body-preview",
    )
    const snippet = snippetEl?.text?.trim()

    // Extract date
    const dateEl = entry.querySelector("time, .date, .timestamp")
    const date = dateEl?.getAttribute("datetime") || dateEl?.text?.trim()

    // Check if unread
    const unread =
      entry.classNames?.includes("unread") ||
      entry.getAttribute("data-unread") === "true"

    emails.push({
      id: id.replace(/^entry-/, ""),
      from,
      subject,
      snippet,
      date,
      unread,
    })
  }

  // Fallback: try parsing Turbo stream content
  if (emails.length === 0) {
    const turboFrames = root.querySelectorAll("turbo-frame")
    for (const frame of turboFrames) {
      const frameId = frame.getAttribute("id")
      if (frameId?.startsWith("entry_") || frameId?.startsWith("posting_")) {
        const innerHtml = frame.innerHTML
        const innerEmails = extractEmailsFromHtml(innerHtml)
        emails.push(...innerEmails)
      }
    }
  }

  return emails
}

function extractEmailDetail(html: string, id: string): EmailDetail {
  const root = parseHtml(html)

  // Extract sender
  const senderEl = root.querySelector(
    ".sender, .from, [data-sender], .message-sender",
  )
  const from = senderEl?.text?.trim() || "Unknown"

  // Extract email address from sender element or data attribute
  const fromEmail =
    senderEl?.getAttribute("data-email") ||
    root.querySelector("[data-sender-email]")?.getAttribute("data-sender-email")

  // Extract subject
  const subjectEl = root.querySelector(
    ".subject, h1.subject, .message-subject, [data-subject]",
  )
  const subject = subjectEl?.text?.trim() || "(No subject)"

  // Extract body - look for message content
  const bodyEl = root.querySelector(
    ".message-body, .body, .content, .trix-content, [data-message-body]",
  )
  const body = bodyEl?.innerHTML || bodyEl?.text || ""

  // Extract date
  const dateEl = root.querySelector("time, .date, .timestamp, [datetime]")
  const date = dateEl?.getAttribute("datetime") || dateEl?.text?.trim()

  // Extract recipients
  const toEls = root.querySelectorAll(".to-recipient, [data-recipient]")
  const to = toEls.map((el: HTMLElement) => el.text.trim()).filter(Boolean)

  const ccEls = root.querySelectorAll(".cc-recipient, [data-cc]")
  const cc = ccEls.map((el: HTMLElement) => el.text.trim()).filter(Boolean)

  // Extract thread ID if present
  const threadId =
    root.querySelector("[data-thread-id]")?.getAttribute("data-thread-id") ||
    root.querySelector("[data-topic-id]")?.getAttribute("data-topic-id")

  return {
    id,
    from,
    fromEmail,
    to: to.length > 0 ? to : undefined,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    body,
    date,
    threadId,
  }
}

export async function listImbox(limit = 25, page = 1): Promise<Email[]> {
  const path = page > 1 ? `/my/imbox?page=${page}` : "/my/imbox"
  const html = await heyClient.fetchHtml(path)
  const emails = extractEmailsFromHtml(html)
  return emails.slice(0, limit)
}

export async function listFeed(limit = 25, page = 1): Promise<Email[]> {
  const path = page > 1 ? `/my/the_feed?page=${page}` : "/my/the_feed"
  const html = await heyClient.fetchHtml(path)
  const emails = extractEmailsFromHtml(html)
  return emails.slice(0, limit)
}

export async function listPaperTrail(limit = 25, page = 1): Promise<Email[]> {
  const path = page > 1 ? `/my/paper_trail?page=${page}` : "/my/paper_trail"
  const html = await heyClient.fetchHtml(path)
  const emails = extractEmailsFromHtml(html)
  return emails.slice(0, limit)
}

export async function listSetAside(): Promise<Email[]> {
  const html = await heyClient.fetchHtml("/my/set_aside")
  return extractEmailsFromHtml(html)
}

export async function listReplyLater(): Promise<Email[]> {
  const html = await heyClient.fetchHtml("/my/reply_later")
  return extractEmailsFromHtml(html)
}

export async function readEmail(
  id: string,
  format: "html" | "text" = "html",
): Promise<EmailDetail> {
  const path = format === "text" ? `/messages/${id}.text` : `/messages/${id}`
  const html = await heyClient.fetchHtml(path)
  return extractEmailDetail(html, id)
}

export async function searchEmails(
  query: string,
  limit = 25,
): Promise<Email[]> {
  const encodedQuery = encodeURIComponent(query)
  const html = await heyClient.fetchHtml(`/my/search?q=${encodedQuery}`)
  const emails = extractEmailsFromHtml(html)
  return emails.slice(0, limit)
}

export async function listScreener(): Promise<Email[]> {
  const html = await heyClient.fetchHtml("/my/screener")
  return extractEmailsFromHtml(html)
}
