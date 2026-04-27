import { describe, expect, test } from "bun:test"
import { classifyRedirect } from "../tools/send"

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
