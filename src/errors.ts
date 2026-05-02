export type HeyErrorCode =
  | "auth_required"
  | "rate_limited"
  | "transient"
  | "csrf_stale"
  | "request_failed"

export class HeyError extends Error {
  constructor(
    public code: HeyErrorCode,
    public detail: string,
    public status?: number,
  ) {
    super(detail)
    this.name = "HeyError"
  }
}

export function toUserError(err: unknown): string {
  if (err instanceof HeyError) return err.detail
  if (err instanceof Error) return err.message
  return "Unknown error"
}

/**
 * Redact URLs, bearer tokens, emails, and absolute filesystem paths from
 * an error message before returning it to an MCP client. Hey's application
 * paths like "/imbox" or "/topics/123" are intentionally left intact.
 */
export function sanitiseError(error: unknown): string {
  if (!(error instanceof Error)) return "An unknown error occurred"
  return error.message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/Bearer \S+/g, "[token]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]")
    .replace(
      /\/(?:home|Users|etc|var|tmp|root|opt|private|srv|run|proc)\/\S+/g,
      "[path]",
    )
    .replace(/[A-Z]:\\\S+/g, "[path]")
}
