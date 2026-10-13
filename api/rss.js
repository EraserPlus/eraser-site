/* ===========================================================================
   /api/rss   博客 RSS 订阅源（公开读，无需登录）
   数据源：content 表 type='post' 且 published 不为 false，按更新时间倒序取 20 条。
   注意：本文件不能用 send()（它强制 JSON Content-Type），XML 自己写响应头。
   =========================================================================== */
import { db, ensureSchema } from './_lib/db.js';
import { send, fail } from './_lib/http.js';

/* jsonb 可能被驱动解析成对象，也可能回来是字符串，防一手 */
function asObj(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return {}; }
}
/* XML 转义 */
function xe(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
/* 粗提取纯文本。服务端不能用 md.js（它挂在 window 上），这里写个精简版 */
function plain(src, n) {
  var s = String(src == null ? "" : src)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[>#\-\*+\d.)\s]+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ").trim();
  if (n && s.length > n) s = s.slice(0, n) + "…";
  return s;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { error: '不支持的请求方法' });
    await ensureSchema();
    const sql = db();
    const rows = await sql`
      SELECT data, updated_at FROM content
      WHERE type = 'post' AND COALESCE(data->>'published', 'true') <> 'false'
      ORDER BY updated_at DESC, id DESC
      LIMIT 20`;
    const host = (req.headers && req.headers.host) || 'eraser.de5.net';
    const base = 'https://' + host;
    const items = rows.map(function (r) {
      const d = asObj(r.data);
      const link = base + '/blog/post.html?slug=' + encodeURIComponent(d.slug || '');
      const pub = r.updated_at ? new Date(r.updated_at) : null;
      const pubLine = (pub && !isNaN(pub.getTime()))
        ? '      <pubDate>' + pub.toUTCString() + '</pubDate>\n' : '';
      return '    <item>\n'
        + '      <title>' + xe(d.title) + '</title>\n'
        + '      <link>' + xe(link) + '</link>\n'
        + '      <description>' + xe(d.summary || plain(d.content, 200)) + '</description>\n'
        + pubLine
        + '      <guid>' + xe(link) + '</guid>\n'
        + '    </item>';
    }).join('\n');
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<rss version="2.0">\n  <channel>\n'
      + '    <title>Eraser 的小站</title>\n'
      + '    <link>' + xe(base) + '</link>\n'
      + '    <description>个人站 · 博客与文件</description>\n'
      + (items ? items + '\n' : '')
      + '  </channel>\n</rss>\n';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.end(xml);
  } catch (e) {
    return fail(res, e);
  }
}
