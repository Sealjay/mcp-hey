import { type HTMLElement, parse as parseHtml } from "node-html-parser"
import {
  type CacheMetadata,
  type CachedResult,
  cacheEmailDetail,
  cacheFolderHtml,
  cacheMessages,
  cacheSearchResults,
  ftsSearch,
  getCachedEmailDetail,
  getCachedFolderHtml,
  getCachedMessages,
  getCachedSearch,
  needsRefresh,
} from "../cache"
import { heyClient } from "../hey-client"
import {
  type AttachmentMeta,
  type CalendarInviteMeta,
  listAttachmentsForEmail,
  probeAttachmentsFromRaw,
} from "./attachments"

export interface Email {
  id: string // Primary ID (topic ID when available, otherwise best available)
  topicId?: string // For /topics/{id}/* operations (bubble_up, trash, etc.)
  entryId?: string // For /entries/{id}/* operations (set_aside, reply_later, read)
  postingId?: string // For /postings/{id}/* operations (muting)
  from: string
  fromEmail?: string
  subject: string
  snippet?: string
  date?: string
  unread?: boolean
  bubbledUp?: boolean
  label?: string
  clearanceId?: string // For screener entries
  /**
   * Best-effort count of attachments for this email, derived from list HTML
   * indicators only (no extra network calls). Undefined when the listing
   * does not surface an attachment hint. 0 means "no indicator seen", which
   * is not a guarantee of zero attachments.
   */
  attachmentCount?: number
}

export interface ImboxSummary {
  screenerCount: number
  bubbledUpCount: number
  newCount: number
  emails: Email[]
  bubbledUpEmails: Email[]
}

