import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { type Cookie, type Session, resolvePython3 } from "../session"

// Mock session data
const mockCookies: Cookie[] = [
  {
    name: "_hey_session",
    value: "test-session-value",
    domain: "app.hey.com",
    path: "/",
  },
  {
    name: "remember_user_token",
    value: "test-remember-token",
    domain: "app.hey.com",
    path: "/",
    expiry: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days from now
  },
]

const mockSession: Session = {
  cookies: mockCookies,
  lastValidated: Date.now(),
}

describe("Session", () => {
  describe("getCookieHeader", () => {
    test("should format cookies as header string", async () => {
      // Import dynamically to allow mocking
      const { getCookieHeader } = await import("../session")

      const header = getCookieHeader(mockSession)

      expect(header).toContain("_hey_session=test-session-value")
      expect(header).toContain("remember_user_token=test-remember-token")
      expect(header).toContain("; ")
    })
  })
})

describe("Cookie Header Parsing", () => {
  test("should handle empty cookies array", async () => {
    const { getCookieHeader } = await import("../session")

    const emptySession: Session = {
      cookies: [],
      lastValidated: Date.now(),
    }

    const header = getCookieHeader(emptySession)

    expect(header).toBe("")
  })

  test("should handle single cookie", async () => {
    const { getCookieHeader } = await import("../session")

    const singleCookieSession: Session = {
      cookies: [
        {
          name: "test",
          value: "value",
          domain: "app.hey.com",
          path: "/",
        },
      ],
      lastValidated: Date.now(),
    }

    const header = getCookieHeader(singleCookieSession)

    expect(header).toBe("test=value")
  })
})

describe("resolvePython3", () => {
  test("returns an absolute path (does not rely on bare PATH lookup at spawn time)", () => {
    const pythonPath = resolvePython3()
    expect(pythonPath).toStartWith("/")
  })

  test("returned path points to an existing file", () => {
    const pythonPath = resolvePython3()
    expect(existsSync(pythonPath)).toBe(true)
  })
})
