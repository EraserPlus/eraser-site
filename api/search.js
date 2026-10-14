/* ===========================================================================
   /api/search   全站搜索（GET 公开，免登录）
   范围：导航链接（名称/网址/说明/标签/关键词）、博客文章（标题/摘要/标签，草稿除外）、
        页面文字（标题/正文，如关于页）、追更（名称/备注/链接）。
   用法：/api/search?q=关键词
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { ok, send, fail } from './_lib/http.js';

/* ilike 通配符转义：用户输入的 % _ \ 按字面量处理 */
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, function (c) { return '\\' + c; });
}

function urlOf(row) {
  const d = (row && row.data) || {};
  if (row.type === 'post') return '/blog/post.html?slug=' + encodeURIComponent(d.slug || '');
  if (row.type === 'page') return d.key === 'home' ? '/' : '/' + encodeURIComponent(d.key || '') + '/';
  if (row.type === 'media') return d.url || '/collect/';   // 追更：填了链接走链接，没填就回落到追更页
  return d.url || '#';   // nav_link，站外地址
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { error: '不支持的请求方法' });

    let q = String((req.query && req.query.q) || '').trim();
    if (!q) return ok(res, { ok: true, q: '', results: [] });
    if (q.length > 50) q = q.slice(0, 50);

    await ensureSchema();
    const sql = db();
    const p = '%' + escapeLike(q) + '%';

    const rows = await sql`
      SELECT id, type, data FROM content
      WHERE type IN ('nav_link', 'post', 'page', 'media')
        AND (
          (type = 'nav_link' AND (
             data->>'name' ILIKE ${p} OR data->>'url' ILIKE ${p}
             OR data->>'desc' ILIKE ${p} OR data->>'tags' ILIKE ${p}
             OR data->>'keywords' ILIKE ${p}))
          OR (type = 'post' AND (data->>'published') IS DISTINCT FROM 'false' AND (
             data->>'title' ILIKE ${p} OR data->>'summary' ILIKE ${p}
             OR data->>'tags' ILIKE ${p}))
          OR (type = 'page' AND (
             data->>'title' ILIKE ${p} OR data->>'content' ILIKE ${p}))
          OR (type = 'media' AND (
             data->>'name' ILIKE ${p} OR data->>'note' ILIKE ${p}
             OR data->>'url' ILIKE ${p}))
        )
      ORDER BY updated_at DESC
      LIMIT 50`;

    const results = rows.map(function (r) {
      const d = r.data || {};
      return {
        type: r.type,
        title: d.name || d.title || '',
        desc: d.desc || d.summary || d.note || '',
        url: urlOf({ type: r.type, data: d }),
      };
    });
    return ok(res, { ok: true, q: q, results: results });
  } catch (e) {
    return fail(res, e);
  }
}
