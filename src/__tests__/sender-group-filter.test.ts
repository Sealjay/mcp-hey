import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ContactBoxAnswer } from "../contact-box"
import {
  applyGroupFilter,
  GROUP_FILTER_TOOLS,
  type GroupFilterReport,
  groupFilterFor,
  parseGroupFilter,
} from "../sender-group-filter"
import { DEFAULT_SETTINGS, withSenderGroups } from "../sender-groups"

const email = (id: string, fromEmail?: string, sender_group?: string) => ({
  id,
  topicId: id,
  from: "Someone",
  fromEmail,
  subject: "s",
  ...(sender_group ? { sender_group } : {}),
})

type Out = {
  data: Array<{ id: string; sender_group?: string }>
  _group_filter: GroupFilterReport
  _cache?: unknown
}

describe("parseGroupFilter", () => {
  test("accepts one group or a list, case-insensitive, deduplicated", () => {
    expect(parseGroupFilter(undefined)).toBeUndefined()
    expect(parseGroupFilter("Feed")).toEqual(["feed"])
    expect(parseGroupFilter(["imbox", "paper_trail", "imbox"])).toEqual([
      "imbox",
      "paper_trail",
    ])
    expect(parseGroupFilter(["screened_out"])).toEqual(["screened_out"])
  })

  test("rejects empty lists, unknown names and non-strings", () => {
    expect(parseGroupFilter([])).toBeNull()
    expect(parseGroupFilter(["unknown"])).toBeNull()
    expect(parseGroupFilter(["inbox"])).toBeNull()
    expect(parseGroupFilter([1])).toBeNull()
  })
})

describe("applyGroupFilter", () => {
  const tagged = () => ({
    data: [
      email("1", "a@example.org", "imbox"),
      email("2", "b@example.org", "feed"),
      email("3", "c@example.org", "unknown"),
      email("4", undefined, "paper_trail"),
      email("5"),
    ],
    _cache: { source: "cache" },
  })

  test("keeps matching messages and reports the rest", () => {
    const out = applyGroupFilter(
      tagged(),
      ["imbox", "paper_trail"],
      "on",
    ) as Out
    expect(out.data.map((e) => e.id)).toEqual(["1", "4"])
    expect(out._cache).toEqual({ source: "cache" })
    expect(out._group_filter).toMatchObject({
      groups: ["imbox", "paper_trail"],
      matched: 2,
      excluded: 1,
      unclassified: 2,
      unclassified_ids: ["3", "5"],
    })
    expect(out._group_filter.note).toContain("Calling again")
  })

  test("in cache mode the note says how to enable lookups", () => {
    const out = applyGroupFilter(tagged(), ["feed"], "cache") as Out
    expect(out._group_filter.note).toContain("HEY_SENDER_GROUPS=on")
  })

  test("no note when every message is classified", () => {
    const out = applyGroupFilter(
      { data: [email("1", "a@example.org", "feed")] },
      ["feed"],
      "on",
    ) as Out
    expect(out._group_filter).toEqual({
      groups: ["feed"],
      matched: 1,
      excluded: 0,
      unclassified: 0,
    })
  })

  test("lists at most 20 unclassified IDs", () => {
    const data = Array.from({ length: 30 }, (_, i) => email(String(i)))
    const out = applyGroupFilter({ data }, ["imbox"], "on") as Out
    expect(out._group_filter.unclassified).toBe(30)
    expect(out._group_filter.unclassified_ids).toHaveLength(20)
  })

  test("unexpected shapes are returned unchanged", () => {
    const odd = { data: { emails: [] } }
    expect(applyGroupFilter(odd, ["imbox"], "on")).toBe(odd)
  })
})

describe("filtering after tagging", () => {
  test("uncached senders are looked up within the budget, the rest are reported", async () => {
    const answers: Record<string, ContactBoxAnswer> = {
      "s0@example.org": "feed",
      "s1@example.org": "imbox",
      "s2@example.org": "feed",
    }
    const lookups: string[] = []
    const resolver = {
      cached: () => null,
      lookup: async (s: string) => {
        lookups.push(s)
        return answers[s] ?? "none"
      },
    }
    const result = {
      data: ["s0", "s1", "s2", "s3"].map((s, i) =>
        email(String(i), `${s}@example.org`),
      ),
      _cache: {},
    }
    const tagged = await withSenderGroups("hey_search", result, {
      settings: { ...DEFAULT_SETTINGS, mode: "on", budget: 2 },
      resolver,
      senderAddress: () => undefined,
      headroom: () => 100,
    })
    const out = applyGroupFilter(tagged, ["feed"], "on") as Out
    expect(lookups).toHaveLength(2)
    expect(out.data.map((e) => e.id)).toEqual(["0"])
    expect(out._group_filter).toMatchObject({
      matched: 1,
      excluded: 1,
      unclassified: 2,
      unclassified_ids: ["2", "3"],
    })
  })
})

describe("tool schemas", () => {
  test("exactly the filter tools take a group parameter", () => {
    const source = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf8")
    const blocks = source.split(/\n\s{2}\{\n\s{4}name: "/).slice(1)
    const withGroup = blocks
      .filter((b) => /\n\s{8}group: \{/.test(b))
      .map((b) => b.slice(0, b.indexOf('"')))
    expect(withGroup.sort()).toEqual([...GROUP_FILTER_TOOLS].sort())
    expect(withGroup).not.toContain("hey_list_emails")
  })
})

describe("groupFilterFor", () => {
  test("no filter unless a filter tool gets group", () => {
    expect(groupFilterFor("hey_search", { query: "x" }, "on")).toEqual({})
    expect(
      groupFilterFor("hey_list_emails", { group: ["feed"] }, "on"),
    ).toEqual({})
  })

  test("valid groups", () => {
    expect(
      groupFilterFor(
        "hey_list_set_aside",
        { group: ["feed", "imbox"] },
        "cache",
      ),
    ).toEqual({
      groups: ["feed", "imbox"],
    })
  })

  test("invalid groups and off mode are errors", () => {
    expect(
      groupFilterFor("hey_search", { group: ["inbox"] }, "on").error,
    ).toContain("group must be")
    expect(
      groupFilterFor("hey_search", { group: ["feed"] }, "off").error,
    ).toContain("HEY_SENDER_GROUPS is off")
  })
})
