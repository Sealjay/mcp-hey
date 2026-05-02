import { describe, expect, test } from "bun:test"
import { parse as parseHtml } from "node-html-parser"
import {
  type ReplyContext,
  type ThreadEntry,
  classifyRedirect,
  extractThreadEntries,
  findLatestNonSelfSender,
  resolveReplyRecipients,
} from "../tools/send"

function mockResponse(status: number, location?: string): Response {
  const headers = new Headers()
  if (location) {
    headers.set("location", location)
  }
  return new Response(null, { status, headers })
}

describe("classifyRedirect", () => {
  test("should detect auth failure from /sign_in redirect", () => {
    const result = classifyRedirect(mockResponse(302, "/sign_in"))
    expect(result.type).toBe("auth_failure")
  })

  test("should extract messageId from /messages/{id} redirect", () => {
    const result = classifyRedirect(mockResponse(302, "/messages/12345"))
    expect(result.type).toBe("success")
    expect(result.messageId).toBe("12345")
  })

  test("should extract messageId from /topics/{id} redirect", () => {
    const result = classifyRedirect(mockResponse(302, "/topics/67890"))
    expect(result.type).toBe("success")
    expect(result.messageId).toBe("67890")
  })

  test("should detect success from /imbox redirect", () => {
    const result = classifyRedirect(mockResponse(302, "/imbox"))
    expect(result.type).toBe("success")
    expect(result.messageId).toBeUndefined()
  })

  test("should detect success from /sent redirect", () => {
    const result = classifyRedirect(mockResponse(302, "/sent"))
    expect(result.type).toBe("success")
  })

  test("should detect validation error from /messages/new redirect", () => {
    const result = classifyRedirect(mockResponse(302, "/messages/new"))
    expect(result.type).toBe("validation_error")
  })

  test("should detect validation error from /entries/new redirect", () => {
    const result = classifyRedirect(mockResponse(302, "/entries/new"))
    expect(result.type).toBe("validation_error")
  })

  test("should treat unknown redirect as success with warning", () => {
    const result = classifyRedirect(mockResponse(302, "/some/unknown/path"))
    expect(result.type).toBe("success")
    expect(result.warning).toContain("/some/unknown/path")
  })

  test("should handle missing location header", () => {
    const result = classifyRedirect(mockResponse(302))
    expect(result.type).toBe("success")
    expect(result.warning).toBeDefined()
  })
})

