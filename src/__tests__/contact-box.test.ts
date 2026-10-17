import { describe, expect, test } from "bun:test"
import {
  CONTACT_BOX_TTL_SECONDS,
  type ContactBoxFetcher,
  createContactBoxResolver,
  NO_CONTACT_TTL_SECONDS,
  normaliseSender,
  parseDeliveryBox,
} from "../contact-box"
import { boxSettings, fakeHey, memoryStore } from "./helpers/contacts"

describe("parseDeliveryBox", () => {
  test("reads the selected delivery destination", () => {
    expect(parseDeliveryBox(boxSettings("imbox"))).toBe("imbox")
    expect(parseDeliveryBox(boxSettings("feedbox"))).toBe("feed")
    expect(parseDeliveryBox(boxSettings("trailbox"))).toBe("paper_trail")
    expect(parseDeliveryBox(boxSettings("screened-out"))).toBe("screened_out")
  })

  test("ignores other groups and pages without a selection", () => {
    expect(parseDeliveryBox(boxSettings("none"))).toBeNull()
    expect(parseDeliveryBox("<html><body>Sign in</body></html>")).toBeNull()
  })
})

describe("normaliseSender", () => {
  test("lowercases addresses and rejects anything else", () => {
    expect(normaliseSender(" Boss@Example.org ")).toBe("boss@example.org")
    expect(normaliseSender("Boss")).toBeNull()
    expect(normaliseSender("a b@example.org")).toBeNull()
  })
})

describe("contact box resolver", () => {
  test("looks up once, then answers from the cache", async () => {
    const store = memoryStore()
    const { fetcher, calls } = fakeHey()
    const r = createContactBoxResolver(store, fetcher, () => 1000)
    expect(r.cached("boss@example.org")).toBeNull()
    expect(await r.contactBox("Boss@Example.org")).toBe("imbox")
    expect(await r.contactBox("boss@example.org")).toBe("imbox")
    expect(calls).toEqual(["search:boss@example.org", "settings:100"])
    expect(r.cached("boss@example.org")).toBe("imbox")
  })

  test("caches 'not a contact' for a shorter time", async () => {
    const store = memoryStore()
    const { fetcher, calls } = fakeHey()
    let now = 1000
    const r = createContactBoxResolver(store, fetcher, () => now)
    expect(await r.contactBox("stranger@example.org")).toBeNull()
    expect(r.cached("stranger@example.org")).toBe("none")
    now += NO_CONTACT_TTL_SECONDS - 1
    expect(r.cached("stranger@example.org")).toBe("none")
    now += 1
    expect(r.cached("stranger@example.org")).toBeNull()
    expect(calls).toEqual(["search:stranger@example.org"])
  })

  test("a delivery setting expires after 30 days", async () => {
    const store = memoryStore()
    const { fetcher } = fakeHey()
    let now = 1000
    const r = createContactBoxResolver(store, fetcher, () => now)
    await r.lookup("news@example.net")
    now += CONTACT_BOX_TTL_SECONDS - 1
    expect(r.cached("news@example.net")).toBe("feed")
    now += 1
    expect(r.cached("news@example.net")).toBeNull()
  })

  test("concurrent lookups of one sender share the requests", async () => {
    const { fetcher, calls } = fakeHey()
    const r = createContactBoxResolver(memoryStore(), fetcher, () => 1000)
    const answers = await Promise.all([
      r.lookup("boss@example.org"),
      r.lookup("BOSS@example.org"),
      r.lookup("boss@example.org"),
    ])
    expect(answers).toEqual(["imbox", "imbox", "imbox"])
    expect(calls).toHaveLength(2)
  })

  test("network errors are not cached", async () => {
    const store = memoryStore()
    const failing: ContactBoxFetcher = {
      findContactId: async () => {
        throw new Error("offline")
      },
      boxSettingsHtml: async () => "",
    }
    const r = createContactBoxResolver(store, failing, () => 1000)
    await expect(r.lookup("boss@example.org")).rejects.toThrow("offline")
    expect(store.rows.size).toBe(0)
  })

  test("invalid addresses make no request", async () => {
    const { fetcher, calls } = fakeHey()
    const r = createContactBoxResolver(memoryStore(), fetcher, () => 1000)
    expect(await r.lookup("not an address")).toBe("none")
    expect(calls).toEqual([])
  })
})
