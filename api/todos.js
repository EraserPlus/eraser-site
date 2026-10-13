/* ===========================================================================
   /api/todos   待办事项
   全部操作都需要登录——待办是私人的，不公开读。
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readJson, needText, optionalText, optionalDate, needId } from './_lib/http.js';

/* 优先级：0 低 / 1 中 / 2 高，默认中 */
function needPriority(v) {
  if (v === undefined || v === null || v === '') return 1;
  const n = Number(v);
  if (n !== 0 && n !== 1 && n !== 2) {
    const e = new Error('优先级只能是 0（低）、1（中）或 2（高）');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return n;
}

const COLS = 'id, title, note, done, due_date, priority, created_at, done_at';

export default async function handler(req, res) {
  try {
    requireAuth(req);
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, title, note, done, due_date, priority, created_at, done_at
        FROM todos
        ORDER BY done ASC, priority DESC, due_date ASC NULLS LAST, id DESC`;
      return ok(res, { ok: true, items: rows });
    }

    if (req.method === 'POST') {
      const b = await readJson(req);
      const rows = await sql`
        INSERT INTO todos (title, note, due_date, priority)
        VALUES (
          ${needText(b.title, '标题', 200)},
          ${optionalText(b.note)},
          ${optionalDate(b.due_date, '截止日期')},
          ${needPriority(b.priority)}
        )
        RETURNING id, title, note, done, due_date, priority, created_at, done_at`;
      return ok(res, { ok: true, item: rows[0] });
    }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const id = needId(b.id);
      const rows = await sql`
        UPDATE todos SET
          title    = ${needText(b.title, '标题', 200)},
          note     = ${optionalText(b.note)},
          due_date = ${optionalDate(b.due_date, '截止日期')},
          priority = ${needPriority(b.priority)},
          done     = ${!!b.done},
          done_at  = CASE WHEN ${!!b.done} THEN COALESCE(done_at, now()) ELSE NULL END
        WHERE id = ${id}
        RETURNING id, title, note, done, due_date, priority, created_at, done_at`;
      if (!rows.length) return send(res, 404, { error: '这条待办不存在，可能已被删除' });
      return ok(res, { ok: true, item: rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = needId((req.query && req.query.id) || (await readJson(req)).id);
      const rows = await sql`DELETE FROM todos WHERE id = ${id} RETURNING id`;
      if (!rows.length) return send(res, 404, { error: '这条待办不存在，可能已被删除' });
      return ok(res, { ok: true, id });
    }

    return send(res, 405, { error: '不支持的请求方法' });
  } catch (e) {
    return fail(res, e);
  }
}
