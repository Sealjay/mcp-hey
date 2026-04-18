import { parse as parseHtml } from "node-html-parser"
import { HeyError } from "./errors"
import {
  type Session,
  ensureValidSession,
  getCookieHeader,
  loadSession,
  runAuthHelper,
} from "./session"

const BASE_URL = "https://app.hey.com"

// Browser-identical headers for Chrome 130 on macOS
function getBrowserHeaders(session: Session): Record<string, string> {
  return {
    Host: "app.hey.com",
    "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-GB,en;q=0.9",
    Cookie: getCookieHeader(session),
  }
}

function getAjaxHeaders(
  session: Session,
  csrfToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Host: "app.hey.com",
    "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Accept: "text/html, application/xhtml+xml",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-GB,en;q=0.9",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "empty",
    "X-Requested-With": "XMLHttpRequest",
    Cookie: getCookieHeader(session),
  }

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken
  }

  return headers
}

interface RateLimitInfo {
  remaining: number
  limit: number
  until?: number
}

// Proactive rate limiter state
const rateLimiter = {
  lastRequestTime: 0,
  minIntervalMs: 100, // Minimum 100ms between requests
  remainingQuota: 100, // Start with conservative estimate
  quotaResetTime: 0,
}

function parseRateLimitHeaders(response: Response): RateLimitInfo | null {
  const remaining = response.headers.get("x-ratelimit-remaining")
  const limit = response.headers.get("x-ratelimit-limit")

  if (remaining && limit) {
    return {
      remaining: Number.parseInt(remaining, 10),
      limit: Number.parseInt(limit, 10),
      until: response.headers.get("x-ratelimit-reset")
        ? Number.parseInt(response.headers.get("x-ratelimit-reset")!, 10)
        : undefined,
    }
  }
  return null
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Proactive rate limiting - waits if we're approaching limits.
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now()

  // Check if quota has reset (assume 60s window if no reset time known)
  if (rateLimiter.quotaResetTime > 0 && now > rateLimiter.quotaResetTime) {
    rateLimiter.remainingQuota = 100
    rateLimiter.quotaResetTime = 0
  }

  // Enforce minimum interval between requests
  const timeSinceLastRequest = now - rateLimiter.lastRequestTime
  if (timeSinceLastRequest < rateLimiter.minIntervalMs) {
    await sleep(rateLimiter.minIntervalMs - timeSinceLastRequest)
  }

  // If quota is low, add progressive delays
  if (rateLimiter.remainingQuota < 20) {
    const delayMs = Math.max(
      0,
      Math.min(500, (20 - rateLimiter.remainingQuota) * 50),
    )
    await sleep(delayMs)
  }

  // Decrement quota optimistically (will be corrected by response headers)
  rateLimiter.remainingQuota = Math.max(0, rateLimiter.remainingQuota - 1)
  rateLimiter.lastRequestTime = Date.now()
}

/**
 * Update rate limiter state from response headers.
 */
function updateRateLimiter(rateLimit: RateLimitInfo): void {
  rateLimiter.remainingQuota = rateLimit.remaining
  if (rateLimit.until) {
    rateLimiter.quotaResetTime = rateLimit.until * 1000
  }
}

