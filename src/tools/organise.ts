import { invalidateForAction, updateReadStatus } from "../cache"
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

export async function setAside(entryId: string): Promise<OrganiseResult> {
  if (!entryId) {
    return { success: false, error: "Entry ID is required" }
  }

  try {
    const endpoints = [
      `/topics/${entryId}/set_aside`,
      `/entries/${entryId}/set_aside`,
      `/topics/${entryId}/status/set_aside`,
    ]

    const response = await withCsrfRetry(() =>
      tryEndpoints(endpoints, async (endpoint) => {
        const post = await heyClient.post(endpoint)
        if (post.ok || post.status === 302) return post
        return heyClient.put(endpoint)
      }),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("set_aside", entryId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function replyLater(entryId: string): Promise<OrganiseResult> {
  if (!entryId) {
    return { success: false, error: "Entry ID is required" }
  }

  try {
    const endpoints = [
      `/entries/${entryId}/reply_later`,
      `/topics/${entryId}/reply_later`,
    ]

    const response = await withCsrfRetry(() =>
      tryEndpoints(endpoints, (endpoint) => heyClient.put(endpoint)),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("reply_later", entryId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

/**
 * Extract the box_id for the "Done" action from the Set Aside page.
 * The box_id is account-specific and found in the form action URL.
 */
async function getSetAsideBoxId(): Promise<string | null> {
  const html = await heyClient.fetchHtml("/set_aside")
  const { parse: parseHtml } = await import("node-html-parser")
  const root = parseHtml(html)

  // Find the form that contains the "Done" button - it has action like /postings/moves?box_id=XXX
  const forms = root.querySelectorAll("form[action*='/postings/moves']")
  for (const form of forms) {
    const action = form.getAttribute("action")
    const match = action?.match(/box_id=(\d+)/)
    if (match) {
      return match[1]
    }
  }
  return null
}

export async function removeFromSetAside(
  postingId: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const boxId = await getSetAsideBoxId()
    if (!boxId) {
      return {
        success: false,
        error:
          "Could not determine box_id from Set Aside page. The page structure may have changed.",
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

/**
 * Extract the box_id for the "Done" action from the Reply Later page.
 * The box_id is account-specific and found in the form action URL.
 */
async function getReplyLaterBoxId(): Promise<string | null> {
  const html = await heyClient.fetchHtml("/reply_later")
  const { parse: parseHtml } = await import("node-html-parser")
  const root = parseHtml(html)

  // Find the form that contains the "Done" button - it has action like /postings/moves?box_id=XXX
  const forms = root.querySelectorAll("form[action*='/postings/moves']")
  for (const form of forms) {
    const action = form.getAttribute("action")
    const match = action?.match(/box_id=(\d+)/)
    if (match) {
      return match[1]
    }
  }
  return null
}

export async function removeFromReplyLater(
  postingId: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const boxId = await getReplyLaterBoxId()
    if (!boxId) {
      return {
        success: false,
        error:
          "Could not determine box_id from Reply Later page. The page structure may have changed.",
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
  const { parse: parseHtml } = await import("node-html-parser")
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
    const formData = new URLSearchParams()
    formData.append("_method", "patch")
    formData.append("status", "denied")

    const response = await withCsrfRetry(() =>
      heyClient.post(`/clearances/${clearanceId}`, formData),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("delete"),
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

export async function trashEmail(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/status/trashed`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("trash", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function restoreFromTrash(
  topicId: string,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/status/active`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("restore", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function markAsSpam(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/status/spam`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("spam", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
}

export async function markAsNotSpam(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/status/ham`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("restore", topicId),
    )
  } catch (err) {
    return { success: false, error: toUserError(err) }
  }
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
    return { success: false, error: "Posting ID is required" }
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
    const endpoint = `/postings/bubble_up?posting_ids[]=${postingId}&slot=${slot}`

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

/**
 * Pop (dismiss) a bubbled-up email so it sinks back into the Imbox.
 */
export async function popBubble(postingId: string): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const endpoint = `/postings/bubble_up?posting_ids[]=${postingId}`
    const response = await withCsrfRetry(() => heyClient.delete(endpoint))

    return organiseResponseToResult(response, () =>
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
    return { success: false, error: "Posting ID is required" }
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
    const endpoint = `/postings/bubble_up?posting_ids[]=${postingId}&slot=custom&waiting_on=true`

    const formData = new URLSearchParams()
    formData.append("date", date)

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
    const formData = new URLSearchParams()
    formData.append("_method", "patch")
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

export async function moveTopicToPaperTrail(
  topicId: string,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const response = await withCsrfRetry(() =>
      heyClient.post(`/topics/${topicId}/status/paper_trail`),
    )

    return organiseResponseToResult(response, () =>
      invalidateForAction("paper_trail", topicId),
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
