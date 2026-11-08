import { describe, expect, it } from "bun:test"
import {
  capThreadEntries,
  cleanEntryBody,
  htmlToText,
  stripQuotedHistory,
} from "../tools/text-extract"

type Entry = { body: string; truncated?: boolean }

describe("htmlToText", () => {
  it("extracts text from an iframe srcdoc and decodes entities", () => {
    const inner = "<html><body><p>Caf&eacute; at <b>noon</b></p></body></html>"
    const srcdoc = inner.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    const html = `<message-content><iframe srcdoc="${srcdoc}"></iframe></message-content>`
    expect(htmlToText(html)).toBe("Café at noon")
  })

  it("drops scripts, styles and hidden preheaders and keeps line structure", () => {
    const html =
      '<style>p{color:red}</style><script>x()</script><div style="display:none">pre</div><p>One</p><p>Two<br>Three</p>'
    expect(htmlToText(html)).toBe("One\n\nTwo\nThree")
  })

  it("removes blockquotes unless asked to keep them", () => {
    const html = "<p>Reply</p><blockquote>Old text</blockquote>"
    expect(htmlToText(html)).toBe("Reply")
    expect(htmlToText(html, true)).toContain("Old text")
  })
})

describe("stripQuotedHistory", () => {
  it.each([
    ["Reply\n\nOn Mon, 3 Nov 2026 at 10:00, Ann <a@b.c> wrote:\n> old", "Reply"],
    ["Antwoord\n\nOp ma 3 nov 2026 om 10:00 schreef Ann <a@b.c>:\nold", "Antwoord"],
    ["Reply\n\nFrom: Ann\nSent: Monday\nTo: Bob\nSubject: x\n\nold", "Reply"],
    ["Hallo\n\nVan: Ann\nVerzonden: maandag\nAan: Bob\n\noud", "Hallo"],
    ["Reply\n________________\nFrom: Ann\nDate: Monday\nold", "Reply"],
    ["Reply\n-----Original Message-----\nold", "Reply"],
  ])("cuts history from %#", (input, expected) => {
    expect(stripQuotedHistory(input)).toBe(expected)
  })

  it("handles an attribution wrapped over two lines", () => {
    expect(
      stripQuotedHistory("Reply\nOn Mon, 3 Nov 2026, Ann Long <a@b.c>\nwrote:\nold"),
    ).toBe("Reply")
  })

  it("keeps inline replies around removed > lines", () => {
    expect(stripQuotedHistory("> question\nanswer\n> more\nend")).toBe("answer\nend")
  })

  it("does not cut on an ordinary From: line", () => {
    const text = "From: the desk of the dean, greetings.\nPlease read this."
    expect(stripQuotedHistory(text)).toBe(text)
  })

  it("keeps the text when stripping would leave nothing", () => {
    const text = "From: Ann\nSent: Monday\nforwarded content"
    expect(stripQuotedHistory(text)).toBe(text)
  })
})

describe("cleanEntryBody", () => {
  it("treats HTML bodies as HTML", () => {
    expect(cleanEntryBody("<div>Hello</div>")).toBe("Hello")
  })

  it("keeps history when asked", () => {
    const text = "Reply\nOn Mon, Ann wrote:\nold"
    expect(cleanEntryBody(text, true)).toContain("old")
  })
})

describe("capThreadEntries", () => {
  it("limits each entry and flags it", () => {
    const entries: Entry[] = [{ body: "x".repeat(50) }, { body: "short" }]
    expect(capThreadEntries(entries, 10, 1000)).toBe(true)
    expect(entries[0]).toEqual({ body: "x".repeat(10), truncated: true })
    expect(entries[1].truncated).toBeUndefined()
  })

  it("spends the thread budget on the newest messages first", () => {
    const entries: Entry[] = [{ body: "o".repeat(40) }, { body: "n".repeat(40) }]
    capThreadEntries(entries, 100, 50)
    expect(entries[1].body).toHaveLength(40)
    expect(entries[0].body).toHaveLength(10)
    expect(entries[0].truncated).toBe(true)
  })

  it("reports false when nothing was cut", () => {
    expect(capThreadEntries([{ body: "ok" }], 10, 10)).toBe(false)
  })
})
