import { describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ContactBoxAnswer } from "../contact-box"
import { heyClient } from "../hey-client"
import {
  DEFAULT_SETTINGS,
  SENDER_GROUP_TOOLS,
  type SenderGroupSettings,
  withSenderGroups,
} from "../sender-groups"

/**
 * Tools that return no messages, with the reason. Every tool in src/index.ts
 * must be listed here or in SENDER_GROUP_TOOLS, so a new tool gets a decision.
 */
const NO_MESSAGE_TOOLS: Record<string, string> = {
  hey_list_labels: "label names only",
  hey_list_collections: "collection names only",
  hey_label: "returns {success}",
  hey_collection: "returns {success}",
  hey_download_attachment: "returns a file path",
  hey_get_calendar_invite: "returns a parsed invite",
  hey_send_email: "returns {success}",
  hey_reply: "returns {success}",
  hey_forward: "returns {success}",
  hey_save_draft: "returns {success, draftId}",
  hey_edit_draft: "returns {success, draftId}",
  hey_delete_draft: "returns {success, draftId}",
  hey_set_aside: "returns {success}",
  hey_reply_later: "returns {success}",
  hey_unset_aside: "returns {success}",
  hey_remove_reply_later: "returns {success}",
  hey_screen: "returns {success}",
  hey_screen_by_id: "returns {success}",
  hey_set_status: "returns {success}",
  hey_move_to: "returns {success}",
  hey_mark_unseen: "returns {success}",
  hey_mark_seen: "returns {success}",
  hey_read_status: "returns {success}",
  hey_bubble_up: "returns {success}",
  hey_bubble_up_if_no_reply: "returns {success}",
  hey_pop_bubble: "returns {success}",
  hey_thread_mute: "returns {success}",
  hey_cache_status: "cache statistics",
}

const settings = (mode: SenderGroupSettings["mode"]): SenderGroupSettings => ({
  ...DEFAULT_SETTINGS,
  mode,
})

const groups: Record<string, ContactBoxAnswer> = {
  "boss@example.org": "imbox",
  "news@example.net": "feed",
  "shop@example.com": "paper_trail",
}
const resolver = {
  cached: (s: string) => groups[s] ?? null,
  lookup: async () => {
    throw new Error("no lookups in these tests")
  },
}
const opts = {
  settings: settings("cache"),
  resolver,
  senderAddress: () => undefined,
}

const email = (id: string, fromEmail?: string) => ({
  id,
  topicId: id,
  from: "Someone",
  fromEmail,
  subject: "s",
})
const listResult = () => ({
  data: [
    email("1", "boss@example.org"),
    email("2", "news@example.net"),
    email("3"),
  ],
  _cache: { source: "cache" },
})

describe("every tool is classified", () => {
  test("tools in src/index.ts", () => {
    const source = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf8")
    const names = [...source.matchAll(/^\s{4}name: "(hey_[a-z_]+)",$/gm)].map(
      (m) => m[1],
    )
    expect(names.length).toBeGreaterThan(30)
    const unclassified = names.filter(
      (n) => !(n in SENDER_GROUP_TOOLS) && !(n in NO_MESSAGE_TOOLS),
    )
    expect(unclassified).toEqual([])
    const stale = [
      ...Object.keys(SENDER_GROUP_TOOLS),
      ...Object.keys(NO_MESSAGE_TOOLS),
    ].filter((n) => !names.includes(n))
    expect(stale).toEqual([])
  })
})

