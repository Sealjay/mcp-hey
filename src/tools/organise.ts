import { parse as parseHtml } from "node-html-parser"
import { invalidateForAction, updateReadStatus } from "../cache"
import type { invalidateForAction as invalidateForActionFn } from "../cache/messages"
import { toUserError } from "../errors"
import { heyClient } from "../hey-client"
import {
  organiseResponseToResult,
  tryEndpoints,
  withCsrfRetry,
} from "./http-helpers"

export interface OrganiseResult {
  success: boolean
  error?: string
}

type CacheAction = Parameters<typeof invalidateForActionFn>[0]

/**
 * Create a URLSearchParams with a `_method` override appended.
 */
function methodOverrideBody(
  method: "put" | "patch" | "delete",
): URLSearchParams {
  const params = new URLSearchParams()
  params.append("_method", method)
  return params
}

/**
 * Common pattern for setting a topic status via a `_method=put` POST.
 */
async function setTopicStatus(
  topicId: string,
  status: string,
  cacheAction: CacheAction,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const formData = methodOverrideBody("put")

    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/status/${status}`, formData),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction(cacheAction, topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function setAside(id: string): Promise<OrganiseResult> {
  if (!id) {
    return { success: false, error: "ID is required" }
  }

  try {
    const boxId = await getBoxId("asidebox")
    if (boxId) {
      const response = await withCsrfRetry(() =>
        heyClient.post(`/topics/${id}/moves?box_id=${boxId}`),
      )
      if (response.ok || response.status === 302) {
        return organiseResponseToResult(response, () =>
          invalidateForAction("set_aside", id),
        )
      }
    }

    const response = await withCsrfRetry(() =>
      tryEndpoints(
        [
          `/topics/${id}/set_aside`,
          `/entries/${id}/set_aside`,
          `/topics/${id}/status/set_aside`,
        ],
        async (endpoint) => {
          const post = await heyClient.post(endpoint)
          if (post.ok || post.status === 302) return post
          return heyClient.put(endpoint)
        },
      ),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("set_aside", id),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function replyLater(id: string): Promise<OrganiseResult> {
  if (!id) {
    return { success: false, error: "ID is required" }
  }

  try {
    const boxId = await getBoxId("laterbox")
    if (boxId) {
      const response = await withCsrfRetry(() =>
        heyClient.post(`/topics/${id}/moves?box_id=${boxId}`),
      )
      if (response.ok || response.status === 302) {
        return organiseResponseToResult(response, () =>
          invalidateForAction("reply_later", id),
        )
      }
    }

    const response = await withCsrfRetry(() =>
      tryEndpoints(
        [`/entries/${id}/reply_later`, `/topics/${id}/reply_later`],
        (endpoint) => heyClient.put(endpoint),
      ),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("reply_later", id),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function removeFromSetAside(
  postingId: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const boxId = await getBoxId("imbox")
    if (!boxId) {
      return {
        success: false,
        error:
          "Could not determine box_id. The page structure may have changed.",
      }
    }

    const formData = new URLSearchParams()
    formData.append("posting_ids", postingId)

    const response = await withCsrfRetry(() =>
      heyClient.post(`/postings/moves?box_id=${boxId}`, formData),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("set_aside", postingId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function removeFromReplyLater(
  postingId: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const boxId = await getBoxId("imbox")
    if (!boxId) {
      return {
        success: false,
        error:
          "Could not determine box_id. The page structure may have changed.",
      }
    }

    const formData = new URLSearchParams()
    formData.append("posting_ids", postingId)

    const response = await withCsrfRetry(() =>
      heyClient.post(`/postings/moves?box_id=${boxId}`, formData),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("reply_later", postingId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function screenIn(senderEmail: string): Promise<OrganiseResult> {
  if (!senderEmail) {
    return { success: false, error: "Sender email is required" }
  }

  try {
    const clearanceId = await findClearanceIdByEmail(senderEmail)
    if (!clearanceId) {
      return {
        success: false,
        error: `Sender ${senderEmail} not found in screener. Use hey_list_screener to see pending senders.`,
      }
    }

    return screenInById(clearanceId)
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

/**
 * Find a clearance ID by sender email from the screener page.
 */
async function findClearanceIdByEmail(
  senderEmail: string,
): Promise<string | null> {
  const html = await heyClient.fetchHtml("/clearances")
  const root = parseHtml(html)

  const forms = root.querySelectorAll("form[action*='/clearances/']")
  for (const form of forms) {
    const formHtml = form.toString().toLowerCase()
    if (formHtml.includes(senderEmail.toLowerCase())) {
      const action = form.getAttribute("action")
      const match = action?.match(/\/clearances\/(\d+)/)
      if (match) {
        return match[1]
      }
    }
  }

  const articles = root.querySelectorAll(
    "article, section, [data-clearance-id]",
  )
  for (const article of articles) {
    const articleText = article.text.toLowerCase()
    if (articleText.includes(senderEmail.toLowerCase())) {
      const form = article.querySelector("form[action*='/clearances/']")
      const action = form?.getAttribute("action")
      const match = action?.match(/\/clearances\/(\d+)/)
      if (match) {
        return match[1]
      }
      const clearanceId = article.getAttribute("data-clearance-id")
      if (clearanceId) {
        return clearanceId
      }
    }
  }

  return null
}

export async function screenOut(senderEmail: string): Promise<OrganiseResult> {
  if (!senderEmail) {
    return { success: false, error: "Sender email is required" }
  }

  try {
    const clearanceId = await findClearanceIdByEmail(senderEmail)
    if (!clearanceId) {
      return {
        success: false,
        error: `Sender ${senderEmail} not found in screener. Use hey_list_screener to see pending senders.`,
      }
    }

    return screenOutById(clearanceId)
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function screenOutById(
  clearanceId: string,
): Promise<OrganiseResult> {
  if (!clearanceId) {
    return { success: false, error: "Clearance ID is required" }
  }

  try {
    const formData = methodOverrideBody("patch")
    formData.append("status", "denied")

    const response = await withCsrfRetry(() =>
      heyClient.post(`/clearances/${clearanceId}`, formData),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("archive"),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function markAsRead(emailId: string): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.put(`/entries/${emailId}/read`),
    )

    return organiseResponseToResult(response, () =>
      updateReadStatus(emailId, true),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function markAsUnread(emailId: string): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.delete(`/entries/${emailId}/read`),
    )

    return organiseResponseToResult(response, () =>
      updateReadStatus(emailId, false),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export function trashEmail(topicId: string): Promise<OrganiseResult> {
  return setTopicStatus(topicId, "trashed", "trash")
}

export function restoreFromTrash(topicId: string): Promise<OrganiseResult> {
  return setTopicStatus(topicId, "active", "restore")
}

export function markAsSpam(topicId: string): Promise<OrganiseResult> {
  return setTopicStatus(topicId, "spam", "spam")
}

export function markAsNotSpam(topicId: string): Promise<OrganiseResult> {
  return setTopicStatus(topicId, "ham", "restore")
}

export async function markAsUnseen(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/unseen`),
    )

    return organiseResponseToResult(response, () =>
      updateReadStatus(topicId, false),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export type BubbleUpSlot =
  | "now"
  | "today"
  | "tomorrow"
  | "weekend"
  | "next_week"
  | "surprise_me"
  | "custom"

/**
 * Validate a date string in YYYY-MM-DD format.
 */
function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false
  }
  const date = new Date(dateStr)
  return !Number.isNaN(date.getTime())
}

