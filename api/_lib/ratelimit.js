/* ===========================================================================
   登录限流（依赖数据库）
   ---------------------------------------------------------------------------
   用数据库而不是内存，因为 Serverless 的实例不共享内存，
   内存计数在并发实例下形同虚设。
   =========================================================================== */

import { db, ensureSchema } from './db.js';

export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60 * 1000;

export async function assertNotLocked(ip) {
  await ensureSchema();
  const sql = db();
  const rows = await sql`SELECT fails, locked_until FROM login_attempts WHERE ip = ${ip}`;
  const row = rows[0];
  if (!row || !row.locked_until) return;
  const left = new Date(row.locked_until).getTime() - Date.now();
  if (left > 0) {
    const mins = Math.ceil(left / 60000);
    const err = new Error(`密码连续输错多次，已锁定，请 ${mins} 分钟后再试`);
    err.code = 'LOCKED';
    throw err;
  }
}

export async function recordFail(ip) {
  await ensureSchema();
  const sql = db();
  const rows = await sql`
    INSERT INTO login_attempts (ip, fails) VALUES (${ip}, 1)
    ON CONFLICT (ip) DO UPDATE SET fails = login_attempts.fails + 1
    RETURNING fails`;
  const fails = rows[0] ? rows[0].fails : 1;
  if (fails >= MAX_FAILS) {
    const until = new Date(Date.now() + LOCK_MS).toISOString();
    await sql`
      UPDATE login_attempts
      SET locked_until = ${until}::timestamptz, fails = 0
      WHERE ip = ${ip}`;
  }
  return fails;
}

export async function clearFails(ip) {
  await ensureSchema();
  const sql = db();
  await sql`DELETE FROM login_attempts WHERE ip = ${ip}`;
}
