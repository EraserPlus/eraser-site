/* ===========================================================================
   /api/favicon   站点图标代理（GET 公开，不登录）
   用法：/api/favicon?url=https://example.com
   流程：先试 origin/favicon.ico；取不到再扒首页 HTML 里的 <link rel="icon">。
   安全：网址先过 _lib/favicon.js 的 SSRF 防护（纯函数有单测）；
        302 跳转手动跟随，每一跳都重新校验，防止弹进内网。
   缓存：函数实例内存缓存 7 天（冷启动清空，可接受）+ 浏览器 7 天。
   =========================================================================== */

import { send, fail } from './_lib/http.js';
import { assertPublicHttpUrl, guessImageType } from './_lib/favicon.js';

const CACHE = new Map();               /* url -> { type, buf, exp } */
const CACHE_MAX = 300;
const CACHE_TTL = 7 * 24 * 3600 * 1000;
const MAX_ICON = 262144;               /* 图标最大 256KB */
const HTML_MAX = 131072;               /* 扒首页时最多读 128KB */
const MAX_HOPS = 4;
const UA = 'Mozilla/5.0 (compatible; eraser-favicon/1.0; +https://eraser.de5.net)';

function cacheGet(url){
  const hit = CACHE.get(url);
  if (hit && hit.exp > Date.now()) return hit;
  if (hit) CACHE.delete(url);
  return null;
}
function cacheSet(url, type, buf){
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(url, { type: type, buf: buf, exp: Date.now() + CACHE_TTL });
}

function toBadInput(e){
  const be = new Error(e.message);
  be.code = 'BAD_INPUT';
  return be;
}

/* 手动跟随跳转，每一跳重新过 SSRF 检查 */
async function fetchAllowed(url){
  let cur = url;
  for (let i = 0; i <= MAX_HOPS; i++){
    const r = await fetch(cur, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'image/*,text/html;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')){
      const next = new URL(r.headers.get('location'), cur).toString();
      cur = (() => { try { return assertPublicHttpUrl(next); } catch (e) { throw toBadInput(e); } })();
      continue;
    }
    return r;
  }
  return null;   // 跳转层数过多
}

/* 从首页 HTML 里找声明的图标地址 */
function iconFromHtml(html, baseUrl){
  const m = html.match(/<link[^>]+rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/i)
        || html.match(/<link[^>]+href\s*=\s*["'][^"']+["'][^>]*rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/i);
  if (!m) return null;
  const hm = m[0].match(/href\s*=\s*["']([^"']+)["']/i);
  if (!hm) return null;
  try { return assertPublicHttpUrl(new URL(hm[1], baseUrl).toString()); }
  catch (e) { return null; }   // 图标指向内网就当没有，不影响主流程
}

async function grab(url){
  /* 1. 先试 /favicon.ico */
  let r = await fetchAllowed(new URL(url).origin + '/favicon.ico');
  if (r && r.ok){
    const buf = Buffer.from(await r.arrayBuffer());
    const type = guessImageType(buf, r.headers.get('content-type'));
    if (type && buf.length && buf.length <= MAX_ICON) return { type: type, buf: buf };
  }
  /* 2. 再扒首页 HTML 里声明的图标 */
  r = await fetchAllowed(url);
  if (r && r.ok){
    const html = (await r.text()).slice(0, HTML_MAX);
    const iconUrl = iconFromHtml(html, url);
    if (iconUrl){
      const ir = await fetchAllowed(iconUrl);
      if (ir && ir.ok){
        const buf = Buffer.from(await ir.arrayBuffer());
        const type = guessImageType(buf, ir.headers.get('content-type'));
        if (type && buf.length && buf.length <= MAX_ICON) return { type: type, buf: buf };
      }
    }
  }
  return null;
}

export default async function handler(req, res){
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD'){
      return send(res, 405, { error: '不支持的请求方法' });
    }
    let url;
    try {
      url = assertPublicHttpUrl((req.query && req.query.url) || '');
    } catch (e) {
      return send(res, 400, { error: e.message });
    }

    let hit = cacheGet(url);
    if (!hit){
      const g = await grab(url);
      if (!g) return send(res, 404, { error: '这个站点没有抓到图标' });
      cacheSet(url, g.type, g.buf);
      hit = cacheGet(url);
    }

    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.statusCode = 200;
    res.end(hit.buf);
  } catch (e) {
    return fail(res, e);
  }
}
