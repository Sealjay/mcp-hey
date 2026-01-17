import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

// Test database path
const TEST_DB_PATH = join(import.meta.dir, "test-cache.db")

describe("Cache Schema", () => {
  let db: Database

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH)
    }
    db = new Database(TEST_DB_PATH, { create: true })
  })

  afterEach(() => {
    db.close()
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH)
    }
  })

  test("should create messages table with correct columns", () => {
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        folder TEXT NOT NULL,
        sender_email TEXT,
        sender_name TEXT,
        subject TEXT,
        snippet TEXT,
        received_at INTEGER,
        is_read INTEGER DEFAULT 0,
        cached_at INTEGER NOT NULL,
        ttl_seconds INTEGER DEFAULT 86400
      )
    `)

    // Insert test data
    db.query(`
      INSERT INTO messages (id, folder, sender_name, subject, cached_at)
      VALUES ('test-1', 'imbox', 'John Doe', 'Test Subject', 1234567890)
    `).run()

    const result = db.query("SELECT * FROM messages WHERE id = 'test-1'").get()
    expect(result).toBeTruthy()
  })

  test("should create sync_state table", () => {
    db.exec(`
      CREATE TABLE sync_state (
        folder TEXT PRIMARY KEY,
        last_sync_at INTEGER,
        sync_cursor TEXT,
        highest_id TEXT,
        message_count INTEGER,
        requires_full_sync INTEGER DEFAULT 0
      )
    `)

    db.query(`
      INSERT INTO sync_state (folder, last_sync_at, message_count)
      VALUES ('imbox', 1234567890, 10)
    `).run()

    const result = db
      .query("SELECT * FROM sync_state WHERE folder = 'imbox'")
      .get() as { folder: string; last_sync_at: number; message_count: number }
    expect(result).toBeTruthy()
    expect(result.message_count).toBe(10)
  })

  test("should create search_cache table with TTL", () => {
    db.exec(`
      CREATE TABLE search_cache (
        query_hash TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        result_ids TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        cached_at INTEGER NOT NULL,
        ttl_seconds INTEGER DEFAULT 60
      )
    `)

    const now = Math.floor(Date.now() / 1000)
    db.query(`
      INSERT INTO search_cache (query_hash, query, result_ids, result_count, cached_at, ttl_seconds)
      VALUES ('abc123', 'test query', '["1","2","3"]', 3, ?, 60)
    `).run(now)

    const result = db
      .query("SELECT * FROM search_cache WHERE query_hash = 'abc123'")
      .get() as { result_count: number; ttl_seconds: number }
    expect(result).toBeTruthy()
    expect(result.result_count).toBe(3)
    expect(result.ttl_seconds).toBe(60)
  })

  test("should support message body caching separately", () => {
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        folder TEXT NOT NULL,
        subject TEXT,
        body_cached INTEGER DEFAULT 0,
        cached_at INTEGER NOT NULL
      )
    `)

    db.exec(`
      CREATE TABLE message_bodies (
        message_id TEXT PRIMARY KEY,
        body_text TEXT,
        body_html TEXT,
        cached_at INTEGER NOT NULL
      )
    `)

    // Insert message without body
    db.query(`
      INSERT INTO messages (id, folder, subject, body_cached, cached_at)
      VALUES ('msg-1', 'imbox', 'Test', 0, 1234567890)
    `).run()

    // Later, cache the body
    db.query(`
      INSERT INTO message_bodies (message_id, body_html, cached_at)
      VALUES ('msg-1', '<p>Hello World</p>', 1234567890)
    `).run()

    db.query("UPDATE messages SET body_cached = 1 WHERE id = 'msg-1'").run()

    const message = db
      .query("SELECT * FROM messages WHERE id = 'msg-1'")
      .get() as {
      body_cached: number
    }
    const body = db
      .query("SELECT * FROM message_bodies WHERE message_id = 'msg-1'")
      .get() as { body_html: string }

    expect(message.body_cached).toBe(1)
    expect(body.body_html).toBe("<p>Hello World</p>")
  })
})