describe("Send Tools", () => {
  describe("SendEmailParams Validation", () => {
    test("should require at least one recipient", async () => {
      const { sendEmail } = await import("../tools/send")

      const result = await sendEmail({
        to: [],
        subject: "Test",
        body: "Test body",
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe("At least one recipient is required")
    })

    test("should require subject", async () => {
      const { sendEmail } = await import("../tools/send")

      const result = await sendEmail({
        to: ["test@example.com"],
        subject: "",
        body: "Test body",
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe("Subject is required")
    })

    test("should require body", async () => {
      const { sendEmail } = await import("../tools/send")

      const result = await sendEmail({
        to: ["test@example.com"],
        subject: "Test",
        body: "",
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe("Body is required")
    })

    test("should trim whitespace when validating", async () => {
      const { sendEmail } = await import("../tools/send")

      const result = await sendEmail({
        to: ["test@example.com"],
        subject: "   ",
        body: "Test body",
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe("Subject is required")
    })
  })

  describe("ReplyParams Validation", () => {
    test("should require body for reply", async () => {
      const { replyToEmail } = await import("../tools/send")

      const result = await replyToEmail({
        threadId: "123",
        body: "",
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe("Reply body is required")
    })

    test("should trim whitespace when validating body", async () => {
      const { replyToEmail } = await import("../tools/send")

      const result = await replyToEmail({
        threadId: "123",
        body: "   ",
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe("Reply body is required")
    })

    test("should reject empty `to` override", async () => {
      const { replyToEmail } = await import("../tools/send")

      const result = await replyToEmail({
        threadId: "123",
        body: "Just chasing this up.",
        to: [],
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe(
        "`to` must contain at least one recipient when provided",
      )
    })

    test("should reject malformed `to` override addresses", async () => {
      const { replyToEmail } = await import("../tools/send")

      const result = await replyToEmail({
        threadId: "123",
        body: "Just chasing this up.",
        to: ["not-an-email"],
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Invalid recipient email(s)")
      expect(result.error).toContain("not-an-email")
    })

    test("should reject malformed `cc` override addresses", async () => {
      const { replyToEmail } = await import("../tools/send")

      const result = await replyToEmail({
        threadId: "123",
        body: "Just chasing this up.",
        to: ["alice@example.com"],
        cc: ["also bad"],
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Invalid CC email(s)")
      expect(result.error).toContain("also bad")
    })
  })
})

describe("SendResult Interface", () => {
  test("should have correct success structure", () => {
    interface SendResult {
      success: boolean
      messageId?: string
      error?: string
    }

    const successResult: SendResult = { success: true, messageId: "12345" }
    const errorResult: SendResult = { success: false, error: "Test error" }

    expect(successResult.success).toBe(true)
    expect(successResult.messageId).toBe("12345")
    expect(errorResult.success).toBe(false)
    expect(errorResult.error).toBe("Test error")
  })
})

describe("Thread reply recipient resolution", () => {
  describe("extractThreadEntries", () => {
    test("extracts sender email from article.entry with avatar alt", () => {
      const html = `
        <html><body>
          <article class="entry" data-entry-id="111">
            <img class="avatar" alt="Alice Smith <alice@example.com>">
            <time datetime="2026-04-29T09:00:00Z">Yesterday</time>
            <p>Hi Chris</p>
          </article>
          <article class="entry" data-entry-id="222">
            <img class="avatar" alt="Chris Example <chris@example.com>">
            <time datetime="2026-04-30T10:00:00Z">Today</time>
            <p>Reply from Chris</p>
          </article>
        </body></html>
      `
      const root = parseHtml(html)
      const entries = extractThreadEntries(root)
      expect(entries).toHaveLength(2)
      expect(entries[0]).toEqual({
        entryId: "111",
        senderEmail: "alice@example.com",
        date: "2026-04-29T09:00:00Z",
      })
      expect(entries[1]).toEqual({
        entryId: "222",
        senderEmail: "chris@example.com",
        date: "2026-04-30T10:00:00Z",
      })
    })

    test("falls back to span/div avatars when img.avatar is absent", () => {
      const html = `
        <html><body>
          <article data-entry-id="333">
            <span class="avatar" alt="Bob Jones <bob@example.org>"></span>
            <time datetime="2026-04-28T08:00:00Z">2 days ago</time>
          </article>
        </body></html>
      `
      const root = parseHtml(html)
      const entries = extractThreadEntries(root)
      expect(entries).toHaveLength(1)
      expect(entries[0].senderEmail).toBe("bob@example.org")
    })

    test("de-duplicates entries matched by multiple selectors", () => {
      const html = `
        <html><body>
          <article class="entry" data-entry-id="999">
            <img class="avatar" alt="Dee <dee@example.com>">
            <message-content data-entry-id="999">
              <img class="avatar" alt="Dee <dee@example.com>">
            </message-content>
          </article>
        </body></html>
      `
      const root = parseHtml(html)
      const entries = extractThreadEntries(root)
      // Should be 1, not 2 - both selectors match the same entry ID.
      expect(entries.filter((e) => e.entryId === "999")).toHaveLength(1)
    })

    test("skips wrappers with no parseable sender email", () => {
      const html = `
        <html><body>
          <article class="entry" data-entry-id="444">
            <img class="avatar" alt="No email here">
          </article>
          <article class="entry" data-entry-id="555">
            <img class="avatar" alt="Has Email <real@example.com>">
          </article>
        </body></html>
      `
      const root = parseHtml(html)
      const entries = extractThreadEntries(root)
      expect(entries).toHaveLength(1)
      expect(entries[0].entryId).toBe("555")
    })
  })

  describe("findLatestNonSelfSender", () => {
    test("returns the sender of the most recent non-self entry by datetime", () => {
      const entries: ThreadEntry[] = [
        {
          entryId: "1",
          senderEmail: "amanda@example.com",
          date: "2026-04-29T09:00:00Z",
        },
        {
          entryId: "2",
          senderEmail: "chris@example.com",
          date: "2026-04-30T10:00:00Z",
        },
        {
          entryId: "3",
          senderEmail: "amanda@example.com",
          date: "2026-04-30T11:00:00Z",
        },
      ]
      const result = findLatestNonSelfSender(entries, "chris@example.com")
      expect(result).toBe("amanda@example.com")
    })

    test("regression: bug-evidence thread - chris last, amanda before that", () => {
      // Mirrors the production bug: thread 1998366264 where Amanda sent
      // the latest non-self message but the previous logic addressed the
      // reply to Chris himself.
      const entries: ThreadEntry[] = [
        {
          entryId: "a",
          senderEmail: "chris@example.com",
          date: "2026-04-25T08:00:00Z",
        },
        {
          entryId: "b",
          senderEmail: "amanda@example.com",
          date: "2026-04-29T09:00:00Z",
        },
      ]
      const result = findLatestNonSelfSender(entries, "chris@example.com")
      expect(result).toBe("amanda@example.com")
    })

    test("returns undefined when only the user has posted in the thread", () => {
      const entries: ThreadEntry[] = [
        {
          entryId: "1",
          senderEmail: "chris@example.com",
          date: "2026-04-30T10:00:00Z",
        },
      ]
      expect(
        findLatestNonSelfSender(entries, "chris@example.com"),
      ).toBeUndefined()
    })

    test("is case-insensitive when comparing self email", () => {
      const entries: ThreadEntry[] = [
        {
          entryId: "1",
          senderEmail: "amanda@example.com",
          date: "2026-04-29T09:00:00Z",
        },
        {
          entryId: "2",
          senderEmail: "chris@example.com",
          date: "2026-04-30T10:00:00Z",
        },
      ]
      const result = findLatestNonSelfSender(entries, "Chris@Example.com")
      expect(result).toBe("amanda@example.com")
    })

    test("falls back to DOM order when no entries have parseable dates", () => {
      const entries: ThreadEntry[] = [
        {
          entryId: "1",
          senderEmail: "amanda@example.com",
          date: undefined,
        },
        { entryId: "2", senderEmail: "chris@example.com", date: undefined },
        { entryId: "3", senderEmail: "elena@law.example", date: undefined },
      ]
      const result = findLatestNonSelfSender(entries, "chris@example.com")
      // Last non-self entry in DOM order.
      expect(result).toBe("elena@law.example")
    })

    test("skips entries with unparseable dates and uses parseable ones", () => {
      const entries: ThreadEntry[] = [
        {
          entryId: "1",
          senderEmail: "amanda@example.com",
          date: "2026-04-29T09:00:00Z",
        },
        {
          entryId: "2",
          senderEmail: "elena@law.example",
          date: "Yesterday at 10am", // not parseable
        },
      ]
      const result = findLatestNonSelfSender(entries, "chris@example.com")
      expect(result).toBe("amanda@example.com")
    })
  })

  describe("resolveReplyRecipients", () => {
    const baseContext: ReplyContext = {
      entryId: "1",
      subject: "Re: hello",
      participantEmails: ["amanda@example.com", "chris@example.com"],
      latestNonSelfSenderEmail: "amanda@example.com",
    }

    test("uses explicit `to` override verbatim when supplied", () => {
      const result = resolveReplyRecipients({
        toOverride: ["someone-else@example.com"],
        replyContext: baseContext,
        selfEmail: "chris@example.com",
      })
      expect(result).toEqual(["someone-else@example.com"])
    })

    test("trims whitespace on explicit `to` overrides", () => {
      const result = resolveReplyRecipients({
        toOverride: ["  alice@example.com  "],
        replyContext: baseContext,
        selfEmail: "chris@example.com",
      })
      expect(result).toEqual(["alice@example.com"])
    })

    test("auto-detects latest non-self sender when no override", () => {
      const result = resolveReplyRecipients({
        toOverride: undefined,
        replyContext: baseContext,
        selfEmail: "chris@example.com",
      })
      expect(result).toEqual(["amanda@example.com"])
    })

    test("falls back to other participants when no latest sender detected", () => {
      const result = resolveReplyRecipients({
        toOverride: undefined,
        replyContext: {
          ...baseContext,
          latestNonSelfSenderEmail: undefined,
          participantEmails: [
            "amanda@example.com",
            "elena@law.example",
            "chris@example.com",
          ],
        },
        selfEmail: "chris@example.com",
      })
      expect(result).toEqual(["amanda@example.com", "elena@law.example"])
    })

    test("returns empty array when only the user has posted", () => {
      const result = resolveReplyRecipients({
        toOverride: undefined,
        replyContext: {
          ...baseContext,
          latestNonSelfSenderEmail: undefined,
          participantEmails: ["chris@example.com"],
        },
        selfEmail: "chris@example.com",
      })
      expect(result).toEqual([])
    })

    test("override wins even when auto-detect would also work", () => {
      const result = resolveReplyRecipients({
        toOverride: ["chase-target@example.com"],
        replyContext: baseContext,
        selfEmail: "chris@example.com",
      })
      expect(result).toEqual(["chase-target@example.com"])
    })

    test("empty override array falls through to auto-detect", () => {
      // Note: callers validate empty `to` upstream and reject it; this just
      // documents the helper's defensive behaviour.
      const result = resolveReplyRecipients({
        toOverride: [],
        replyContext: baseContext,
        selfEmail: "chris@example.com",
      })
      expect(result).toEqual(["amanda@example.com"])
    })
  })
})
