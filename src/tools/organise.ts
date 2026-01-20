import { invalidateForAction, updateReadStatus } from "../cache"
import { heyClient } from "../hey-client"

export interface OrganiseResult {
  success: boolean
  error?: string
}

export async function setAside(emailId: string): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    // Try multiple endpoints - Hey may use topics or entries
    const endpoints = [
      `/topics/${emailId}/set_aside`,
      `/entries/${emailId}/set_aside`,
      `/topics/${emailId}/status/set_aside`,
    ]

    let response: Response | null = null
    let lastError: string | null = null

    for (const endpoint of endpoints) {
      try {
        // Try POST first (like bubble_up), then PUT
        response = await heyClient.post(endpoint, undefined, csrfToken)
        if (response.status >= 200 && response.status < 400) {
          break // Success
        }
        // Try PUT as fallback
        response = await heyClient.put(endpoint, undefined, csrfToken)
        if (response.status >= 200 && response.status < 400) {
          break // Success
        }
        lastError = `${endpoint} returned ${response.status}`
      } catch (err) {
        lastError = `${endpoint} failed: ${err instanceof Error ? err.message : "Unknown"}`
      }
    }

    if (!response) {
      return { success: false, error: lastError || "All endpoints failed" }
    }

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("set_aside", emailId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("set_aside", emailId)
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

export async function replyLater(emailId: string): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.put(
      `/entries/${emailId}/reply_later`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("reply_later", emailId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("reply_later", emailId)
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

export async function removeFromSetAside(
  emailId: string,
): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.delete(
      `/entries/${emailId}/set_aside`,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("set_aside", emailId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("set_aside", emailId)
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
    // Get the box_id from the Reply Later page (account-specific)
    const boxId = await getReplyLaterBoxId()
    if (!boxId) {
      return {
        success: false,
        error:
          "Could not determine box_id from Reply Later page. The page structure may have changed.",
      }
    }

    const csrfToken = await heyClient.getCsrfToken()

    // Use POST /postings/moves?box_id={boxId} with posting_ids form field
    const formData = new URLSearchParams()
    formData.append("posting_ids", postingId)

    const response = await heyClient.post(
      `/postings/moves?box_id=${boxId}`,
      formData,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("reply_later", postingId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("reply_later", postingId)
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

export async function screenIn(senderEmail: string): Promise<OrganiseResult> {
  if (!senderEmail) {
    return { success: false, error: "Sender email is required" }
  }

  try {
    // First, we need to find the clearance ID for this sender
    // by fetching the screener page and looking for the email
    const clearanceId = await findClearanceIdByEmail(senderEmail)
    if (!clearanceId) {
      return {
        success: false,
        error: `Sender ${senderEmail} not found in screener. Use hey_list_screener to see pending senders.`,
      }
    }

    // Use the clearance ID to screen in
    return screenInById(clearanceId)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
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

  // Find forms that contain the sender email
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

  // Also try looking in the surrounding article/section for the email
  const articles = root.querySelectorAll(
    "article, section, [data-clearance-id]",
  )
  for (const article of articles) {
    const articleText = article.text.toLowerCase()
    if (articleText.includes(senderEmail.toLowerCase())) {
      // Find clearance ID in nested form
      const form = article.querySelector("form[action*='/clearances/']")
      const action = form?.getAttribute("action")
      const match = action?.match(/\/clearances\/(\d+)/)
      if (match) {
        return match[1]
      }
      // Or from data attribute
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
    // First, we need to find the clearance ID for this sender
    const clearanceId = await findClearanceIdByEmail(senderEmail)
    if (!clearanceId) {
      return {
        success: false,
        error: `Sender ${senderEmail} not found in screener. Use hey_list_screener to see pending senders.`,
      }
    }

    // Use the clearance ID to screen out
    return screenOutById(clearanceId)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

export async function screenOutById(
  clearanceId: string,
): Promise<OrganiseResult> {
  if (!clearanceId) {
    return { success: false, error: "Clearance ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    // Hey uses POST with _method=patch and status=denied for screen out
    const formData = new URLSearchParams()
    formData.append("_method", "patch")
    formData.append("status", "denied")

    const response = await heyClient.post(
      `/clearances/${clearanceId}`,
      formData,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("delete") // Screened out emails are removed
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("delete")
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

export async function markAsRead(emailId: string): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.put(
      `/entries/${emailId}/read`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      updateReadStatus(emailId, true)
      return { success: true }
    }
    if (response.status === 302) {
      updateReadStatus(emailId, true)
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

export async function markAsUnread(emailId: string): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.delete(
      `/entries/${emailId}/read`,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      updateReadStatus(emailId, false)
      return { success: true }
    }
    if (response.status === 302) {
      updateReadStatus(emailId, false)
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

export async function trashEmail(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/topics/${topicId}/status/trashed`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("trash", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("trash", topicId)
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

export async function restoreFromTrash(
  topicId: string,
): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/topics/${topicId}/status/active`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("restore", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("restore", topicId)
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

export async function markAsSpam(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/topics/${topicId}/status/spam`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("spam", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("spam", topicId)
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

export async function markAsNotSpam(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/topics/${topicId}/status/ham`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("restore", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("restore", topicId)
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

export async function markAsUnseen(topicId: string): Promise<OrganiseResult> {
  if (!topicId) {
    return { success: false, error: "Topic ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/topics/${topicId}/unseen`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      updateReadStatus(topicId, false)
      return { success: true }
    }
    if (response.status === 302) {
      updateReadStatus(topicId, false)
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

export type BubbleUpSlot =
  | "now"
  | "today"
  | "tomorrow"
  | "weekend"
  | "next_week"

export async function bubbleUp(
  postingId: string,
  slot: BubbleUpSlot,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }
  if (!slot) {
    return { success: false, error: "Slot is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    // Correct endpoint: POST /postings/bubble_up?posting_ids[]={id}&slot={slot}
    const response = await heyClient.post(
      `/postings/bubble_up?posting_ids[]=${postingId}&slot=${slot}`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("bubble_up", postingId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("bubble_up", postingId)
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

export async function ignoreThread(postingId: string): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/postings/${postingId}/muting`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("mute", postingId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("mute", postingId)
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

export async function unignoreThread(
  postingId: string,
): Promise<OrganiseResult> {
  if (!postingId) {
    return { success: false, error: "Posting ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.delete(
      `/postings/${postingId}/muting`,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("unmute", postingId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("unmute", postingId)
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

export async function screenInById(
  clearanceId: string,
): Promise<OrganiseResult> {
  if (!clearanceId) {
    return { success: false, error: "Clearance ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    // Hey uses POST with _method=patch and status=approved for screen in
    const formData = new URLSearchParams()
    formData.append("_method", "patch")
    formData.append("status", "approved")

    const response = await heyClient.post(
      `/clearances/${clearanceId}`,
      formData,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("archive") // Screener changes affect imbox
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("archive")
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
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/topics/${topicId}/collecting?collection_id=${collectionId}`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("collection", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("collection", topicId)
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
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.delete(
      `/topics/${topicId}/collecting?collection_id=${collectionId}`,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("collection", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("collection", topicId)
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
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.post(
      `/topics/${topicId}/filings?folder_id=${labelId}`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("label", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("label", topicId)
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
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.delete(
      `/topics/${topicId}/filings?folder_id=${labelId}`,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      invalidateForAction("label", topicId)
      return { success: true }
    }
    if (response.status === 302) {
      invalidateForAction("label", topicId)
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
