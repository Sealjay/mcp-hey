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

export interface Collection {
  id: string
  name: string
}

export interface SearchOptions {
  limit?: number
  forceRefresh?: boolean
}

function extractEmailsFromHtml(html: string): Email[] {
  try {
    const root = parseHtml(html)
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
      })
    }

    // Fallback for screener page: extract clearance entries from article elements
    // Hey.com screener page structure (from browser inspection):
    // <article>
    //   <button>
    //     <img alt="sender@email.com">
    //     <h2>sender@email.com <sender@email.com></h2>  <!-- SENDER EMAIL -->
    //     <div>Subject Line</div>
    //     <div>– Snippet text...</div>
    //   </button>
    //   <a href="/contacts/...">recipient@email.com</a>  <!-- IGNORE: this is the user -->
    //   <form action="/clearances/{id}">
    //     <input type="hidden" value="patch">
    //     <input type="hidden" value="approved">
    //     <!-- or clearance ID in a hidden input -->
    //   </form>
    // </article>
    if (emails.length === 0) {
      const articles = root.querySelectorAll("article")

      for (const article of articles) {
        // Look for the heading with the "email <email>" pattern - this is the SENDER
        const headings = article.querySelectorAll("h1, h2, h3, h4, h5, h6")
        let fromEmail = ""
        let from = ""

        for (const heading of headings) {
          const headingText = heading.text?.trim() || ""
          // Match "email <email>" pattern
          const emailPattern =
            /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/
          const emailMatch = headingText.match(emailPattern)
          if (emailMatch) {
            fromEmail = emailMatch[2] || emailMatch[1]
            from = fromEmail.split("@")[0]
            break
          }
        }

        // If no heading match, try the image alt attribute (also contains sender email)
        if (!fromEmail) {
          const img = article.querySelector("img[alt*='@']")
          const imgAlt = img?.getAttribute("alt") || ""
          const imgEmailMatch = imgAlt.match(
            /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
          )
          if (imgEmailMatch) {
            fromEmail = imgEmailMatch[1]
            from = fromEmail.split("@")[0]
          }
        }

        if (!fromEmail) continue // No sender email found, skip this article

        // Find clearance ID - try form action first, then hidden inputs
        let clearanceId = ""
        const forms = article.querySelectorAll("form")
        for (const form of forms) {
          const action = form.getAttribute("action") || ""
          const actionMatch = action.match(/\/clearances\/(\d+)/)
          if (actionMatch) {
            clearanceId = actionMatch[1]
            break
          }
          // Also check hidden inputs for clearance ID (numeric value that's not "patch"/"approved"/"denied")
          const hiddenInputs = form.querySelectorAll("input[type='hidden']")
          for (const input of hiddenInputs) {
            const value = input.getAttribute("value") || ""
            if (/^\d{5,}$/.test(value)) {
              // Looks like a clearance ID (long numeric)
              clearanceId = value
              break
            }
          }
          if (clearanceId) break
        }

        if (!clearanceId) continue // No clearance ID found, skip

        // Extract subject and snippet from article text
        // Get all text, then look for content after the email heading
        const articleText = article.text || ""

        // Find the subject - it's the line after the email, before the dash
        // Skip button text like "Yes", "No", "Screen in", etc.
        const lines = articleText
          .split(/\n/)
          .map((l) => l.trim())
          .filter((l) => l)
        let subject = "(Screener entry)"
        let snippet = ""

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          // Skip the email header line
          if (line.includes(fromEmail)) continue
          // Skip button/action text
          if (/^(Yes|No|Screen\s+(in|out)|Done|Clear)/i.test(line)) continue
          // Skip recipient email links
          if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(line))
            continue
          // Skip dates
          if (
            /^(January|February|March|April|May|June|July|August|September|October|November|December)/i.test(
              line,
            )
          )
            continue
          // Skip navigation items
          if (/^(Imbox|The Feed|Paper Trail|Reply Later|Set Aside)/i.test(line))
            continue

          // This might be the subject line
          if (line.startsWith("–")) {
            // This is the snippet
            snippet = line.slice(1).trim()
          } else if (
            line.length > 10 &&
            !line.includes("Screen") &&
            !line.includes("options for")
          ) {
            subject = line
            // Look for snippet in next line
            if (i + 1 < lines.length && lines[i + 1].startsWith("–")) {
              snippet = lines[i + 1].slice(1).trim()
            }
            break
          }
        }

        emails.push({
          id: clearanceId,
          clearanceId,
          from,
          fromEmail,
          subject,
          snippet,
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
    console.error("[hey-mcp] Failed to parse labels HTML:", err)
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
    console.error("[hey-mcp] Failed to parse collections HTML:", err)
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

  // Fetch from network - try /topics first (most common ID type), then /messages
  let content = ""
  const isRawText = format === "text"

  if (format === "text") {
    // For text format, only /messages supports .text extension
    content = await heyClient.fetchHtml(`/messages/${id}.text`)
  } else {
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
        console.error(`[hey-mcp] Trying endpoint: ${endpoint}`)
        content = await heyClient.fetchHtml(endpoint)
        console.error(`[hey-mcp] Success with endpoint: ${endpoint}`)
        break // Success - exit the loop
      } catch (err) {
        lastError = err as Error
        console.error(`[hey-mcp] ${endpoint} failed:`, (err as Error).message)
      }
    }

    if (!content && lastError) {
      throw lastError
    }
  }

  const email = extractEmailDetail(content, id, isRawText)

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

    const items = root.querySelectorAll(
      "a.action-group__action--envelope",
    )

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
      const subjectEl = item.querySelector(
        "span.u-min-width > span",
      )
      const subject = subjectEl?.text?.trim() || "(No subject)"

      // Sender from small element
      const senderEl = item.querySelector(
        "span.u-min-width > small",
      )
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
