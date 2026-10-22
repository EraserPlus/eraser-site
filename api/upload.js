/* ===========================================================================
   /api/upload   文件上传（需登录）——把文件存到 Vercel Blob，返回可访问 URL
   ---------------------------------------------------------------------------
   方案：裸 body 上传。前端 fetch('/api/upload?name=文件名', {method:'POST', body:文件})
   服务端读原始 body，存到 Blob 的 files/ 前缀下。令牌只在服务端环境变量里，
   浏览器永远拿不到。上传不可用（没配令牌）时返回 503，前端可手填链接兜底。
   =========================================================================== */
import { put } from '@vercel/blob';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readBody } from './_lib/http.js';

/* 4MB 上限：Hobby 函数请求体上限 4.5MB，留余量 */
const MAX_BYTES = 4 * 1024 * 1024;

/* 只给浏览器能直接显示的位图打上 Content-Type。
   前端压缩后会把 webp 改名成 .jpg，靠扩展名推断不可靠，这里显式传。 */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

/* 文件名清洗：去路径分隔符和控制字符，防路径穿越 */
function safeName(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f/\\]/g, '')
    .replace(/^\.+/, '')
    .slice(0, 100);
  return s || 'file';
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: '不支持的请求方法' });
    requireAuth(req);
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return send(res, 503, { error: '服务器还没配好：缺少 BLOB_READ_WRITE_TOKEN。去 Vercel 项目里连接 Blob 存储；或者直接在表单里粘贴文件链接。' });
    }
    const name = safeName((req.query && req.query.name) || '');
    const rawType = String((req.query && req.query.type) || '').toLowerCase();
    const contentType = IMAGE_TYPES.has(rawType) ? rawType : '';
    const body = await readBody(req, MAX_BYTES);
    if (!body.length) return send(res, 400, { error: '文件内容是空的' });
    const options = {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
    };
    if (contentType) options.contentType = contentType;
    const result = await put('files/' + name, body, options);
    return ok(res, { ok: true, data: { url: result.url, pathname: result.pathname } });
  } catch (e) {
    return fail(res, e);
  }
}
