/**
 * Attachment and calendar invite handling for Hey.com emails.
 *
 * Hey.com exposes the raw RFC822 message at `/messages/{id}.text`. That
 * endpoint returns multipart MIME with attachments inlined as base64. This
 * module provides:
 *   - A small multipart MIME parser to surface attachment metadata.
 *   - A minimal ICS (RFC 5545) parser focused on VEVENT properties used
 *     in calendar invites.
 *   - `downloadAttachment` to decode a base64 part and write it to disk.
 *   - `getCalendarInvite` to extract and parse the .ics part of a message.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { heyClient } from "../hey-client"

export interface AttachmentMeta {
  /** Stable per-message identifier ("part-{n}" indexed from the multipart walk). */
  id: string
  /** Filename declared in Content-Disposition or Content-Type, sanitised. */
  filename: string
  /** Decoded byte size. */
  size: number
  /** MIME type (e.g. image/png, application/pdf, text/calendar). */
  mime: string
  /** True for text/calendar parts (.ics files). */
  is_calendar: boolean
}

export interface CalendarInviteMeta {
  /** Attachment id (matches AttachmentMeta.id of the .ics part). */
  id: string
  filename: string
  /** SUMMARY line of the first VEVENT, if any. */
  summary?: string
  /** DTSTART of the first VEVENT, ISO-formatted when parseable. */
  start?: string
  /** DTEND of the first VEVENT, ISO-formatted when parseable. */
  end?: string
  /** ATTENDEE addresses (mailto-stripped) of the first VEVENT. */
  attendees: string[]
}

export interface ParsedCalendarInvite {
  title?: string
  start?: string
  end?: string
  location?: string
  attendees: string[]
  organizer?: string
  description?: string
  raw_ics: string
}

/** Internal: one parsed multipart part with decoded body. */
interface MimePart {
  headers: Record<string, string>
  /** Raw (possibly transfer-encoded) body bytes. */
  rawBody: string
  /** Decoded body bytes as a Uint8Array (after base64/qp decoding). */
  decoded: Uint8Array
  /** Decoded body as UTF-8 text (best-effort) for text/* parts. */
  text: string
}

/**
 * Parse a single MIME header block into a lower-cased key/value map.
 * Continuation lines (leading whitespace) are folded into the previous header.
 */
function parseHeaders(headerBlock: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const lines = headerBlock.split(/\r?\n/)
  let lastKey: string | null = null

  for (const line of lines) {
    if (line === "") continue
    if ((line.startsWith(" ") || line.startsWith("\t")) && lastKey) {
      headers[lastKey] += ` ${line.trim()}`
      continue
    }
    const colonIdx = line.indexOf(":")
    if (colonIdx <= 0) continue
    const key = line.slice(0, colonIdx).toLowerCase().trim()
    const value = line.slice(colonIdx + 1).trim()
    headers[key] = value
    lastKey = key
  }

  return headers
}

/**
 * Extract a parameter from a structured header value. Handles quoted and
 * unquoted forms ("name=foo.txt" or "name=\"foo bar.txt\"").
 */
function getHeaderParam(headerValue: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\*?=(?:"([^"]*)"|([^;\\s]+))`, "i")
  const match = headerValue.match(re)
  if (!match) return undefined
  const raw = match[1] ?? match[2]
  if (!raw) return undefined
  // Best-effort RFC 2047 decode for "=?utf-8?...?=" filenames.
  return decodeRfc2047(raw)
}

/**
 * Best-effort RFC 2047 decoder for encoded-word headers like
 * `=?utf-8?B?Zm9v?=` or `=?utf-8?Q?foo?=`.
 */
function decodeRfc2047(input: string): string {
  return input.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, _charset, encoding, payload) => {
      try {
        if (encoding.toUpperCase() === "B") {
          return atob(payload)
        }
        // Q encoding: underscores are spaces, =XX hex.
        return payload
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
          )
      } catch {
        return payload
      }
    },
  )
}

