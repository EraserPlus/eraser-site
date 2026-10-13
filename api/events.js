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
      /* 合并语义：只更新请求体里出现的键，未出现的保持原值（与 /api/content 一致）。
         旧前端传全量字段时行为不变（全传 = 全量更新）。
         注意：假数据库驱动只支持静态 SQL，不能用 sql.join 动态拼 SET 子句，
         所以用一条静态 SQL + CASE 实现按需更新。 */
      const b = await readJson(req);
      const id = needId(b.id);
      const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
      const hasTitle = has('title'), hasNote = has('note'), hasStart = has('start_at'),
            hasEnd = has('end_at'), hasAllDay = has('all_day');
      if (!hasTitle && !hasNote && !hasStart && !hasEnd && !hasAllDay) {
        const e = new Error('至少传一个要修改的字段（title / note / start_at / end_at / all_day）');
        e.code = 'BAD_INPUT';
        throw e;
      }
      const title  = hasTitle  ? needText(b.title, '标题', 200) : null;
      const note   = hasNote   ? optionalText(b.note) : null;
      const start  = hasStart  ? needTimestamp(b.start_at, '开始时间') : null;
      const end    = hasEnd    ? (b.end_at ? needTimestamp(b.end_at, '结束时间') : null) : null;
      const allDay = hasAllDay ? !!b.all_day : null;
      const rows = await sql`
        UPDATE events SET
          title    = CASE WHEN ${hasTitle} THEN ${title}::text ELSE title END,
          note     = CASE WHEN ${hasNote}  THEN ${note}::text ELSE note END,
          start_at = CASE WHEN ${hasStart} THEN ${start}::timestamptz ELSE start_at END,
          end_at   = CASE WHEN ${hasEnd}   THEN ${end}::timestamptz ELSE end_at END,
          all_day  = CASE WHEN ${hasAllDay} THEN ${allDay}::boolean ELSE all_day END
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
