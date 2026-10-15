/* ===========================================================================
   /api/sitemap   sitemap.xml（给搜索引擎的站点地图，公开读、无需登录）
   ---------------------------------------------------------------------------
   为什么动态生成而不是写死一个静态 sitemap.xml：
   本站的文章 / 页面 / 追更 / 学习地图都存在数据库里，随时增删。
   静态文件就得每次改内容都手动同步一次，迟早会过期；这里读一次 content 表
   就得到当前真实的全集，永远不会漏、不会多。

   收录范围（只列真正想让搜索引擎看到的公开页）：
     - 固定页面：/ /tools/ /blog/ /collect/ /learn/ /nav/ /about/
     - 博客文章：/blog/post.html?slug=xxx（只看已发布，草稿不列）
     - 内置页面：/about/ 这类由 page 记录决定（key 为空或 home 的跳过）
     - 追更：不是独立详情页，全部指向 /collect/，所以不单独列（避免重复 URL）
     - 学习地图：/learn/?id=xxx（站长已确认地图保持公开）
   刻意不列：/admin/（要登录）、/dev/（开发交接，页内有 noindex）、/api/（接口）。

   vercel.json 里把 /sitemap.xml 重写到本函数（Vercel 的静态文件优先，
   重写放在 rewrites 里即可）。

   注意：本文件不能用 send()（它强制 JSON），XML 自己写响应头——同 api/rss.js。
   =========================================================================== */
import { db, ensureSchema } from './_lib/db.js';
import { send, fail } from './_lib/http.js';

/* 静态公开页（永远是这几个，与仓库目录一一对应） */
const STATIC_PAGES = ['/', '/tools/', '/blog/', '/collect/', '/learn/', '/nav/', '/about/'];

function asObj(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return {}; }
}

/* XML 转义 */
function xe(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* 只保留 YYYY-MM-DD，省得 sitemap 里塞一长串毫秒 */
function day(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/* 一个 <url> 条目 */
function entry(loc, lastmod, priority) {
  let s = '  <url>\n    <loc>' + xe(loc) + '</loc>\n';
  if (lastmod) s += '    <lastmod>' + lastmod + '</lastmod>\n';
  s += '    <priority>' + priority + '</priority>\n  </url>';
  return s;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { error: '不支持的请求方法' });
    await ensureSchema();
    const sql = db();

    const host = (req.headers && req.headers.host) || 'eraser.de5.net';
    const base = 'https://' + host;

    /* 一次把所有相关类型的记录都取回来，按类型分派（省得多查几次） */
    const rows = await sql`
      SELECT id, type, data, updated_at FROM content
      WHERE type IN ('post', 'page', 'learn_map')
      ORDER BY updated_at DESC, id DESC`;

    const urls = [];
    const seen = {};

    function push(loc, lastmod, priority) {
      if (seen[loc]) return;      /* 防重复 URL */
      seen[loc] = true;
      urls.push(entry(loc, lastmod, priority));
    }

    /* 首页优先级最高，其余固定页次之 */
    push(base + '/', '', '1.0');
    for (const p of STATIC_PAGES) {
      if (p === '/') continue;
      push(base + p, '', '0.8');
    }

    for (const r of rows) {
      const d = asObj(r.data);
      const mod = day(r.updated_at);

      if (r.type === 'post') {
        /* 草稿（published=false）不列给搜索引擎 */
        if (d.published === false || d.published === 'false') continue;
        if (!d.slug) continue;
        push(base + '/blog/post.html?slug=' + encodeURIComponent(d.slug), mod, '0.7');
      } else if (r.type === 'page') {
        const key = String(d.key || '').trim();
        /* home 已下线（首页并入搜索），不列；其余页面按 /key/ 列 */
        if (!key || key === 'home') continue;
        push(base + '/' + encodeURIComponent(key) + '/', mod, '0.6');
      } else if (r.type === 'learn_map') {
        if (d.status === 'archived') continue;   /* 归档地图不列 */
        push(base + '/learn/?id=' + encodeURIComponent(r.id), mod, '0.5');
      }
    }

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.join('\n') + '\n'
      + '</urlset>\n';

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    /* 一天缓存一次就够，内容变化不会太频繁 */
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(xml);
  } catch (e) {
    return fail(res, e);
  }
}
