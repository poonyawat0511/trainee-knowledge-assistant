import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'

// sql.js (WASM SQLite) is used instead of better-sqlite3 (a native addon).
// better-sqlite3 was observed to segfault (SIGSEGV) inside Docker Desktop
// on this project's target machine even when compiled from source
// specifically for that container — see README Known Issues. WASM has no
// native/dlopen code path, so it isn't susceptible to that failure mode.
// The trade-off: sql.js runs entirely in memory and has no built-in file
// persistence, so this wrapper loads the whole DB file into memory on
// first use and re-exports/writes the whole DB back to disk after every
// write. Fine for this project's data volume; would not scale to a large
// database.

export interface PreparedStatement {
  get(...args: unknown[]): Record<string, unknown> | undefined
  all(...args: unknown[]): Record<string, unknown>[]
  run(...args: unknown[]): void
}

export interface DbLike {
  prepare(sql: string): PreparedStatement
  exec(sql: string): void
  pragma(setting: string): void
}

function wrap(sqlJsDb: SqlJsDatabase, dbPath: string): DbLike {
  function persist(): void {
    fs.writeFileSync(dbPath, Buffer.from(sqlJsDb.export()))
  }

  return {
    prepare(sql: string): PreparedStatement {
      return {
        get(...args: unknown[]) {
          const stmt = sqlJsDb.prepare(sql)
          try {
            stmt.bind(args as never)
            const hasRow = stmt.step()
            return hasRow ? (stmt.getAsObject() as Record<string, unknown>) : undefined
          } finally {
            stmt.free()
          }
        },
        all(...args: unknown[]) {
          const stmt = sqlJsDb.prepare(sql)
          const rows: Record<string, unknown>[] = []
          try {
            stmt.bind(args as never)
            while (stmt.step()) {
              rows.push(stmt.getAsObject() as Record<string, unknown>)
            }
          } finally {
            stmt.free()
          }
          return rows
        },
        run(...args: unknown[]) {
          sqlJsDb.run(sql, args as never)
          persist()
        },
      }
    },
    exec(sql: string): void {
      sqlJsDb.exec(sql)
      persist()
    },
    pragma(): void {
      // No-op: WAL and other better-sqlite3-specific pragmas aren't
      // meaningful for an in-memory sql.js instance that is snapshotted
      // to disk after every write instead.
    },
  }
}

let dbPromise: Promise<DbLike> | null = null

export function getDb(): Promise<DbLike> {
  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    const dbPath = process.env.DATABASE_PATH ?? './data/app.db'
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })

    // Next's build-time file tracer cannot follow the dynamic path sql.js
    // uses internally to locate its WASM binary, so it isn't picked up
    // automatically into the standalone Docker build. `locateFile` makes
    // the path explicit and resolvable at runtime instead; the Dockerfile
    // separately copies this exact file into the runner image.
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules/sql.js/dist', file),
    })
    const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined
    const sqlJsDb = new SQL.Database(existing)

    const wrapped = wrap(sqlJsDb, dbPath)

    const schema = fs.readFileSync(
      path.join(process.cwd(), 'src/shared/db/schema.sql'),
      'utf-8'
    )
    wrapped.exec(schema)

    return wrapped
  })()

  return dbPromise
}
