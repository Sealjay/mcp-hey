import { describe, expect, spyOn, test } from "bun:test"
import type { ContactBoxAnswer } from "../contact-box"
import {
  DEFAULT_SETTINGS,
  resolveSenderGroups,
  type SenderGroupSettings,
  senderGroupSettings,
  tagSenderGroups,
} from "../sender-groups"

const on = (over: Partial<SenderGroupSettings> = {}): SenderGroupSettings => ({
  ...DEFAULT_SETTINGS,
  mode: "on",
  ...over,
})

/** A fake resolver: `cache` answers without requests; lookups are counted and may be slow. */
function fakeResolver(
  cache: Record<string, ContactBoxAnswer> = {},
  answers: Record<string, ContactBoxAnswer> = {},
  delayMs = 0,
) {
  const stats = {
    lookups: [] as string[],
    cacheReads: 0,
    running: 0,
    maxRunning: 0,
  }
  return {
    stats,
    resolver: {
      cached: (s: string) => {
        stats.cacheReads++
        return cache[s] ?? null
      },
      lookup: async (s: string) => {
        stats.lookups.push(s)
        stats.running++
        stats.maxRunning = Math.max(stats.maxRunning, stats.running)
        await new Promise((r) => setTimeout(r, delayMs))
        stats.running--
        if (answers[s] === undefined) throw new Error(`no answer for ${s}`)
        return answers[s]
      },
    },
  }
}

describe("senderGroupSettings", () => {
  test("defaults and bounds", () => {
    expect(senderGroupSettings({})).toEqual(DEFAULT_SETTINGS)
    const s = senderGroupSettings({
      HEY_SENDER_GROUPS: "CACHE",
      HEY_SENDER_GROUP_BUDGET: "500",
      HEY_SENDER_GROUP_TIMEOUT_MS: "-5",
    })
    expect(s.mode).toBe("cache")
    expect(s.budget).toBe(50)
    expect(s.timeoutMs).toBe(0)
  })

  test("an unknown mode falls back to the default", () => {
    const err = spyOn(console, "error").mockImplementation(() => {})
    expect(senderGroupSettings({ HEY_SENDER_GROUPS: "maybe" }).mode).toBe(
      DEFAULT_SETTINGS.mode,
    )
    err.mockRestore()
  })
})

