/**
 * Sender groups: the sender's current Hey delivery setting on every message.
 *
 * `sender_group` is where Hey delivers new mail from that sender today
 * ("Deliver their emails to…" on the contact page): `imbox`, `feed`,
 * `paper_trail` or `screened_out`, else `unknown`. It describes the sender,
 * not the message. A thread moved by hand to another box, or mail that arrived
 * before the sender's setting changed, can sit somewhere else.
 *
 * Settings (environment):
 *   HEY_SENDER_GROUPS              off | cache | on (default on)
 *       off    no field, no cache reads, no requests
 *       cache  answers from the local cache only, never a request
 *       on     the cache, plus a few lookups per call for senders not cached
 *   HEY_SENDER_GROUP_BUDGET        lookups per tool call in "on" mode (default 10, 0-50)
 *   HEY_SENDER_GROUP_TIMEOUT_MS    how long a call waits for lookups (default 3000, 0-30000)
 *
 * A lookup is two requests (see contact-box.ts) and runs at most 3 at a time.
 * Senders are deduplicated within a call. Lookups stop early when Hey's
 * rate-limit headroom is low. Senders left over, and lookups still running at
 * the time limit, come back as `unknown`; running lookups finish in the
 * background and fill the cache, so later calls see the answer.
 */

import { queryOne } from "./cache/db"
import {
  type ContactBox,
  type ContactBoxAnswer,
  type ContactBoxResolver,
  contactBoxes,
  normaliseSender,
} from "./contact-box"
import { rateLimitHeadroom } from "./hey-client"

export type SenderGroup = ContactBox | "unknown"
export const SENDER_GROUPS: readonly SenderGroup[] = [
  "imbox",
  "feed",
  "paper_trail",
  "screened_out",
  "unknown",
]
export type SenderGroupMode = "off" | "cache" | "on"

export interface SenderGroupSettings {
  mode: SenderGroupMode
  /** Lookups per call in "on" mode. */
  budget: number
  /** Lookups running at once. */
  concurrency: number
  /** How long a call waits for its lookups, in milliseconds. */
  timeoutMs: number
  /** Do not start a lookup when fewer requests than this are left in the rate-limit window. */
  minHeadroom: number
}

export const DEFAULT_SETTINGS: SenderGroupSettings = {
  mode: "on",
  budget: 10,
  concurrency: 3,
  timeoutMs: 3000,
  minHeadroom: 20,
}

let warned = false

