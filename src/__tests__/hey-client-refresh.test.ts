import { describe, expect, test } from "bun:test"
import { HeyClient } from "../hey-client"

const mockSession = {
  cookies: [
    {
      name: "session_token",
      value: "test-session",
      domain: "app.hey.com",
      path: "/",
    },
  ],
  lastValidated: Date.now(),
}

let runAuthHelperCalls = 0
let releaseAuthHelper: (() => void) | null = null

describe("HeyClient.refreshSession", () => {
  test("coalesces concurrent refreshes into one auth helper launch", async () => {
    runAuthHelperCalls = 0
    releaseAuthHelper = null

    const client = new HeyClient({
      ensureValidSession: async () => mockSession,
      loadSession: async () => mockSession,
      runAuthHelper: async () => {
        runAuthHelperCalls++
        await new Promise<void>((resolve) => {
          releaseAuthHelper = resolve
        })
        return true
      },
      validateAuthenticatedSession: async () => mockSession,
    })
    const refreshA = client.refreshSession()
    const refreshB = client.refreshSession()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runAuthHelperCalls).toBe(1)

    // Cast: TS narrows `releaseAuthHelper` to `null` after the reset above
    // and can't see that the runAuthHelper closure has reassigned it.
    const release = releaseAuthHelper as (() => void) | null
    if (!release) {
      throw new Error("expected auth helper to be waiting")
    }
    release()

    await Promise.all([refreshA, refreshB])
  })
})
