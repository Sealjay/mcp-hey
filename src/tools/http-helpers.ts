import { HeyError } from "../errors"
import { heyClient } from "../hey-client"
import type { OrganiseResult } from "./organise"

/**
 * Run a write request; on a 422 (stale CSRF), invalidate the cached token
 * and retry once. Callers must not pre-fetch the CSRF token — the client
 * will fetch a fresh one on the retry.
 */
export async function withCsrfRetry(
  fn: () => Promise<Response>,
): Promise<Response> {
  const response = await fn()
  if (response.status === 422) {
    heyClient.invalidateCsrfToken()
    return fn()
  }
  return response
}

/**
 * Try endpoints in order, returning the first Response whose status is ok
 * or 302. Returns the last Response if none succeed. Throws only if the
 * endpoint list is empty.
 */
export async function tryEndpoints(
  endpoints: string[],
  attempt: (endpoint: string) => Promise<Response>,
): Promise<Response> {
  let last: Response | undefined
  for (const endpoint of endpoints) {
    last = await attempt(endpoint)
    if (last.ok || last.status === 302) return last
  }
  if (!last) {
    throw new HeyError("request_failed", "no endpoints attempted")
  }
  return last
}

/**
 * Convert a write Response into the tool's result shape. `onSuccess` runs
 * only on 2xx or 302 (Hey returns 302 on successful form submits).
 */
export function organiseResponseToResult(
  response: Response,
  onSuccess: () => void,
): OrganiseResult {
  if (response.ok || response.status === 302) {
    onSuccess()
    return { success: true }
  }
  return {
    success: false,
    error: `Request failed with status ${response.status}`,
  }
}
