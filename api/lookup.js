/* ===========================================================================
   /api/lookup   番剧 / 漫画「按名字自动填充」（GET，需要登录）
   ---------------------------------------------------------------------------
   用法：/api/lookup?q=Frieren&kind=anime
   作用：拿一个名字去 AniList 查，把封面 / 评分 / 话数 / 年份 / 链接带回来，
        后台表单点一下就把 8 个字段填好，省得手打。
   为什么要有服务端代理：AniList 是跨域接口，而且不该把第三方地址散在页面里；
        走这里还能统一做超时、限流与错误兜底。
   安全：需要登录（避免被人当免费代理白嫖，也避免本站被打成滥用出口）。
   =========================================================================== */

import { send, ok, fail } from './_lib/http.js';
import { requireAuth } from './_lib/token.js';
import { normalizeQuery, normalizeKind, buildQuery, shapeResponse } from './_lib/lookup.js';

const ANILIST = 'https://graphql.anilist.co';
const TIMEOUT_MS = 8000;

/* 同一个人短时间内重复查同一个词，直接吃缓存（函数实例内存，冷启动清空） */
const CACHE = new Map();
const CACHE_MAX = 200;
const CACHE_TTL = 30 * 60 * 1000;   /* 30 分钟 */

function cacheKey(kind, q) {
  return kind + '::' + q.toLowerCase();
}
function cacheGet(k) {
  const hit = CACHE.get(k);
  if (hit && hit.exp > Date.now()) return hit.value;
  if (hit) CACHE.delete(k);
  return null;
}
function cacheSet(k, value) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(k, { value: value, exp: Date.now() + CACHE_TTL });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return send(res, 405, { error: '不支持的请求方法' });
    }
    requireAuth(req);

    let q, kind;
    try {
      q = normalizeQuery(req.query && req.query.q);
      kind = normalizeKind(req.query && req.query.kind);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }

    const key = cacheKey(kind, q);
    const cached = cacheGet(key);
    if (cached) return ok(res, { ok: true, q: q, kind: kind, results: cached, cached: true });

    const body = buildQuery(kind, q);
    let r;
    try {
      r = await fetch(ANILIST, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'eraser-site/1.0 (+https://eraser.de5.net)',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return send(res, 502, {
        error: '连不上番剧资料库（AniList）。可能是网络问题，稍后再试，或直接手填。',
      });
    }

    if (!r.ok) {
      return send(res, 502, {
        error: '番剧资料库返回了 ' + r.status + '，稍后再试，或直接手填。',
      });
    }

    let json;
    try {
      json = await r.json();
    } catch (e) {
      return send(res, 502, { error: '番剧资料库返回的内容看不懂，稍后再试。' });
    }

    /* AniList 用 GraphQL 错误数组报告问题（比如查询语法不对） */
    if (json && Array.isArray(json.errors) && json.errors.length) {
      return send(res, 502, { error: '资料库查询出错，稍后再试。' });
    }

    const results = shapeResponse(json, 6);
    cacheSet(key, results);
    return ok(res, {
      ok: true,
      q: q,
      kind: kind,
      results: results,
      hint: results.length ? null : '没找到。AniList 用英文名或日文原名最准，中文名往往搜不到。',
    });
  } catch (e) {
    return fail(res, e);
  }
}
