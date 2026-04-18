import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import { heyClient } from "../hey-client"
import {
  organiseResponseToResult,
  tryEndpoints,
  withCsrfRetry,
} from "../tools/http-helpers"

function mockResponse(status: number): Response {
  return new Response(null, { status })
}

describe("withCsrfRetry", () => {
  beforeEach(() => {
    // Reset any prior spies
    spyOn(heyClient, "invalidateCsrfToken").mockClear()
  })

  test("returns the response unchanged on success", async () => {
    const fn = () => Promise.resolve(mockResponse(200))
    const response = await withCsrfRetry(fn)
    expect(response.status).toBe(200)
  })

  test("invalidates the CSRF token and retries once on 422", async () => {
    const invalidate = spyOn(heyClient, "invalidateCsrfToken").mockReturnValue()
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve(mockResponse(calls === 1 ? 422 : 200))
    }

    const response = await withCsrfRetry(fn)
    expect(response.status).toBe(200)
    expect(calls).toBe(2)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  test("does not retry a second time if the retry also returns 422", async () => {
    spyOn(heyClient, "invalidateCsrfToken").mockReturnValue()
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve(mockResponse(422))
    }

    const response = await withCsrfRetry(fn)
    expect(response.status).toBe(422)
    expect(calls).toBe(2)
  })

  test("does not retry on non-422 statuses", async () => {
    const invalidate = spyOn(heyClient, "invalidateCsrfToken").mockReturnValue()
    let calls = 0
    const fn = () => {
      calls++
      return Promise.resolve(mockResponse(500))
    }

    const response = await withCsrfRetry(fn)
    expect(response.status).toBe(500)
    expect(calls).toBe(1)
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe("tryEndpoints", () => {
  test("returns the first response whose status is ok", async () => {
    const calls: string[] = []
    const response = await tryEndpoints(["/a", "/b", "/c"], (endpoint) => {
      calls.push(endpoint)
      return Promise.resolve(mockResponse(endpoint === "/b" ? 200 : 404))
    })
    expect(response.status).toBe(200)
    expect(calls).toEqual(["/a", "/b"])
  })

  test("returns the first response whose status is 302", async () => {
    const calls: string[] = []
    const response = await tryEndpoints(["/a", "/b"], (endpoint) => {
      calls.push(endpoint)
      return Promise.resolve(mockResponse(endpoint === "/a" ? 302 : 200))
    })
    expect(response.status).toBe(302)
    expect(calls).toEqual(["/a"])
  })

  test("returns the last response when all endpoints fail", async () => {
    const calls: string[] = []
    const response = await tryEndpoints(["/a", "/b"], (endpoint) => {
      calls.push(endpoint)
      return Promise.resolve(mockResponse(404))
    })
    expect(response.status).toBe(404)
    expect(calls).toEqual(["/a", "/b"])
  })

  test("throws if the endpoint list is empty", async () => {
    await expect(
      tryEndpoints([], () => Promise.resolve(mockResponse(200))),
    ).rejects.toThrow("no endpoints attempted")
  })
})

describe("organiseResponseToResult", () => {
  test("runs onSuccess and returns success on 2xx", () => {
    let called = false
    const result = organiseResponseToResult(mockResponse(204), () => {
      called = true
    })
    expect(result).toEqual({ success: true })
    expect(called).toBe(true)
  })

  test("runs onSuccess and returns success on 302", () => {
    let called = false
    const result = organiseResponseToResult(mockResponse(302), () => {
      called = true
    })
    expect(result).toEqual({ success: true })
    expect(called).toBe(true)
  })

  test("returns a failure result and skips onSuccess on 4xx/5xx", () => {
    let called = false
    const result = organiseResponseToResult(mockResponse(500), () => {
      called = true
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain("500")
    expect(called).toBe(false)
  })
})