describe("withSenderGroups", () => {
  for (const [tool, kind] of Object.entries(SENDER_GROUP_TOOLS).filter(
    ([, k]) => k === "list",
  )) {
    test(`${tool} tags every message (${kind})`, async () => {
      const out = (await withSenderGroups(tool, listResult(), opts)) as {
        data: Array<{ sender_group: string }>
        _cache: unknown
        _sender_groups: { unknown: number }
      }
      expect(out.data.map((e) => e.sender_group)).toEqual([
        "imbox",
        "feed",
        "unknown",
      ])
      expect(out._cache).toEqual({ source: "cache" })
      expect(out._sender_groups.unknown).toBe(1)
    })
  }

  test("hey_imbox_summary tags emails and bubbled-up emails", async () => {
    const out = (await withSenderGroups(
      "hey_imbox_summary",
      {
        data: {
          screenerCount: 1,
          newCount: 2,
          bubbledUpCount: 1,
          emails: [
            email("1", "boss@example.org"),
            email("2", "news@example.net"),
          ],
          bubbledUpEmails: [email("1", "boss@example.org")],
        },
        _cache: {},
      },
      opts,
    )) as {
      data: {
        screenerCount: number
        emails: Array<{ sender_group: string }>
        bubbledUpEmails: Array<{ sender_group: string }>
      }
    }
    expect(out.data.screenerCount).toBe(1)
    expect(out.data.emails.map((e) => e.sender_group)).toEqual([
      "imbox",
      "feed",
    ])
    expect(out.data.bubbledUpEmails.map((e) => e.sender_group)).toEqual([
      "imbox",
    ])
  })

  test("hey_read_email tags the thread and each entry", async () => {
    const out = (await withSenderGroups(
      "hey_read_email",
      {
        data: {
          id: "9",
          from: "Boss",
          fromEmail: "boss@example.org",
          subject: "s",
          body: "b",
          entries: [
            {
              entryId: "a",
              from: "Boss",
              fromEmail: "boss@example.org",
              body: "b",
            },
            {
              entryId: "b",
              from: "Shop",
              fromEmail: "Shop@Example.com",
              body: "b",
            },
          ],
        },
        _cache: {},
      },
      opts,
    )) as {
      data: {
        sender_group: string
        body: string
        entries: Array<{ sender_group: string }>
      }
    }
    expect(out.data.sender_group).toBe("imbox")
    expect(out.data.body).toBe("b")
    expect(out.data.entries.map((e) => e.sender_group)).toEqual([
      "imbox",
      "paper_trail",
    ])
  })

  test("a thread without entries keeps that shape", async () => {
    const out = (await withSenderGroups(
      "hey_read_email",
      {
        data: {
          id: "9",
          from: "x",
          fromEmail: "news@example.net",
          subject: "s",
          body: "b",
        },
        _cache: {},
      },
      opts,
    )) as { data: Record<string, unknown> }
    expect(out.data.sender_group).toBe("feed")
    expect("entries" in out.data).toBe(false)
  })

  test("search results without an address use the local message cache", async () => {
    const out = (await withSenderGroups(
      "hey_search",
      { data: [email("7")], _cache: {} },
      {
        ...opts,
        senderAddress: (item) =>
          item.topicId === "7" ? "shop@example.com" : undefined,
      },
    )) as { data: Array<{ sender_group: string }> }
    expect(out.data[0].sender_group).toBe("paper_trail")
  })

  test("the screener is tagged from the cache only", async () => {
    let lookups = 0
    const counting = {
      cached: () => null,
      lookup: async () => {
        lookups++
        return "imbox" as const
      },
    }
    await withSenderGroups("hey_list_screener", listResult(), {
      settings: settings("on"),
      resolver: counting,
      senderAddress: () => undefined,
      headroom: () => 100,
    })
    expect(lookups).toBe(0)
  })

  test("other tools and unexpected shapes are returned unchanged", async () => {
    const r = { success: true }
    expect(await withSenderGroups("hey_set_aside", r, opts)).toBe(r)
    const odd = { data: "not a list" }
    expect(await withSenderGroups("hey_list_emails", odd, opts)).toBe(odd)
  })

  test("off mode returns the result as is and makes zero requests", async () => {
    const fetchSpy = spyOn(heyClient, "fetchHtml").mockImplementation(
      async () => {
        throw new Error("no requests expected")
      },
    )
    try {
      const r = listResult()
      for (const tool of Object.keys(SENDER_GROUP_TOOLS)) {
        expect(
          await withSenderGroups(tool, r, { settings: settings("off") }),
        ).toBe(r)
      }
      expect(fetchSpy).toHaveBeenCalledTimes(0)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
