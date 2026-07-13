import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Test database path - use OS temp directory for reliable write access
const TEST_DB_DIR = join(tmpdir(), "mcp-hey-test")
const TEST_DB_PATH = join(TEST_DB_DIR, "test-cache.db")
