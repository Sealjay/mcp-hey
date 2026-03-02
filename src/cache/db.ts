/**
 * SQLite database wrapper for email caching.
 * Uses Bun's built-in SQLite for optimal performance.
 */

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { FTS_SCHEMA, INIT_SCHEMA, SCHEMA_VERSION } from "./schema"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "..", "data")
const DB_PATH = join(DATA_DIR, "hey-cache.db")

let db: Database | null = null

/**
 * Check if an error is a SQLite disk I/O error.
 */
function isDiskError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("disk I/O error") ||
      error.message.includes("database disk image is malformed") ||
      error.message.includes("SQLITE_CORRUPT") ||
      error.message.includes("SQLITE_IOERR"))
  )
}

/**
 * Close and discard the current database connection.
 * Removes WAL/SHM files to clear any corrupted journaling state.
 */
export function resetDatabase(): void {
  if (db) {
    try {
      db.close()
    } catch {
      // Connection may already be unusable — ignore close errors
    }
    db = null
  }

  // Remove WAL/SHM files that may hold corrupted state
  for (const suffix of ["-wal", "-shm"]) {
    try {
      rmSync(`${DB_PATH}${suffix}`, { force: true })
    } catch {
      // Best-effort cleanup
    }
  }
}

export function getDatabase(): Database {
  if (db) {
    // Health check: verify the connection is still usable
    try {
      db.query("SELECT 1").get()
      return db
    } catch (error) {
      if (isDiskError(error)) {
        console.error("[hey-mcp] Database connection unhealthy, resetting...")
        resetDatabase()
      } else {
        throw error
      }
    }
  }

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }

  try {
    db = new Database(DB_PATH, { create: true })
    initializeSchema(db)
    return db
  } catch (error) {
    if (isDiskError(error)) {
      // Database file is corrupted — delete and recreate
      console.error("[hey-mcp] Database corrupted, recreating from scratch...")
      db = null
      try {
        rmSync(DB_PATH, { force: true })
        rmSync(`${DB_PATH}-wal`, { force: true })
        rmSync(`${DB_PATH}-shm`, { force: true })
      } catch {
        // Best-effort cleanup
      }
      db = new Database(DB_PATH, { create: true })
      initializeSchema(db)
      return db
    }
    throw error
  }
}

function initializeSchema(database: Database): void {
  // Check current schema version (handle case where table doesn't exist yet)
  let currentVersion = 0
  try {
    const versionResult = database
      .query("SELECT value FROM schema_info WHERE key = 'version'")
      .get() as { value: string } | null
    currentVersion = versionResult
      ? Number.parseInt(versionResult.value, 10)
      : 0
  } catch {
    // Table doesn't exist yet, need full initialization
    currentVersion = 0
  }

  if (currentVersion < SCHEMA_VERSION) {
    console.error(`[hey-mcp] Initializing cache schema v${SCHEMA_VERSION}...`)

    // Run schema initialization (handles fresh installs via CREATE TABLE IF NOT EXISTS)
    database.exec(INIT_SCHEMA)

    // Initialize FTS (separate to handle potential errors gracefully)
    try {
      database.exec(FTS_SCHEMA)
    } catch (err) {
      console.error("[hey-mcp] FTS5 initialization warning:", err)
    }

    // Migration to v3: add stale column to message_bodies
    if (currentVersion < 3) {
      try {
        database.exec(
          "ALTER TABLE message_bodies ADD COLUMN stale INTEGER NOT NULL DEFAULT 0",
        )
        console.error(
          "[hey-mcp] Migrated v2 → v3: added stale column to message_bodies",
        )
      } catch (err) {
        // Column already exists (idempotent) — safe to ignore
        if (err instanceof Error && err.message.includes("duplicate column")) {
          console.error(
            "[hey-mcp] Migration v2 → v3: stale column already exists, skipping",
          )
        } else {
          throw err
        }
      }
    }

    // Update version
    database
      .query(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('version', ?)",
      )
      .run(String(SCHEMA_VERSION))

    console.error("[hey-mcp] Cache schema initialized")
  }
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.exec("PRAGMA optimize")
    } catch {
      // Best-effort optimization
    }
    try {
      db.close()
    } catch {
      // Ignore close errors during shutdown
    }
    db = null
  }
}