async function backoff(attempt: number): Promise<void> {
  const baseDelay = 2 ** attempt * 1000
  const jitter = Math.random() * 500
  await sleep(baseDelay + jitter)
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null
  let lastStatus = 0

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Proactive rate limiting before request
      await waitForRateLimit()

      const response = await fetch(url, options)

      // Check rate limiting from response
      const rateLimit = parseRateLimitHeaders(response)
      if (rateLimit) {
        updateRateLimiter(rateLimit)

        if (rateLimit.remaining === 0 && rateLimit.until) {
          const waitMs = rateLimit.until * 1000 - Date.now()
          if (waitMs > 0) {
            console.error(`[mcp-hey] Rate limited, waiting ${waitMs}ms`)
            await sleep(waitMs)
            continue
          }
        }
      }

      // Retry transient HTTP failures. 429 without rate-limit headers falls
      // here too; 4xx other than 429 are returned for callers to handle.
      if (response.status >= 500 || response.status === 429) {
        lastStatus = response.status
        if (attempt < maxRetries - 1) {
          console.error(
            `[mcp-hey] HTTP ${response.status}, retrying (attempt ${attempt + 1}/${maxRetries})`,
          )
          await backoff(attempt)
          continue
        }
        throw new HeyError(
          response.status === 429 ? "rate_limited" : "transient",
          `Request failed with status ${response.status}`,
          response.status,
        )
      }

      return response
    } catch (err) {
      if (err instanceof HeyError) throw err
      lastError = err as Error
      await backoff(attempt)
    }
  }

  if (lastStatus) {
    throw new HeyError(
      lastStatus === 429 ? "rate_limited" : "transient",
      `Request failed with status ${lastStatus}`,
      lastStatus,
    )
  }
  throw lastError ?? new HeyError("transient", "Request failed after retries")
}

// CSRF token cache TTL (5 minutes)
const CSRF_TOKEN_TTL_MS = 5 * 60 * 1000

export class HeyClient {
  private session: Session | null = null
  private cachedCsrfToken: string | null = null
  private csrfTokenExpiry = 0

  async ensureSession(): Promise<Session> {
    if (!this.session) {
      this.session = await ensureValidSession()
    }
    if (!this.session) {
      throw new Error("Failed to authenticate with Hey.com")
    }
    return this.session
  }

  async refreshSession(): Promise<void> {
    const success = await runAuthHelper()
    if (success) {
      this.session = await loadSession()
    }
  }

