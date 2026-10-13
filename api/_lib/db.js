/* ===========================================================================
   数据库连接
   ---------------------------------------------------------------------------
   连接串来自 Vercel 环境变量，由 Neon 集成自动注入。
   优先读 DATABASE_URL，回退到 POSTGRES_URL（旧版集成用的名字）。
   连接串绝不写进代码——仓库是公开的。
   =========================================================================== */

import { neon } from '@neondatabase/serverless';

let cached = null;

export function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    const err = new Error('服务器没有配置数据库连接。请在 Vercel 项目的环境变量里设置 DATABASE_URL。');
    err.code = 'NO_DATABASE';
    throw err;
  }
  if (!cached) cached = neon(url);
  return cached;
}

/* 首次访问时建表。用 IF NOT EXISTS，重复调用是安全的。 */
let schemaReady = null;

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = db();
      await sql`
        CREATE TABLE IF NOT EXISTS todos (
          id          serial PRIMARY KEY,
          title       text NOT NULL,
          note        text,
          done        boolean NOT NULL DEFAULT false,
          due_date    date,
          created_at  timestamptz NOT NULL DEFAULT now(),
          done_at     timestamptz
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS events (
          id          serial PRIMARY KEY,
          title       text NOT NULL,
          note        text,
          start_at    timestamptz NOT NULL,
          end_at      timestamptz,
          all_day     boolean NOT NULL DEFAULT false,
          created_at  timestamptz NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS login_attempts (
          ip            text PRIMARY KEY,
          fails         integer NOT NULL DEFAULT 0,
          locked_until  timestamptz
        )`;
      await sql`CREATE INDEX IF NOT EXISTS todos_due_idx ON todos (due_date)`;
      await sql`CREATE INDEX IF NOT EXISTS events_start_idx ON events (start_at)`;
    })().catch((e) => {
      schemaReady = null;   // 失败就下次重试
      throw e;
    });
  }
  return schemaReady;
}