describe("resolveSenderGroups", () => {
  test("answers from the cache and dedupes senders", async () => {
    const { resolver, stats } = fakeResolver({
      "boss@example.org": "imbox",
      "x@example.org": "none",
    })
    const r = await resolveSenderGroups(
      ["Boss@Example.org", "boss@example.org", "x@example.org", null, "nope"],
      {
        settings: on(),
        resolver,
        headroom: () => 100,
      },
    )
    expect(r.groups.get("boss@example.org")).toBe("imbox")
    expect(r.groups.get("x@example.org")).toBe("unknown")
    expect(stats.cacheReads).toBe(2)
    expect(stats.lookups).toEqual([])
  })

  test("looks up uncached senders within the budget, at most 3 at a time", async () => {
    const senders = Array.from({ length: 15 }, (_, i) => `s${i}@example.org`)
    const answers = Object.fromEntries(senders.map((s) => [s, "feed" as const]))
    const { resolver, stats } = fakeResolver({}, answers, 5)
    const r = await resolveSenderGroups(senders, {
      settings: on({ budget: 10 }),
      resolver,
      headroom: () => 100,
    })
    expect(stats.lookups).toHaveLength(10)
    expect(stats.maxRunning).toBeLessThanOrEqual(3)
    expect(r.lookedUp).toBe(10)
    expect(r.deferred).toBe(5)
    expect(r.groups.size).toBe(10)
  })

  test("cache mode never looks up", async () => {
    const { resolver, stats } = fakeResolver({}, { "a@example.org": "imbox" })
    const r = await resolveSenderGroups(["a@example.org"], {
      settings: on({ mode: "cache" }),
      resolver,
      headroom: () => 100,
    })
    expect(stats.lookups).toEqual([])
    expect(r.deferred).toBe(1)
  })

  test("off mode reads nothing", async () => {
    const { resolver, stats } = fakeResolver({ "a@example.org": "imbox" })
    const r = await resolveSenderGroups(["a@example.org"], {
      settings: on({ mode: "off" }),
      resolver,
    })
    expect(stats.cacheReads).toBe(0)
    expect(stats.lookups).toEqual([])
    expect(r.groups.size).toBe(0)
  })

  test("allowLookups=false answers from the cache only", async () => {
    const { resolver, stats } = fakeResolver({}, { "a@example.org": "imbox" })
    await resolveSenderGroups(["a@example.org"], {
      settings: on(),
      resolver,
      allowLookups: false,
      headroom: () => 100,
    })
    expect(stats.lookups).toEqual([])
  })

  test("returns at the time limit and leaves slow lookups running", async () => {
    const { resolver } = fakeResolver({}, { "slow@example.org": "imbox" }, 200)
    const started = Date.now()
    const r = await resolveSenderGroups(["slow@example.org"], {
      settings: on({ timeoutMs: 30 }),
      resolver,
      headroom: () => 100,
    })
    expect(Date.now() - started).toBeLessThan(150)
    expect(r.pending).toBe(1)
    expect(r.groups.has("slow@example.org")).toBe(false)
  })

  test("stops starting lookups when rate-limit headroom is low", async () => {
    const { resolver, stats } = fakeResolver(
      {},
      { "a@example.org": "imbox", "b@example.org": "feed" },
    )
    const r = await resolveSenderGroups(["a@example.org", "b@example.org"], {
      settings: on(),
      resolver,
      headroom: () => 5,
    })
    expect(stats.lookups).toEqual([])
    expect(r.deferred).toBe(2)
  })

  test("a failed lookup leaves the sender unknown", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {})
    const { resolver } = fakeResolver({}, {})
    const r = await resolveSenderGroups(["a@example.org"], {
      settings: on(),
      resolver,
      headroom: () => 100,
    })
    expect(r.groups.has("a@example.org")).toBe(false)
    expect(r.lookedUp).toBe(0)
    err.mockRestore()
  })

  test("an unusable cache is treated as empty", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {})
    const resolver = {
      cached: () => {
        throw new Error("db gone")
      },
      lookup: async () => "paper_trail" as const,
    }
    const r = await resolveSenderGroups(["a@example.org"], {
      settings: on(),
      resolver,
      headroom: () => 100,
    })
    expect(r.groups.get("a@example.org")).toBe("paper_trail")
    err.mockRestore()
  })
})

describe("tagSenderGroups", () => {
  const items = [
    { id: "1", fromEmail: "boss@example.org", subject: "a" },
    { id: "2", subject: "search hit without address" },
    { id: "3", fromEmail: "stranger@example.org", subject: "c" },
  ]

  test("tags every item, finds missing addresses, does not change the input", async () => {
    const { resolver } = fakeResolver({
      "boss@example.org": "imbox",
      "news@example.net": "feed",
    })
    const { items: tagged, summary } = await tagSenderGroups(items, {
      settings: on({ mode: "cache" }),
      resolver,
      senderAddress: (item) =>
        item.id === "2" ? "news@example.net" : undefined,
    })
    expect(tagged.map((t) => t.sender_group)).toEqual([
      "imbox",
      "feed",
      "unknown",
    ])
    expect(summary).toEqual({
      mode: "cache",
      unknown: 1,
      looked_up: 0,
      deferred: 1,
    })
    expect("sender_group" in items[0]).toBe(false)
  })

  test("off mode returns the items untouched", async () => {
    const { resolver, stats } = fakeResolver({ "boss@example.org": "imbox" })
    const { items: tagged } = await tagSenderGroups(items, {
      settings: on({ mode: "off" }),
      resolver,
    })
    expect(tagged).toBe(items)
    expect(stats.cacheReads).toBe(0)
  })
})
