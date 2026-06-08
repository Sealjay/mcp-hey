import { describe, expect, test } from "bun:test"
import { extractEmailsFromHtml } from "../tools/read"

// Hey marks an UNSEEN posting with a screen-reader marker element
// `<span id="unseen_posting_{postingId}">`, NOT a `posting--unread` class
// (which no longer exists in Hey's markup). These fixtures mirror the real
// list DOM; the subjects/ids are synthetic and contain no account data.
const unreadPosting = `
<article class="posting" data-identifier="posting_111" data-bubbled-up="false">
  <div class="posting__body">
    <span class="u-for-screen-reader" id="unseen_posting_111">Unseen</span>
    <a class="posting__link" href="/topics/111"></a>
    <span class="posting__title">Unread invoice reminder</span>
    <span class="posting__detail">Acme Billing</span>
    <time class="posting__time" datetime="2026-06-07T14:35:57Z">Jun 7</time>
  </div>
</article>`

const readPosting = `
<article class="posting" data-identifier="posting_222" data-bubbled-up="false">
  <div class="posting__body">
    <a class="posting__link" href="/topics/222"></a>
    <span class="posting__title">Already read newsletter</span>
    <span class="posting__detail">Some Sender</span>
    <time class="posting__time" datetime="2026-06-06T10:00:00Z">Jun 6</time>
  </div>
</article>`

describe("Unread detection — unseen_posting marker", () => {
  test("marks a posting unread when the unseen_posting_ marker is present", () => {
    const [email] = extractEmailsFromHtml(unreadPosting)
    expect(email.unread).toBe(true)
  })

  test("marks a posting read when the marker is absent", () => {
    const [email] = extractEmailsFromHtml(readPosting)
    expect(email.unread).toBe(false)
  })

  test("distinguishes mixed read/unread postings in one list", () => {
    const emails = extractEmailsFromHtml(
      `<div>${unreadPosting}${readPosting}</div>`,
    )
    const byId = Object.fromEntries(emails.map((e) => [e.id, e.unread]))
    expect(byId["111"]).toBe(true)
    expect(byId["222"]).toBe(false)
  })

  test("the obsolete posting--unread class alone does not mark unread", () => {
    const stale = `
<article class="posting posting--unread" data-identifier="posting_333">
  <div class="posting__body">
    <a class="posting__link" href="/topics/333"></a>
    <span class="posting__title">Stale class only</span>
  </div>
</article>`
    const [email] = extractEmailsFromHtml(stale)
    expect(email.unread).toBe(false)
  })
})
