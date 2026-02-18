import { db, schema } from "./index.ts";
import { sql } from "drizzle-orm";

export function runMigrations() {
  // Create tables if they don't exist using raw SQL
  // This approach avoids needing drizzle-kit at runtime
  db.run(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_name TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_executions (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id),
      agent_name TEXT NOT NULL,
      status TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES agent_executions(id),
      chat_id TEXT NOT NULL REFERENCES chats(id),
      agent_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_estimate REAL NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Permanent billing ledger — no FKs, survives chat/project deletion
  db.run(sql`
    CREATE TABLE IF NOT EXISTS billing_ledger (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      project_name TEXT,
      chat_id TEXT,
      chat_title TEXT,
      execution_id TEXT,
      agent_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_estimate REAL NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      chat_id TEXT,
      label TEXT NOT NULL,
      file_manifest TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  console.log("[db] Migrations complete");
}