export interface ThreadEntry {
  entryId: string
  from: string
  fromEmail?: string
  to?: string[]
  cc?: string[]
  subject?: string
  date?: string
  body: string
  attachments?: AttachmentMeta[]
  calendar_invites?: CalendarInviteMeta[]
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
  entries?: ThreadEntry[]
  attachments?: AttachmentMeta[]
  calendar_invites?: CalendarInviteMeta[]
  muted?: boolean
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

export interface Collection {
  id: string
  name: string
}

export interface SearchOptions {
  limit?: number
  forceRefresh?: boolean
}

/**
 * Count attachment indicators within a listing entry. This is a cheap probe
 * intended to avoid round-tripping every email body for triage purposes.
 *
 * Returned semantics:
 *   - undefined  → list HTML did not contain a recognised indicator slot
 *   - 0          → indicator slot present, no attachments
 *   - n          → n attachments signalled by the indicator
 */
function extractAttachmentCount(entry: HTMLElement): number | undefined {
  // 1. Explicit data attribute, when Hey emits one.
  const dataAttr =
    entry.getAttribute("data-has-attachments") ||
    entry.getAttribute("data-attachment-count")
  if (dataAttr) {
    const n = Number.parseInt(dataAttr, 10)
    if (!Number.isNaN(n)) return n
    if (dataAttr === "true") return 1
    if (dataAttr === "false") return 0
  }

  // 2. Class-based hint on the posting itself.
  const classAttr = entry.getAttribute("class") || ""
  if (
    /(?:^|\s)(?:posting--has-attachment|has-attachments?)(?:$|\s)/i.test(
      classAttr,
    )
  ) {
    return 1
  }

  // 3. Look for paperclip-style icons or attachment badges. We treat any
  // attachment-flavoured node inside the entry as a single attachment unless
  // a numeric badge is also present.
  const indicator =
    entry.querySelector(".posting__attachment, .posting__paperclip") ||
    entry.querySelector("[class*='attachment'], [aria-label*='attachment' i]")
  if (!indicator) return undefined

  const badgeText = indicator.text?.trim() || ""
  const badgeMatch = badgeText.match(/(\d+)/)
  if (badgeMatch) {
    return Number.parseInt(badgeMatch[1], 10)
  }
  return 1
}

function extractEmailsFromHtml(htmlOrRoot: string | HTMLElement): Email[] {
  try {
    const root =
      typeof htmlOrRoot === "string" ? parseHtml(htmlOrRoot) : htmlOrRoot
    const emails: Email[] = []

    // Hey.com email entries can be:
    // - article.posting (standard list views like imbox, set_aside)
    // - article.bulk-actions__container[data-identifier] (Focus & Reply view for reply_later)
    // We use data-identifier as the reliable indicator of an email entry
    const entries = root.querySelectorAll(
      "article.posting, article.bulk-actions__container[data-identifier]",
    )

    for (const entry of entries) {
      // Extract multiple ID types from different sources
      // 1. Posting ID from data-identifier attribute
      const postingId = entry
        .getAttribute("data-identifier")
        ?.replace(/^(posting_|entry_)/, "")

      // 2. Entry ID from data-entry-id attribute (primary)
      let entryId = entry.getAttribute("data-entry-id")?.replace(/^entry_/, "")

      // 2b. Fallback: extract entryId from #__entry_{id} URL fragments in links
      if (!entryId) {
        const entryLink = entry.querySelector("a[href*='#__entry_']")
        if (entryLink) {
          const href = entryLink.getAttribute("href") || ""
          const entryMatch = href.match(/#__entry_(\d+)/)
          if (entryMatch) {
            entryId = entryMatch[1]
          }
        }
      }

      // 3. Topic ID from href links within the article
      let topicId: string | undefined
      const topicLink = entry.querySelector("a[href*='/topics/']")
      if (topicLink) {
        const href = topicLink.getAttribute("href") || ""
        const topicMatch = href.match(/\/topics\/(\d+)/)
        if (topicMatch) {
          topicId = topicMatch[1]
        }
      }

      // If no topic link inside, check if the posting__title or posting__link is a topic link
      if (!topicId) {
        const titleLink = entry.querySelector(
          ".posting__title a[href*='/topics/'], .posting__link[href*='/topics/']",
        )
        if (titleLink) {
          const href = titleLink.getAttribute("href") || ""
          const topicMatch = href.match(/\/topics\/(\d+)/)
          if (topicMatch) {
            topicId = topicMatch[1]
          }
        }
      }

      // Also check any link within the entry for topic ID
      if (!topicId) {
        const anyLink = entry.querySelector("a[href]")
        if (anyLink) {
          const href = anyLink.getAttribute("href") || ""
          const topicMatch = href.match(/\/topics\/(\d+)/)
          if (topicMatch) {
            topicId = topicMatch[1]
          }
        }
      }

      // Primary ID: prefer topic ID > entry ID > posting ID
      const id = topicId || entryId || postingId
      if (!id) continue

      // Subject is in .posting__title, or heading elements for Focus & Reply view
      const subjectEl =
        entry.querySelector(".posting__title") ||
        entry.querySelector(".topic__title") ||
        entry.querySelector("h1, h2, h3")
      const subject = subjectEl?.text?.trim() || "(No subject)"

      // Sender name is in .posting__detail, or from avatar/image alt attribute
      const senderEl = entry.querySelector(".posting__detail")
      const avatarEl =
        entry.querySelector(".avatar") || entry.querySelector("img[alt*='@']")
      // Parse sender from avatar alt which may be "Name <email>" format
      const avatarAlt = avatarEl?.getAttribute("alt") || ""
      const senderFromAvatar = avatarAlt.split("<")[0]?.trim() || avatarAlt
      const from = senderEl?.text?.trim() || senderFromAvatar || "Unknown"

      // Extract sender email from avatar alt if present
      const emailMatch = avatarAlt.match(/<([^>]+@[^>]+)>/)
      const fromEmail = emailMatch?.[1]

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

      // Best-effort attachment-indicator detection. Hey lists do not
      // explicitly expose attachment counts, but rendered postings sometimes
      // surface a paperclip icon or `data-has-attachments` attribute. We
      // look for the most-likely indicators without fetching message bodies.
      const attachmentCount = extractAttachmentCount(entry)

      emails.push({
        id,
        topicId,
        entryId,
        postingId,
        from,
        fromEmail,
        subject,
        snippet,
        date,
        unread,
        bubbledUp,
        label,
        attachmentCount,
      })
    }

    // Screener page: extract clearance entries from article.clearance elements.
    // The screener DOM uses a different structure than the imbox posting list.
    // <article id="clearance_{id}" class="clearance" data-clearance-id="{id}">
    //   <h3 class="clearance__sender">
    //     <span id="name_clearance_{id}">Sender Name</span>
    //     <span class="clearance__email"><span>&lt;</span>sender@email.com<span>&gt;</span></span>
    //   </h3>
    //   <span class="clearance__subject">Subject</span>
    //   <span> – Snippet...</span>
    //   <time datetime="...">...</time>
    // </article>
    const clearanceArticles = root.querySelectorAll("article.clearance")

    for (const article of clearanceArticles) {
      const clearanceId =
        article.getAttribute("data-clearance-id") ||
        article.getAttribute("id")?.replace(/^clearance_/, "") ||
        ""
      if (!clearanceId) continue

      const nameEl = article.querySelector(".clearance__sender .hdg")
      const from = nameEl?.text?.trim() || ""

      const emailEl = article.querySelector(".clearance__email")
      const emailText = emailEl?.text?.trim() || ""
      // Strip surrounding angle brackets and whitespace
      const fromEmail = emailText.replace(/[<>\s ]/g, "")

      const subjectEl = article.querySelector(".clearance__subject")
      const subject = subjectEl?.text?.trim() || "(Screener entry)"

      // Snippet is the sibling span after the subject inside .clearance__detail
      let snippet = ""
      const detailEl = article.querySelector(".clearance__detail")
      if (detailEl) {
        const detailText = detailEl.text?.trim() || ""
        const dashIndex = detailText.indexOf("–")
        if (dashIndex !== -1) {
          snippet = detailText.slice(dashIndex + 1).trim()
        }
      }

      const timeEl = article.querySelector("time[datetime]")
      const date = timeEl?.getAttribute("datetime") || undefined

      emails.push({
        id: clearanceId,
        clearanceId,
        from: from || fromEmail.split("@")[0] || "Unknown",
        fromEmail: fromEmail || undefined,
        subject,
        snippet,
        date,
        unread: true,
      })
    }

    return emails
  } catch (err) {
    console.error("[mcp-hey] Failed to parse email HTML:", err)
    return []
  }
}

function extractImboxSummary(html: string): ImboxSummary {
  const root = parseHtml(html)
  const emails = extractEmailsFromHtml(root)

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

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}

function decodeBase64(text: string): string {
  const cleaned = text.replace(/\r?\n/g, "")
  try {
    return Buffer.from(cleaned, "base64").toString("utf-8")
  } catch {
    return text
  }
}

function decodeTransferEncoding(body: string, encoding: string): string {
  const enc = encoding.toLowerCase().trim()
  if (enc === "quoted-printable") return decodeQuotedPrintable(body)
  if (enc === "base64") return decodeBase64(body)
  return body
}

function parseMimeHeaders(block: string): {
  headers: Record<string, string>
  bodyStart: number
} {
  const lines = block.split("\n")
  const headers: Record<string, string> = {}
  let bodyStart = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "") {
      bodyStart = i + 1
      break
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      const lastKey = Object.keys(headers).pop()
      if (lastKey) headers[lastKey] += ` ${line.trim()}`
    } else {
      const colonIdx = line.indexOf(":")
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).toLowerCase()
        headers[key] = line.slice(colonIdx + 1).trim()
      }
    }
  }

  return { headers, bodyStart }
}

