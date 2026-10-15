/* ===========================================================================
   /api/search   全站搜索（GET 公开，免登录）
   ---------------------------------------------------------------------------
   范围（只搜「标题类」字段，不搜正文——正文命中一多结果就变成一锅粥）：
     - 导航链接：名称 / 网址 / 说明 / 标签 / 关键词
     - 博客文章：标题 / 摘要 / 标签（正文不搜，草稿除外）
     - 页面：标题（正文不搜）
     - 追更：名称 / 备注 / 链接
     - 学习地图：标题 / 说明（节点文字不搜）
   用法：/api/search?q=关键词
   匹配：先用数据库做子串匹配；命中不足时，再对候选池做一层「子序列模糊匹配」
         （字符按顺序出现即可，如 gth → GitHub、vrc → Vercel），命中项带 fuzzy:true。

   为什么刻意不搜正文：
   本站是「索引型」站点，正文命中会把搜索结果冲垮——搜「Vercel」时十几篇文章
   只要正文里提过这个词就全冒出来，正文段落还会被当摘要显示，非常乱。
   现在只保留标题/摘要级字段，正文里的词一律搜不到；真想按正文找，用文章页内的
   浏览器 Ctrl+F。这个取舍是站长明确要求的。
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { ok, send, fail } from './_lib/http.js';

const LIMIT = 50;    /* 单次返回上限 */
const POOL  = 300;   /* 模糊匹配的候选池上限（个人站数据量小，一次取够） */
const MIN_Q = 2;     /* 关键词最少几个字符（1 个字命中面太大，几乎等于没筛） */

/* 参与搜索的类型。加新类型时改这里，并在下面的 SQL 里补一段条件。
   正文类字段（post.content / page.content / learn_map.nodes）一律不在这里出现——
   搜正文会把结果冲垮，见文件头注释。 */
const TYPES = ['nav_link', 'post', 'page', 'media', 'learn_map'];

/* ilike 通配符转义：用户输入的 % _ \ 按字面量处理 */
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, function (c) { return '\\' + c; });
}

function urlOf(row) {
  const d = (row && row.data) || {};
  if (row.type === 'post') return '/blog/post.html?slug=' + encodeURIComponent(d.slug || '');
  if (row.type === 'page') return d.key === 'home' ? '/' : '/' + encodeURIComponent(d.key || '') + '/';
  if (row.type === 'media') return d.url || '/collect/';   // 追更：填了链接走链接，没填就回落到追更页
  if (row.type === 'learn_map') return '/learn/?id=' + encodeURIComponent(row.id || '');
  return d.url || '#';   // nav_link，站外地址
}

function mapRow(r) {
  const d = (r && r.data) || {};
  return {
    type: r.type,
    title: d.name || d.title || '',
    desc: d.desc || d.summary || d.note || '',
    url: urlOf({ id: r.id, type: r.type, data: d }),
  };
}

/* 子序列匹配：needle 的字符按顺序出现在 hay 即可（不要求连续） */
function isSubseq(hay, needle) {
  let i = 0, j = 0;
  while (i < hay.length && j < needle.length) {
    if (hay[i] === needle[j]) j++;
    i++;
  }
  return j === needle.length;
}

/* 各类型参与模糊匹配的字段，与上面 SQL 的范围保持一致（同样不含正文/节点文字） */
function fieldsOf(row) {
  const d = (row && row.data) || {};
  const pick = (keys) => keys
    .map((k) => d[k])
    .filter((v) => v != null && v !== '')
    .map(String);
  if (row.type === 'nav_link') return pick(['name', 'url', 'desc', 'tags', 'keywords']);
  if (row.type === 'post')     return pick(['title', 'summary', 'tags']);
  if (row.type === 'page')     return pick(['title']);
  if (row.type === 'media')    return pick(['name', 'note', 'url']);
  if (row.type === 'learn_map') return pick(['title', 'desc']);
  return [];
}

/* 模糊命中：任一字段去空白后能按顺序凑出 needle */
function fuzzyHit(row, needle) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  return fieldsOf(row).some((f) => isSubseq(norm(f), needle));
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { error: '不支持的请求方法' });

    let q = String((req.query && req.query.q) || '').trim();
    if (!q) return ok(res, { ok: true, q: '', results: [], tooShort: false });
    if (q.length > 50) q = q.slice(0, 50);
    /* 一个字符命中面太大，直接返回空并标出来，前端好提示「再打一个字」 */
    if (q.length < MIN_Q) return ok(res, { ok: true, q: q, results: [], tooShort: true, min: MIN_Q });

    await ensureSchema();
    const sql = db();
    const p = '%' + escapeLike(q) + '%';

    const rows = await sql`
      SELECT id, type, data FROM content
      WHERE type IN ('nav_link', 'post', 'page', 'media', 'learn_map')
        AND (
          (type = 'nav_link' AND (
             data->>'name' ILIKE ${p} OR data->>'url' ILIKE ${p}
             OR data->>'desc' ILIKE ${p} OR data->>'tags' ILIKE ${p}
             OR data->>'keywords' ILIKE ${p}))
          OR (type = 'post' AND (data->>'published') IS DISTINCT FROM 'false' AND (
             data->>'title' ILIKE ${p} OR data->>'summary' ILIKE ${p}
             OR data->>'tags' ILIKE ${p}))
          OR (type = 'page' AND (
             data->>'title' ILIKE ${p}))
          OR (type = 'media' AND (
             data->>'name' ILIKE ${p} OR data->>'note' ILIKE ${p}
             OR data->>'url' ILIKE ${p}))
          OR (type = 'learn_map' AND (
             data->>'title' ILIKE ${p} OR data->>'desc' ILIKE ${p}))
        )
      ORDER BY updated_at DESC
      LIMIT 50`;

    const results = rows.map(mapRow);
    const seen = new Set(rows.map((r) => r.id));

    /* 精确命中不足时补一层模糊匹配：gth → GitHub、vrc → Vercel */
    const needle = q.toLowerCase().replace(/\s+/g, '');
    if (results.length < LIMIT && needle.length >= 3) {
      const pool = await sql`
        SELECT id, type, data FROM content
        WHERE type IN ('nav_link', 'post', 'page', 'media', 'learn_map')
          AND (type <> 'post' OR (data->>'published') IS DISTINCT FROM 'false')
        ORDER BY updated_at DESC
        LIMIT ${POOL}`;
      for (const r of pool) {
        if (seen.has(r.id) || !fuzzyHit(r, needle)) continue;
        seen.add(r.id);
        results.push(Object.assign(mapRow(r), { fuzzy: true }));
        if (results.length >= LIMIT) break;
      }
    }

    return ok(res, { ok: true, q: q, results: results });
  } catch (e) {
    return fail(res, e);
  }
}
