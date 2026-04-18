import { describe, expect, test } from "bun:test"
import { HeyError, sanitiseError, toUserError } from "../errors"

describe("sanitiseError", () => {
  test("redacts URLs as [url]", () => {
    const out = sanitiseError(
      new Error("Failed to reach https://hey.com/imbox"),
    )
    expect(out).toBe("Failed to reach [url]")
  })

  test("leaves Hey application paths like /imbox intact", () => {
    const out = sanitiseError(new Error("GET /imbox returned 500"))
    expect(out).toBe("GET /imbox returned 500")
  })

  test("leaves resource paths like /topics/123 intact", () => {
    const out = sanitiseError(new Error("POST /topics/123/set_aside failed"))
    expect(out).toBe("POST /topics/123/set_aside failed")
  })

  test("redacts absolute filesystem paths as [path]", () => {
    const out = sanitiseError(
      new Error("cannot read /home/user/mcp-hey/data/hey-cookies.json"),
    )
    expect(out).toBe("cannot read [path]")
  })

  test("redacts Bearer tokens", () => {
    const out = sanitiseError(new Error("auth: Bearer abc.def.ghi"))
    expect(out).toBe("auth: [token]")
  })

  test("redacts email addresses", () => {
    const out = sanitiseError(new Error("sender alice@example.com not found"))
    expect(out).toBe("sender [email] not found")
  })

  test("handles non-Error inputs", () => {
    expect(sanitiseError("oops")).toBe("An unknown error occurred")
    expect(sanitiseError(null)).toBe("An unknown error occurred")
    expect(sanitiseError(undefined)).toBe("An unknown error occurred")
  })

  test("redacts URLs before paths so URLs don't leak a 'https:' prefix", () => {
    const out = sanitiseError(new Error("fetch https://app.hey.com/imbox"))
    expect(out).toBe("fetch [url]")
    expect(out).not.toContain("https:")
  })
})

describe("toUserError", () => {
  test("returns HeyError.detail", () => {
    expect(toUserError(new HeyError("transient", "network flap"))).toBe(
      "network flap",
    )
  })

  test("returns Error.message for plain errors", () => {
    expect(toUserError(new Error("boom"))).toBe("boom")
  })

  test("fallback for unknown inputs", () => {
    expect(toUserError("string")).toBe("Unknown error")
    expect(toUserError(undefined)).toBe("Unknown error")
  })
})

describe("HeyError", () => {
  test("carries code, detail, and optional status", () => {
    const e = new HeyError("rate_limited", "too many", 429)
    expect(e.code).toBe("rate_limited")
    expect(e.detail).toBe("too many")
    expect(e.status).toBe(429)
    expect(e.message).toBe("too many")
    expect(e.name).toBe("HeyError")
    expect(e instanceof Error).toBe(true)
  })
})
