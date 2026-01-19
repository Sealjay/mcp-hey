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
  bubbledUp?: boolean
  label?: string
}

export interface ImboxSummary {
  screenerCount: number
  bubbledUpCount: number
  newCount: number
  emails: Email[]
  bubbledUpEmails: Email[]
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

    // Hey.com email entries are article.posting elements
    const entries = root.querySelectorAll("article.posting")

    for (const entry of entries) {
      // ID is in data-identifier attribute
      const id = entry.getAttribute("data-identifier")
      if (!id) continue

      // Subject is in .posting__title
      const subjectEl = entry.querySelector(".posting__title")
      const subject = subjectEl?.text?.trim() || "(No subject)"

      // Sender name is in .posting__detail or from avatar alt attribute
      const senderEl = entry.querySelector(".posting__detail")
      const avatarEl = entry.querySelector(".avatar")
      const from =
        senderEl?.text?.trim() || avatarEl?.getAttribute("alt") || "Unknown"

      // Snippet/preview is in .posting__summary
      const snippetEl = entry.querySelector(".posting__summary")
      const snippet = snippetEl?.text?.trim()

      // Date is in .posting__time or time element
      const timeEl = entry.querySelector(".posting__time, time")
      const date = timeEl?.getAttribute("datetime") || timeEl?.text?.trim()

      // Unread status from class
      const classAttr = entry.getAttribute("class") || ""
      const unread = classAttr.includes("posting--unread")

      // Bubbled up status from data attribute
      const bubbledUp = entry.getAttribute("data-bubbled-up") === "true"

      // Label from inbox pill
      const labelEl = entry.querySelector(".posting__inbox-pill, .inbox-pill")
      const label = labelEl?.text?.trim()

      emails.push({
        id,
        from,
        subject,
        snippet,
        date,
        unread,
        bubbledUp,
        label,
      })
    }

    // Fallback for screener page: look for clearance articles
    if (emails.length === 0) {
      const clearanceEntries = root.querySelectorAll("article")
      for (const entry of clearanceEntries) {
        // Screener entries have sender email in heading
        const headingEl = entry.querySelector("h4, h3, heading")
        const subjectEl = entry.querySelector(
          '[class*="subject"], [class*="topic"]',
        )

        // Look for hidden input with posting ID
        const idInput = entry.querySelector('input[type="hidden"][value]')
        const id = idInput?.getAttribute("value")

        if (!id) continue

        const from = headingEl?.text?.trim()?.split("<")[0]?.trim() || "Unknown"
        const subject = subjectEl?.text?.trim() || "(No subject)"

        emails.push({
          id,
          from,
          subject,
          unread: true,
        })
      }
    }

    return emails
  } catch (err) {
    console.error("[hey-mcp] Failed to parse email HTML:", err)
    return []
  }
}

function extractImboxSummary(html: string): ImboxSummary {
  const root = parseHtml(html)
  const emails = extractEmailsFromHtml(html)

  // Extract screener count from button text like "Screen 1 first-time sender"
  let screenerCount = 0
  const screenerButton = root.querySelector('[href="/clearances"]')
  if (screenerButton) {
    const text = screenerButton.text || ""
    const match = text.match(/Screen\s+(\d+)/i)
    if (match) {
      screenerCount = Number.parseInt(match[1], 10)
    }
  }

  // Also check status element for screener count
  if (screenerCount === 0) {
    const statusEl = root.querySelector("status, [role='status']")
    if (statusEl) {
      const text = statusEl.text || ""
      const match = text.match(/(\d+)\s+message/i)
      if (match) {
        screenerCount = Number.parseInt(match[1], 10)
      }
    }
  }

  // Separate bubbled up emails from regular emails
  const bubbledUpEmails = emails.filter((e) => e.bubbledUp)
  const newEmails = emails.filter((e) => e.unread && !e.bubbledUp)

  return {
    screenerCount,
    bubbledUpCount: bubbledUpEmails.length,
    newCount: newEmails.length,
    emails,
    bubbledUpEmails,
  }
}

/**
 * Parse raw email text format (MIME) to extract body and headers.
 * This handles the /messages/{id}.text endpoint response.
 */