export async function bubbleUp(
  postingId: string,
  slot: BubbleUpSlot,
  date?: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "ID is required" }
  }
  if (!slot) {
    return { success: false, error: "Slot is required" }
  }
  if (slot === "custom" && !date) {
    return {
      success: false,
      error: "Date is required when using 'custom' slot (YYYY-MM-DD format)",
    }
  }
  if (date && !isValidDate(date)) {
    return {
      success: false,
      error: "Date must be in YYYY-MM-DD format",
    }
  }

  try {
    if (slot === "now") {
      const response = await withCsrfRetry(() =>
        heyClient.post(`/topics/${postingId}/bubble_up_now`),
      )
      if (response.ok || response.status === 302) {
        return organiseResponseToResult(response, () =>
          invalidateForAction("bubble_up", postingId),
        )
      }
    }

    // The "now" case already returned above on success, so this is the fallback
    const endpoint = `/topics/${postingId}/bubble_up?slot=${slot}`

    let formData: URLSearchParams | undefined
    if (slot === "custom" && date) {
      formData = new URLSearchParams()
      formData.append("date", date)
    }

    const response = await withCsrfRetry(() =>
      heyClient.post(endpoint, formData),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("bubble_up", postingId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function popBubble(postingId: string): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const formData = methodOverrideBody("delete")

    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${postingId}/bubble_up`, formData),
    )
    if (response.ok || response.status === 302) {
      return organiseResponseToResult(response, () =>
        invalidateForAction("bubble_up", postingId),
      )
    }

    const fallbackEndpoint = `/postings/bubble_up?posting_ids[]=${postingId}`
    const fallbackResponse = await withCsrfRetry(() =>
      heyClient.delete(fallbackEndpoint),
    )

    return organiseResponseToResult(fallbackResponse, () =>
      invalidateForAction("bubble_up", postingId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

/**
 * Schedule an email to bubble up ONLY if there's no reply by a specific date.
 */
export async function bubbleUpIfNoReply(
  postingId: string,
  date: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "ID is required" }
  }
  if (!date) {
    return { success: false, error: "Date is required (YYYY-MM-DD format)" }
  }
  if (!isValidDate(date)) {
    return {
      success: false,
      error: "Date must be in YYYY-MM-DD format",
    }
  }

  try {
    const formData = new URLSearchParams()
    formData.append("date", date)

    const response = await withCsrfRetry(() =>
      heyClient.post(
        `/topics/${postingId}/bubble_up?slot=custom&waiting_on=true`,
        formData,
      ),
    )
    if (response.ok || response.status === 302) {
      return organiseResponseToResult(response, () =>
        invalidateForAction("bubble_up", postingId),
      )
    }

    const fallbackResponse = await withCsrfRetry(() =>
      heyClient.post(
        `/postings/bubble_up?posting_ids[]=${postingId}&slot=custom&waiting_on=true`,
        formData,
      ),
    )

    return organiseResponseToResult(fallbackResponse, () =>
      invalidateForAction("bubble_up", postingId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function ignoreThread(postingId: string): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/postings/${postingId}/muting`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("mute", postingId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function unignoreThread(
  postingId: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.delete(`/postings/${postingId}/muting`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("unmute", postingId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function screenInById(
  clearanceId: string,
): Promise<OrganiseResult> {
  if (!clearanceId) {
    return { success: false, error: "Clearance ID is required" }
  }

  try {
    const formData = methodOverrideBody("patch")
    formData.append("status", "approved")

    const response = await withCsrfRetry(() =>
      heyClient.post(`/clearances/${clearanceId}`, formData),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("archive"),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

const boxIdCache: Record<string, string> = {}

async function getBoxId(targetKey: string): Promise<string | null> {
  if (boxIdCache[targetKey]) return boxIdCache[targetKey]

  const html = await heyClient.fetchHtml("/imbox")
  const root = parseHtml(html)

  const forms = root.querySelectorAll("form[action*='/postings/moves']")
  for (const form of forms) {
    const target = form.getAttribute("data-bulk-actions-target")
    const action = form.getAttribute("action")
    const match = action?.match(/box_id=(\d+)/)
    if (target && match) {
      if (target.includes("trailbox")) boxIdCache.trailbox = match[1]
      if (target.includes("asidebox")) boxIdCache.asidebox = match[1]
      if (target.includes("laterbox")) boxIdCache.laterbox = match[1]
      if (target.includes("imbox")) boxIdCache.imbox = match[1]
      if (target.includes("feedbox")) boxIdCache.feedbox = match[1]
    }
  }
  return boxIdCache[targetKey] || null
}

export type MoveDestination = "imbox" | "feed" | "paper_trail"

const destinationBoxKey: Record<MoveDestination, string> = {
  imbox: "imbox",
  feed: "feedbox",
  paper_trail: "trailbox",
}

const destinationCacheAction: Record<MoveDestination, CacheAction> = {
  imbox: "restore",
  feed: "feed",
  paper_trail: "paper_trail",
}

export async function moveTo(
  topicId: string,
  destination: MoveDestination,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  const boxKey = destinationBoxKey[destination]
  if (!boxKey) {
    return {
      success: false,
      error: `Invalid destination: ${destination}. Must be imbox, feed, or paper_trail.`,
    }
  }

  try {
    const boxId = await getBoxId(boxKey)
    if (!boxId) {
      return {
        success: false,
        error: `Could not determine box_id for ${destination}. The page structure may have changed.`,
      }
    }

    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/moves?box_id=${boxId}`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction(destinationCacheAction[destination], topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function addToCollection(
  topicId: string,
  collectionId: string,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }
  if (!collectionId) {
    return { success: false, error: "Collection ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(
        `/topics/${topicId}/collecting?collection_id=${collectionId}`,
      ),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("collection", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function removeFromCollection(
  topicId: string,
  collectionId: string,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }
  if (!collectionId) {
    return { success: false, error: "Collection ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.delete(
        `/topics/${topicId}/collecting?collection_id=${collectionId}`,
      ),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("collection", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function addLabel(
  topicId: string,
  labelId: string,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }
  if (!labelId) {
    return { success: false, error: "Label ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/filings?folder_id=${labelId}`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("label", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

async function findFilingId(
  topicId: string,
  labelId: string,
): Promise<string | null> {
  const { listLabels } = await import("./read")
  const labels = await listLabels()
  const label = labels.find((l) => l.id === labelId)
  if (!label) return null

  const html = await heyClient.fetchHtml(`/topics/${topicId}/filings`)
  const root = parseHtml(html)

  const forms = root.querySelectorAll("form[action*='/filings/']")
  for (const form of forms) {
    const button = form.querySelector("button")
    const ariaLabel = button?.getAttribute("aria-label") || ""
    if (ariaLabel.includes(label.name)) {
      const action = form.getAttribute("action")
      const match = action?.match(/\/filings\/(\d+)/)
      if (match) return match[1]
    }
  }

  if (forms.length === 1) {
    const action = forms[0].getAttribute("action")
    const match = action?.match(/\/filings\/(\d+)/)
    if (match) return match[1]
  }

  return null
}

export async function removeLabel(
  topicId: string,
  labelId: string,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }
  if (!labelId) {
    return { success: false, error: "Label ID is required" }
  }

  try {
    const filingId = await findFilingId(topicId, labelId)
    if (filingId) {
      const formData = methodOverrideBody("delete")

      const response = await withCsrfRetry(() =>
        heyClient.post(`/topics/${topicId}/filings/${filingId}`, formData),
      )

      if (response.ok || response.status === 302) {
        return organiseResponseToResult(response, () =>
          invalidateForAction("label", topicId),
        )
      }
    }

    const response = await withCsrfRetry(() =>
      heyClient.delete(`/topics/${topicId}/filings?folder_id=${labelId}`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("label", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}
