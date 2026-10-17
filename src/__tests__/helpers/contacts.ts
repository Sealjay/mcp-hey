/** Synthetic Hey contacts for tests. No real data. */
import type {
  ContactBoxAnswer,
  ContactBoxFetcher,
  ContactBoxStore,
} from "../../contact-box"

/** Synthetic markup in the shape of /contacts/{id}/box_settings. */
export function boxSettings(selected: string): string {
  const item = (cls: string, title: string) => {
    const on = cls === selected
    return `<div class="action-group__item${on ? " action-group__item--selected" : ""}">
      <button name="button" type="submit" class="action-group__action--${cls} action-group__action"
        role="menuitemradio" aria-checked="${on}" data-bridge-group="deliver"
        data-bridge-selected="${on}"><span>${title}</span></button></div>`
  }
  return `<turbo-frame id="contact_box_settings">
    <div class="action-group" role="group">
      <h3 class="action-group__title">Deliver their emails to…</h3>
      ${item("imbox", "Imbox")}${item("feedbox", "The Feed")}${item("trailbox", "Paper Trail")}
      ${item("screened-out", "Screened Out")}
    </div>
    <div class="action-group" role="group">
      <button class="action-group__action--unbundled action-group__action" role="menuitemradio"
        aria-checked="true" data-bridge-group="display">Separately</button>
    </div>
  </turbo-frame>`
}

export function memoryStore(): ContactBoxStore & {
  rows: Map<string, { box: string; checked_at: number }>
} {
  const rows = new Map<string, { box: string; checked_at: number }>()
  return {
    rows,
    get: (s) => rows.get(s) ?? null,
    put: (s, box: ContactBoxAnswer, at) => {
      rows.set(s, { box, checked_at: at })
    },
  }
}

/** Contacts: boss@ is delivered to the Imbox, news@ to the Feed. Counts requests. */
export function fakeHey(
  contacts: Record<string, string> = {
    "boss@example.org": "imbox",
    "news@example.net": "feedbox",
  },
) {
  const calls: string[] = []
  const ids = Object.keys(contacts)
  const fetcher: ContactBoxFetcher = {
    findContactId: async (s) => {
      calls.push(`search:${s}`)
      const i = ids.indexOf(s)
      return i >= 0 ? String(100 + i) : null
    },
    boxSettingsHtml: async (id) => {
      calls.push(`settings:${id}`)
      return boxSettings(contacts[ids[Number(id) - 100]])
    },
  }
  return { fetcher, calls }
}
