/**
 * SQLite schema for email caching.
 * Separates lightweight metadata from full content for fast queries.
 */

export const SCHEMA_VERSION = 2

export const INIT_SCHEMA = `
-- Pragma settings for optimal caching performance
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -20000;
PRAGMA temp_store = MEMORY;
PRAGMA foreign_keys = ON;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_info (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Core messages table with metadata-first design
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    folder TEXT NOT NULL,
    sender_email TEXT,
    sender_name TEXT,
    subject TEXT,
    snippet TEXT,
    received_at INTEGER,
    has_attachments INTEGER DEFAULT 0,
    is_read INTEGER DEFAULT 0,
    is_starred INTEGER DEFAULT 0,

    -- Cache management
    body_cached INTEGER DEFAULT 0,
    cached_at INTEGER NOT NULL,
    etag TEXT,
    sync_status TEXT DEFAULT 'synced',
    ttl_seconds INTEGER DEFAULT 86400
);

-- Thread aggregation
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    subject_base TEXT,
    participant_emails TEXT,
    message_count INTEGER DEFAULT 1,
    unread_count INTEGER DEFAULT 0,
    newest_date INTEGER,
    oldest_date INTEGER,
    cached_at INTEGER NOT NULL
);

-- Separate table for body content (lazy-loaded)
CREATE TABLE IF NOT EXISTS message_bodies (
    message_id TEXT PRIMARY KEY,
    body_text TEXT,
    body_html TEXT,
    raw_headers TEXT,
    cached_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Attachments metadata
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    filename TEXT,
    content_type TEXT,
    size INTEGER,
    cached INTEGER DEFAULT 0,
    cache_path TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Sync state per folder for incremental sync
CREATE TABLE IF NOT EXISTS sync_state (
    folder TEXT PRIMARY KEY,
    last_sync_at INTEGER,
    sync_cursor TEXT,
    highest_id TEXT,
    message_count INTEGER,
    requires_full_sync INTEGER DEFAULT 0
);

-- Sync queue for offline operations
CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT NOT NULL,
    message_id TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending'
);

-- Folder metadata cache
CREATE TABLE IF NOT EXISTS folders (
    name TEXT PRIMARY KEY,
    display_name TEXT,
    unread_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    cached_at INTEGER NOT NULL
);

-- Search results cache
CREATE TABLE IF NOT EXISTS search_cache (
    query_hash TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    result_ids TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    cached_at INTEGER NOT NULL,
    ttl_seconds INTEGER DEFAULT 60
);

-- Folder HTML cache (for re-parsing summaries without network fetch)
CREATE TABLE IF NOT EXISTS folder_html (
    folder TEXT PRIMARY KEY,
    html TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, received_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_email);
CREATE INDEX IF NOT EXISTS idx_messages_sync ON messages(sync_status) WHERE sync_status != 'synced';
CREATE INDEX IF NOT EXISTS idx_messages_cached ON messages(cached_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
`

export const FTS_SCHEMA = `
-- FTS5 with external content (no duplicate storage)
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    sender_name,
    sender_email,
    subject,
    snippet,
    content='messages',
    content_rowid='rowid',
    tokenize='porter unicode61',
    prefix='2 3'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, sender_name, sender_email, subject, snippet)
    VALUES (new.rowid, new.sender_name, new.sender_email, new.subject, new.snippet);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, sender_name, sender_email, subject, snippet)
    VALUES('delete', old.rowid, old.sender_name, old.sender_email, old.subject, old.snippet);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, sender_name, sender_email, subject, snippet)
    VALUES('delete', old.rowid, old.sender_name, old.sender_email, old.subject, old.snippet);
    INSERT INTO messages_fts(rowid, sender_name, sender_email, subject, snippet)
    VALUES (new.rowid, new.sender_name, new.sender_email, new.subject, new.snippet);
END;
`

// TTL configuration by data type (in seconds)
export const TTL_CONFIG = {
  message_body: 86400, // 24 hours - immutable once delivered
  message_metadata: 300, // 5 minutes
  folder_list: 300, // 5 minutes
  inbox_list: 120, // 2 minutes - needs frequent updates
  unread_counts: 60, // 1 minute
  search_results: 60, // 1 minute - quickly stale after mutations
  thread: 300, // 5 minutes
} as const
