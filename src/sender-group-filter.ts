/**
 * Filter tool output by sender group.
 *
 * Applies to tools whose output is a list of messages already tagged with
 * `sender_group` (see sender-groups.ts). Messages whose sender group is
 * still `unknown` are never silently dropped: the output reports how many
 * were left out and lists their IDs, so the caller can ask again (later calls
 * resolve more senders) or read them directly.
 */

import type { SenderGroup, SenderGroupMode } from "./sender-groups"

/** Groups a caller can filter by. `unknown` is reported, not filtered on. */
export const FILTER_GROUPS = [
  "imbox",
  "feed",
  "paper_trail",
  "screened_out",
] as const
export type FilterGroup = (typeof FILTER_GROUPS)[number]

/** Tools that accept a `group` filter. */
export const GROUP_FILTER_TOOLS = new Set([
  "hey_search",
  "hey_list_label_emails",
  "hey_list_collection_emails",
  "hey_list_set_aside",
  "hey_list_reply_later",
])

/** How many unclassified message IDs to list in the report. */
const MAX_UNCLASSIFIED_IDS = 20

/**
 * Parse a `group` argument: one group name or an array of them.
 * Returns undefined when absent, null when invalid.
 */
export function parseGroupFilter(
  value: unknown,
): FilterGroup[] | null | undefined {
  if (value === undefined || value === null) return undefined
  const raw = Array.isArray(value) ? value : [value]
  if (raw.length === 0) return null
  const out: FilterGroup[] = []
  for (const v of raw) {
    if (typeof v !== "string") return null
    const g = v.trim().toLowerCase()
    if (!(FILTER_GROUPS as readonly string[]).includes(g)) return null
    if (!out.includes(g as FilterGroup)) out.push(g as FilterGroup)
  }
  return out
}

export interface GroupFilterReport {
  groups: FilterGroup[]
  /** Messages returned (their sender group is one of `groups`). */
  matched: number
  /** Messages left out because their sender is in another group. */
  excluded: number
  /** Messages left out because their sender group is still unknown. */
  unclassified: number
  /** IDs (topicId, else id) of the unclassified messages, at most 20. */
  unclassified_ids?: string[]
  note?: string
}

type Tagged = { sender_group?: SenderGroup; topicId?: string; id?: string }

/**
 * Keep the messages in `data` whose sender group is in `groups`, and add a
 * `_group_filter` report. Output of an unexpected shape is returned unchanged.
 */
export function applyGroupFilter(
  result: unknown,
  groups: FilterGroup[],
  mode: SenderGroupMode,
): unknown {
  if (!result || typeof result !== "object") return result
  const data = (result as { data?: unknown }).data
  if (!Array.isArray(data)) return result
  const items = data as Tagged[]
  const kept: Tagged[] = []
  const unclassifiedIds: string[] = []
  let excluded = 0
  let unclassified = 0
  for (const item of items) {
    const group = item.sender_group ?? "unknown"
    if (group === "unknown") {
      unclassified++
      const id = item.topicId ?? item.id
      if (id && unclassifiedIds.length < MAX_UNCLASSIFIED_IDS) {
        unclassifiedIds.push(id)
      }
    } else if ((groups as string[]).includes(group)) {
      kept.push(item)
    } else {
      excluded++
    }
  }
  const report: GroupFilterReport = {
    groups,
    matched: kept.length,
    excluded,
    unclassified,
  }
  if (unclassified > 0) {
    report.unclassified_ids = unclassifiedIds
    report.note =
      mode === "on"
        ? `${unclassified} message(s) have no sender group yet and were left out. Calling again resolves more senders (a few per call); or read them by ID.`
        : `${unclassified} message(s) have no sender group in the local cache and were left out. Set HEY_SENDER_GROUPS=on to look senders up, or read them by ID.`
  }
  return { ...(result as object), data: kept, _group_filter: report }
}

/**
 * The group filter a tool call asks for. `groups` is undefined when there is
 * none; `error` is set when the argument is invalid or sender groups are off.
 */
export function groupFilterFor(
  tool: string,
  args: Record<string, unknown> | undefined,
  mode: SenderGroupMode,
): { groups?: FilterGroup[]; error?: string } {
  if (!GROUP_FILTER_TOOLS.has(tool) || args?.group === undefined) return {}
  const groups = parseGroupFilter(args.group)
  if (!groups) {
    return {
      error:
        "Error: group must be one or more of imbox, feed, paper_trail, screened_out",
    }
  }
  if (mode === "off") {
    return {
      error:
        "Error: group filtering needs sender groups, but HEY_SENDER_GROUPS is off. Set it to cache or on.",
    }
  }
  return { groups }
}
