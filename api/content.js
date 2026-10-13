/* ===========================================================================
   /api/content   站点内容：导航 / 博客 / 文件 / 页面
   ---------------------------------------------------------------------------
   GET    公开可读（前台页面要读），其余操作需要登录。
   ?type=nav 是特例：一次返回分类和链接，省得前台发两次请求。
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readJson, needId } from './_lib/http.js';
import { normalize, knownType, needsParent } from './_lib/content.js';

/* jsonb 正常会被驱动解析成对象，但这里防一手 */
function asObj(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}
function shape(row) {
  return {
    id: row.id,
    type: row.type,
    parent_id: row.parent_id,
    sort_order: row.sort_order,
    updated_at: row.updated_at,
    data: asObj(row.data),
  };
}
function pickType(req) {
  const t = (req.query && req.query.type) || '';
  return String(t);
}
function checkType(t) {
  if (!knownType(t)) {
    const e = new Error('未知的内容类型：' + (t || '（空）'));
    e.code = 'BAD_INPUT';
    throw e;
  }
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const sql = db();

    /* ---------------- 读取：公开 ---------------- */
    if (req.method === 'GET') {
      const t = pickType(req);

      if (t === 'nav') {
        const rows = await sql`
          SELECT * FROM content
          WHERE type IN ('nav_category', 'nav_link')
          ORDER BY sort_order ASC, id ASC`;
        const all = rows.map(shape);
        return ok(res, {
          ok: true,
          categories: all.filter(function (r) { return r.type === 'nav_category'; }),
          links: all.filter(function (r) { return r.type === 'nav_link'; }),
        });
      }

      checkType(t);
      const rows = await sql`
        SELECT * FROM content WHERE type = ${t} ORDER BY sort_order ASC, id ASC`;
      return ok(res, { ok: true, items: rows.map(shape) });
    }

    /* ---------------- 以下都需要登录 ---------------- */
    requireAuth(req);

    if (req.method === 'POST') {
      const b = await readJson(req);
      const t = String(b.type || '');
      checkType(t);

      let parentId = null;
      if (needsParent(t)) {
        parentId = needId(b.parent_id);
        const p = await sql`SELECT id FROM content WHERE id = ${parentId} AND type = 'nav_category'`;
        if (!p.length) return send(res, 400, { error: '所属分类不存在' });
      }

      const data = normalize(t, b.data);
      if (t === 'post') {
        const dup = await sql`SELECT id FROM content WHERE type = 'post' AND data->>'slug' = ${data.slug}`;
        if (dup.length) return send(res, 409, { error: '短链接「' + data.slug + '」已经被别的文章用了' });
      }
      if (t === 'page') {
        const dup = await sql`SELECT id FROM content WHERE type = 'page' AND data->>'key' = ${data.key}`;
        if (dup.length) return send(res, 409, { error: '页面标识「' + data.key + '」已经存在' });
      }

      const order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
      const rows = await sql`
        INSERT INTO content (type, parent_id, data, sort_order)
        VALUES (${t}, ${parentId}, ${JSON.stringify(data)}::jsonb, ${order})
        RETURNING *`;
      return ok(res, { ok: true, item: shape(rows[0]) });
    }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const id = needId(b.id);

      const cur = await sql`SELECT * FROM content WHERE id = ${id}`;
      if (!cur.length) return send(res, 404, { error: '这条内容不存在，可能已被删除' });
      const row = cur[0];
      const t = row.type;

      const merged = Object.assign({}, asObj(row.data), b.data || {});
      const data = normalize(t, merged);

      if (t === 'post') {
        const dup = await sql`SELECT id FROM content WHERE type='post' AND data->>'slug' = ${data.slug} AND id <> ${id}`;
        if (dup.length) return send(res, 409, { error: '短链接「' + data.slug + '」已经被别的文章用了' });
      }
      if (t === 'page') {
        const dup = await sql`SELECT id FROM content WHERE type='page' AND data->>'key' = ${data.key} AND id <> ${id}`;
        if (dup.length) return send(res, 409, { error: '页面标识「' + data.key + '」已经存在' });
      }

      const order = (b.sort_order === undefined) ? row.sort_order
        : (Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : row.sort_order);

      const rows = await sql`
        UPDATE content
        SET data = ${JSON.stringify(data)}::jsonb, sort_order = ${order}, updated_at = now()
        WHERE id = ${id}
        RETURNING *`;
      return ok(res, { ok: true, item: shape(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = needId(req.query && req.query.id);
      const cur = await sql`SELECT type FROM content WHERE id = ${id}`;
      if (!cur.length) return send(res, 404, { error: '这条内容不存在，可能已被删除' });

      if (cur[0].type === 'nav_category') {
        /* 删分类时把它下面的链接一起删掉，避免留下孤儿数据 */
        const n = await sql`DELETE FROM content WHERE parent_id = ${id} RETURNING id`;
        await sql`DELETE FROM content WHERE id = ${id}`;
        return ok(res, { ok: true, id, alsoDeletedLinks: n.length });
      }

      await sql`DELETE FROM content WHERE id = ${id}`;
      return ok(res, { ok: true, id });
    }

    return send(res, 405, { error: '不支持的请求方法' });
  } catch (e) {
    return fail(res, e);
  }
}