function extractTextFromMimeRecursive(content: string): string {
  const { headers, bodyStart } = parseMimeHeaders(content)
  const ct = (headers["content-type"] || "").toLowerCase()
  const encoding = headers["content-transfer-encoding"] || "7bit"
  const body = content.split("\n").slice(bodyStart).join("\n")

  if (ct.includes("image/") || ct.includes("application/octet-stream")) {
    return ""
  }

  const boundaryMatch = ct.match(/boundary="?([^";\s]+)"?/)
  if (boundaryMatch) {
    const parts = body.split(`--${boundaryMatch[1]}`)
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed || trimmed === "--") continue
      const result = extractTextFromMimeRecursive(trimmed)
      if (result) return result
    }
    return ""
  }

  if (ct.includes("text/plain") || (!ct && !headers["content-type"])) {
    let textBody = body.trim()
    const bIdx = textBody.indexOf("\n--")
    if (bIdx > 0) textBody = textBody.slice(0, bIdx).trim()
    return decodeTransferEncoding(textBody, encoding)
  }

  return ""
}

/**
 * Parse raw email text format (MIME) to extract body and headers.
 * Handles quoted-printable, base64, and multipart MIME messages.
 */
function parseRawEmailText(rawText: string): {
  from: string
  fromEmail?: string
  subject: string
  body: string
  date?: string
  to?: string[]
} {
  const { headers, bodyStart } = parseMimeHeaders(rawText)
  const lines = rawText.split("\n")

  const fromHeader = headers.from || ""
  const fromMatch = fromHeader.match(/^([^<]+)?<?([^>]+@[^>]+)?>?$/)
  const from = fromMatch?.[1]?.trim()?.replace(/^"|"$/g, "") || "Unknown"
  const fromEmail = fromMatch?.[2]

  const subject = headers.subject || "(No subject)"
  const date = headers.date

  const toHeader = headers.to || ""
  const to = toHeader
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)

  const body = extractTextFromMimeRecursive(rawText)

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

  // Parse all entries in the thread
  const entryEls = root.querySelectorAll(".entry.entry--sheet")
  const entries: ThreadEntry[] = []

  for (const entryEl of entryEls) {
    const entryId = entryEl.getAttribute("id")?.replace("entry_", "") || ""
    const avatar = entryEl.querySelector(".avatar")
    const avatarAlt = avatar?.getAttribute("alt") || ""
    const entryEmailMatch = avatarAlt.match(/<([^>]+)>/)
    const entryFrom = avatarAlt.split("<")[0]?.trim() || "Unknown"
    const entryFromEmail = entryEmailMatch?.[1]
    const timeEl = entryEl.querySelector("time[datetime]")
    const entryDate = timeEl?.getAttribute("datetime") || timeEl?.text?.trim()

    const entryToEls = entryEl.querySelectorAll(
      ".entry__recipients a, [class*='recipient'] a",
    )
    const entryTo = entryToEls
      .map((el: HTMLElement) => el.text.trim())
      .filter(Boolean)
    const entryCcEls = entryEl.querySelectorAll("[class*='cc'] a")
    const entryCc = entryCcEls
      .map((el: HTMLElement) => el.text.trim())
      .filter(Boolean)

    let entryBody = ""
    const template = entryEl.querySelector("message-content template")
    if (template) {
      entryBody = template.innerHTML?.trim() || ""
    }
    if (!entryBody) {
      const contentEl = entryEl.querySelector(
        "message-content, .entry__content, .trix-content",
      )
      if (contentEl) {
        entryBody = contentEl.innerHTML?.trim() || contentEl.text?.trim() || ""
      }
    }

    if (entryId || entryBody) {
      entries.push({
        entryId,
        from: entryFrom,
        fromEmail: entryFromEmail,
        to: entryTo.length > 0 ? entryTo : undefined,
        cc: entryCc.length > 0 ? entryCc : undefined,
        date: entryDate,
        body: entryBody,
      })
    }
  }

  const firstEntry = entries[0]
  const from = firstEntry?.from || "Unknown"
  const fromEmail = firstEntry?.fromEmail
  const date = firstEntry?.date
  const body = entries.map((e) => e.body).join("\n\n")

  // Fallback if no .entry--sheet elements found (e.g. single-entry views)
  let fallbackBody = body
  if (!fallbackBody) {
    const bodySelectors = [
      "message-content template",
      "message-content",
      ".entry__content",
      ".trix-content",
    ]
    for (const selector of bodySelectors) {
      const bodyEl = root.querySelector(selector)
      if (bodyEl) {
        const extracted = bodyEl.innerHTML || bodyEl.text || ""
        if (extracted.trim().length > fallbackBody.length) {
          fallbackBody = extracted.trim()
        }
      }
    }
    if (!fallbackBody) {
      const excerptEl = root.querySelector(".entry__excerpt, .posting__summary")
      fallbackBody = excerptEl?.text?.trim() || ""
    }
  }

  const threadId =
    root.querySelector("[data-topic-id]")?.getAttribute("data-topic-id") ||
    root
      .querySelector("a[href*='/topics/']")
      ?.getAttribute("href")
      ?.match(/\/topics\/(\d+)/)?.[1]

  // Detect muted/ignored thread status
  const muteNotice = root.querySelector(".island--topic-notice")
  const muted =
    muteNotice?.text?.includes("ignored") ||
    !!root.querySelector(".action-group__action--unmute")

  return {
    id,
    from,
    fromEmail,
    to: firstEntry?.to,
    cc: firstEntry?.cc,
    subject,
    body: fallbackBody || body,
    date,
    threadId,
    entries: entries.length > 0 ? entries : undefined,
    muted: muted || undefined,
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
    // Cache raw HTML for imbox (enables summary extraction without network)
    if (folder === "imbox") {
      cacheFolderHtml(folder, html)
    }
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

  // Check cache first (unless force refresh requested)
  if (!forceRefresh) {
    const cachedHtml = getCachedFolderHtml("imbox")
    if (cachedHtml) {
      const summary = extractImboxSummary(cachedHtml.html)
      return {
        data: summary,
        _cache: cachedHtml.metadata,
      }
    }
  }

  // Fetch from network
  const html = await heyClient.fetchHtml("/imbox")
  const summary = extractImboxSummary(html)

  // Cache the HTML for future summary requests
  cacheFolderHtml("imbox", html)
  // Also cache the extracted messages
  cacheMessages("imbox", summary.emails)

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

    // Hey.com labels page has links to /folders/{id}
    const links = root.querySelectorAll("a[href*='/folders/']")

    for (const link of links) {
      const href = link.getAttribute("href")
      const match = href?.match(/\/folders\/(\d+)/)
      if (!match) continue

      const id = match[1]
      const name = link.text?.trim() || "Unnamed"

      // Skip "New label" link and navigation links
      if (name === "New label" || name === "All Labels") continue

      labels.push({ id, name })
    }

    return labels
  } catch (err) {
    console.error("[mcp-hey] Failed to parse labels HTML:", err)
    return []
  }
}

