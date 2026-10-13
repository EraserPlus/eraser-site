/* ===========================================================================
   /api/events   日程 / 时间表
   全部操作都需要登录——日程是私人的，不公开读。
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readJson, needText, optionalText, needTimestamp, needId } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    requireAuth(req);
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, title, note, start_at, end_at, all_day, created_at
        FROM events
        ORDER BY start_at ASC, id ASC`;
      return ok(res, { ok: true, items: rows });
    }

    if (req.method === 'POST') {
      const b = await readJson(req);
      const rows = await sql`
        INSERT INTO events (title, note, start_at, end_at, all_day)
        VALUES (
          ${needText(b.title, '标题', 200)},
          ${optionalText(b.note)},
          ${needTimestamp(b.start_at, '开始时间')}::timestamptz,
          ${b.end_at ? needTimestamp(b.end_at, '结束时间') : null}::timestamptz,
          ${!!b.all_day}
        )
        RETURNING id, title, note, start_at, end_at, all_day, created_at`;
      return ok(res, { ok: true, item: rows[0] });
    }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const id = needId(b.id);
      const rows = await sql`
        UPDATE events SET
          title    = ${needText(b.title, '标题', 200)},
          note     = ${optionalText(b.note)},
          start_at = ${needTimestamp(b.start_at, '开始时间')}::timestamptz,
          end_at   = ${b.end_at ? needTimestamp(b.end_at, '结束时间') : null}::timestamptz,
          all_day  = ${!!b.all_day}
        WHERE id = ${id}
        RETURNING id, title, note, start_at, end_at, all_day, created_at`;
      if (!rows.length) return send(res, 404, { error: '这条日程不存在，可能已被删除' });
      return ok(res, { ok: true, item: rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = needId((req.query && req.query.id) || (await readJson(req)).id);
      const rows = await sql`DELETE FROM events WHERE id = ${id} RETURNING id`;
      if (!rows.length) return send(res, 404, { error: '这条日程不存在，可能已被删除' });
      return ok(res, { ok: true, id });
    }

    return send(res, 405, { error: '不支持的请求方法' });
  } catch (e) {
    return fail(res, e);
  }
}