function parseRawEmailText(rawText: string): {
  from: string
  fromEmail?: string
  subject: string
  body: string
  date?: string
  to?: string[]
} {
  const lines = rawText.split("\n")
  const headers: Record<string, string> = {}
  let headerEnd = 0

  // Parse headers until empty line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "") {
      headerEnd = i
      break
    }
    // Handle header continuation (lines starting with whitespace)
    if (line.startsWith(" ") || line.startsWith("\t")) {
      const lastKey = Object.keys(headers).pop()
      if (lastKey) {
        headers[lastKey] += ` ${line.trim()}`
      }
    } else {
      const colonIdx = line.indexOf(":")
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).toLowerCase()
        const value = line.slice(colonIdx + 1).trim()
        headers[key] = value
      }
    }
  }

  // Extract from header
  const fromHeader = headers.from || ""
  const fromMatch = fromHeader.match(/^([^<]+)?<?([^>]+@[^>]+)?>?$/)
  const from = fromMatch?.[1]?.trim()?.replace(/^"|"$/g, "") || "Unknown"
  const fromEmail = fromMatch?.[2]

  // Extract subject
  const subject = headers.subject || "(No subject)"

  // Extract date
  const date = headers.date

  // Extract to
  const toHeader = headers.to || ""
  const to = toHeader
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)

  // Extract body - find plain text part in MIME message
  let body = ""
  const bodyContent = lines.slice(headerEnd + 1).join("\n")

  // Check for MIME boundary
  const boundaryMatch = headers["content-type"]?.match(
    /boundary="?([^";\s]+)"?/,
  )
  if (boundaryMatch) {
    const boundary = boundaryMatch[1]
    const parts = bodyContent.split(`--${boundary}`)

    // Find plain text part
    for (const part of parts) {
      if (
        part.includes("Content-Type: text/plain") ||
        part.includes("content-type: text/plain")
      ) {
        // Skip headers of this part
        const partLines = part.split("\n")
        let partHeaderEnd = 0
        for (let i = 0; i < partLines.length; i++) {
          if (partLines[i].trim() === "") {
            partHeaderEnd = i
            break
          }
        }
        body = partLines
          .slice(partHeaderEnd + 1)
          .join("\n")
          .trim()
        // Stop at next boundary marker
        const boundaryIdx = body.indexOf(`--${boundary}`)
        if (boundaryIdx > 0) {
          body = body.slice(0, boundaryIdx).trim()
        }
        break
      }
    }
  }

  // If no MIME parts, use raw body
  if (!body) {
    body = bodyContent.trim()
  }

  return {
    from,
    fromEmail,
    subject,
    body,
    date,
    to: to.length > 0 ? to : undefined,
  }
}

function extractEmailDetail(
  content: string,
  id: string,
  isRawText = false,
): EmailDetail {
  // Handle raw email text format (from .text endpoint)
  if (
    isRawText ||
    content.startsWith("Return-Path:") ||
    content.startsWith("Received:")
  ) {
    const parsed = parseRawEmailText(content)
    return {
      id,
      from: parsed.from,
      fromEmail: parsed.fromEmail,
      subject: parsed.subject,
      body: parsed.body,
      date: parsed.date,
      to: parsed.to,
    }
  }

  // Parse HTML format
  const root = parseHtml(content)

  // Extract subject from topic title or page heading
  const subjectEl = root.querySelector(
    ".topic__title, h1, .entry__collection-topic, [class*='subject']",
  )
  const subject = subjectEl?.text?.trim() || "(No subject)"

  // Extract sender from entry header - look for link with sender name
  // The avatar alt attribute contains "Name <email>" format
  const avatarEl = root.querySelector(".entry__avatar .avatar, .avatar")
  const avatarAlt = avatarEl?.getAttribute("alt") || ""

  // Parse "Name <email>" format from avatar alt
  const emailMatch = avatarAlt.match(/<([^>]+)>/)
  const fromEmail = emailMatch?.[1]
  const from = avatarAlt.split("<")[0]?.trim() || "Unknown"

  // Extract body content
  // Hey uses <message-content> with shadow DOM, but the template/turbo-frame
  // contains the actual HTML content when fetched server-side
  let body = ""

  // Try multiple selectors for body content
  const bodySelectors = [
    "message-content template",
    "message-content",
    ".entry__body .entry__content",
    ".entry__content",
    ".trix-content",
    ".message-body",
  ]

  for (const selector of bodySelectors) {
    const bodyEl = root.querySelector(selector)
    if (bodyEl) {
      const extractedContent = bodyEl.innerHTML || bodyEl.text || ""
      if (extractedContent.trim().length > body.length) {
        body = extractedContent.trim()
      }
    }
  }

  // If still no body, try to get excerpt/snippet as fallback
  if (!body) {
    const excerptEl = root.querySelector(".entry__excerpt, .posting__summary")
    body = excerptEl?.text?.trim() || ""
  }

  // Extract date from entry time
  const dateEl = root.querySelector(
    ".entry__time time, .entry__time, time[datetime]",
  )
  const date = dateEl?.getAttribute("datetime") || dateEl?.text?.trim()

  // Extract recipients from entry header
  const toEls = root.querySelectorAll(
    ".entry__recipients a, [class*='recipient'] a",
  )
  const to = toEls.map((el: HTMLElement) => el.text.trim()).filter(Boolean)

  const ccEls = root.querySelectorAll("[class*='cc'] a")
  const cc = ccEls.map((el: HTMLElement) => el.text.trim()).filter(Boolean)

  // Extract thread/topic ID from URL or data attributes
  const threadId =
    root.querySelector("[data-topic-id]")?.getAttribute("data-topic-id") ||
    root
      .querySelector("a[href*='/topics/']")
      ?.getAttribute("href")
      ?.match(/\/topics\/(\d+)/)?.[1]

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

/**
 * Get full imbox summary including screener count and bubbled up emails.
 * This provides more context than listImbox alone.
 */
export async function getImboxSummary(
  options: ListOptions = {},
): Promise<CachedResult<ImboxSummary>> {
  const { forceRefresh = false } = options

  // Fetch from network (always fresh for summary)
  const html = await heyClient.fetchHtml("/imbox")
  const summary = extractImboxSummary(html)

  return {
    data: summary,
    _cache: createNetworkMetadata(),
  }
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
  const content = await heyClient.fetchHtml(path)
  const isRawText = format === "text"
  const email = extractEmailDetail(content, id, isRawText)

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