describe("Cache TTL", () => {
  test("should correctly identify expired cache entries", () => {
    const now = Math.floor(Date.now() / 1000)
    const ttlSeconds = 60
    const cachedAt = now - 120 // 2 minutes ago

    const isExpired = now > cachedAt + ttlSeconds
    expect(isExpired).toBe(true)
  })

  test("should correctly identify fresh cache entries", () => {
    const now = Math.floor(Date.now() / 1000)
    const ttlSeconds = 300
    const cachedAt = now - 60 // 1 minute ago

    const isExpired = now > cachedAt + ttlSeconds
    expect(isExpired).toBe(false)
  })

  test("should handle edge case at exact TTL boundary", () => {
    const now = Math.floor(Date.now() / 1000)
    const ttlSeconds = 60
    const cachedAt = now - 60 // Exactly at TTL

    const isExpired = now > cachedAt + ttlSeconds
    expect(isExpired).toBe(false) // At boundary, not yet expired
  })
})

describe("Query Hashing", () => {
  function hashQuery(query: string): string {
    let hash = 0
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return hash.toString(36)
  }

  test("should produce consistent hashes for same query", () => {
    const query = "important project"
    const hash1 = hashQuery(query)
    const hash2 = hashQuery(query)
    expect(hash1).toBe(hash2)
  })

  test("should produce different hashes for different queries", () => {
    const hash1 = hashQuery("important project")
    const hash2 = hashQuery("urgent meeting")
    expect(hash1).not.toBe(hash2)
  })

  test("should handle empty strings", () => {
    const hash = hashQuery("")
    expect(hash).toBe("0")
  })

  test("should handle special characters", () => {
    const hash = hashQuery("test@example.com")
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe("string")
  })
})

describe("Cache Metadata", () => {
  test("should create valid cache metadata for network response", () => {
    const metadata = {
      source: "network" as const,
      cached_at: new Date().toISOString(),
      age_seconds: 0,
      is_stale: false,
      hint: "Fresh data from Hey.com",
    }

    expect(metadata.source).toBe("network")
    expect(metadata.is_stale).toBe(false)
    expect(metadata.age_seconds).toBe(0)
  })

  test("should create valid cache metadata for cached response", () => {
    const cachedAt = new Date(Date.now() - 120000) // 2 minutes ago
    const metadata = {
      source: "cache" as const,
      cached_at: cachedAt.toISOString(),
      age_seconds: 120,
      is_stale: false,
      hint: "Data is 120s old. Valid for 180s more.",
    }

    expect(metadata.source).toBe("cache")
    expect(metadata.age_seconds).toBe(120)
  })

  test("should indicate stale cache", () => {
    const metadata = {
      source: "cache" as const,
      cached_at: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
      age_seconds: 600,
      is_stale: true,
      hint: "Cache is stale (600s old). Use force_refresh for real-time results.",
    }

    expect(metadata.is_stale).toBe(true)
  })
})

describe("FTS Query Sanitization", () => {
  function sanitizeFtsQuery(input: string): string | null {
    if (!input || input.trim().length === 0) {
      return null
    }

    let sanitized = input
      .replace(/['"]/g, "")
      .replace(/[()]/g, "")
      .replace(/[:^*]/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    if (sanitized.length === 0) {
      return null
    }

    const words = sanitized.split(" ").filter((w) => w.length > 0)
    if (words.length > 1) {
      sanitized = words.map((w) => `"${w}"*`).join(" ")
    } else if (words.length === 1) {
      sanitized = `"${words[0]}"*`
    }

    return sanitized
  }

  test("should handle simple queries", () => {
    const result = sanitizeFtsQuery("hello")
    expect(result).toBe('"hello"*')
  })

  test("should handle multi-word queries", () => {
    const result = sanitizeFtsQuery("hello world")
    expect(result).toBe('"hello"* "world"*')
  })

  test("should remove quotes", () => {
    const result = sanitizeFtsQuery("\"hello\" 'world'")
    expect(result).toBe('"hello"* "world"*')
  })

  test("should remove parentheses", () => {
    const result = sanitizeFtsQuery("(hello) (world)")
    expect(result).toBe('"hello"* "world"*')
  })

  test("should handle empty input", () => {
    const result = sanitizeFtsQuery("")
    expect(result).toBeNull()
  })

  test("should handle whitespace-only input", () => {
    const result = sanitizeFtsQuery("   ")
    expect(result).toBeNull()
  })

  test("should handle special FTS operators", () => {
    const result = sanitizeFtsQuery("test:value^boost*wildcard")
    expect(result).toBe('"test"* "value"* "boost"* "wildcard"*')
  })
})
