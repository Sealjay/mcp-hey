import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { heyClient } from "../hey-client"
import { listAttachmentsForEmail } from "../tools/attachments"
import { readEmail, resolveMessageId } from "../tools/read"

const threadHtml = `
<main data-topic-id="topic-42">
  <a href="/messages/999/edit">Navigation link, not an entry</a>
  <article class="entry entry--sheet" id="entry_101" data-message-id="201">
    <a class="entry__edit" href="/messages/201/edit">Message metadata</a>
    <message-content>
      <a href="/messages/998/edit">User-authored link</a>
      <article class="entry entry--sheet" id="entry_998"></article>
    </message-content>
  </article>
  <article class="entry entry--sheet" id="entry_102">
    <a class="entry__edit" href="/messages/202/edit">Message metadata</a>
  </article>
</main>
`

const rawWithAlternativeAndCalendar = [
  "From: Sender <sender@example.com>",
  "Subject: Cafe",
  'Content-Type: multipart/mixed; boundary="OuTeR"',
  "",
  "Outer MIME preamble must be ignored",
  "--OuTeR",
  'Content-Type: multipart/alternative; boundary="MiXeD"',
  "",
  "Alternative MIME preamble must be ignored",
  "--MiXeD",
  'Content-Type: text/html; charset="utf-8"',
  "",
  '<iframe srcdoc="&lt;p&gt;HTML alternative&lt;/p&gt;"></iframe>',
  "--MiXeD",
  'Content-Type: text/plain; charset="iso-8859-1"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "caf=E9 plain alternative",
  "--MiXeD--",
  "--OuTeR",
  'Content-Type: text/calendar; method=REQUEST; charset="utf-8"',
  'Content-Disposition: attachment; filename="invite.ics"',
  "",
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "SUMMARY:Lunch",
  "DTSTART:20260513T120000Z",
  "END:VEVENT",
  "END:VCALENDAR",
  "--OuTeR--",
  "Outer epilogue must be ignored",
  "",
].join("\r\n")

const rawHtmlOnly = [
  "From: Other <other@example.com>",
  "Subject: HTML only",
  'Content-Type: text/html; charset="utf-8"',
  "",
  '<iframe srcdoc="&lt;p&gt;Readable iframe&lt;/p&gt;"></iframe>',
  "",
].join("\r\n")

afterEach(() => mock.restore())

