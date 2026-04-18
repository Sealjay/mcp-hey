/**
 * FTS5 full-text search functionality.
 * Provides fast local search across cached emails.
 */

import type { Email } from "../tools/read"
import { execute, query, queryOne, unixNow } from "./db"
import type { CacheMetadata } from "./messages"
import { TTL_CONFIG } from "./schema"

interface FtsResult {
  id: string
  sender_name: string | null
  sender_email: string | null
  subject: string | null
  snippet: string | null
  received_at: number | null
  is_read: number
  relevance: number
}

/**
 * Create cache metadata for FTS results.
 */
function createFtsMetadata(resultCount: number): CacheMetadata {
  return {
    source: "cache",
    cached_at: new Date().toISOString(),
    age_seconds: 0,
    is_stale: false,
    hint: `Found ${resultCount} results in local cache. Network search may find more.`,
  }
}

/**
 * Search emails using FTS5 with BM25 ranking.
 * Subject matches are weighted higher than sender/snippet.
 */
export function ftsSearch(
  searchQuery: string,
  limit = 25,
): { emails: Email[]; metadata: CacheMetadata } | null {
  // Sanitize query for FTS5
  const sanitized = sanitizeFtsQuery(searchQuery)
  if (!sanitized) {
    return null
  }

  try {
    // BM25 weights: sender_name=1.0, sender_email=1.0, subject=2.0, snippet=0.5
    const results = query<FtsResult>(
      `SELECT
         m.id,
         m.sender_name,
         m.sender_email,
         m.subject,
         m.snippet,
         m.received_at,
         m.is_read,
         bm25(messages_fts, 1.0, 1.0, 2.0, 0.5) as relevance
       FROM messages_fts
       JOIN messages m ON messages_fts.rowid = m.rowid
       WHERE messages_fts MATCH ?
       ORDER BY relevance
       LIMIT ?`,
      [sanitized, limit],
    )

    if (results.length === 0) {
      return null
    }

    const emails: Email[] = results.map((row) => ({
      id: row.id,
      from: row.sender_name || "Unknown",
      fromEmail: row.sender_email || undefined,
      subject: row.subject || "(No subject)",
      snippet: row.snippet || undefined,
      date: row.received_at
        ? new Date(row.received_at * 1000).toISOString()
        : undefined,
      unread: row.is_read === 0,
    }))

    return {
      emails,
      metadata: createFtsMetadata(results.length),
    }
  } catch (err) {
    // FTS5 query errors are common with special characters
    console.error("[mcp-hey] FTS search error:", err)
    return null
  }
}

/**
 * Search by sender email or name.
 */
export function searchBySender(
  senderQuery: string,
  limit = 25,
): { emails: Email[]; metadata: CacheMetadata } | null {
  const pattern = `%${senderQuery}%`

  const results = query<FtsResult>(
    `SELECT
       id,
       sender_name,
       sender_email,
       subject,
       snippet,
       received_at,
       is_read,
       0 as relevance
     FROM messages
     WHERE sender_email LIKE ? OR sender_name LIKE ?
     ORDER BY received_at DESC
     LIMIT ?`,
    [pattern, pattern, limit],
  )

  if (results.length === 0) {
    return null
  }

  const emails: Email[] = results.map((row) => ({
    id: row.id,
    from: row.sender_name || "Unknown",
    fromEmail: row.sender_email || undefined,
    subject: row.subject || "(No subject)",
    snippet: row.snippet || undefined,
    date: row.received_at
      ? new Date(row.received_at * 1000).toISOString()
      : undefined,
    unread: row.is_read === 0,
  }))

  return {
    emails,
    metadata: createFtsMetadata(results.length),
  }
}

/**
 * Get recent emails matching a subject pattern.
 */
export function searchBySubject(
  subjectQuery: string,
  limit = 25,
): { emails: Email[]; metadata: CacheMetadata } | null {
  const pattern = `%${subjectQuery}%`

  const results = query<FtsResult>(
    `SELECT
       id,
       sender_name,
       sender_email,
       subject,
       snippet,
       received_at,
       is_read,
       0 as relevance
     FROM messages
     WHERE subject LIKE ?
     ORDER BY received_at DESC
     LIMIT ?`,
    [pattern, limit],
  )

  if (results.length === 0) {
    return null
  }

  const emails: Email[] = results.map((row) => ({
    id: row.id,
    from: row.sender_name || "Unknown",
    fromEmail: row.sender_email || undefined,
    subject: row.subject || "(No subject)",
    snippet: row.snippet || undefined,
    date: row.received_at
      ? new Date(row.received_at * 1000).toISOString()
      : undefined,
    unread: row.is_read === 0,
  }))

  return {
    emails,
    metadata: createFtsMetadata(results.length),
  }
}

/**
 * Get unread message count for a folder.
 */
export function getUnreadCount(folder?: string): number {
  if (folder) {
    const result = queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM messages WHERE folder = ? AND is_read = 0",
      [folder],
    )
    return result?.count || 0
  }

  const result = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM messages WHERE is_read = 0",
  )
  return result?.count || 0
}

/**
 * Get total cached messages for a folder.
 */
export function getMessageCount(folder?: string): number {
  if (folder) {
    const result = queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM messages WHERE folder = ?",
      [folder],
    )
    return result?.count || 0
  }

  const result = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM messages",
  )
  return result?.count || 0
}

/**
 * Sanitize a search query for FTS5.
 * Handles special characters that would cause query errors.
 */
function sanitizeFtsQuery(input: string): string | null {
  if (!input || input.trim().length === 0) {
    return null
  }

  // Remove FTS5 special operators for simple queries
  let sanitized = input
    .replace(/['"]/g, "") // Remove quotes
    .replace(/[()]/g, "") // Remove parentheses
    .replace(/[:^*]/g, " ") // Replace operators with space
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim()

  if (sanitized.length === 0) {
    return null
  }

  // For multi-word queries, use implicit AND
  const words = sanitized.split(" ").filter((w) => w.length > 0)
  if (words.length > 1) {
    // Wrap each word for prefix matching
    sanitized = words.map((w) => `"${w}"*`).join(" ")
  } else if (words.length === 1) {
    // Single word with prefix matching
    sanitized = `"${words[0]}"*`
  }

  return sanitized
}

/**
 * Rebuild FTS index from messages table.
 * Use after bulk imports or if index becomes corrupted.
 */
export function rebuildFtsIndex(): void {
  // Delete all FTS content
  execute("DELETE FROM messages_fts")

  // Rebuild from messages table
  execute(
    `INSERT INTO messages_fts(rowid, sender_name, sender_email, subject, snippet)
     SELECT rowid, sender_name, sender_email, subject, snippet FROM messages`,
  )

  // Optimise the index
  execute("INSERT INTO messages_fts(messages_fts) VALUES('optimize')")
}
