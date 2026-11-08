/**
 * Turn the HTML and plain text of an email into short, readable text:
 * no markup, no quoted history, and a size limit per message and per thread.
 */
import { type HTMLElement, type Node, NodeType, parse } from "node-html-parser"

export const DEFAULT_MAX_CHARS_PER_ENTRY = 4000
export const DEFAULT_MAX_CHARS_TOTAL = 24000

const SKIPPED_TAGS = new Set([
  "script",
  "style",
  "head",
  "title",
  "meta",
  "link",
  "noscript",
])
const BLOCK_TAGS = new Set(
  "address article aside blockquote center dd div dl dt fieldset figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody thead tfoot tr ul".split(
    " ",
  ),
)
const QUOTE_CLASSES = /\b(gmail_quote|gmail_attr|moz-cite-prefix|yahoo_quoted)\b/
const MAX_SRCDOC_DEPTH = 3

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff\u034f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function walk(node: Node, out: string[], keepQuoted: boolean, depth: number) {
  if (node.nodeType === NodeType.TEXT_NODE) {
    out.push(node.text.replace(/\s+/g, " "))
    return
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return
  const el = node as HTMLElement
  const tag = (el.rawTagName || "").toLowerCase()
  if (SKIPPED_TAGS.has(tag)) return
  if (/display\s*:\s*none/i.test(el.getAttribute("style") || "")) return
  if (
    !keepQuoted &&
    (tag === "blockquote" || QUOTE_CLASSES.test(el.getAttribute("class") || ""))
  ) {
    return
  }
  if (tag === "br") {
    out.push("\n")
    return
  }
  if (tag === "iframe") {
    const srcdoc = el.getAttribute("srcdoc")
    if (srcdoc && depth < MAX_SRCDOC_DEPTH) {
      out.push("\n", convert(srcdoc, keepQuoted, depth + 1), "\n")
    }
    return
  }
  const block = BLOCK_TAGS.has(tag)
  if (block) out.push("\n")
  for (const child of el.childNodes) walk(child, out, keepQuoted, depth)
  if (block) out.push("\n")
}

function convert(html: string, keepQuoted: boolean, depth: number): string {
  const out: string[] = []
  walk(parse(html), out, keepQuoted, depth)
  return out.join("")
}

/** Plain text of an HTML fragment, including the document inside any iframe srcdoc. */
export function htmlToText(html: string, keepQuoted = false): string {
  return normalize(convert(html, keepQuoted, 0))
}

const ATTRIBUTION_LINES = [
  /^On\b.{4,300}\bwrote:$/i,
  /^Op\b.{4,300}\bschreef\b.{0,120}:$/i,
  /^Le\b.{4,300}\ba écrit\s*:$/i,
  /^Am\b.{4,300}\bschrieb\b.{0,120}:$/i,
  /^Dne\b.{4,300}\bnapsal(a|\(a\))?\b.{0,120}:$/i,
]
const ORIGINAL_MESSAGE =
  /^-{2,}\s*(original message|oorspronkelijk bericht|původní zpráva|ursprüngliche nachricht)\s*-{2,}$/i
const HEADER_FROM = /^\*?(from|van|od|de|von|fra)\*?\s*:/i
const HEADER_FOLLOW =
  /^\*?(sent|date|verzonden|datum|odesláno|envoyé|gesendet|sendt)\*?\s*:/i
const RULE_LINE = /^[_-]{5,}$/

function isHeaderBlock(lines: string[], i: number): boolean {
  if (!HEADER_FROM.test(lines[i])) return false
  return lines.slice(i + 1, i + 6).some((l) => HEADER_FOLLOW.test(l))
}

function isAttribution(lines: string[], i: number): boolean {
  const one = lines[i]
  const joined = `${one} ${lines[i + 1] ?? ""}`.trim()
  return ATTRIBUTION_LINES.some((re) => re.test(one) || re.test(joined))
}

/** Remove quoted earlier messages. Returns the text unchanged if nothing would be left. */
export function stripQuotedHistory(text: string): string {
  const lines = text.split("\n")
  let cut = lines.findIndex(
    (l, i) =>
      ORIGINAL_MESSAGE.test(l) ||
      isHeaderBlock(lines, i) ||
      isAttribution(lines, i),
  )
  if (cut === -1) cut = lines.length
  while (cut > 0 && (RULE_LINE.test(lines[cut - 1]) || !lines[cut - 1])) cut--
  const kept = normalize(
    lines
      .slice(0, cut)
      .filter((l) => !l.startsWith(">"))
      .join("\n"),
  )
  return kept || text
}

/** Readable text for one message, given its decoded plain-text part or HTML. */
export function cleanEntryBody(body: string, keepQuoted = false): string {
  const isHtml = /^\s*(<!doctype|<html|<head|<body|<div|<table|<p[\s>])/i.test(
    body,
  )
  const text = isHtml ? htmlToText(body, keepQuoted) : normalize(body)
  return keepQuoted ? text : stripQuotedHistory(text)
}

/**
 * Apply the size limits in place. The thread budget is spent newest first, because
 * the latest messages matter most. Returns true if any entry was cut.
 */
export function capThreadEntries(
  entries: { body: string; truncated?: boolean }[],
  maxPerEntry = DEFAULT_MAX_CHARS_PER_ENTRY,
  maxTotal = DEFAULT_MAX_CHARS_TOTAL,
): boolean {
  let left = maxTotal
  let cutAny = false
  for (const entry of [...entries].reverse()) {
    const limit = Math.min(maxPerEntry, left)
    if (entry.body.length > limit) {
      entry.body = entry.body.slice(0, limit).trimEnd()
      entry.truncated = true
      cutAny = true
    }
    left -= entry.body.length
  }
  return cutAny
}
