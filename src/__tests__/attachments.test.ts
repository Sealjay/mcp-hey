import { describe, expect, test } from "bun:test"
import { __testing } from "../tools/attachments"

const {
  parseHeaders,
  walkMultipart,
  base64ToBytes,
  quotedPrintableToBytes,
  isAttachmentPart,
  deriveFilename,
  sanitiseFilename,
  parseIcs,
  parseIcsDate,
  pureMime,
} = __testing

const SIMPLE_MULTIPART = [
  "From: sender@example.com",
  "Subject: Test",
  'Content-Type: multipart/mixed; boundary="BOUNDARY"',
  "",
  "preamble",
  "--BOUNDARY",
  "Content-Type: text/plain",
  "Content-Transfer-Encoding: 7bit",
  "",
  "Hello world.",
  "--BOUNDARY",
  'Content-Type: image/png; name="logo.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="logo.png"',
  "",
  // "PNG" prefix encoded in base64
  "iVBORw0KGgo=",
  "--BOUNDARY--",
  "",
].join("\r\n")

const ICS_MULTIPART = [
  "From: organiser@example.com",
  "Subject: Invite",
  'Content-Type: multipart/alternative; boundary="ALT"',
  "",
  "--ALT",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "You're invited!",
  "--ALT",
  'Content-Type: text/calendar; method=REQUEST; charset="utf-8"',
  "Content-Transfer-Encoding: 7bit",
  "",
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "SUMMARY:Lunch with Chris",
  "DTSTART:20260513T120000Z",
  "DTEND:20260513T130000Z",
  "LOCATION:Food at 52",
  "ORGANIZER:mailto:organiser@example.com",
  "ATTENDEE;CN=Chris:mailto:chris@example.com",
  "ATTENDEE:mailto:guest@example.com",
  "END:VEVENT",
  "END:VCALENDAR",
  "--ALT--",
  "",
].join("\r\n")

describe("parseHeaders", () => {
  test("lower-cases keys and trims values", () => {
    const headers = parseHeaders(
      "Content-Type: text/plain\r\nX-Custom: foo\r\n",
    )
    expect(headers["content-type"]).toBe("text/plain")
    expect(headers["x-custom"]).toBe("foo")
  })

  test("folds continuation lines", () => {
    const headers = parseHeaders(
      'Content-Type: multipart/mixed;\r\n boundary="BOUNDARY"',
    )
    expect(headers["content-type"]).toBe('multipart/mixed; boundary="BOUNDARY"')
  })
})

describe("base64ToBytes / quotedPrintableToBytes", () => {
  test("decodes base64 with whitespace", () => {
    const bytes = base64ToBytes("SGVsbG8s\nIHdvcmxkIQ==")
    expect(new TextDecoder().decode(bytes)).toBe("Hello, world!")
  })

  test("decodes quoted-printable with soft breaks", () => {
    const bytes = quotedPrintableToBytes("Hello,=\r\n =E2=98=83=\r\n end")
    expect(new TextDecoder().decode(bytes)).toBe("Hello, ☃ end")
  })
})

describe("walkMultipart", () => {
  test("emits leaf parts and skips multipart wrappers", () => {
    const parts = walkMultipart(SIMPLE_MULTIPART)
    expect(parts).toHaveLength(2)
    expect(parts[0].headers["content-type"]).toBe("text/plain")
    expect(parts[0].text).toContain("Hello world.")
    expect(parts[1].headers["content-disposition"]).toContain("attachment")
    expect(parts[1].decoded.byteLength).toBe(8) // 8 bytes of decoded PNG header
  })

  test("descends into nested multipart blocks", () => {
    const nested = [
      "From: a@b.com",
      'Content-Type: multipart/mixed; boundary="OUTER"',
      "",
      "--OUTER",
      'Content-Type: multipart/alternative; boundary="INNER"',
      "",
      "--INNER",
      "Content-Type: text/plain",
      "",
      "alt-text",
      "--INNER",
      "Content-Type: text/html",
      "",
      "<p>html</p>",
      "--INNER--",
      "--OUTER--",
      "",
    ].join("\r\n")
    const parts = walkMultipart(nested)
    expect(parts).toHaveLength(2)
    expect(parts[0].text).toContain("alt-text")
    expect(parts[1].text).toContain("<p>html</p>")
  })
})

