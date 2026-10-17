import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { initializeSchema } from "../cache/db"
import { INIT_SCHEMA, SCHEMA_VERSION } from "../cache/schema"

function tables(db: Database): string[] {
  return db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )
    .all()
    .map((r) => r.name)
}

describe("schema upgrade", () => {
  test("a v4 cache gains the contact_boxes table", () => {
    const db = new Database(":memory:")
    db.exec(INIT_SCHEMA)
    db.exec("DROP TABLE contact_boxes")
    db.query(
      "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('version', '4')",
    ).run()
    expect(tables(db)).not.toContain("contact_boxes")

    initializeSchema(db)

    expect(tables(db)).toContain("contact_boxes")
    const v = db
      .query<{ value: string }, []>(
        "SELECT value FROM schema_info WHERE key = 'version'",
      )
      .get()
    expect(v?.value).toBe(String(SCHEMA_VERSION))
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(5)
    db.close()
  })
})