describe("whole-thread text reads", () => {
  test("fetches only entries in the requested topic and preserves MIME metadata", async () => {
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path === "/topics/topic-42") return threadHtml
        if (path === "/messages/201.text") return rawWithAlternativeAndCalendar
        if (path === "/messages/202.text") return rawHtmlOnly
        throw new Error(`Unexpected fetch: ${path}`)
      },
    )

    const { data } = await readEmail("topic-42", { format: "text" })

    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/topics/topic-42",
      "/messages/201.text",
      "/messages/202.text",
    ])
    expect(data.entries?.map((entry) => entry.entryId)).toEqual(["101", "102"])
    expect(data.entries?.[0].body).toBe("café plain alternative")
    expect(data.entries?.[1].body).toBe("Readable iframe")
    expect(data.attachments?.map((attachment) => attachment.filename)).toEqual([
      "invite.ics",
    ])
    expect(data.calendar_invites?.[0].summary).toBe("Lunch")
    expect(data.body).toBe("")
  })

  test("uses a bounded number of concurrent requests and response limits", async () => {
    const entries = Array.from({ length: 8 }, (_, i) => {
      const id = 300 + i
      return `<article class="entry entry--sheet" id="entry_${id}" data-message-id="${id + 1000}"></article>`
    }).join("")
    let active = 0
    let maximumActive = 0
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path === "/topics/topic-limits") {
          return `<main data-topic-id="topic-limits">${entries}</main>`
        }
        active++
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active--
        return [
          "From: Sender <sender@example.com>",
          "Subject: Test",
          "Content-Type: text/plain",
          "",
          "x".repeat(30),
        ].join("\r\n")
      },
    )

    const { data } = await readEmail("topic-limits", {
      format: "text",
      maxEntries: 8,
      maxCharsPerEntry: 20,
      maxCharsTotal: 25,
    })

    expect(maximumActive).toBeLessThanOrEqual(4)
    expect(fetch.mock.calls).toHaveLength(9)
    expect(data.entries).toHaveLength(8)
    expect(
      data.entries?.reduce((sum, entry) => sum + entry.body.length, 0),
    ).toBe(25)
    expect(data.truncated).toBe(true)
  })

  test("limits malformed and oversized messages and errors when none are readable", async () => {
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path === "/topics/topic-bad") {
          return '<main data-topic-id="topic-bad"><article class="entry entry--sheet" id="entry_1"></article></main>'
        }
        if (path === "/messages/1.text") return "not a MIME message"
        throw new Error(`Unexpected fetch: ${path}`)
      },
    )

    await expect(readEmail("topic-bad", { format: "text" })).rejects.toThrow(
      "No readable entries found for email topic-bad",
    )
    expect(fetch.mock.calls).toHaveLength(2)
  })

  test("rejects oversized MIME before parsing or attachment discovery", async () => {
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path === "/topics/topic-large") {
          return '<main data-topic-id="topic-large"><article class="entry entry--sheet" id="entry_2"></article></main>'
        }
        if (path === "/messages/2.text") return "x".repeat(2_000_001)
        throw new Error(`Unexpected fetch: ${path}`)
      },
    )

    await expect(readEmail("topic-large", { format: "text" })).rejects.toThrow(
      "No readable entries found for email topic-large",
    )
    expect(fetch.mock.calls).toHaveLength(2)
  })

  test("resolves shared message IDs from entry metadata, not page links", async () => {
    spyOn(heyClient, "fetchHtml").mockResolvedValue(
      '<main data-topic-id="topic-resolve"><a href="/messages/999/edit">Nav</a><article class="entry entry--sheet" id="entry_3" data-message-id="303"><message-content><a href="/messages/888/edit">Body</a></message-content></article></main>',
    )
    expect(await resolveMessageId("topic-resolve")).toBe("303")
  })

  test("attachment discovery uses the same topic-scoped message resolution", async () => {
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path === "/topics/topic-attachments") {
          return '<main data-topic-id="topic-attachments"><a href="/messages/999/edit">Nav</a><article class="entry entry--sheet" id="entry_6" data-message-id="606"></article></main>'
        }
        if (path === "/messages/606.text") return rawWithAlternativeAndCalendar
        throw new Error(`Unexpected fetch: ${path}`)
      },
    )

    const result = await listAttachmentsForEmail("topic-attachments")

    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/topics/topic-attachments",
      "/messages/606.text",
    ])
    expect(result.attachments[0].filename).toBe("invite.ics")
  })

  test("still reads direct posting and entry IDs in text format", async () => {
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path.startsWith("/topics/")) return "<main></main>"
        if (path.endsWith(".text")) return rawHtmlOnly
        throw new Error(`Unexpected fetch: ${path}`)
      },
    )

    const posting = await readEmail("posting-44", { format: "text" })
    const entry = await readEmail("entry-45", { format: "text" })

    expect(posting.data.entries?.[0].entryId).toBe("posting-44")
    expect(entry.data.entries?.[0].entryId).toBe("entry-45")
    expect(fetch.mock.calls).toContainEqual(["/messages/posting-44.text"])
    expect(fetch.mock.calls).toContainEqual(["/messages/entry-45.text"])
  })

  test("resolves posting IDs through their owned topic metadata", async () => {
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path === "/topics/posting-77") throw new Error("not a topic")
        if (path === "/entries/posting-77") throw new Error("not an entry")
        if (path === "/postings/posting-77") {
          return '<main data-topic-id="topic-owner"></main>'
        }
        if (path === "/topics/topic-owner") {
          return threadHtml.replaceAll("topic-42", "topic-owner")
        }
        if (path === "/messages/201.text" || path === "/messages/202.text") {
          return rawHtmlOnly
        }
        throw new Error(`Unexpected fetch: ${path}`)
      },
    )

    const result = await readEmail("posting-77", { format: "text" })

    expect(result.data.entries?.[0].entryId).toBe("101")
    expect(fetch.mock.calls.map(([path]) => path)).toContainEqual(
      "/topics/topic-owner",
    )
    expect(fetch.mock.calls.map(([path]) => path)).toContainEqual(
      "/messages/201.text",
    )
  })

  test("resolves entry IDs through their owned topic metadata", async () => {
    const fetch = spyOn(heyClient, "fetchHtml").mockImplementation(
      async (path: string) => {
        if (path === "/topics/entry-45") throw new Error("not a topic")
        if (path === "/entries/entry-45") {
          return '<main data-topic-id="topic-entry"></main>'
        }
        if (path === "/topics/topic-entry") {
          return '<main data-topic-id="topic-entry"><article class="entry entry--sheet" id="entry_entry-45" data-message-id="845"></article></main>'
        }
        if (path === "/messages/845.text") return rawHtmlOnly
        throw new Error(`Unexpected fetch: ${path}`)
      },
    )

    const result = await readEmail("entry-45", { format: "text" })

    expect(result.data.entries?.[0].entryId).toBe("entry-45")
    expect(fetch.mock.calls.map(([path]) => path)).toContainEqual(
      "/topics/topic-entry",
    )
    expect(fetch.mock.calls.map(([path]) => path)).toContainEqual(
      "/messages/845.text",
    )
  })
})