describe("isAttachmentPart", () => {
  test("flags Content-Disposition: attachment", () => {
    const part = walkMultipart(SIMPLE_MULTIPART)[1]
    expect(isAttachmentPart(part)).toBe(true)
  })

  test("flags text/calendar even when inline", () => {
    const part = walkMultipart(ICS_MULTIPART)[1]
    expect(isAttachmentPart(part)).toBe(true)
  })

  test("treats plain text/plain bodies as non-attachment", () => {
    const part = walkMultipart(SIMPLE_MULTIPART)[0]
    expect(isAttachmentPart(part)).toBe(false)
  })
})

describe("deriveFilename / sanitiseFilename", () => {
  test("uses Content-Disposition filename when present", () => {
    const part = walkMultipart(SIMPLE_MULTIPART)[1]
    expect(deriveFilename(part, 1)).toBe("logo.png")
  })

  test("defaults calendar parts to invite.ics", () => {
    const part = walkMultipart(ICS_MULTIPART)[1]
    expect(deriveFilename(part, 1)).toBe("invite.ics")
  })

  test("strips path components", () => {
    expect(sanitiseFilename("/etc/passwd")).toBe("passwd")
    expect(sanitiseFilename("..\\windows\\system32\\evil.exe")).toBe("evil.exe")
  })

  test("replaces forbidden characters", () => {
    expect(sanitiseFilename("inv*alid?:name.txt")).toContain("_")
  })
})

describe("pureMime", () => {
  test("strips parameters and lower-cases", () => {
    expect(pureMime("Text/Calendar; method=REQUEST")).toBe("text/calendar")
    expect(pureMime(undefined)).toBe("application/octet-stream")
  })
})

describe("parseIcs", () => {
  test("extracts SUMMARY, DTSTART, DTEND, LOCATION, ORGANIZER, ATTENDEE", () => {
    const part = walkMultipart(ICS_MULTIPART)[1]
    const result = parseIcs(part.text)
    expect(result.title).toBe("Lunch with Chris")
    expect(result.start).toBe("2026-05-13T12:00:00Z")
    expect(result.end).toBe("2026-05-13T13:00:00Z")
    expect(result.location).toBe("Food at 52")
    expect(result.organizer).toBe("organiser@example.com")
    expect(result.attendees).toEqual(["chris@example.com", "guest@example.com"])
  })

  test("unfolds continuation lines and unescapes text", () => {
    // Per RFC 5545 §3.1, only the CRLF + leading whitespace marker is
    // removed during unfolding. Any other whitespace is preserved verbatim,
    // so "SUMMARY:Long" + " meeting..." becomes "Long meeting...".
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Long",
      "  meeting\\, with\\; details",
      "DTSTART:20260101T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n")
    const result = parseIcs(ics)
    expect(result.title).toBe("Long meeting, with; details")
    expect(result.start).toBe("2026-01-01T09:00:00")
  })

  test("returns no event when there is no VEVENT", () => {
    const result = parseIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
    expect(result.title).toBeUndefined()
    expect(result.attendees).toEqual([])
  })
})

describe("parseIcsDate", () => {
  test("supports UTC, floating, and date-only forms", () => {
    expect(parseIcsDate("20260513T140000Z")).toBe("2026-05-13T14:00:00Z")
    expect(parseIcsDate("20260513T140000")).toBe("2026-05-13T14:00:00")
    expect(parseIcsDate("20260513")).toBe("2026-05-13")
    expect(parseIcsDate("garbage")).toBe("garbage")
  })
})
