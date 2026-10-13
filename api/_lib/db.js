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
      /* 后续加的列，用 IF NOT EXISTS 保证对已有数据库也安全 */
      await sql`ALTER TABLE todos ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 1`;

      /* ------------------------------------------------------------------
         站点内容：导航、博客、文件、页面统一放这一张表。
         type 取值：nav_category / nav_link / post / file / page
         parent_id 用于 nav_link 指向它所属的 nav_category
         data 存该类型自己的字段（jsonb），避免为每种内容单独建表
         ------------------------------------------------------------------ */
      await sql`
        CREATE TABLE IF NOT EXISTS content (
          id          serial PRIMARY KEY,
          type        text NOT NULL,
          parent_id   integer,
          data        jsonb NOT NULL,
          sort_order  integer NOT NULL DEFAULT 0,
          created_at  timestamptz NOT NULL DEFAULT now(),
          updated_at  timestamptz NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS content_type_idx ON content (type, sort_order, id)`;

      await sql`CREATE INDEX IF NOT EXISTS todos_due_idx ON todos (due_date)`;
      await sql`CREATE INDEX IF NOT EXISTS events_start_idx ON events (start_at)`;
    })().catch((e) => {
      schemaReady = null;   // 失败就下次重试
      throw e;
    });
  }
  return schemaReady;
}