export async function listLabels(): Promise<Label[]> {
  const html = await heyClient.fetchHtml("/folders")
  return extractLabelsFromHtml(html)
}

function extractCollectionsFromHtml(html: string): Collection[] {
  try {
    const root = parseHtml(html)
    const collections: Collection[] = []

    // Collections page has links to /collections/{id}
    const links = root.querySelectorAll("a[href*='/collections/']")

    for (const link of links) {
      const href = link.getAttribute("href")
      const match = href?.match(/\/collections\/(\d+)/)
      if (!match) continue

      const id = match[1]
      const name = link.text?.trim() || "Unnamed"

      // Skip if it's just "All Collections" link
      if (name === "All Collections") continue

      collections.push({ id, name })
    }

    return collections
  } catch (err) {
    console.error("[mcp-hey] Failed to parse collections HTML:", err)
    return []
  }
}

export async function listCollections(): Promise<Collection[]> {
  const html = await heyClient.fetchHtml("/collections")
  return extractCollectionsFromHtml(html)
}

export async function listCollectionEmails(
  collectionId: string,
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder(
    `collection_${collectionId}`,
    `/collections/${collectionId}`,
    options,
  )
}

export async function listLabelEmails(
  labelId: string,
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder(`label_${labelId}`, `/folders/${labelId}`, options)
}