/** Decode a base64 string into raw bytes. Whitespace is stripped. */
function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/\s+/g, "")
  if (cleaned.length === 0) return new Uint8Array(0)
  // Bun/Node both ship atob.
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Decode quoted-printable into bytes. */
function quotedPrintableToBytes(qp: string): Uint8Array {
  // Soft line breaks: "=\r\n" or "=\n" → drop.
  const folded = qp.replace(/=\r?\n/g, "")
  const out: number[] = []
  for (let i = 0; i < folded.length; i++) {
    const ch = folded[i]
    if (ch === "=") {
      const hex = folded.slice(i + 1, i + 3)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(Number.parseInt(hex, 16))
        i += 2
        continue
      }
    }
    out.push(folded.charCodeAt(i) & 0xff)
  }
  return new Uint8Array(out)
}

/**
 * Decode a part body according to its Content-Transfer-Encoding header.
 */
function decodePartBody(
  rawBody: string,
  encoding: string | undefined,
): Uint8Array {
  const enc = (encoding || "7bit").toLowerCase()
  if (enc === "base64") return base64ToBytes(rawBody)
  if (enc === "quoted-printable") return quotedPrintableToBytes(rawBody)
  // 7bit / 8bit / binary: take the raw octets as-is.
  const bytes = new Uint8Array(rawBody.length)
  for (let i = 0; i < rawBody.length; i++) {
    bytes[i] = rawBody.charCodeAt(i) & 0xff
  }
  return bytes
}

/**
 * Recursively walk a multipart body and yield leaf parts. Nested
 * multipart/* (alternative, related, mixed, signed) is descended into.
 */
function walkMultipart(rawMessage: string): MimePart[] {
  const parts: MimePart[] = []

  const walk = (block: string): void => {
    const split = splitHeaderBody(block)
    if (!split) return
    const { headers, body } = split

    const contentType = headers["content-type"] || "text/plain"
    const boundary = getHeaderParam(contentType, "boundary")

    if (boundary && /^multipart\//i.test(contentType)) {
      // Split body on --boundary lines. Discard the preamble before the
      // first boundary and the epilogue after the closing boundary.
      const delim = `--${boundary}`
      const segments = body.split(delim)
      // segments[0] is preamble, last segment may be "--\r\n..." (closing).
      for (let i = 1; i < segments.length; i++) {
        const segment = segments[i]
        // Closing boundary marker
        if (segment.startsWith("--")) break
        // Strip leading CRLF that follows the boundary marker.
        const cleaned = segment.replace(/^\r?\n/, "").replace(/\r?\n$/, "")
        walk(cleaned)
      }
      return
    }

    const decoded = decodePartBody(body, headers["content-transfer-encoding"])
    const text = bytesToUtf8(decoded)
    parts.push({ headers, rawBody: body, decoded, text })
  }

  walk(rawMessage)
  return parts
}

/** Split a MIME message/part into its header block and body. */
function splitHeaderBody(
  block: string,
): { headers: Record<string, string>; body: string } | null {
  // Headers and body are separated by a blank line (CRLF CRLF or LF LF).
  const sepCrlf = block.indexOf("\r\n\r\n")
  const sepLf = block.indexOf("\n\n")
  let sepIdx = -1
  let sepLen = 0
  if (sepCrlf !== -1 && (sepLf === -1 || sepCrlf <= sepLf)) {
    sepIdx = sepCrlf
    sepLen = 4
  } else if (sepLf !== -1) {
    sepIdx = sepLf
    sepLen = 2
  }
  if (sepIdx === -1) return null

  const headerBlock = block.slice(0, sepIdx)
  const body = block.slice(sepIdx + sepLen)
  return { headers: parseHeaders(headerBlock), body }
}

/** Convert decoded bytes to UTF-8 text, replacing invalid sequences. */
function bytesToUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  } catch {
    return ""
  }
}

