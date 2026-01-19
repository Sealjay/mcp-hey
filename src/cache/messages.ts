/**
 * Message caching operations.
 * Provides cache-first access to email data with TTL-based freshness.
 */

import type { Email, EmailDetail } from "../tools/read"
import {
  execute,
  hashQuery,
  isExpired,
  query,
  queryOne,
  transaction,
  unixNow,
} from "./db"
import { TTL_CONFIG } from "./schema"

export interface CacheMetadata {
  source: "cache" | "network"
  cached_at: string | null
  age_seconds: number | null
  is_stale: boolean
  hint: string
}

export interface CachedResult<T> {
  data: T
  _cache: CacheMetadata
}

interface CachedMessage {
  id: string
  thread_id: string | null
  folder: string
  sender_email: string | null
  sender_name: string | null
  subject: string | null
  snippet: string | null
  received_at: number | null
  is_read: number
  cached_at: number
  ttl_seconds: number
}

interface CachedBody {
  message_id: string
  body_text: string | null
  body_html: string | null
  cached_at: number
}

/**
 * Convert cached message to Email interface.
 */
function toEmail(row: CachedMessage): Email {
  return {
    id: row.id,
    from: row.sender_name || "Unknown",
    fromEmail: row.sender_email || undefined,
    subject: row.subject || "(No subject)",
    snippet: row.snippet || undefined,
    date: row.received_at
      ? new Date(row.received_at * 1000).toISOString()
      : undefined,
    unread: row.is_read === 0,
  }
}

/**
 * Create cache metadata for responses.
 */
function createCacheMetadata(
  source: "cache" | "network",
  cachedAt: number | null,
  ttlSeconds: number,
): CacheMetadata {
  const now = unixNow()
  const ageSeconds = cachedAt ? now - cachedAt : null
  const isStale = cachedAt ? isExpired(cachedAt, ttlSeconds) : true

  let hint: string
  if (source === "network") {
    hint = "Fresh data from Hey.com"
  } else if (isStale) {
    hint = `Cache is stale (${ageSeconds}s old). Use force_refresh for real-time results.`
  } else {
    hint = `Data is ${ageSeconds}s old. Valid for ${ttlSeconds - (ageSeconds || 0)}s more.`
  }

  return {
    source,
    cached_at: cachedAt ? new Date(cachedAt * 1000).toISOString() : null,
    age_seconds: ageSeconds,
    is_stale: isStale,
    hint,
  }
}

/**
 * Get messages from cache for a folder.
 */
export function getCachedMessages(
  folder: string,
  limit = 25,
): { messages: Email[]; metadata: CacheMetadata } | null {
  const ttl =
    folder === "imbox" ? TTL_CONFIG.inbox_list : TTL_CONFIG.message_metadata

  const rows = query<CachedMessage>(
    `SELECT * FROM messages
     WHERE folder = ?
     ORDER BY received_at DESC
     LIMIT ?`,
    [folder, limit],
  )

  if (rows.length === 0) {
    return null
  }

  // Use oldest cached_at for staleness check
  const oldestCachedAt = Math.min(...rows.map((r) => r.cached_at))

  return {
    messages: rows.map(toEmail),
    metadata: createCacheMetadata("cache", oldestCachedAt, ttl),
  }
}

/**
 * Cache messages for a folder.
 */
