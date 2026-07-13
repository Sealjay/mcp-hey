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
  /**
   * Every sender alias the account owns, lowercased. The active
   * `senderEmail` is always present. Used so reply recipient resolution
   * treats *all* of the user's addresses as "self" — otherwise a thread
   * where the latest prior message came from an alias is mistaken for an
   * external sender and the reply loops back to the user.
   */
  selfEmails: ReadonlySet<string>
}

// Cache account info per session (doesn't change)
const accountInfoCache: { value: AccountInfo | null } = { value: null }

/**
 * Validate an email address format.
 */
export function isValidEmail(email: string): boolean {
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

/** Maximum number of recipients across to/cc/bcc combined. */
const MAX_RECIPIENTS = 50

/**
 * Validate one or more named recipient lists: total count across all lists
 * against MAX_RECIPIENTS (using capLabel in the error, e.g. "to/cc" or
 * "to/cc/bcc"), then each list's email formats (using its own label, e.g.
 * "recipient", "CC", "BCC"). Returns the error string on first failure.
 */
function validateRecipientLists(
  lists: { label: string; emails?: string[] }[],
  capLabel: string,
): string | undefined {
  const totalRecipients = lists.reduce(
    (sum, list) => sum + (list.emails?.length ?? 0),
    0,
  )
  if (totalRecipients > MAX_RECIPIENTS) {
    return `Too many recipients (${totalRecipients}). Maximum is ${MAX_RECIPIENTS} across ${capLabel} combined.`
  }
  for (const list of lists) {
    if (list.emails && list.emails.length > 0) {
      const invalid = findInvalidEmails(list.emails)
      if (invalid.length > 0) {
        return `Invalid ${list.label} email(s): ${invalid.join(", ")}`
      }
    }
  }
  return undefined
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
  // <select name="acting_sender_id">
  //   <option value="123" selected>primary@example.com</option>
  //   <option value="456">alias@example.com</option>
  // </select>
  // Every option is one of the account's sender aliases; we keep the full
  // set so reply recipient resolution can treat them all as "self".
  const senderSelect = root.querySelector("select[name='acting_sender_id']")
  if (senderSelect) {
    const selectedOption =
      senderSelect.querySelector("option[selected]") ||
      senderSelect.querySelector("option") // fallback to first option

    if (selectedOption) {
      const senderId = selectedOption.getAttribute("value")
      const senderEmail = selectedOption.text.trim()

      if (senderId && senderEmail && isValidEmail(senderEmail)) {
        const selfEmails = new Set<string>()
        for (const option of senderSelect.querySelectorAll("option")) {
          const optionEmail = option.text.trim()
          if (optionEmail && isValidEmail(optionEmail)) {
            selfEmails.add(optionEmail.toLowerCase())
          }
        }
        selfEmails.add(senderEmail.toLowerCase())

        debugLog("Extracted account info from select", {
          senderId,
          senderEmail,
          aliasCount: selfEmails.size,
        })
        const accountInfo = { senderId, senderEmail, selfEmails }
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
      selfEmails: new Set([legacySenderEmail.toLowerCase()]),
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
    const accountInfo = {
      senderId: accountId,
      senderEmail: accountEmail,
      selfEmails: new Set([accountEmail.toLowerCase()]),
    }
    accountInfoCache.value = accountInfo
    return accountInfo
  }

  // Debug: Log structure only on failure — never log raw HTML (may contain auth tokens).
  const tagNames = [
    ...new Set(
      (composeHtml.match(/<[a-z][a-z0-9]*/gi) ?? []).map((t) =>
        t.toLowerCase(),
      ),
    ),
  ]
    .sort()
    .join(", ")
  debugLog("Failed to extract account info", {
    htmlLength: composeHtml.length,
    tagsFound: tagNames,
  })

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

/**
 * Classify a Hey.com form submission response: 2xx and non-rejecting 302s
 * are success (invalidating the cache for `cacheAction`), an auth-redirect
 * 302 is a session error, a validation-redirect 302 returns `rejectedMessage`,
 * anything else is a generic status-code error.
 */
function handleFormResponse(
  response: Response,
  cacheAction: Parameters<typeof invalidateForAction>[0],
  rejectedMessage: string,
): SendResult {
  if (response.status >= 200 && response.status < 300) {
    safeInvalidateCache(cacheAction)
    return { success: true }
  }
  if (response.status === 302) {
    const classification = classifyRedirect(response)

    if (classification.type === "auth_failure") {
      return { success: false, error: "Session expired, please retry" }
    }
    if (classification.type === "validation_error") {
      return { success: false, error: rejectedMessage }
    }

    safeInvalidateCache(cacheAction)
    return { success: true, messageId: classification.messageId }
  }
  return {
    success: false,
    error: `Request failed with status ${response.status}`,
  }
}

export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  const { to, subject, body, cc } = params

  if (to.length === 0) {
    return { success: false, error: "At least one recipient is required" }
  }

  const recipientError = validateRecipientLists(
    [
      { label: "recipient", emails: to },
      { label: "CC", emails: cc },
    ],
    "to/cc",
  )
  if (recipientError) {
    return { success: false, error: recipientError }
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

    return handleFormResponse(
      response,
      "send",
      "Hey.com rejected the email (redirected back to compose form)",
    )
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

  const recipientError = validateRecipientLists(
    [
      { label: "recipient", emails: to },
      { label: "CC", emails: cc },
      { label: "BCC", emails: bcc },
    ],
    "to/cc/bcc",
  )
  if (recipientError) {
    return { success: false, error: recipientError }
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

    return handleFormResponse(
      response,
      "forward",
      "Hey.com rejected the forward (redirected back to compose form)",
    )
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
  /**
   * Optional override of the To: line, mirroring Hey's web UI which lets you
   * change the recipient when chasing a thread you started. When omitted, the
   * tool reuses the thread participants (excluding the caller).
   */
  to?: string[]
  /**
   * Optional CC override. Only honoured when `to` is provided.
   */
  cc?: string[]
}

export interface ThreadEntry {
  entryId?: string
  senderEmail?: string
  date?: string // ISO datetime if available, else falls back to position
}

export interface ReplyContext {
  entryId: string
  subject: string
  participantEmails: string[]
  // Email of the sender of the most recent entry that was NOT sent by the user.
  // Used as the primary recipient for replies so we don't accidentally email ourselves.
  latestNonSelfSenderEmail?: string
}

/**
 * Extract every entry in the thread page along with its sender email and date,
 * in DOM order (which mirrors the chronological order Hey renders).
 *
 * Hey's thread page contains one outer wrapper per email (typically
 * article.entry / article.posting / [data-entry-id] / message-content[data-entry-id]).
 * Each wrapper has an avatar with alt="Name <email@example.com>" and a
 * <time datetime="..."> element. The selectors below are intentionally broad
 * because Hey's markup has shifted over time and we need to be tolerant.
 */
const EMAIL_ANGLE_RE = /<([^>\s]+@[^>\s]+)>/
const EMAIL_BARE_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/

function matchEmail(text: string | null | undefined): string | undefined {
  if (!text) return undefined
  const m = text.match(EMAIL_ANGLE_RE) ?? text.match(EMAIL_BARE_RE)
  return m?.[1]?.toLowerCase()
}

/**
 * Find a single sender email within a wrapper. Hey's markup has evolved:
 *   - Current (May 2026+): `<span class="entry__sender-email">…&lt;email&gt;…</span>`
 *     and `<img title="Name <email>">` on the avatar.
 *   - Legacy: `<img class="avatar" alt="Name <email>">`.
 * We try all three sources in order — the first to yield an email wins.
 */
function extractSenderEmailFromScope(
  scope: ReturnType<typeof parseHtml>,
): string | undefined {
  const senderEmailEl = scope.querySelector(".entry__sender-email")
  const fromSpan = matchEmail(senderEmailEl?.text)
  if (fromSpan) return fromSpan

  for (const img of scope.querySelectorAll("img[title*='@']")) {
    const fromTitle = matchEmail(img.getAttribute("title"))
    if (fromTitle) return fromTitle
  }

  for (const avatar of scope.querySelectorAll(
    ".avatar, img.avatar, [class*='avatar'], img[alt*='@']",
  )) {
    const fromAlt = matchEmail(avatar.getAttribute("alt"))
    if (fromAlt) return fromAlt
  }
  return undefined
}

/**
 * Collect every distinct participant email visible within a scope, scanning
 * the same three sources as extractSenderEmailFromScope (sender-email spans,
 * img titles, avatar alt attributes). Used for the page-wide participant
 * sweep that captures recipients/CCs whose own entries may not be parseable.
 */
function collectParticipantEmailsFromScope(
  scope: ReturnType<typeof parseHtml>,
): string[] {
  const emails: string[] = []
  const add = (email: string | undefined) => {
    if (email && !emails.includes(email)) emails.push(email)
  }
  for (const el of scope.querySelectorAll(".entry__sender-email")) {
    add(matchEmail(el.text))
  }
  for (const img of scope.querySelectorAll("img[title*='@']")) {
    add(matchEmail(img.getAttribute("title")))
  }
  for (const avatar of scope.querySelectorAll(
    ".avatar, img.avatar, [class*='avatar']",
  )) {
    add(matchEmail(avatar.getAttribute("alt")))
  }
  return emails
}

export function extractThreadEntries(
  root: ReturnType<typeof parseHtml>,
): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  const seenEntryIds = new Set<string>()

  // Candidate entry wrappers, in priority order. Any wrapper that yields a
  // sender email is good enough; later candidates fill in gaps.
  const wrapperSelectors = [
    "article.entry",
    "article.posting",
    "article[data-entry-id]",
    "[data-entry-id]",
    "message-content[data-entry-id]",
  ]

  for (const selector of wrapperSelectors) {
    for (const wrapper of root.querySelectorAll(selector)) {
      const rawEntryId =
        wrapper.getAttribute("data-entry-id") ??
        wrapper.getAttribute("data-identifier") ??
        ""
      const entryId = rawEntryId.replace(/^(entry_|posting_)/, "") || undefined

      // De-duplicate: a single email can be matched by multiple selectors
      // (e.g. article.entry[data-entry-id] and message-content[data-entry-id]).
      if (entryId && seenEntryIds.has(entryId)) {
        continue
      }

      const senderEmail = extractSenderEmailFromScope(wrapper)

      if (!senderEmail) {
        // No sender email on this wrapper - skip it; we only care about
        // entries we can attribute to a specific sender.
        continue
      }

      // Date from the first time element inside the wrapper (datetime attr
      // preferred; fall back to text content).
      const timeEl = wrapper.querySelector("time")
      const date =
        timeEl?.getAttribute("datetime") ?? timeEl?.text?.trim() ?? undefined

      if (entryId) {
        seenEntryIds.add(entryId)
      }
      entries.push({ entryId, senderEmail, date })
    }
  }

  return entries
}

/**
 * Pick the latest entry whose sender is NOT the user themselves.
 *
 * Order of preference:
 *   1. Highest ISO datetime among non-self entries.
 *   2. Falling back to last DOM-order non-self entry (Hey renders newest
 *      last in the unfurled thread view).
 */
export function findLatestNonSelfSender(
  entries: ThreadEntry[],
  selfEmails: ReadonlySet<string>,
): string | undefined {
  const nonSelf = entries.filter(
    (e) => e.senderEmail && !selfEmails.has(e.senderEmail.toLowerCase()),
  )
  if (nonSelf.length === 0) {
    return undefined
  }

  // Try to sort by ISO datetime when available. Entries without a parseable
  // date keep their DOM order.
  let best: ThreadEntry | undefined
  let bestTs: number | undefined

  for (const entry of nonSelf) {
    const ts = entry.date ? Date.parse(entry.date) : Number.NaN
    if (!Number.isNaN(ts)) {
      if (bestTs === undefined || ts > bestTs) {
        best = entry
        bestTs = ts
      }
    }
  }

  if (best?.senderEmail) {
    return best.senderEmail
  }

  // No parseable dates - take the last non-self entry in DOM order.
  return nonSelf[nonSelf.length - 1].senderEmail
}

/**
 * Resolve who a reply should be addressed to, combining the explicit `to`
 * override with smart auto-detection from the thread.
 *
 * Returns the trimmed list of recipient emails, or an empty array if neither
 * the override nor the auto-detection produced anything addressable. Callers
 * should treat an empty result as a hard error - falling back to the user's
 * own address would silently mail the reply to themselves.
 */
export function resolveReplyRecipients(opts: {
  toOverride: string[] | undefined
  replyContext: ReplyContext
  selfEmails: ReadonlySet<string>
}): string[] {
  const { toOverride, replyContext, selfEmails } = opts

  if (toOverride && toOverride.length > 0) {
    return toOverride.map((email) => email.trim())
  }

  if (replyContext.latestNonSelfSenderEmail) {
    return [replyContext.latestNonSelfSenderEmail]
  }

  return replyContext.participantEmails.filter(
    (email) => !selfEmails.has(email.toLowerCase()),
  )
}

/**
 * Extract reply context from a thread page: entry ID, subject, and participant emails.
 */
async function getReplyContext(
  threadId: string,
  selfEmails: ReadonlySet<string>,
): Promise<ReplyContext> {
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

  // Walk every entry in the thread, collecting per-entry sender info.
  const threadEntries = extractThreadEntries(root)
  const latestNonSelfSenderEmail = findLatestNonSelfSender(
    threadEntries,
    selfEmails,
  )

  // Participant emails: union of every distinct sender we saw, plus a
  // page-wide sweep so we still expose CC/bcc faces even when an
  // entry-level scan is missing.
  const participantEmails: string[] = []
  for (const entry of threadEntries) {
    if (entry.senderEmail && !participantEmails.includes(entry.senderEmail)) {
      participantEmails.push(entry.senderEmail)
    }
  }
  for (const email of collectParticipantEmailsFromScope(root)) {
    if (!participantEmails.includes(email)) {
      participantEmails.push(email)
    }
  }

  debugLog("Reply context", {
    entryId,
    subject,
    participantEmails,
    latestNonSelfSenderEmail,
    threadEntryCount: threadEntries.length,
  })
  return { entryId, subject, participantEmails, latestNonSelfSenderEmail }
}

export async function replyToEmail(params: ReplyParams): Promise<SendResult> {
  const { threadId, body, to: toOverride, cc: ccOverride } = params

  if (!body.trim()) {
    return { success: false, error: "Reply body is required" }
  }

  const recipientError = validateRecipientLists(
    [
      { label: "recipient", emails: toOverride },
      { label: "CC", emails: ccOverride },
    ],
    "to/cc",
  )
  if (recipientError) {
    return { success: false, error: recipientError }
  }

  if (toOverride !== undefined && toOverride.length === 0) {
    return {
      success: false,
      error: "`to` must contain at least one recipient when provided",
    }
  }

  try {
    // Fetch account info first - we need the user's email to identify
    // which entries in the thread are theirs vs the other participants'.
    const accountInfo = await getAccountInfo()
    const replyContext = await getReplyContext(threadId, accountInfo.selfEmails)

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
    //
    // Recipient policy:
    //   1. If `to` override was passed in, honour it verbatim (mirrors Hey's
    //      web UI, which lets you change the To: line when chasing a thread
    //      you started).
    //   2. Otherwise auto-detect: prefer the author of the most recent
    //      non-self entry in the thread, then fall back to any other
    //      participants we found.
    //   3. If we still have nothing, surface the failure with an actionable
    //      error rather than silently posting a topic entry that never
    //      leaves Hey by addressing it back to the caller.
    const recipientEmails = resolveReplyRecipients({
      toOverride,
      replyContext,
      selfEmails: accountInfo.selfEmails,
    })

    if (recipientEmails.length === 0) {
      return {
        success: false,
        error:
          "Could not determine reply recipient from thread participants. Pass `to` with the recipient email address(es) you want to chase.",
      }
    }

    const sendFormData = new URLSearchParams()
    sendFormData.append("_method", "patch")
    sendFormData.append("acting_sender_id", accountInfo.senderId)
    sendFormData.append("remember_last_sender", "true")

    for (const email of recipientEmails) {
      sendFormData.append("entry[addressed][directly][]", email)
    }

    if (ccOverride && ccOverride.length > 0) {
      for (const ccRecipient of ccOverride) {
        sendFormData.append("entry[addressed][copied][]", ccRecipient.trim())
      }
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

export interface DraftFields {
  to?: string[]
  cc?: string[]
  subject?: string
  body?: string
}

export type SaveDraftParams = DraftFields

export interface EditDraftParams extends DraftFields {
  draftId: string
}

export interface DraftResult {
  success: boolean
  draftId?: string
  error?: string
}

function validateDraftFields(fields: DraftFields): string | undefined {
  const totalRecipients = (fields.to?.length ?? 0) + (fields.cc?.length ?? 0)
  if (totalRecipients > MAX_RECIPIENTS) {
    return `Too many recipients (${totalRecipients}). Maximum is ${MAX_RECIPIENTS} across to/cc combined.`
  }
  if (fields.to && fields.to.length > 0) {
    const invalidTo = findInvalidEmails(fields.to)
    if (invalidTo.length > 0) {
      return `Invalid recipient email(s): ${invalidTo.join(", ")}`
    }
  }
  if (fields.cc && fields.cc.length > 0) {
    const invalidCc = findInvalidEmails(fields.cc)
    if (invalidCc.length > 0) {
      return `Invalid CC email(s): ${invalidCc.join(", ")}`
    }
  }
  return undefined
}

function buildDraftFormData(
  fields: DraftFields,
  senderId: string,
): URLSearchParams {
  const formData = new URLSearchParams()
  formData.append("acting_sender_id", senderId)
  for (const recipient of fields.to ?? []) {
    formData.append("entry[addressed][directly][]", recipient.trim())
  }
  for (const ccRecipient of fields.cc ?? []) {
    formData.append("entry[addressed][copied][]", ccRecipient.trim())
  }
  if (fields.subject !== undefined) {
    formData.append("message[subject]", fields.subject)
  }
  if (fields.body !== undefined) {
    formData.append("message[content]", fields.body)
  }
  formData.append("entry[status]", "drafted")
  return formData
}

/**
 * Extract the draft/message ID Hey assigns on creation. Confirmed live
 * 2026-07-12: `POST /messages` with `entry[status]=drafted` (no `commit`
 * field, no `_method`) returns 204 with a `Location: /messages/{id}`
 * header — unlike hey_send_email, which redirects with 302.
 */
export function extractDraftId(response: Response): string | undefined {
  const location = response.headers.get("location") ?? ""
  return location.match(/\/messages\/(\d+)/)?.[1]
}

/**
 * Save a new draft (does not send). Use hey_edit_draft to update it and
 * hey_send_email/hey_reply to send.
 */
export async function saveDraft(params: SaveDraftParams): Promise<DraftResult> {
  const validationError = validateDraftFields(params)
  if (validationError) {
    return { success: false, error: validationError }
  }

  try {
    const accountInfo = await getAccountInfo()
    const formData = buildDraftFormData(params, accountInfo.senderId)

    const response = await withCsrfRetry(() =>
      heyClient.postTurbo("/messages", formData),
    )

    if (!response.ok) {
      return {
        success: false,
        error: `Request failed with status ${response.status}`,
      }
    }

    const draftId = extractDraftId(response)
    safeInvalidateCache("draft")
    return { success: true, draftId }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

/**
 * Update an existing draft's recipients, subject, or body. Fields omitted
 * here are left as-is only if Hey's autosave already persisted them —
 * pass every field you want to keep, since this call replaces subject/body
 * outright rather than merging.
 */
export async function editDraft(params: EditDraftParams): Promise<DraftResult> {
  const { draftId } = params

  if (!draftId) {
    return { success: false, error: "Draft ID is required" }
  }

  const validationError = validateDraftFields(params)
  if (validationError) {
    return { success: false, error: validationError }
  }

  try {
    const accountInfo = await getAccountInfo()
    const formData = buildDraftFormData(params, accountInfo.senderId)
    formData.append("_method", "patch")

    const response = await withCsrfRetry(() =>
      heyClient.postTurbo(`/messages/${draftId}`, formData),
    )

    if (!response.ok) {
      return {
        success: false,
        error: `Request failed with status ${response.status}`,
      }
    }

    safeInvalidateCache("draft")
    return { success: true, draftId }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

/** Permanently delete a draft. This does not go to trash — it's gone. */
export async function deleteDraft(draftId: string): Promise<DraftResult> {
  if (!draftId) {
    return { success: false, error: "Draft ID is required" }
  }

  try {
    const formData = new URLSearchParams()
    formData.append("_method", "delete")

    const response = await withCsrfRetry(() =>
      heyClient.post(`/entries/drafts/${draftId}`, formData),
    )

    if (!response.ok) {
      return {
        success: false,
        error: `Request failed with status ${response.status}`,
      }
    }

    safeInvalidateCache("draft")
    return { success: true, draftId }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}