/** Decide whether a MIME part is an attachment (vs. an inline body part). */
function isAttachmentPart(part: MimePart): boolean {
  const disp = part.headers["content-disposition"] || ""
  const ct = part.headers["content-type"] || ""

  // Explicit attachment disposition is the strongest signal.
  if (/^attachment/i.test(disp)) return true

  // Calendar invites are always treated as attachments even when delivered
  // inline (they are parsed by hey_get_calendar_invite, not rendered as body).
  if (/^text\/calendar/i.test(ct)) return true

  // A named file in either header indicates an attachment, even when the
  // disposition is "inline" (common for image/png that ought to be saved).
  const name = getHeaderParam(disp, "filename") || getHeaderParam(ct, "name")
  if (name) return true

  return false
}

/** Pick a sensible filename for an attachment part. */
function deriveFilename(part: MimePart, index: number): string {
  const disp = part.headers["content-disposition"] || ""
  const ct = part.headers["content-type"] || ""
  const fromDisp = getHeaderParam(disp, "filename")
  const fromCt = getHeaderParam(ct, "name")
  const raw = fromDisp || fromCt
  if (raw) return sanitiseFilename(raw)
  // Calendar parts default to invite.ics.
  if (/^text\/calendar/i.test(ct)) return "invite.ics"
  // Fallback by mime type.
  const mime = ct.split(";")[0]?.trim() || "application/octet-stream"
  const ext = mimeToExt(mime)
  return `attachment-${index}${ext}`
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "text/html": ".html",
    "text/calendar": ".ics",
    "application/zip": ".zip",
  }
  return map[mime] || ".bin"
}

/**
 * Strip path separators and control chars from a filename so it is safe to
 * concatenate with a directory under ~/Downloads.
 */
function sanitiseFilename(name: string): string {
  // Remove any directory component.
  const base = name.replace(/^.*[\\/]/, "").trim()
  // Replace forbidden characters and ASCII control bytes (0x00-0x1f) with
  // underscores. We iterate so the linter does not flag a control-char range
  // in the regex, but the behaviour is identical to /[ -<>:"/\\|?*]/g.
  let safe = ""
  for (const ch of base) {
    const code = ch.charCodeAt(0)
    if (code <= 0x1f || '<>:"/\\|?*'.includes(ch)) {
      safe += "_"
    } else {
      safe += ch
    }
  }
  return safe.length > 0 ? safe : "attachment.bin"
}

/** Extract the mime type (without parameters) from a Content-Type header. */
function pureMime(contentType: string | undefined): string {
  if (!contentType) return "application/octet-stream"
  return (
    contentType.split(";")[0]?.trim().toLowerCase() ||
    "application/octet-stream"
  )
}

/**
 * Fetch the raw RFC822 message and walk its multipart structure.
 * Returns the parsed parts plus a list of attachment parts and their
 * stable per-message IDs (`part-1`, `part-2`, ...).
 */
async function fetchAndWalkRawMessage(emailId: string): Promise<{
  parts: MimePart[]
  attachmentParts: Array<{ id: string; index: number; part: MimePart }>
}> {
  // Hey's `.text` endpoint returns the raw RFC822 source for a message id.
  const raw = await heyClient.fetchHtml(`/messages/${emailId}.text`)
  const parts = walkMultipart(raw)
  const attachmentParts: Array<{ id: string; index: number; part: MimePart }> =
    []
  let attachmentIndex = 0
  for (const part of parts) {
    if (!isAttachmentPart(part)) continue
    attachmentIndex += 1
    attachmentParts.push({
      id: `part-${attachmentIndex}`,
      index: attachmentIndex,
      part,
    })
  }
  return { parts, attachmentParts }
}

/**
 * List attachment metadata for an email. Used by hey_read_email to enrich
 * its response without inlining the binary content.
 */