export function cacheMessages(folder: string, emails: Email[]): void {
  const now = unixNow()
  const ttl =
    folder === "imbox" ? TTL_CONFIG.inbox_list : TTL_CONFIG.message_metadata

  transaction(() => {
    for (const email of emails) {
      execute(
        `INSERT OR REPLACE INTO messages
         (id, folder, sender_email, sender_name, subject, snippet, received_at, is_read, cached_at, ttl_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          email.id,
          folder,
          email.fromEmail || null,
          email.from,
          email.subject,
          email.snippet || null,
          email.date ? Math.floor(new Date(email.date).getTime() / 1000) : null,
          email.unread ? 0 : 1,
          now,
          ttl,
        ],
      )
    }

    // Update sync state
    execute(
      `INSERT OR REPLACE INTO sync_state (folder, last_sync_at, message_count)
       VALUES (?, ?, ?)`,
      [folder, now, emails.length],
    )
  })
}

/**
 * Get a single message with body from cache.
 */
export function getCachedEmailDetail(
  id: string,
): { email: EmailDetail; metadata: CacheMetadata } | null {
  const message = queryOne<CachedMessage>(
    "SELECT * FROM messages WHERE id = ?",
    [id],
  )

  if (!message) {
    return null
  }

  const body = queryOne<CachedBody>(
    "SELECT * FROM message_bodies WHERE message_id = ?",
    [id],
  )

  // Body must be cached for a complete result
  if (!body) {
    return null
  }

  const email: EmailDetail = {
    id: message.id,
    from: message.sender_name || "Unknown",
    fromEmail: message.sender_email || undefined,
    subject: message.subject || "(No subject)",
    body: body.body_html || body.body_text || "",
    date: message.received_at
      ? new Date(message.received_at * 1000).toISOString()
      : undefined,
    threadId: message.thread_id || undefined,
  }

  return {
    email,
    metadata: createCacheMetadata(
      "cache",
      body.cached_at,
      TTL_CONFIG.message_body,
    ),
  }
}

/**
 * Cache email detail with body.
 */
export function cacheEmailDetail(email: EmailDetail): void {
  const now = unixNow()

  transaction(() => {
    // Update or insert message metadata
    execute(
      `INSERT OR REPLACE INTO messages
       (id, thread_id, folder, sender_email, sender_name, subject, received_at, body_cached, cached_at, ttl_seconds)
       VALUES (?, ?, COALESCE((SELECT folder FROM messages WHERE id = ?), 'unknown'), ?, ?, ?, ?, 1, ?, ?)`,
      [
        email.id,
        email.threadId || null,
        email.id,
        email.fromEmail || null,
        email.from,
        email.subject,
        email.date ? Math.floor(new Date(email.date).getTime() / 1000) : null,
        now,
        TTL_CONFIG.message_body,
      ],
    )

    // Cache body separately
    execute(
      `INSERT OR REPLACE INTO message_bodies (message_id, body_html, body_text, cached_at)
       VALUES (?, ?, ?, ?)`,
      [
        email.id,
        email.body,
        null, // Could extract text version if needed
        now,
      ],
    )
  })
}

/**
 * Get cached search results.
 */
export function getCachedSearch(
  searchQuery: string,
): { emails: Email[]; metadata: CacheMetadata } | null {
  const queryHash = hashQuery(searchQuery)
  const normalizedQuery = searchQuery.toLowerCase().trim()

  const cached = queryOne<{
    query: string
    result_ids: string
    cached_at: number
    ttl_seconds: number
  }>(
    "SELECT query, result_ids, cached_at, ttl_seconds FROM search_cache WHERE query_hash = ?",
    [queryHash],
  )

  if (!cached || isExpired(cached.cached_at, cached.ttl_seconds)) {
    return null
  }

  // Verify query matches to prevent hash collision issues
  if (cached.query.toLowerCase().trim() !== normalizedQuery) {
    return null
  }

  const ids: string[] = JSON.parse(cached.result_ids)
  if (ids.length === 0) {
    return {
      emails: [],
      metadata: createCacheMetadata(
        "cache",
        cached.cached_at,
        TTL_CONFIG.search_results,
      ),
    }
  }

  const placeholders = ids.map(() => "?").join(",")
  const rows = query<CachedMessage>(
    `SELECT * FROM messages WHERE id IN (${placeholders})`,
    ids,
  )

  return {
    emails: rows.map(toEmail),
    metadata: createCacheMetadata(
      "cache",
      cached.cached_at,
      TTL_CONFIG.search_results,
    ),
  }
}

/**
 * Cache search results.
 */
export function cacheSearchResults(searchQuery: string, emails: Email[]): void {
  const now = unixNow()
  const queryHash = hashQuery(searchQuery)

  transaction(() => {
    // Cache the messages themselves
    for (const email of emails) {
      execute(
        `INSERT OR IGNORE INTO messages
         (id, folder, sender_email, sender_name, subject, snippet, received_at, is_read, cached_at, ttl_seconds)
         VALUES (?, 'search', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          email.id,
          email.fromEmail || null,
          email.from,
          email.subject,
          email.snippet || null,
          email.date ? Math.floor(new Date(email.date).getTime() / 1000) : null,
          email.unread ? 0 : 1,
          now,
          TTL_CONFIG.message_metadata,
        ],
      )
    }

    // Cache the search result set
    execute(
      `INSERT OR REPLACE INTO search_cache (query_hash, query, result_ids, result_count, cached_at, ttl_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        queryHash,
        searchQuery,
        JSON.stringify(emails.map((e) => e.id)),
        emails.length,
        now,
        TTL_CONFIG.search_results,
      ],
    )
  })
}

/**
 * Invalidate cache for specific actions.
 */
export function invalidateForAction(
  action:
    | "archive"
    | "delete"
    | "set_aside"
    | "reply_later"
    | "send"
    | "reply"
    | "trash"
    | "restore"
    | "spam"
    | "bubble_up",
  messageId?: string,
): void {
  const now = unixNow()

  switch (action) {
    case "archive":
    case "set_aside":
    case "reply_later":
      if (messageId) {
        // Update the message's folder
        execute("UPDATE messages SET cached_at = 0 WHERE id = ?", [messageId])
      }
      // Invalidate folder lists by marking sync state stale
      execute("UPDATE sync_state SET requires_full_sync = 1")
      break

    case "delete":
      if (messageId) {
        execute("DELETE FROM messages WHERE id = ?", [messageId])
        execute("DELETE FROM message_bodies WHERE message_id = ?", [messageId])
      }
      execute("UPDATE sync_state SET requires_full_sync = 1")
      break

    case "send":
    case "reply":
      // Invalidate sent folder and potentially thread cache
      execute(
        "UPDATE sync_state SET requires_full_sync = 1 WHERE folder IN ('sent', 'imbox')",
      )
      break

    case "trash":
      if (messageId) {
        execute("UPDATE messages SET cached_at = 0 WHERE id = ?", [messageId])
      }
      // Invalidate imbox and trash folders
      execute(
        "UPDATE sync_state SET requires_full_sync = 1 WHERE folder IN ('imbox', 'trash', 'feed', 'paper_trail')",
      )
      break

    case "restore":
      if (messageId) {
        execute("UPDATE messages SET cached_at = 0 WHERE id = ?", [messageId])
      }
      // Invalidate trash and destination folders
      execute(
        "UPDATE sync_state SET requires_full_sync = 1 WHERE folder IN ('imbox', 'trash', 'spam')",
      )
      break

    case "spam":
      if (messageId) {
        execute("UPDATE messages SET cached_at = 0 WHERE id = ?", [messageId])
      }
      // Invalidate imbox and spam folders
      execute(
        "UPDATE sync_state SET requires_full_sync = 1 WHERE folder IN ('imbox', 'spam', 'feed', 'paper_trail')",
      )
      break

    case "bubble_up":
      if (messageId) {
        execute("UPDATE messages SET cached_at = 0 WHERE id = ?", [messageId])
      }
      // Invalidate set_aside folder (bubble up moves from set aside)
      execute(
        "UPDATE sync_state SET requires_full_sync = 1 WHERE folder IN ('set_aside', 'imbox')",
      )
      break
  }

  // Always invalidate search cache on mutations
  execute("DELETE FROM search_cache WHERE cached_at < ?", [now])
}

/**
 * Update read status in cache.
 */
export function updateReadStatus(messageId: string, isRead: boolean): void {
  execute("UPDATE messages SET is_read = ?, cached_at = ? WHERE id = ?", [
    isRead ? 1 : 0,
    unixNow(),
    messageId,
  ])
}

/**
 * Check if folder needs refresh.
 */
export function needsRefresh(folder: string): boolean {
  const state = queryOne<{
    last_sync_at: number
    requires_full_sync: number
  }>(
    "SELECT last_sync_at, requires_full_sync FROM sync_state WHERE folder = ?",
    [folder],
  )

  if (!state) return true
  if (state.requires_full_sync) return true

  const ttl =
    folder === "imbox" ? TTL_CONFIG.inbox_list : TTL_CONFIG.folder_list
  return isExpired(state.last_sync_at, ttl)
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): {
  message_count: number
  body_count: number
  search_cache_count: number
  oldest_message: string | null
  cache_size_estimate: number
} {
  const messageCount =
    queryOne<{ count: number }>("SELECT COUNT(*) as count FROM messages")
      ?.count || 0
  const bodyCount =
    queryOne<{ count: number }>("SELECT COUNT(*) as count FROM message_bodies")
      ?.count || 0
  const searchCount =
    queryOne<{ count: number }>("SELECT COUNT(*) as count FROM search_cache")
      ?.count || 0
  const oldest = queryOne<{ cached_at: number }>(
    "SELECT MIN(cached_at) as cached_at FROM messages",
  )

  return {
    message_count: messageCount,
    body_count: bodyCount,
    search_cache_count: searchCount,
    oldest_message: oldest?.cached_at
      ? new Date(oldest.cached_at * 1000).toISOString()
      : null,
    cache_size_estimate: messageCount * 500 + bodyCount * 5000, // Rough bytes estimate
  }
}
