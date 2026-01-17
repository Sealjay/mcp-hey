import { describe, expect, test } from "bun:test"

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