export async function listAttachmentsForEmail(emailId: string): Promise<{
  attachments: AttachmentMeta[]
  calendar_invites: CalendarInviteMeta[]
}> {
  const { attachmentParts } = await fetchAndWalkRawMessage(emailId)
  const attachments: AttachmentMeta[] = []
  const calendar_invites: CalendarInviteMeta[] = []

  for (const { id, index, part } of attachmentParts) {
    const mime = pureMime(part.headers["content-type"])
    const filename = deriveFilename(part, index)
    const is_calendar = mime === "text/calendar"

    attachments.push({
      id,
      filename,
      size: part.decoded.byteLength,
      mime,
      is_calendar,
    })

    if (is_calendar) {
      const ics = parseIcs(part.text)
      calendar_invites.push({
        id,
        filename,
        summary: ics.title,
        start: ics.start,
        end: ics.end,
        attendees: ics.attendees,
      })
    }
  }

  return { attachments, calendar_invites }
}

/**
 * Decode a single attachment from the message and write it to disk.
 */
export async function downloadAttachment(args: {
  emailId: string
  attachmentId: string
  savePath?: string
}): Promise<{
  local_path: string
  filename: string
  size: number
  mime: string
}> {
  const { emailId, attachmentId } = args
  const { attachmentParts } = await fetchAndWalkRawMessage(emailId)
  const found = attachmentParts.find((a) => a.id === attachmentId)
  if (!found) {
    const ids = attachmentParts.map((a) => a.id).join(", ") || "(none)"
    throw new Error(
      `Attachment ${attachmentId} not found on email ${emailId}. Available ids: ${ids}`,
    )
  }

  const filename = deriveFilename(found.part, found.index)
  const mime = pureMime(found.part.headers["content-type"])
  const targetPath = resolveSavePath(args.savePath, emailId, filename)

  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, found.part.decoded)

  return {
    local_path: targetPath,
    filename,
    size: found.part.decoded.byteLength,
    mime,
  }
}

/**
 * Resolve a user-supplied save path, expanding ~ and defaulting to
 * ~/Downloads/hey-attachments/<emailId>/<filename> when omitted.
 */
function resolveSavePath(
  savePath: string | undefined,
  emailId: string,
  filename: string,
): string {
  const home = homedir()
  if (!savePath) {
    return join(home, "Downloads", "hey-attachments", emailId, filename)
  }
  // Expand leading ~/ to homedir (Node's path APIs do not do this for us).
  let expanded = savePath
  if (expanded === "~") expanded = home
  else if (expanded.startsWith("~/")) expanded = join(home, expanded.slice(2))

  // If the path is relative, anchor it to the default downloads dir.
  if (!isAbsolute(expanded)) {
    expanded = resolve(home, "Downloads", expanded)
  }

  // If the caller pointed at a directory (trailing slash or no extension),
  // append the inferred filename.
  if (expanded.endsWith("/") || expanded.endsWith("\\")) {
    return join(expanded, filename)
  }
  return expanded
}

/**
 * Extract and parse a calendar invite from an email. When `attachmentId`
 * is omitted, the first text/calendar part is used.
 */
export async function getCalendarInvite(args: {
  emailId: string
  attachmentId?: string
}): Promise<ParsedCalendarInvite> {
  const { emailId, attachmentId } = args
  const { attachmentParts } = await fetchAndWalkRawMessage(emailId)
  const calendarParts = attachmentParts.filter(
    (a) => pureMime(a.part.headers["content-type"]) === "text/calendar",
  )

  if (calendarParts.length === 0) {
    throw new Error(`No calendar invite (.ics) found on email ${emailId}`)
  }

  const chosen = attachmentId
    ? calendarParts.find((a) => a.id === attachmentId)
    : calendarParts[0]
  if (!chosen) {
    const ids = calendarParts.map((a) => a.id).join(", ")
    throw new Error(
      `Calendar attachment ${attachmentId} not found on email ${emailId}. Available calendar ids: ${ids}`,
    )
  }

  const parsed = parseIcs(chosen.part.text)
  return {
    title: parsed.title,
    start: parsed.start,
    end: parsed.end,
    location: parsed.location,
    attendees: parsed.attendees,
    organizer: parsed.organizer,
    description: parsed.description,
    raw_ics: chosen.part.text,
  }
}

