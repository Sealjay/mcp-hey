import { describe, expect, test } from "bun:test"

describe("Organise Tools", () => {
  describe("Input Validation", () => {
    test("setAside should require email ID", async () => {
      // We can't easily mock the HTTP client, so test the validation logic
      const { setAside } = await import("../tools/organise")

      const result = await setAside("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Email ID is required")
    })

    test("replyLater should require email ID", async () => {
      const { replyLater } = await import("../tools/organise")

      const result = await replyLater("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Email ID is required")
    })

    test("screenIn should require sender email", async () => {
      const { screenIn } = await import("../tools/organise")

      const result = await screenIn("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Sender email is required")
    })

    test("screenOut should require sender email", async () => {
      const { screenOut } = await import("../tools/organise")

      const result = await screenOut("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Sender email is required")
    })

    test("removeFromSetAside should require email ID", async () => {
      const { removeFromSetAside } = await import("../tools/organise")

      const result = await removeFromSetAside("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Email ID is required")
    })

    test("removeFromReplyLater should require posting ID", async () => {
      const { removeFromReplyLater } = await import("../tools/organise")

      const result = await removeFromReplyLater("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Posting ID is required")
    })

    test("markAsRead should require email ID", async () => {
      const { markAsRead } = await import("../tools/organise")

      const result = await markAsRead("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Email ID is required")
    })

    test("markAsUnread should require email ID", async () => {
      const { markAsUnread } = await import("../tools/organise")

      const result = await markAsUnread("")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Email ID is required")
    })
  })
})

describe("OrganiseResult Interface", () => {
  test("should have correct success structure", () => {
    interface OrganiseResult {
      success: boolean
      error?: string
    }

    const successResult: OrganiseResult = { success: true }
    const errorResult: OrganiseResult = { success: false, error: "Test error" }

    expect(successResult.success).toBe(true)
    expect(successResult.error).toBeUndefined()
    expect(errorResult.success).toBe(false)
    expect(errorResult.error).toBe("Test error")
  })
})
