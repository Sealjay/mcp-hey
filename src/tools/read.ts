import { type HTMLElement, parse as parseHtml } from "node-html-parser"
import {
  type CachedResult,
  type CacheMetadata,
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
import {
  capThreadEntries,
  cleanEntryBody,
  DEFAULT_MAX_CHARS_PER_ENTRY,
  DEFAULT_MAX_CHARS_TOTAL,
  MAX_TEXT_SOURCE_CHARS,
} from "./text-extract"

export interface Email {
  id: string // Primary ID (topic ID when available, otherwise best available)
  topicId?: string // For /topics/{id}/* operations (bubble_up, trash, etc.)
  entryId?: string // For /entries/{id}/* operations (set_aside, reply_later, read)
  postingId?: string // For /postings/{id}/* operations (muting)
  from: string
  fromEmail?: string
  to?: string // Recipient, only populated for folder="sent"
  toEmail?: string
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
  truncated?: boolean
}

export interface ListOptions {
  limit?: number
  page?: number
  forceRefresh?: boolean
}

export interface Label {
  id: string
  name: string
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

export function extractEmailsFromHtml(
  htmlOrRoot: string | HTMLElement,
  folder?: string,
): Email[] {
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

      // 3. Topic ID from href links within the article. Try selectors in
      // order of specificity, stopping at the first one that yields a match.
      let topicId: string | undefined
      const topicLinkSelectors = [
        "a[href*='/topics/']",
        ".posting__title a[href*='/topics/'], .posting__link[href*='/topics/']",
        "a[href]",
      ]
      for (const selector of topicLinkSelectors) {
        const link = entry.querySelector(selector)
        const href = link?.getAttribute("href") || ""
        const topicMatch = href.match(/\/topics\/(\d+)/)
        if (topicMatch) {
          topicId = topicMatch[1]
          break
        }
      }

      // Drafts have no topic/entry/posting ID — Hey addresses them by
      // message ID via the row's /messages/{id}/edit link instead. Without
      // this, every draft entry falls through with no id and is dropped.
      let messageId: string | undefined
      if (!topicId && !entryId && !postingId) {
        const messageLink = entry.querySelector("a[href*='/messages/']")
        if (messageLink) {
          const href = messageLink.getAttribute("href") || ""
          const messageMatch = href.match(/\/messages\/(\d+)/)
          if (messageMatch) {
            messageId = messageMatch[1]
          }
        }
      }

      // Primary ID: prefer topic ID > entry ID > posting ID > message ID
      const id = topicId || entryId || postingId || messageId
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
      const identity = senderEl?.text?.trim() || senderFromAvatar || "Unknown"

      // Extract identity email from avatar alt if present
      const emailMatch = avatarAlt.match(/<([^>]+@[^>]+)>/)
      const identityEmail = emailMatch?.[1]

      // On Sent, every row was sent by the account owner — that's true
      // regardless of what the list markup shows, so it needs no parsing.
      // The name/email this markup actually surfaces (.posting__detail /
      // avatar alt) is the recipient there, not the sender, so it belongs
      // under `to`/`toEmail` instead of being mislabelled as `from`.
      // ponytail: unverified against a real Sent page (live check was
      // blocked by sandboxed credential access) — Drafts uses the same
      // .posting__detail slot but renders the literal placeholder "Me"
      // there instead of a name, so skip that case rather than relabel a
      // placeholder as a recipient. Re-check against a real mailbox and
      // drop this guard if Sent never shows "Me".
      const isSent = folder === "sent"
      const isPlaceholder = /^me$/i.test(identity)
      const from = isSent ? "Me" : identity
      const fromEmail = isSent ? undefined : identityEmail
      const to = isSent && !isPlaceholder ? identity : undefined
      const toEmail = isSent && !isPlaceholder ? identityEmail : undefined

      // Snippet/preview is in .posting__summary
      const snippetEl = entry.querySelector(".posting__summary")
      const snippet = snippetEl?.text?.trim()

      // Date is in .posting__time or time element
      const timeEl = entry.querySelector(".posting__time, time")
      const date = timeEl?.getAttribute("datetime") || timeEl?.text?.trim()

      // Unread (unseen) status. Hey no longer exposes a `posting--unread`
      // class; instead each unseen posting carries a screen-reader marker
      // element `<span id="unseen_posting_{postingId}">`. Its presence is the
      // reliable per-item unread signal (read postings omit it entirely).
      const unread = entry.querySelector("[id^='unseen_posting_']") !== null

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
        to,
        toEmail,
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

/**
 * Hey's "New for you" (Power Through) count — what the UI calls *new*.
 *
 * The `/imbox` first page only renders the bubbled-up section, so the new/unseen
 * tally is NOT derivable from it. Hey exposes the count on the dedicated
 * `/imbox/unseen` ("Power Through New") view, which declares its size via
 * `data-list-size-value` and has no pagination. A plain GET of that view is
 * non-mutating (verified: the count is stable across repeated GETs); only
 * advancing through the messages marks them seen.
 *
 * Note: this is Hey's *new* count, distinct from the total never-opened backlog
 * (every posting carries an `unseen_posting_` marker — see extractEmailsFromHtml).
 */
export function extractUnseenCount(html: string): number {
  const declared = html.match(/data-list-size-value="(\d+)"/)
  if (declared) return Number.parseInt(declared[1], 10)
  // Fallback: count rendered unseen entry blocks if the attribute is absent.
  return parseHtml(html).querySelectorAll(".entry__wrapper").length
}

function extractImboxSummary(html: string, unseenCount = 0): ImboxSummary {
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

  // Separate bubbled up emails from regular emails. `newCount` comes from the
  // /imbox/unseen view (passed in) — it can't be computed from the first imbox
  // page, which contains only the bubbled-up section.
  const bubbledUpEmails = emails.filter((e) => e.bubbledUp)

  return {
    screenerCount,
    bubbledUpCount: bubbledUpEmails.length,
    newCount: unseenCount,
    emails,
    bubbledUpEmails,
  }
}

const MAX_MIME_DEPTH = 10
const MAX_MIME_PARTS = 200

function decodeMimeBytes(body: string, encoding: string): Uint8Array {
  const enc = encoding.toLowerCase().trim()
  if (enc === "base64") {
    return new Uint8Array(Buffer.from(body.replace(/\s/g, ""), "base64"))
  }
  if (enc === "quoted-printable") {
    const folded = body.replace(/=\r?\n/g, "")
    const bytes: number[] = []
    const raw = Buffer.from(folded, "latin1")
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0x3d) {
        const hex = raw.toString("latin1", i + 1, i + 3)
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          bytes.push(Number.parseInt(hex, 16))
          i += 2
          continue
        }
      }
      bytes.push(raw[i])
    }
    return Uint8Array.from(bytes)
  }
  return Uint8Array.from(Buffer.from(body, "utf8"))
}

