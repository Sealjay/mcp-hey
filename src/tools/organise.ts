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

    // Set aside is typically a PUT/POST to a specific endpoint
    const response = await heyClient.put(
      `/entries/${emailId}/set_aside`,
      undefined,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      return { success: true }
    }
    if (response.status === 302) {
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
      return { success: true }
    }
    if (response.status === 302) {
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
      return { success: true }
    }
    if (response.status === 302) {
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

export async function removeFromReplyLater(
  emailId: string,
): Promise<OrganiseResult> {
  if (!emailId) {
    return { success: false, error: "Email ID is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const response = await heyClient.delete(
      `/entries/${emailId}/reply_later`,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      return { success: true }
    }
    if (response.status === 302) {
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
    const csrfToken = await heyClient.getCsrfToken()

    const formData = new URLSearchParams()
    formData.append("sender_email", senderEmail)

    // Screen in approves the sender
    const response = await heyClient.post(
      "/screener/approvals",
      formData,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      return { success: true }
    }
    if (response.status === 302) {
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

export async function screenOut(senderEmail: string): Promise<OrganiseResult> {
  if (!senderEmail) {
    return { success: false, error: "Sender email is required" }
  }

  try {
    const csrfToken = await heyClient.getCsrfToken()

    const formData = new URLSearchParams()
    formData.append("sender_email", senderEmail)

    // Screen out rejects the sender
    const response = await heyClient.post(
      "/screener/rejections",
      formData,
      csrfToken,
    )

    if (response.status >= 200 && response.status < 300) {
      return { success: true }
    }
    if (response.status === 302) {
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
      return { success: true }
    }
    if (response.status === 302) {
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
      return { success: true }
    }
    if (response.status === 302) {
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