/**
 * Execute a function with automatic retry on disk I/O errors.
 * Resets the database connection on first failure and retries once.
 */
function withRetry<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (isDiskError(error)) {
      console.error(
        "[hey-mcp] Disk I/O error, resetting database and retrying...",
      )
      resetDatabase()
      return fn()
    }
    throw error
  }
}

/**
 * Execute a query with automatic database connection.
 */
export function query<T>(sql: string, params?: unknown[]): T[] {
  return withRetry(() => {
    const database = getDatabase()
    const stmt = database.query(sql)
    return (params ? stmt.all(...params) : stmt.all()) as T[]
  })
}

/**
 * Execute a single-row query.
 */
export function queryOne<T>(sql: string, params?: unknown[]): T | null {
  return withRetry(() => {
    const database = getDatabase()
    const stmt = database.query(sql)
    return (params ? stmt.get(...params) : stmt.get()) as T | null
  })
}

/**
 * Execute a write operation.
 */
export function execute(sql: string, params?: unknown[]): void {
  withRetry(() => {
    const database = getDatabase()
    const stmt = database.query(sql)
    if (params) {
      stmt.run(...params)
    } else {
      stmt.run()
    }
  })
}

/**
 * Execute multiple statements in a transaction.
 */
export function transaction<T>(fn: () => T): T {
  return withRetry(() => {
    const database = getDatabase()
    return database.transaction(fn)()
  })
}

/**
 * Get current Unix timestamp in seconds.
 */
export function unixNow(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Check if a cached item is expired.
 */
export function isExpired(cachedAt: number, ttlSeconds: number): boolean {
  return unixNow() > cachedAt + ttlSeconds
}

/**
 * Generate a hash for search query caching.
 * Uses Bun's native hash for better collision resistance (64-bit).
 */
export function hashQuery(query: string): string {
  // Normalize query before hashing for consistent results
  const normalized = query.toLowerCase().trim()
  // Bun.hash returns a 64-bit hash as bigint, convert to base36 string
  return Bun.hash(normalized).toString(36)
}

// Cache size limits
const CACHE_LIMITS = {
  maxMessages: 10000, // Maximum cached messages
  maxBodies: 1000, // Maximum cached message bodies
  maxSearchResults: 500, // Maximum cached search results
} as const

/**
 * Run periodic maintenance tasks.
 */
export function runMaintenance(): void {
  const database = getDatabase()
  const now = unixNow()

  // Clean expired search cache
  database
    .query(
      `DELETE FROM search_cache
     WHERE cached_at + ttl_seconds < ?`,
    )
    .run(now)

  // Clean expired folder HTML cache
  database
    .query(
      `DELETE FROM folder_html
     WHERE cached_at + ttl_seconds < ?`,
    )
    .run(now)

  // Clean old sync queue entries
  database
    .query(
      `DELETE FROM sync_queue
     WHERE status = 'completed'
       AND created_at < ?`,
    )
    .run(now - 86400) // 24 hours

  // Evict oldest messages if over limit (keep most recent)
  database
    .query(
      `DELETE FROM messages
     WHERE id NOT IN (
       SELECT id FROM messages
       ORDER BY cached_at DESC
       LIMIT ?
     )`,
    )
    .run(CACHE_LIMITS.maxMessages)

  // Evict oldest message bodies if over limit
  database
    .query(
      `DELETE FROM message_bodies
     WHERE message_id NOT IN (
       SELECT message_id FROM message_bodies
       ORDER BY cached_at DESC
       LIMIT ?
     )`,
    )
    .run(CACHE_LIMITS.maxBodies)

  // Evict oldest search results if over limit
  database
    .query(
      `DELETE FROM search_cache
     WHERE query_hash NOT IN (
       SELECT query_hash FROM search_cache
       ORDER BY cached_at DESC
       LIMIT ?
     )`,
    )
    .run(CACHE_LIMITS.maxSearchResults)

  // Checkpoint WAL to prevent unbounded growth
  database.exec("PRAGMA wal_checkpoint(PASSIVE)")

  // Incremental vacuum
  database.exec("PRAGMA incremental_vacuum(100)")
}
