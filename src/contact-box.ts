/**
 * Where Hey delivers a sender's mail: Imbox, The Feed or Paper Trail.
 *
 * Every contact has one delivery setting ("Deliver their emails to…" on the
 * contact page). `GET /contacts/{id}/box_settings` renders it as a group of
 * menu buttons, and the chosen one carries `aria-checked="true"`:
 *   action-group__action--imbox | --feedbox | --trailbox | --screened-out
 *
 * A lookup costs two requests: `GET /search?q={email}` to find the contact
 * id, then the box settings. Answers are kept in the `contact_boxes` cache
 * table: a delivery setting for 30 days, "not a contact" (or no setting
 * marked) for 1 day, so a sender who is screened in later is picked up soon.
 * Network failures are not cached. Concurrent lookups of the same sender
 * share one request.
 *
 * This module has no dependency on any caller. It is used by sender groups
 * (`sender-groups.ts`).
 */

import { parse as parseHtml } from "node-html-parser"
import { execute, queryOne, unixNow } from "./cache/db"
import { heyClient } from "./hey-client"
import { findContactIdByEmail } from "./tools/organise"

export type ContactBox = "imbox" | "feed" | "paper_trail" | "screened_out"
/** A delivery setting, or "none" when the sender is not a contact or no setting is marked. */
export type ContactBoxAnswer = ContactBox | "none"

const CLASS_TO_BOX: Record<string, ContactBox> = {
  "action-group__action--imbox": "imbox",
  "action-group__action--feedbox": "feed",
  "action-group__action--trailbox": "paper_trail",
  "action-group__action--screened-out": "screened_out",
}

export const CONTACT_BOX_TTL_SECONDS = 30 * 86400
export const NO_CONTACT_TTL_SECONDS = 86400

/** The selected delivery box in a contact's box settings HTML, or null when none is marked. */
export function parseDeliveryBox(html: string): ContactBox | null {
  const root = parseHtml(html)
  const buttons = root.querySelectorAll(
    '[data-bridge-group="deliver"][role="menuitemradio"]',
  )
  for (const button of buttons) {
    const selected =
      button.getAttribute("aria-checked") === "true" ||
      button.getAttribute("data-bridge-selected") === "true"
    if (!selected) continue
    for (const cls of (button.getAttribute("class") ?? "").split(/\s+/)) {
      if (CLASS_TO_BOX[cls]) return CLASS_TO_BOX[cls]
    }
  }
  return null
}

export function normaliseSender(sender: string): string | null {
  const s = sender.trim().toLowerCase()
  return /^[^\s@<>]+@[^\s@<>]+$/.test(s) ? s : null
}

/** Where answers are kept. The default is the `contact_boxes` cache table. */
export interface ContactBoxStore {
  get(sender: string): { box: string; checked_at: number } | null
  put(sender: string, answer: ContactBoxAnswer, at: number): void
}

/** How Hey is asked. The default uses the shared Hey client. */
export interface ContactBoxFetcher {
  findContactId(sender: string): Promise<string | null>
  boxSettingsHtml(contactId: string): Promise<string>
}

export const dbStore: ContactBoxStore = {
  get: (sender) =>
    queryOne<{ box: string; checked_at: number }>(
      "SELECT box, checked_at FROM contact_boxes WHERE sender_email = ?",
      [sender],
    ),
  put: (sender, answer, at) =>
    execute(
      "INSERT OR REPLACE INTO contact_boxes (sender_email, box, checked_at) VALUES (?, ?, ?)",
      [sender, answer, at],
    ),
}

export const heyFetcher: ContactBoxFetcher = {
  findContactId: (sender) => findContactIdByEmail(sender),
  boxSettingsHtml: (contactId) =>
    heyClient.fetchHtml(`/contacts/${contactId}/box_settings`),
}

export interface ContactBoxResolver {
  /** The cached answer, or null when there is none or it expired. Never makes a request. */
  cached(sender: string): ContactBoxAnswer | null
  /** Ask Hey (two requests) and cache the answer. Rejects on network errors, which are not cached. */
  lookup(sender: string): Promise<ContactBoxAnswer>
  /** From the cache, else from Hey. Null when the sender is not a contact or has no setting marked. */
  contactBox(sender: string): Promise<ContactBox | null>
}

export function createContactBoxResolver(
  store: ContactBoxStore = dbStore,
  fetcher: ContactBoxFetcher = heyFetcher,
  clock: () => number = unixNow,
): ContactBoxResolver {
  const inFlight = new Map<string, Promise<ContactBoxAnswer>>()

  function cached(sender: string): ContactBoxAnswer | null {
    const key = normaliseSender(sender)
    if (!key) return null
    const row = store.get(key)
    if (!row) return null
    const answer = row.box as ContactBoxAnswer
    const ttl =
      answer === "none" ? NO_CONTACT_TTL_SECONDS : CONTACT_BOX_TTL_SECONDS
    return clock() - row.checked_at < ttl ? answer : null
  }

  function lookup(sender: string): Promise<ContactBoxAnswer> {
    const key = normaliseSender(sender)
    if (!key) return Promise.resolve("none")
    const running = inFlight.get(key)
    if (running) return running
    const work = (async (): Promise<ContactBoxAnswer> => {
      const contactId = await fetcher.findContactId(key)
      const answer: ContactBoxAnswer = contactId
        ? (parseDeliveryBox(await fetcher.boxSettingsHtml(contactId)) ?? "none")
        : "none"
      store.put(key, answer, clock())
      return answer
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, work)
    return work
  }

  async function contactBox(sender: string): Promise<ContactBox | null> {
    const answer = cached(sender) ?? (await lookup(sender))
    return answer === "none" ? null : answer
  }

  return { cached, lookup, contactBox }
}

/** The shared resolver: `contact_boxes` cache table and the Hey client. */
export const contactBoxes = createContactBoxResolver()

/** A sender's delivery setting from the cache, else from Hey. Null when unknown. */
export function contactBox(senderEmail: string): Promise<ContactBox | null> {
  return contactBoxes.contactBox(senderEmail)
}

export const __testing = { CLASS_TO_BOX }