  private async handleResponse(response: Response): Promise<Response> {
    // Check for redirect to sign_in (session expired)
    const location = response.headers.get("location")
    if (response.status === 302 && location?.includes("/sign_in")) {
      console.error("[mcp-hey] Session expired, refreshing...")
      await this.refreshSession()
      throw new Error("Session expired, please retry")
    }
    return response
  }

  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const session = await this.ensureSession()
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`

    const response = await fetchWithRetry(url, {
      ...options,
      headers: {
        ...getBrowserHeaders(session),
        ...(options.headers || {}),
      },
      redirect: "manual",
    })

    return this.handleResponse(response)
  }

  async fetchHtml(path: string, maxRedirects = 5): Promise<string> {
    let currentPath = path
    let redirectCount = 0

    while (redirectCount < maxRedirects) {
      const response = await this.fetch(currentPath)

      console.error(
        `[mcp-hey] fetchHtml ${currentPath}: status=${response.status}`,
      )

      // Handle redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location")
        console.error(`[mcp-hey] Redirect to: ${location}`)

        if (!location) {
          throw new Error(`Redirect without location header for ${currentPath}`)
        }

        // Check for auth redirect
        if (location.includes("/sign_in")) {
          console.error("[mcp-hey] Session expired (redirect to sign_in)")
          await this.refreshSession()
          throw new Error("Session expired, please retry")
        }

        // Follow the redirect
        // Handle relative URLs
        if (location.startsWith("/")) {
          currentPath = location
        } else if (location.startsWith("http")) {
          // Absolute URL - extract path
          const url = new URL(location)
          if (url.hostname !== "app.hey.com") {
            throw new Error(
              `Unexpected redirect to different host: ${location}`,
            )
          }
          currentPath = url.pathname + url.search
        } else {
          currentPath = location
        }

        redirectCount++
        continue
      }

      // Check for HTTP errors (404, 500, etc.)
      if (!response.ok) {
        const body = await response.text()
        console.error(
          `[mcp-hey] HTTP error body (first 500 chars): ${body.slice(0, 500)}`,
        )
        throw new Error(`HTTP ${response.status}: Failed to fetch ${path}`)
      }

      return response.text()
    }

    throw new Error(`Too many redirects (${maxRedirects}) for ${path}`)
  }

  async getCsrfToken(): Promise<string> {
    // Return cached token if still valid
    if (this.cachedCsrfToken && Date.now() < this.csrfTokenExpiry) {
      return this.cachedCsrfToken
    }

    const html = await this.fetchHtml("/imbox")
    const root = parseHtml(html)
    const meta = root.querySelector('meta[name="csrf-token"]')

    if (!meta) {
      throw new Error("CSRF token not found")
    }

    const token = meta.getAttribute("content")
    if (!token) {
      throw new Error("CSRF token is empty")
    }

    // Cache the token
    this.cachedCsrfToken = token
    this.csrfTokenExpiry = Date.now() + CSRF_TOKEN_TTL_MS

    return token
  }

  /**
   * Invalidate the cached CSRF token.
   * Call this if a request fails with a CSRF error.
   */
  invalidateCsrfToken(): void {
    this.cachedCsrfToken = null
    this.csrfTokenExpiry = 0
  }

  async post(
    path: string,
    body?: URLSearchParams | FormData,
    csrfToken?: string,
  ): Promise<Response> {
    const session = await this.ensureSession()
    const token = csrfToken || (await this.getCsrfToken())
    const url = `${BASE_URL}${path}`

    const headers: Record<string, string> = {
      ...getAjaxHeaders(session, token),
    }

    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
    }

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: body?.toString(),
      redirect: "manual",
    })

    return this.handleResponse(response)
  }

  async postForm(
    path: string,
    body?: URLSearchParams | FormData,
    csrfToken?: string,
  ): Promise<Response> {
    const session = await this.ensureSession()
    const token = csrfToken || (await this.getCsrfToken())
    const url = `${BASE_URL}${path}`

    const headers: Record<string, string> = {
      ...getBrowserHeaders(session),
      "X-CSRF-Token": token,
      Origin: BASE_URL,
      Referer: `${BASE_URL}/imbox`,
    }

    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
    }

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: body?.toString(),
      redirect: "manual",
    })

    return this.handleResponse(response)
  }

  async postTurbo(
    path: string,
    body?: URLSearchParams | FormData,
    csrfToken?: string,
  ): Promise<Response> {
    const session = await this.ensureSession()
    const token = csrfToken || (await this.getCsrfToken())
    const url = `${BASE_URL}${path}`

    const headers: Record<string, string> = {
      ...getBrowserHeaders(session),
      Accept: "text/vnd.turbo-stream.html, text/html, application/xhtml+xml",
      "X-CSRF-Token": token,
      Origin: BASE_URL,
      Referer: `${BASE_URL}/imbox`,
    }

    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
    }

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: body?.toString(),
      redirect: "manual",
    })

    return this.handleResponse(response)
  }

  async delete(path: string, csrfToken?: string): Promise<Response> {
    const session = await this.ensureSession()
    const token = csrfToken || (await this.getCsrfToken())
    const url = `${BASE_URL}${path}`

    const response = await fetchWithRetry(url, {
      method: "DELETE",
      headers: getAjaxHeaders(session, token),
      redirect: "manual",
    })

    return this.handleResponse(response)
  }

  async put(
    path: string,
    body?: URLSearchParams | FormData,
    csrfToken?: string,
  ): Promise<Response> {
    const session = await this.ensureSession()
    const token = csrfToken || (await this.getCsrfToken())
    const url = `${BASE_URL}${path}`

    const headers: Record<string, string> = {
      ...getAjaxHeaders(session, token),
    }

    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
    }

    const response = await fetchWithRetry(url, {
      method: "PUT",
      headers,
      body: body?.toString(),
      redirect: "manual",
    })

    return this.handleResponse(response)
  }
}

// Export singleton instance
export const heyClient = new HeyClient()
