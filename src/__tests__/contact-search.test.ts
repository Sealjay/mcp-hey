import { describe, expect, test } from "bun:test"
import { contactIdFromSearchHtml } from "../tools/organise"

/** Synthetic Hey search results with contact rows. No real data. */
const results = `
  <a class="action-group__action--contacts action-group__action" href="/contacts/11">Jim Bob jimbob@example.org</a>
  <a class="action-group__action--contacts action-group__action" href="/contacts/12">Bob bob@example.org.au</a>
  <a class="action-group__action--contacts action-group__action" href="/contacts/13">Bob &lt;Bob@Example.org&gt;</a>
`

describe("contactIdFromSearchHtml", () => {
  test("matches the exact address, not one that contains it", () => {
    expect(contactIdFromSearchHtml(results, "bob@example.org")).toBe("13")
  })

  test("returns null when only longer addresses contain the needle", () => {
    const html = `<a href="/contacts/11">jimbob@example.org</a>`
    expect(contactIdFromSearchHtml(html, "bob@example.org")).toBeNull()
  })

  test("falls back to any contacts link and ignores a trailing full stop", () => {
    const html = `<a href="/contacts/7">Write to boss@example.org.</a>`
    expect(contactIdFromSearchHtml(html, "BOSS@example.org")).toBe("7")
  })
})