function intSetting(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/** Settings from the environment. An unknown mode falls back to the default with a warning. */
export function senderGroupSettings(
  env: Record<string, string | undefined> = process.env,
): SenderGroupSettings {
  const raw = env.HEY_SENDER_GROUPS?.trim().toLowerCase()
  let mode = DEFAULT_SETTINGS.mode
  if (raw === "off" || raw === "cache" || raw === "on") {
    mode = raw
  } else if (raw && !warned) {
    warned = true
    console.error(
      `[mcp-hey] Unknown HEY_SENDER_GROUPS=${raw}; using "${DEFAULT_SETTINGS.mode}" (valid: off, cache, on)`,
    )
  }
  return {
    ...DEFAULT_SETTINGS,
    mode,
    budget: intSetting(
      env.HEY_SENDER_GROUP_BUDGET,
      DEFAULT_SETTINGS.budget,
      0,
      50,
    ),
    timeoutMs: intSetting(
      env.HEY_SENDER_GROUP_TIMEOUT_MS,
      DEFAULT_SETTINGS.timeoutMs,
      0,
      30000,
    ),
  }
}

function toGroup(answer: ContactBoxAnswer): SenderGroup {
  return answer === "none" ? "unknown" : answer
}

export interface GroupResolution {
  /** Group per normalised sender address. Senders without an answer are absent. */
  groups: Map<string, SenderGroup>
  /** Lookups that finished during this call. */
  lookedUp: number
  /** Lookups still running at the time limit. They finish in the background. */
  pending: number
  /** Uncached senders not looked up in this call (over budget, low rate-limit headroom, or "cache" mode). */
  deferred: number
}

export interface ResolveOptions {
  settings?: SenderGroupSettings
  /** False: answer from the cache only, even in "on" mode. */
  allowLookups?: boolean
  resolver?: Pick<ContactBoxResolver, "cached" | "lookup">
  headroom?: () => number
}

/** Groups for a set of sender addresses, from the cache and, within the budget, from Hey. */
export async function resolveSenderGroups(
  addresses: Iterable<string | null | undefined>,
  options: ResolveOptions = {},
): Promise<GroupResolution> {
  const settings = options.settings ?? senderGroupSettings()
  const resolver = options.resolver ?? contactBoxes
  const headroom = options.headroom ?? rateLimitHeadroom
  const out: GroupResolution = {
    groups: new Map(),
    lookedUp: 0,
    pending: 0,
    deferred: 0,
  }
  if (settings.mode === "off") return out

  const unique = new Set<string>()
  for (const a of addresses) {
    const key = a ? normaliseSender(a) : null
    if (key) unique.add(key)
  }

  const missing: string[] = []
  for (const sender of unique) {
    let answer: ContactBoxAnswer | null = null
    try {
      answer = resolver.cached(sender)
    } catch (err) {
      console.error("[mcp-hey] Sender group cache unavailable:", err)
    }
    if (answer) out.groups.set(sender, toGroup(answer))
    else missing.push(sender)
  }

  const lookups = settings.mode === "on" && options.allowLookups !== false
  const queue = lookups ? missing.slice(0, settings.budget) : []
  out.deferred = missing.length - queue.length
  if (queue.length === 0) return out

  let stopped = false
  let running = 0
  const worker = async (): Promise<void> => {
    while (!stopped && queue.length > 0) {
      if (headroom() < settings.minHeadroom) {
        stopped = true
        break
      }
      const sender = queue.shift() as string
      running++
      try {
        const answer = await resolver.lookup(sender)
        if (!stopped) {
          out.groups.set(sender, toGroup(answer))
          out.lookedUp++
        }
      } catch (err) {
        if (!stopped) {
          console.error("[mcp-hey] Sender group lookup failed:", err)
        }
      } finally {
        running--
      }
    }
  }

  const workers = Promise.all(
    Array.from({ length: Math.min(settings.concurrency, queue.length) }, () =>
      worker(),
    ),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, settings.timeoutMs)
  })
  await Promise.race([workers, deadline])
  clearTimeout(timer)
  stopped = true
  out.pending = running
  out.deferred += queue.length
  // Lookups still running finish in the background and fill the cache.
  workers.catch(() => {})
  return out
}

/** Fields used to find a message's sender address. */
export interface SenderFields {
  fromEmail?: string
  id?: string
  topicId?: string
  entryId?: string
}

/** The sender address of a message in the local message cache, by any of its ids. */
export function cachedSenderAddress(item: SenderFields): string | undefined {
  const ids = [item.topicId, item.id, item.entryId].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  )
  for (const id of ids) {
    const row = queryOne<{ sender_email: string | null }>(
      "SELECT sender_email FROM messages WHERE id = ? AND sender_email IS NOT NULL",
      [id],
    )
    if (row?.sender_email) return row.sender_email
  }
  return undefined
}

export interface TagOptions extends ResolveOptions {
  /** Finds a sender address when a result has none (Hey search results show only a name). */
  senderAddress?: (item: SenderFields) => string | undefined
}

export interface SenderGroupSummary {
  mode: SenderGroupMode
  /** Messages whose sender has no known group yet. */
  unknown: number
  /** Lookups that finished during this call. */
  looked_up: number
  /** Senders left for later calls (over budget, still running, or "cache" mode). */
  deferred: number
}

/**
 * Add `sender_group` to message-like items. Returns new objects; the input is not changed.
 * In "off" mode the items are returned as they are.
 */
