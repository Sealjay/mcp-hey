import { type HTMLElement, parse as parseHtml } from "node-html-parser"
import {
  type CacheMetadata,
  type CachedResult,
  cacheEmailDetail,
  cacheMessages,
  cacheSearchResults,
  ftsSearch,
  getCachedEmailDetail,
  getCachedMessages,
  getCachedSearch,
  needsRefresh,
} from "../cache"
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

export interface ListOptions {
  limit?: number
  page?: number
  forceRefresh?: boolean
}

export interface Label {
  id: string
  name: string
  color?: string
}

export interface SearchOptions {
  limit?: number
  forceRefresh?: boolean
}

function extractEmailsFromHtml(html: string): Email[] {
  try {
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
        entry.classList?.contains("unread") ||
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
  } catch (err) {
    console.error("[hey-mcp] Failed to parse email HTML:", err)
    return []
  }
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

function createNetworkMetadata(): CacheMetadata {
  return {
    source: "network",
    cached_at: new Date().toISOString(),
    age_seconds: 0,
    is_stale: false,
    hint: "Fresh data from Hey.com",
  }
}

/**
 * Generic folder listing with cache support.
 */
async function listFolder(
  folder: string,
  path: string,
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  const { limit = 25, page = 1, forceRefresh = false } = options

  // Check cache first (only for first page)
  if (!forceRefresh && page === 1 && !needsRefresh(folder)) {
    const cached = getCachedMessages(folder, limit)
    if (cached) {
      return {
        data: cached.messages,
        _cache: cached.metadata,
      }
    }
  }

  // Fetch from network
  const fullPath = page > 1 ? `${path}?page=${page}` : path
  const html = await heyClient.fetchHtml(fullPath)
  const emails = extractEmailsFromHtml(html).slice(0, limit)

  // Update cache (only for first page)
  if (page === 1) {
    cacheMessages(folder, emails)
  }

  return {
    data: emails,
    _cache: createNetworkMetadata(),
  }
}

export async function listImbox(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("imbox", "/imbox", options)
}

export async function listFeed(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("feed", "/feedbox", options)
}

export async function listPaperTrail(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("paper_trail", "/paper_trail", options)
}

export async function listSetAside(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("set_aside", "/set_aside", options)
}

export async function listReplyLater(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("reply_later", "/reply_later", options)
}

export async function listScreener(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("screener", "/clearances", options)
}

export async function listTrash(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("trash", "/topics/trash", options)
}

export async function listSpam(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("spam", "/topics/spam", options)
}

export async function listDrafts(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("drafts", "/entries/drafts", options)
}

function extractLabelsFromHtml(html: string): Label[] {
  try {
    const root = parseHtml(html)
    const labels: Label[] = []

    // Hey.com uses folders for labels
    const folderItems = root.querySelectorAll(
      "[data-folder-id], .folder-item, [data-collection-id]",
    )

    for (const item of folderItems) {
      const id =
        item.getAttribute("data-folder-id") ||
        item.getAttribute("data-collection-id") ||
        item.getAttribute("id")

      if (!id) continue

      const nameEl = item.querySelector(".folder-name, .name, .label")
      const name = nameEl?.text?.trim() || item.text?.trim() || "Unnamed"

      const color =
        item.getAttribute("data-color") ||
        item.querySelector("[data-color]")?.getAttribute("data-color")

      labels.push({
        id: id.replace(/^folder-/, ""),
        name,
        color: color || undefined,
      })
    }

    return labels
  } catch (err) {
    console.error("[hey-mcp] Failed to parse labels HTML:", err)
    return []
  }
}

export async function listLabels(): Promise<Label[]> {
  const html = await heyClient.fetchHtml("/folders")
  return extractLabelsFromHtml(html)
}

export async function listLabelEmails(
  labelId: string,
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder(`label_${labelId}`, `/folders/${labelId}`, options)
}

export async function readEmail(
  id: string,
  format: "html" | "text" = "html",
  forceRefresh = false,
): Promise<CachedResult<EmailDetail>> {
  // Check cache first (only for HTML format)
  if (!forceRefresh && format === "html") {
    const cached = getCachedEmailDetail(id)
    if (cached) {
      return {
        data: cached.email,
        _cache: cached.metadata,
      }
    }
  }

  // Fetch from network
  const path = format === "text" ? `/messages/${id}.text` : `/messages/${id}`
  const html = await heyClient.fetchHtml(path)
  const email = extractEmailDetail(html, id)

  // Update cache
  cacheEmailDetail(email)

  return {
    data: email,
    _cache: createNetworkMetadata(),
  }
}

export async function searchEmails(
  query: string,
  options: SearchOptions = {},
): Promise<CachedResult<Email[]>> {
  const { limit = 25, forceRefresh = false } = options

  // Try local FTS search first (fast)
  if (!forceRefresh) {
    const ftsResult = ftsSearch(query, limit)
    if (ftsResult && ftsResult.emails.length > 0) {
      return {
        data: ftsResult.emails,
        _cache: ftsResult.metadata,
      }
    }

    // Check cached search results
    const cached = getCachedSearch(query)
    if (cached) {
      return {
        data: cached.emails,
        _cache: cached.metadata,
      }
    }
  }

  // Fetch from network
  const encodedQuery = encodeURIComponent(query)
  const html = await heyClient.fetchHtml(`/search?q=${encodedQuery}`)
  const emails = extractEmailsFromHtml(html).slice(0, limit)

  // Update cache
  cacheSearchResults(query, emails)

  return {
    data: emails,
    _cache: createNetworkMetadata(),
  }
}

// Legacy exports for backward compatibility (without cache metadata)
export async function listImboxLegacy(limit = 25, page = 1): Promise<Email[]> {
  const result = await listImbox({ limit, page })
  return result.data
}

export async function listFeedLegacy(limit = 25, page = 1): Promise<Email[]> {
  const result = await listFeed({ limit, page })
  return result.data
}

export async function listPaperTrailLegacy(
  limit = 25,
  page = 1,
): Promise<Email[]> {
  const result = await listPaperTrail({ limit, page })
  return result.data
}

export async function listSetAsideLegacy(): Promise<Email[]> {
  const result = await listSetAside()
  return result.data
}

export async function listReplyLaterLegacy(): Promise<Email[]> {
  const result = await listReplyLater()
  return result.data
}

export async function readEmailLegacy(
  id: string,
  format: "html" | "text" = "html",
): Promise<EmailDetail> {
  const result = await readEmail(id, format)
  return result.data
}

export async function searchEmailsLegacy(
  query: string,
  limit = 25,
): Promise<Email[]> {
  const result = await searchEmails(query, { limit })
  return result.data
}

export async function listScreenerLegacy(): Promise<Email[]> {
  const result = await listScreener()
  return result.data
}