export interface ReadOptions {
  format?: "html" | "text"
  forceRefresh?: boolean
  maxEntries?: number
}

const messageIdCache = new Map<string, string>()

export async function resolveMessageId(id: string): Promise<string> {
  const cached = messageIdCache.get(id)
  if (cached) return cached

  try {
    const html = await heyClient.fetchHtml(`/topics/${id}`)
    const match = html.match(/\/messages\/(\d+)/)
    if (match) {
      messageIdCache.set(id, match[1])
      return match[1]
    }
  } catch (err) {
    console.error("[mcp-hey] resolveMessageId failed:", err)
  }
  return id
}

export async function readEmail(
  id: string,
  options: ReadOptions = {},
): Promise<CachedResult<EmailDetail>> {
  const { format = "html", forceRefresh = false, maxEntries } = options

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

  // Fetch from network - try /topics first (most common ID type), then /messages
  let content = ""
  const isRawText = format === "text"
  let messageId = id

  if (format === "text") {
    let entryMessageIds: string[] = []
    try {
      const topicHtml = await heyClient.fetchHtml(`/topics/${id}`)
      const seen = new Set<string>()
      for (const m of topicHtml.matchAll(/\/messages\/(\d+)/g)) {
        if (!seen.has(m[1])) {
          seen.add(m[1])
          entryMessageIds.push(m[1])
        }
      }
    } catch (err) {
      console.error("[mcp-hey] Topic page fetch failed for", id, err)
    }

    if (entryMessageIds.length === 0) entryMessageIds = [id]
    if (maxEntries) entryMessageIds = entryMessageIds.slice(0, maxEntries)
    messageId = entryMessageIds[0]

    // Cache the resolved message IDs so resolveMessageId can skip the fetch
    if (entryMessageIds[0] !== id) {
      messageIdCache.set(id, entryMessageIds[0])
    }

    // Fetch all entries in parallel (H4)
    const entryResults = await Promise.all(
      entryMessageIds.map(async (eid) => {
        try {
          const raw = await heyClient.fetchHtml(`/messages/${eid}.text`)
          const parsed = parseRawEmailText(raw)
          // Probe attachments from the already-fetched raw MIME (C1)
          const probe = probeAttachmentsFromRaw(raw, eid)
          const entry: ThreadEntry = {
            entryId: eid,
            from: parsed.from,
            fromEmail: parsed.fromEmail,
            to: parsed.to,
            subject: parsed.subject,
            date: parsed.date,
            body: parsed.body,
            attachments: probe.attachments,
            calendar_invites: probe.calendar_invites,
          }
          return entry
        } catch (err) {
          console.error("[mcp-hey] Entry fetch failed for", eid, err)
          return null
        }
      }),
    )

    const parsedEntries = entryResults.filter(
      (e): e is ThreadEntry => e !== null,
    )

    const first = parsedEntries[0]
    const subject = first?.subject || "(No subject)"
    const combinedBody = parsedEntries.map((e) => e.body).join("\n\n---\n\n")

    // Aggregate attachments from all entries
    const allAttachments = parsedEntries.flatMap((e) => e.attachments ?? [])
    const allCalendarInvites = parsedEntries.flatMap(
      (e) => e.calendar_invites ?? [],
    )

    const email: EmailDetail = {
      id,
      from: first?.from || "Unknown",
      fromEmail: first?.fromEmail,
      to: first?.to,
      subject,
      body: combinedBody,
      date: first?.date,
      entries: parsedEntries.length > 0 ? parsedEntries : undefined,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      calendar_invites:
        allCalendarInvites.length > 0 ? allCalendarInvites : undefined,
    }

    cacheEmailDetail(email)
    return { data: email, _cache: createNetworkMetadata() }
  }

  {
    // For HTML format, try multiple endpoints in order of likelihood
    // Hey.com uses different ID types for different resources:
    // - topicId: threads (conversations) at /topics/{id} - most common from listings
    // - postingId: individual email entries at /postings/{id}
    // - postingId (bundles): Paper Trail grouped emails at /postings/{id}/bundles/unseen
    // - entryId: inbox entries at /entries/{id}
    // - messageId: raw messages at /messages/{id}
    // Note: IDs from list operations are typically topicIds, so try /topics first
    const endpoints = [
      `/topics/${id}`,
      `/topics/${id}/entries`,
      `/postings/${id}`,
      `/postings/${id}/bundles/unseen`, // Paper Trail bundles (grouped transactional emails)
      `/entries/${id}`,
      `/messages/${id}`,
    ]

    let lastError: Error | null = null
    for (const endpoint of endpoints) {
      try {
        console.error(`[mcp-hey] Trying endpoint: ${endpoint}`)
        content = await heyClient.fetchHtml(endpoint)
        console.error(`[mcp-hey] Success with endpoint: ${endpoint}`)
        break // Success - exit the loop
      } catch (err) {
        lastError = err as Error
        console.error(`[mcp-hey] ${endpoint} failed:`, (err as Error).message)
      }
    }

    if (!content && lastError) {
      throw lastError
    }
  }

  const email = extractEmailDetail(content, id, isRawText)

  // Probe for attachments via the raw .text endpoint. Failures (e.g. the
  // message id is a topic id where .text is unavailable) are swallowed: the
  // attachments arrays are simply omitted in that case. Calendar invites
  // are surfaced separately for triage - the body remains attachment-free.
  try {
    // H5: Extract message ID from the already-fetched HTML content to avoid
    // a redundant resolveMessageId call that re-fetches the topic page.
    if (messageId === id) {
      const contentMatch = content.match(/\/messages\/(\d+)/)
      if (contentMatch) {
        messageId = contentMatch[1]
        messageIdCache.set(id, messageId)
      } else {
        messageId = await resolveMessageId(id)
      }
    }
    const probe = await listAttachmentsForEmail(messageId)
    email.attachments = probe.attachments
    email.calendar_invites = probe.calendar_invites
  } catch (err) {
    console.error(
      `[mcp-hey] Attachment probe failed for ${id}:`,
      (err as Error).message,
    )
  }

  // Update cache
  cacheEmailDetail(email)

  return {
    data: email,
    _cache: createNetworkMetadata(),
  }
}

