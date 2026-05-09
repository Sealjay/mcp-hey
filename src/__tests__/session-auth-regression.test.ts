import { describe, expect, test } from "bun:test"

const sessionModule = await import("../session")

describe("post-auth session acceptance", () => {
  test("rejects a session that lacks the Hey session cookie", async () => {
    const validateSession = async () => true

    const accepted = await sessionModule.validateAuthenticatedSession(
      {
        cookies: [
          {
            name: "remember_user_token",
            value: "token-only",
            domain: "app.hey.com",
            path: "/",
          },
        ],
        lastValidated: Date.now(),
      },
      validateSession,
    )

    expect(accepted).toBeNull()
  })

  test("re-validates a freshly written auth session before accepting it", async () => {
    const validateSession = async () => false

    const accepted = await sessionModule.validateAuthenticatedSession(
      {
        cookies: [
          {
            name: "session_token",
            value: "looks-valid",
            domain: "app.hey.com",
            path: "/",
          },
        ],
        lastValidated: Date.now(),
      },
      validateSession,
    )

    expect(accepted).toBeNull()
  })
})
