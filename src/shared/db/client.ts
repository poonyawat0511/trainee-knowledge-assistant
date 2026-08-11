import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = process.env.DATABASE_PATH ?? './data/app.db'
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  const schema = fs.readFileSync(
    path.join(process.cwd(), 'src/shared/db/schema.sql'),
    'utf-8'
  )
  db.exec(schema)

  return db
}
