import { describe, expect, test } from "bun:test"
import {
  capThreadEntries,
  cleanEntryBody,
  htmlToText,
  MAX_TEXT_SOURCE_CHARS,
  stripQuotedHistory,
} from "../tools/text-extract"

describe("readable text extraction", () => {
  test("extracts iframe srcdoc and decodes HTML entities", () => {
    const srcdoc = "&lt;p&gt;Caf&eacute; at noon&lt;/p&gt;"
    expect(
      htmlToText(
        `<message-content><iframe srcdoc="${srcdoc}"></iframe></message-content>`,
      ),
    ).toBe("Café at noon")
  })

  test("removes scripts, hidden preheaders, and quoted blocks", () => {
    const html =
      '<style>p{color:red}</style><script>x()</script><div style="display:none">pre</div><p>Reply</p><blockquote>Old</blockquote>'
    expect(htmlToText(html)).toBe("Reply")
  })

  test("strips quoted history but can retain it", () => {
    const body = "Reply\n\nOn Mon, 3 Nov 2026 at 10:00, Ann wrote:\n> old"
    expect(stripQuotedHistory(body)).toBe("Reply")
    expect(cleanEntryBody(body, true)).toContain("> old")
  })

  test("caps each entry and spends the thread budget newest first", () => {
    const entries: { body: string; truncated?: boolean }[] = [
      { body: "old".repeat(10) },
      { body: "new".repeat(10) },
    ]
    expect(capThreadEntries(entries, 50, 40)).toBe(true)
    expect(entries[1].body).toHaveLength(30)
    expect(entries[0].body).toHaveLength(10)
    expect(entries[0].truncated).toBe(true)
  })

  test("rejects oversized HTML before parsing it", () => {
    expect(() => htmlToText("x".repeat(MAX_TEXT_SOURCE_CHARS + 1))).toThrow(
      "maximum parsing size",
    )
  })
})
