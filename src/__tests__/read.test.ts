import { beforeEach, describe, expect, mock, test } from "bun:test"

// Mock HTML responses
const mockImboxHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta name="csrf-token" content="test-csrf-token">
</head>
<body>
  <div data-entry-id="12345" class="posting unread">
    <div class="sender" data-email="john@example.com">John Doe</div>
    <div class="subject">Test Subject 1</div>
    <div class="snippet">This is a preview...</div>
    <time datetime="2024-01-15T10:30:00Z">Jan 15</time>
  </div>
  <div data-entry-id="12346" class="posting">
    <div class="sender" data-email="jane@example.com">Jane Smith</div>
    <div class="subject">Test Subject 2</div>
    <div class="snippet">Another preview...</div>
    <time datetime="2024-01-14T09:00:00Z">Jan 14</time>
  </div>
</body>
</html>
`

const mockEmailDetailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta name="csrf-token" content="test-csrf-token">
</head>
<body>
  <div class="message" data-thread-id="thread-123">
    <div class="sender" data-email="john@example.com">John Doe</div>
    <h1 class="subject">Test Subject 1</h1>
    <div class="message-body">
      <p>This is the full email body content.</p>
      <p>It has multiple paragraphs.</p>
    </div>
    <time datetime="2024-01-15T10:30:00Z">January 15, 2024</time>
  </div>
</body>
</html>
`

const mockSearchResultsHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta name="csrf-token" content="test-csrf-token">
</head>
<body>
  <div class="search-results">
    <div data-entry-id="99999" class="posting">
      <div class="sender">Search Result</div>
      <div class="subject">Found Email</div>
      <div class="snippet">Matching content...</div>
      <time datetime="2024-01-10T12:00:00Z">Jan 10</time>
    </div>
  </div>
</body>
</html>
`

describe("Read Tools", () => {
  describe("HTML Parsing", () => {
    test("should parse email entries from HTML", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockImboxHtml)
      const entries = root.querySelectorAll("[data-entry-id]")

      expect(entries.length).toBe(2)
      expect(entries[0].getAttribute("data-entry-id")).toBe("12345")
      expect(entries[1].getAttribute("data-entry-id")).toBe("12346")
    })

    test("should extract sender information", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockImboxHtml)
      const entry = root.querySelector("[data-entry-id='12345']")
      const sender = entry?.querySelector(".sender")

      expect(sender?.text.trim()).toBe("John Doe")
      expect(sender?.getAttribute("data-email")).toBe("john@example.com")
    })

    test("should extract subject", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockImboxHtml)
      const entry = root.querySelector("[data-entry-id='12345']")
      const subject = entry?.querySelector(".subject")

      expect(subject?.text.trim()).toBe("Test Subject 1")
    })

    test("should detect unread status", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockImboxHtml)
      const unreadEntry = root.querySelector("[data-entry-id='12345']")
      const readEntry = root.querySelector("[data-entry-id='12346']")

      expect(unreadEntry?.classNames).toContain("unread")
      expect(readEntry?.classNames).not.toContain("unread")
    })

    test("should extract date from time element", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockImboxHtml)
      const entry = root.querySelector("[data-entry-id='12345']")
      const time = entry?.querySelector("time")

      expect(time?.getAttribute("datetime")).toBe("2024-01-15T10:30:00Z")
    })

    test("should extract CSRF token", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockImboxHtml)
      const csrfMeta = root.querySelector('meta[name="csrf-token"]')

      expect(csrfMeta?.getAttribute("content")).toBe("test-csrf-token")
    })
  })

  describe("Email Detail Parsing", () => {
    test("should extract full email body", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockEmailDetailHtml)
      const body = root.querySelector(".message-body")

      expect(body?.innerHTML).toContain(
        "<p>This is the full email body content.</p>",
      )
      expect(body?.innerHTML).toContain("<p>It has multiple paragraphs.</p>")
    })

    test("should extract thread ID", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockEmailDetailHtml)
      const message = root.querySelector("[data-thread-id]")

      expect(message?.getAttribute("data-thread-id")).toBe("thread-123")
    })
  })

  describe("Search Results", () => {
    test("should parse search results", async () => {
      const { parse } = await import("node-html-parser")

      const root = parse(mockSearchResultsHtml)
      const results = root.querySelectorAll("[data-entry-id]")

      expect(results.length).toBe(1)
      expect(results[0].getAttribute("data-entry-id")).toBe("99999")
    })
  })
})

describe("Empty States", () => {
  test("should handle empty email list", async () => {
    const { parse } = await import("node-html-parser")

    const emptyHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <div class="empty-state">No emails</div>
      </body>
      </html>
    `

    const root = parse(emptyHtml)
    const entries = root.querySelectorAll("[data-entry-id]")

    expect(entries.length).toBe(0)
  })
})