interface IcsExtract {
  title?: string
  start?: string
  end?: string
  location?: string
  organizer?: string
  description?: string
  attendees: string[]
}

/**
 * Minimal RFC 5545 parser focused on the first VEVENT block.
 *
 * Extracts SUMMARY, DTSTART, DTEND, LOCATION, ORGANIZER, DESCRIPTION and
 * ATTENDEE lines. We do not attempt full conformance: timezone parameters,
 * RRULE expansion, alarms, and nested VTIMEZONE blocks are ignored.
 */
function parseIcs(ics: string): IcsExtract {
  // Unfold continuation lines per RFC 5545 §3.1: any line starting with a
  // space or tab is folded into the previous line.
  const unfolded = ics.replace(/\r?\n[ \t]/g, "")
  const lines = unfolded.split(/\r?\n/)

  let inEvent = false
  let title: string | undefined
  let start: string | undefined
  let end: string | undefined
  let location: string | undefined
  let organizer: string | undefined
  let description: string | undefined
  const attendees: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true
      continue
    }
    if (trimmed === "END:VEVENT") {
      // Stop at the first event; ignore any subsequent blocks.
      break
    }
    if (!inEvent) continue

    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const lhs = trimmed.slice(0, colonIdx)
    const rhs = trimmed.slice(colonIdx + 1)
    // Property name is everything before the first ";" (parameters follow).
    const propName = lhs.split(";")[0]?.toUpperCase() || ""

    switch (propName) {
      case "SUMMARY":
        title = unescapeIcs(rhs)
        break
      case "DTSTART":
        start = parseIcsDate(rhs)
        break
      case "DTEND":
        end = parseIcsDate(rhs)
        break
      case "LOCATION":
        location = unescapeIcs(rhs)
        break
      case "DESCRIPTION":
        description = unescapeIcs(rhs)
        break
      case "ORGANIZER": {
        const addr = extractMailto(rhs)
        if (addr) organizer = addr
        break
      }
      case "ATTENDEE": {
        const addr = extractMailto(rhs)
        if (addr) attendees.push(addr)
        break
      }
    }
  }

  return { title, start, end, location, organizer, description, attendees }
}

/** Strip mailto: prefix from an ICS CAL-ADDRESS value. */
function extractMailto(value: string): string | undefined {
  const trimmed = value.trim()
  if (/^mailto:/i.test(trimmed)) return trimmed.slice(7)
  // Some calendars provide raw email addresses without the mailto prefix.
  if (/@/.test(trimmed)) return trimmed
  return undefined
}

/** Decode an ICS TEXT value (escaped commas, semicolons, newlines). */
function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
}

/**
 * Convert an ICS DATE-TIME value to ISO 8601 where possible. Supports:
 *   - 20260513T140000Z      → 2026-05-13T14:00:00Z
 *   - 20260513T140000       → 2026-05-13T14:00:00 (floating)
 *   - 20260513              → 2026-05-13
 * Other forms are returned unchanged so callers see the raw value.
 */
function parseIcsDate(raw: string): string {
  const v = raw.trim()
  const utcMatch = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (utcMatch) {
    const [, y, mo, d, h, mi, s] = utcMatch
    return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
  }
  const localMatch = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/)
  if (localMatch) {
    const [, y, mo, d, h, mi, s] = localMatch
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`
  }
  const dateMatch = v.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateMatch) {
    const [, y, mo, d] = dateMatch
    return `${y}-${mo}-${d}`
  }
  return v
}

// Internal helpers exported only for testing.
export const __testing = {
  parseHeaders,
  walkMultipart,
  decodePartBody,
  base64ToBytes,
  quotedPrintableToBytes,
  isAttachmentPart,
  deriveFilename,
  sanitiseFilename,
  parseIcs,
  parseIcsDate,
  pureMime,
}