function decodeMimeText(
  body: string,
  encoding: string,
  charset: string,
): string {
  const bytes = decodeMimeBytes(body, encoding)
  try {
    return new TextDecoder(charset as "utf-8").decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
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

function splitMultipartBody(body: string, boundary: string): string[] {
  const boundaryLine = new RegExp(
    `^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(--)?[\\t ]*$`,
  )
  const parts: string[] = []
  let current: string[] | null = null
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(boundaryLine)
    if (match) {
      if (current) parts.push(current.join("\n"))
      if (parts.length >= MAX_MIME_PARTS) break
      if (match[1]) break
      current = []
    } else if (current) {
      current.push(line)
    }
  }
  return parts
}

function extractTextFromMimeRecursive(
  content: string,
  depth = 0,
  partCount = { value: 0 },
): { text: string; kind: "plain" | "html" } | undefined {
  if (
    depth > MAX_MIME_DEPTH ||
    partCount.value >= MAX_MIME_PARTS ||
    !/\r?\n\r?\n/.test(content)
  ) {
    return undefined
  }
  const { headers, bodyStart } = parseMimeHeaders(content)
  const rawContentType = headers["content-type"] || "text/plain"
  const ct = rawContentType.toLowerCase()
  const encoding = headers["content-transfer-encoding"] || "7bit"
  const body = content.split("\n").slice(bodyStart).join("\n")
  if (/^multipart\//i.test(ct)) {
    const boundary = rawContentType.match(/boundary="?([^";\s]+)"?/i)?.[1]
    if (!boundary) return undefined
    const results: { text: string; kind: "plain" | "html" }[] = []
    for (const part of splitMultipartBody(body, boundary)) {
      partCount.value += 1
      if (partCount.value > MAX_MIME_PARTS) break
      const result = extractTextFromMimeRecursive(part, depth + 1, partCount)
      if (result?.text) results.push(result)
    }
    return results.find((result) => result.kind === "plain") ?? results[0]
  }

  if (/^attachment\b/i.test(headers["content-disposition"] || "")) {
    return undefined
  }
  const charset =
    rawContentType.match(/charset="?([^";\s]+)"?/i)?.[1] || "utf-8"
  const decoded = decodeMimeText(body, encoding, charset).trim()
  if (!decoded) return undefined
  if (/^text\/plain\b/i.test(ct)) return { text: decoded, kind: "plain" }
  if (/^text\/html\b/i.test(ct)) return { text: decoded, kind: "html" }
  return undefined
}

function decodeHeaderWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (_match, charset: string, encoding: string, payload: string) => {
        const bytes =
          encoding.toLowerCase() === "b"
            ? new Uint8Array(Buffer.from(payload, "base64"))
            : decodeMimeBytes(payload.replace(/_/g, " "), "quoted-printable")
        try {
          return new TextDecoder(charset as "utf-8").decode(bytes)
        } catch {
          return new TextDecoder("utf-8").decode(bytes)
        }
      },
    )
}

/**
 * Parse raw email text format (MIME) to extract body and headers.
 * Handles quoted-printable, base64, and multipart MIME messages.
 */
function parseRawEmailText(
  rawText: string,
  keepQuoted = false,
): {
  from: string
  fromEmail?: string
  subject: string
  body: string
  date?: string
  to?: string[]
} {
  if (rawText.length > MAX_TEXT_SOURCE_CHARS) {
    throw new Error("Email MIME content exceeds the maximum parsing size")
  }
  if (!/\r?\n\r?\n/.test(rawText)) {
    throw new Error("Malformed MIME message: missing header/body separator")
  }
  const { headers } = parseMimeHeaders(rawText)

  const fromHeader = headers.from || ""
  const fromMatch = fromHeader.match(/^([^<]+)?<?([^>]+@[^>]+)?>?$/)
  const from =
    decodeHeaderWords(fromMatch?.[1]?.trim()?.replace(/^"|"$/g, "") || "") ||
    "Unknown"
  const fromEmail = fromMatch?.[2]

  const subject = decodeHeaderWords(headers.subject || "") || "(No subject)"
  const date = headers.date

  const toHeader = headers.to || ""
  const to = toHeader
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)

  const body = extractTextFromMimeRecursive(rawText)?.text || ""

  return {
    from,
    fromEmail,
    subject,
    body: cleanEntryBody(body, keepQuoted),
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
 * Hey.com paginates listings with an opaque, base64-encoded keyset cursor
 * embedded in a `/?page=<token>` link — NOT an integer page number. Sending
 * `?page=2` is silently ignored and returns the first page again. Extract the
 * "next page" cursor href so callers can follow real pagination.
 */
export function extractNextCursor(html: string): string | null {
  const match = html.match(/href="(\/\?page=[^"]+)"/)
  return match ? match[1].replace(/&amp;/g, "&") : null
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

  // Fetch from network. Hey paginates via an opaque base64 cursor, so to reach
  // page N we fetch the first page and follow the embedded "next" cursor N-1
  // times. (The legacy `?page=<int>` is ignored by Hey and just repeats page 1.)
  let html = await heyClient.fetchHtml(path)
  for (let current = 1; current < page; current++) {
    const next = extractNextCursor(html)
    if (!next) break // no further pages
    html = await heyClient.fetchHtml(next)
  }
  const emails = extractEmailsFromHtml(html, folder).slice(0, limit)

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

  // Check cache first (unless force refresh requested). We need both the imbox
  // page (bubbled-up + screener) and the /imbox/unseen page (new count); only
  // serve from cache when both are fresh, otherwise refetch both.
  if (!forceRefresh) {
    const cachedHtml = getCachedFolderHtml("imbox")
    const cachedUnseen = getCachedFolderHtml("imbox_unseen")
    if (cachedHtml && cachedUnseen) {
      const summary = extractImboxSummary(
        cachedHtml.html,
        extractUnseenCount(cachedUnseen.html),
      )
      return {
        data: summary,
        _cache: cachedHtml.metadata,
      }
    }
  }

  // Fetch from network. The new count lives on /imbox/unseen, so fetch both in
  // parallel (a GET of the unseen view is read-only — it does not mark seen).
  const [html, unseenHtml] = await Promise.all([
    heyClient.fetchHtml("/imbox"),
    heyClient.fetchHtml("/imbox/unseen"),
  ])
  const summary = extractImboxSummary(html, extractUnseenCount(unseenHtml))

  // Cache both pages for future summary requests, plus the extracted messages.
  cacheFolderHtml("imbox", html)
  cacheFolderHtml("imbox_unseen", unseenHtml)
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

export async function listSent(
  options: ListOptions = {},
): Promise<CachedResult<Email[]>> {
  return listFolder("sent", "/sent", options)
}

function extractIdNameLinks(
  html: string,
  urlSegment: string,
  skipNames: string[],
): { id: string; name: string }[] {
  const root = parseHtml(html)
  const results: { id: string; name: string }[] = []

  const links = root.querySelectorAll(`a[href*='/${urlSegment}/']`)
  const idPattern = new RegExp(`/${urlSegment}/(\\d+)`)

  for (const link of links) {
    const href = link.getAttribute("href")
    const match = href?.match(idPattern)
    if (!match) continue

    const id = match[1]
    const name = link.text?.trim() || "Unnamed"

    if (skipNames.includes(name)) continue

    results.push({ id, name })
  }

  return results
}

function extractLabelsFromHtml(html: string): Label[] {
  try {
    // Hey.com labels page has links to /folders/{id}. Skip "New label" and
    // the "All Labels" navigation link.
    return extractIdNameLinks(html, "folders", ["New label", "All Labels"])
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
    // Collections page has links to /collections/{id}. Skip the "All
    // Collections" navigation link.
    return extractIdNameLinks(html, "collections", ["All Collections"])
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
  keepQuoted?: boolean
  maxCharsPerEntry?: number
  maxCharsTotal?: number
}

export const MAX_THREAD_ENTRIES = 50
export const MAX_CHARS_PER_ENTRY = 10_000
export const MAX_CHARS_TOTAL = 50_000
const DEFAULT_MAX_ENTRIES = 20
const MAX_THREAD_HTML_CHARS = 2_000_000
const THREAD_FETCH_CONCURRENCY = 4

const messageIdCache = new Map<string, string>()

interface ThreadMessageId {
  entryId: string
  messageId: string
}

function isEntryBodyNode(node: HTMLElement): boolean {
  const classes = node.getAttribute("class") || ""
  return (
    node.rawTagName?.toLowerCase() === "message-content" ||
    /(?:^|\s)(?:entry__content|trix-content)(?:$|\s)/.test(classes)
  )
}

function isInsideEntryBody(node: HTMLElement): boolean {
  let parent = node.parentNode as HTMLElement | null
  while (parent) {
    if (isEntryBodyNode(parent)) return true
    parent = parent.parentNode as HTMLElement | null
  }
  return false
}

/**
 * Read message IDs only from actual entry records on the requested topic page.
 * User-authored links in the page body and unrelated navigation are not IDs.
 */
function extractThreadMessageIds(
  html: string,
  requestedTopicId: string,
  allowRelatedTopic = false,
): ThreadMessageId[] {
  if (html.length > MAX_THREAD_HTML_CHARS) {
    throw new Error("Email thread page exceeds the maximum parsing size")
  }
  const root = parseHtml(html)
  const pageTopicId = root
    .querySelectorAll("[data-topic-id]")
    .find((element) => !isInsideEntryBody(element))
    ?.getAttribute("data-topic-id")
    ?.replace(/^topic_/, "")
  if (pageTopicId && pageTopicId !== requestedTopicId && !allowRelatedTopic) {
    return []
  }

  const entries = root.querySelectorAll(
    ".entry.entry--sheet, article.entry[data-entry-id]",
  )
  const found: ThreadMessageId[] = []
  const seen = new Set<string>()
  for (const entry of entries.slice(0, MAX_THREAD_ENTRIES)) {
    if (isInsideEntryBody(entry)) continue
    const rawEntryId =
      entry.getAttribute("data-entry-id") ||
      entry.getAttribute("id")?.match(/^entry_(.+)$/)?.[1]
    const entryId = rawEntryId?.replace(/^entry_/, "")
    if (!entryId || !/^[A-Za-z0-9_-]+$/.test(entryId)) continue
    if (seen.has(entryId)) continue
    seen.add(entryId)

    let messageId =
      entry.getAttribute("data-message-id")?.match(/^[A-Za-z0-9_-]+$/)?.[0] ||
      ""
    for (const link of entry.querySelectorAll("a[href]")) {
      if (isInsideEntryBody(link)) continue
      const href = link.getAttribute("href") || ""
      const match = href.match(/^\/messages\/([A-Za-z0-9_-]+)(?:\/|$)/)
      if (match) {
        messageId ||= match[1]
        break
      }
    }

    if (allowRelatedTopic && entryId !== requestedTopicId) continue
    found.push({ entryId, messageId: messageId || entryId })
  }
  return found
}

function extractOwnedPageTopicId(html: string): string | undefined {
  if (html.length > MAX_THREAD_HTML_CHARS) {
    throw new Error("Email thread page exceeds the maximum parsing size")
  }
  const root = parseHtml(html)
  const topic = root
    .querySelectorAll("[data-topic-id]")
    .find((element) => !isInsideEntryBody(element))
    ?.getAttribute("data-topic-id")
    ?.replace(/^topic_/, "")
  return topic && /^[A-Za-z0-9_-]+$/.test(topic) ? topic : undefined
}

async function resolveThreadMessageIds(id: string): Promise<ThreadMessageId[]> {
  let topicPageFetched = false
  try {
    const topicHtml = await heyClient.fetchHtml(`/topics/${id}`)
    topicPageFetched = true
    const messages = extractThreadMessageIds(topicHtml, id)
    if (messages.length > 0) return messages
  } catch (err) {
    if (err instanceof Error && /maximum parsing size/.test(err.message)) {
      throw err
    }
    console.error("[mcp-hey] Topic page fetch failed for", id, err)
  }
  if (topicPageFetched) return []

  for (const endpoint of [`/entries/${id}`, `/postings/${id}`]) {
    try {
      const html = await heyClient.fetchHtml(endpoint)
      const relatedTopicId = extractOwnedPageTopicId(html)
      if (relatedTopicId && relatedTopicId !== id) {
        const topicHtml = await heyClient.fetchHtml(`/topics/${relatedTopicId}`)
        const messages = extractThreadMessageIds(topicHtml, relatedTopicId)
        if (messages.length > 0) return messages
      }

      const entryMessages = extractThreadMessageIds(html, id, true)
      if (entryMessages.length > 0) return entryMessages
    } catch (err) {
      if (err instanceof Error && /maximum parsing size/.test(err.message)) {
        throw err
      }
      console.error(`[mcp-hey] ${endpoint} fetch failed for ${id}:`, err)
    }
  }
  return []
}

export async function resolveMessageId(id: string): Promise<string> {
  const cached = messageIdCache.get(id)
  if (cached) return cached

  try {
    const message = (await resolveThreadMessageIds(id))[0]?.messageId
    if (message) {
      messageIdCache.set(id, message)
      return message
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
  const {
    format = "html",
    forceRefresh = false,
    maxEntries,
    keepQuoted = false,
    maxCharsPerEntry = DEFAULT_MAX_CHARS_PER_ENTRY,
    maxCharsTotal = DEFAULT_MAX_CHARS_TOTAL,
  } = options
  const entryLimit = Math.max(
    1,
    Math.min(Math.floor(maxEntries ?? DEFAULT_MAX_ENTRIES), MAX_THREAD_ENTRIES),
  )
  const perEntryLimit = Math.max(
    1,
    Math.min(Math.floor(maxCharsPerEntry), MAX_CHARS_PER_ENTRY),
  )
  const totalLimit = Math.max(
    1,
    Math.min(Math.floor(maxCharsTotal), MAX_CHARS_TOTAL),
  )

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
    let threadMessages = await resolveThreadMessageIds(id)

    // Non-topic IDs (entry, posting, or message IDs) may identify one message
    // directly. The endpoint remains scoped to that ID rather than page links.
    if (threadMessages.length === 0) {
      threadMessages = [{ entryId: id, messageId: id }]
    }
    threadMessages = threadMessages.slice(0, entryLimit)
    messageId = threadMessages[0].messageId

    if (threadMessages[0].messageId !== id) {
      messageIdCache.set(id, threadMessages[0].messageId)
    }

    const entryResults: (ThreadEntry | null)[] = new Array(
      threadMessages.length,
    ).fill(null)
    let nextEntry = 0
    const workers = Array.from(
      { length: Math.min(THREAD_FETCH_CONCURRENCY, threadMessages.length) },
      async () => {
        while (nextEntry < threadMessages.length) {
          const index = nextEntry++
          const { entryId, messageId: entryMessageId } = threadMessages[index]
          try {
            const raw = await heyClient.fetchHtml(
              `/messages/${entryMessageId}.text`,
            )
            if (raw.length > MAX_TEXT_SOURCE_CHARS) {
              throw new Error(
                "Email MIME content exceeds the maximum parsing size",
              )
            }
            const parsed = parseRawEmailText(raw, keepQuoted)
            if (!parsed.body)
              throw new Error("Message has no readable text body")
            const probe = probeAttachmentsFromRaw(raw, entryMessageId)
            entryResults[index] = {
              entryId,
              from: parsed.from,
              fromEmail: parsed.fromEmail,
              to: parsed.to,
              subject: parsed.subject,
              date: parsed.date,
              body: parsed.body,
              attachments: probe.attachments,
              calendar_invites: probe.calendar_invites,
            }
          } catch (err) {
            console.error(
              "[mcp-hey] Entry fetch failed for",
              entryMessageId,
              err,
            )
          }
        }
      },
    )
    await Promise.all(workers)

    const parsedEntries = entryResults.filter(
      (e): e is ThreadEntry => e !== null,
    )
    if (parsedEntries.length === 0) {
      throw new Error(`No readable entries found for email ${id}`)
    }

    const first = parsedEntries[0]
    const truncated = capThreadEntries(parsedEntries, perEntryLimit, totalLimit)

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
      subject: first.subject || "(No subject)",
      body: "",
      date: first?.date,
      entries: parsedEntries,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      calendar_invites:
        allCalendarInvites.length > 0 ? allCalendarInvites : undefined,
      truncated: truncated || undefined,
    }

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

  if (content.length > MAX_THREAD_HTML_CHARS) {
    throw new Error("Email content exceeds the maximum parsing size")
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
      const threadMessage = extractThreadMessageIds(content, id)[0]?.messageId
      if (threadMessage) {
        messageId = threadMessage
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