/**
 * Parse search results from Hey.com /search page HTML.
 * Search results use a different structure from folder listings:
 *   a.action-group__action--envelope[href="/topics/{topicId}#__entry_{entryId}"]
 *     span.u-min-width
 *       span.txt--ellipsis  → subject
 *       small.txt--subtle   → sender name
 *     time[datetime]         → ISO date
 */
function extractSearchResultsFromHtml(html: string): Email[] {
  try {
    const root = parseHtml(html)
    const emails: Email[] = []

    const items = root.querySelectorAll("a.action-group__action--envelope")

    for (const item of items) {
      const href = item.getAttribute("href") || ""

      // Extract topicId and entryId from href like /topics/1946922438#__entry_2069500066
      const topicMatch = href.match(/\/topics\/(\d+)/)
      const entryMatch = href.match(/#__entry_(\d+)/)
      const topicId = topicMatch?.[1]
      const entryId = entryMatch?.[1]

      const id = topicId || entryId
      if (!id) continue

      // Subject from first span child inside span.u-min-width
      const subjectEl = item.querySelector("span.u-min-width > span")
      const subject = subjectEl?.text?.trim() || "(No subject)"

      // Sender from small element
      const senderEl = item.querySelector("span.u-min-width > small")
      const from = senderEl?.text?.trim() || "Unknown"

      // Date from time element
      const timeEl = item.querySelector("time")
      const date = timeEl?.getAttribute("datetime") || undefined

      emails.push({
        id,
        topicId,
        entryId,
        from,
        subject,
        date,
      })
    }

    return emails
  } catch {
    return []
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
  const emails = extractSearchResultsFromHtml(html).slice(0, limit)

  // Update cache
  cacheSearchResults(query, emails)

  return {
    data: emails,
    _cache: createNetworkMetadata(),
  }
}
