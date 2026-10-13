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
      /* 合并语义：只更新请求体里出现的键，未出现的保持原值（与 /api/content 一致）。
         旧前端传全量字段时行为不变（全传 = 全量更新）。
         注意：假数据库驱动只支持静态 SQL，不能用 sql.join 动态拼 SET 子句，
         所以用一条静态 SQL + CASE 实现按需更新。 */
      const b = await readJson(req);
      const id = needId(b.id);
      const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
      const hasTitle = has('title'), hasNote = has('note'), hasDue = has('due_date'),
            hasPri = has('priority'), hasDone = has('done');
      if (!hasTitle && !hasNote && !hasDue && !hasPri && !hasDone) {
        const e = new Error('至少传一个要修改的字段（title / note / due_date / priority / done）');
        e.code = 'BAD_INPUT';
        throw e;
      }
      /* 只校验出现的字段；未出现的不校验、不发送 */
      const title = hasTitle ? needText(b.title, '标题', 200) : null;
      const note  = hasNote  ? optionalText(b.note) : null;
      const due   = hasDue   ? optionalDate(b.due_date, '截止日期') : null;
      const pri   = hasPri   ? needPriority(b.priority) : null;
      const done  = hasDone  ? !!b.done : null;
      /* done_at 三态：传 done=true → 已打过时间戳的不动；传 done=false → 清空；不传 → 原值。
         done_at 永不接受前端传入（SQL 里没有它的入参，天然防御）。 */
      const rows = await sql`
        UPDATE todos SET
          title    = CASE WHEN ${hasTitle} THEN ${title}::text ELSE title END,
          note     = CASE WHEN ${hasNote}  THEN ${note}::text  ELSE note END,
          due_date = CASE WHEN ${hasDue}   THEN ${due}::date   ELSE due_date END,
          priority = CASE WHEN ${hasPri}   THEN ${pri}::smallint ELSE priority END,
          done     = CASE WHEN ${hasDone}  THEN ${done}::boolean ELSE done END,
          done_at  = CASE
                       WHEN ${hasDone} AND NOT ${done} THEN NULL
                       WHEN ${hasDone} AND ${done} THEN COALESCE(done_at, now())
                       ELSE done_at
                     END
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