export async function tagSenderGroups<T extends SenderFields>(
  items: T[],
  options: TagOptions = {},
): Promise<{
  items: Array<T & { sender_group?: SenderGroup }>
  summary: SenderGroupSummary
}> {
  const settings = options.settings ?? senderGroupSettings()
  if (settings.mode === "off") {
    return {
      items,
      summary: { mode: "off", unknown: 0, looked_up: 0, deferred: 0 },
    }
  }
  const findAddress = options.senderAddress ?? cachedSenderAddress
  const addresses = items.map((item) => {
    if (item.fromEmail) return item.fromEmail
    try {
      return findAddress(item)
    } catch {
      return undefined
    }
  })
  const resolution = await resolveSenderGroups(addresses, {
    ...options,
    settings,
  })
  let unknown = 0
  const tagged = items.map((item, i) => {
    const key = addresses[i] ? normaliseSender(addresses[i] as string) : null
    const group = (key && resolution.groups.get(key)) || "unknown"
    if (group === "unknown") unknown++
    return { ...item, sender_group: group }
  })
  return {
    items: tagged,
    summary: {
      mode: settings.mode,
      unknown,
      looked_up: resolution.lookedUp,
      deferred: resolution.deferred + resolution.pending,
    },
  }
}

/**
 * Tools whose output holds messages, by where the messages are:
 *   list     `data` is an array of messages
 *   summary  `data.emails` and `data.bubbledUpEmails`
 *   thread   `data` is a thread, and `data.entries` its messages
 */
export const SENDER_GROUP_TOOLS: Record<string, "list" | "summary" | "thread"> =
  {
    hey_list_emails: "list",
    hey_search: "list",
    hey_list_set_aside: "list",
    hey_list_reply_later: "list",
    hey_list_screener: "list",
    hey_list_label_emails: "list",
    hey_list_collection_emails: "list",
    hey_imbox_summary: "summary",
    hey_read_email: "thread",
  }

/** Screener senders are not contacts yet, so a lookup could not answer: cache only. */
const CACHE_ONLY_TOOLS = new Set(["hey_list_screener"])

type Item = SenderFields & Record<string, unknown>

function isItems(value: unknown): value is Item[] {
  return Array.isArray(value)
}

/**
 * Add `sender_group` to every message in a tool's output, and a
 * `_sender_groups` summary next to `_cache`. Output of other tools, output of
 * an unexpected shape, and everything in "off" mode is returned unchanged.
 */
export async function withSenderGroups(
  tool: string,
  result: unknown,
  options: TagOptions = {},
): Promise<unknown> {
  const kind = SENDER_GROUP_TOOLS[tool]
  if (!kind || !result || typeof result !== "object") return result
  const settings = options.settings ?? senderGroupSettings()
  if (settings.mode === "off") return result
  const outer = result as { data?: unknown }
  const data = outer.data

  // Collect every message list in the output, tag them in one pass (one budget).
  const lists: Item[][] = []
  if (kind === "list" && isItems(data)) {
    lists.push(data)
  } else if (kind === "summary" && data && typeof data === "object") {
    const d = data as { emails?: unknown; bubbledUpEmails?: unknown }
    if (isItems(d.emails)) lists.push(d.emails)
    if (isItems(d.bubbledUpEmails)) lists.push(d.bubbledUpEmails)
  } else if (kind === "thread" && data && typeof data === "object") {
    lists.push([data as Item])
    const entries = (data as { entries?: unknown }).entries
    if (isItems(entries)) lists.push(entries)
  }
  if (lists.length === 0) return result

  const { items, summary } = await tagSenderGroups(lists.flat(), {
    ...options,
    settings,
    allowLookups: options.allowLookups ?? !CACHE_ONLY_TOOLS.has(tool),
  })
  const tagged: Item[][] = []
  let at = 0
  for (const list of lists) {
    tagged.push(items.slice(at, at + list.length) as Item[])
    at += list.length
  }

  let newData: unknown = data
  if (kind === "list") {
    newData = tagged[0]
  } else if (kind === "summary") {
    const d = data as { emails?: unknown; bubbledUpEmails?: unknown }
    let i = 0
    newData = {
      ...(data as object),
      ...(isItems(d.emails) ? { emails: tagged[i++] } : {}),
      ...(isItems(d.bubbledUpEmails) ? { bubbledUpEmails: tagged[i++] } : {}),
    }
  } else {
    newData = {
      ...tagged[0][0],
      ...(tagged[1] ? { entries: tagged[1] } : {}),
    }
  }
  return { ...(result as object), data: newData, _sender_groups: summary }
}
