import { describe, expect, test } from "bun:test"
import { extractNextCursor } from "../tools/read"

// Hey.com paginates listings with an opaque, base64-encoded keyset cursor
// embedded in a `/?page=<token>` link — NOT an integer page number. These tests
// cover the cursor extraction that drives real pagination. The sample token
// below decodes to `{"page_number":2}` and contains no account data.
describe("Cursor pagination — extractNextCursor", () => {
  test("extracts the base64 cursor from Hey's next-page link", () => {
    const html = `<nav><a href="/?page=eyJwYWdlX251bWJlciI6Mn0%3D" rel="next">More</a></nav>`
    expect(extractNextCursor(html)).toBe("/?page=eyJwYWdlX251bWJlciI6Mn0%3D")
  })

  test("returns null when there is no next-page link", () => {
    expect(extractNextCursor("<div>nothing to paginate</div>")).toBeNull()
  })

  test("ignores asset/query links that merely contain 'page'", () => {
    const html = `<link href="/assets/page_controller-abc123.js"><a href="/settings?tab=page">x</a>`
    expect(extractNextCursor(html)).toBeNull()
  })

  test("unescapes &amp; in the cursor href", () => {
    expect(extractNextCursor(`<a href="/?page=tok123&amp;k=1">next</a>`)).toBe(
      "/?page=tok123&k=1",
    )
  })
})
