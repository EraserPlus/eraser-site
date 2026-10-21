/* ===========================================================================
   /api/content   站点内容：导航 / 博客 / 文件 / 页面 / 追更 / 学习地图
   ---------------------------------------------------------------------------
   GET    公开可读（前台页面要读），其余操作需要登录。
   ?type=nav 是特例：一次返回分类和链接，省得前台发两次请求。
   ?action=lookup 是另一个特例：拿名字去 AniList 查，把封面/评分/话数/年份/链接
          带回来，用于「按名字自动填充」。**需要登录**，且只认 GET。
   ?action=airing 按 B 站番剧链接查官方更新日 / 更新时间（只取公开资料，不代理
          视频内容）。**需要登录**，且只认 GET；漫画没有公开日历，仍由站主手填。

   注意：Vercel Hobby 档每个部署最多 12 个 Serverless Function，本目录已经在
   上限上，所以「按名字查」「查放送表」都没有单独开文件，而是并到这里——和
   api/learn.js 的 ?action=xxx 是同一套写法。
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readJson, needId } from './_lib/http.js';
import { normalize, knownType, needsParent } from './_lib/content.js';
import { normalizeQuery, normalizeKind, buildQuery, shapeResponse } from './_lib/lookup.js';
import { biliRef, seasonApiUrl, shapeSeason } from './_lib/airing.js';

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

/* ---------------------------------------------------------------------------
   建一条内容。抽出来给「单条 POST」和「批量 POST（?batch=1）」共用，
   保证两条路径的校验、唯一性检查、归一化完全一致，不会各写一套。
   失败时抛出带 code 的 Error，由调用方决定是整批失败还是只记这一条。
   --------------------------------------------------------------------------- */
async function createOne(sql, t, b) {
  checkType(t);

  let parentId = null;
  if (needsParent(t)) {
    parentId = needId(b.parent_id);
    const p = await sql`SELECT id FROM content WHERE id = ${parentId} AND type = 'nav_category'`;
    if (!p.length) {
      const e = new Error('所属分类不存在');
      e.code = 'BAD_INPUT';
      throw e;
    }
  }

  const data = normalize(t, b.data);
  if (t === 'post') {
    const dup = await sql`SELECT id FROM content WHERE type = 'post' AND data->>'slug' = ${data.slug}`;
    if (dup.length) {
      const e = new Error('短链接「' + data.slug + '」已经被别的文章用了');
      e.code = 'DUP';
      throw e;
    }
  }
  if (t === 'page') {
    const dup = await sql`SELECT id FROM content WHERE type = 'page' AND data->>'key' = ${data.key}`;
    if (dup.length) {
      const e = new Error('页面标识「' + data.key + '」已经存在');
      e.code = 'DUP';
      throw e;
    }
  }

  const order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
  const rows = await sql`
    INSERT INTO content (type, parent_id, data, sort_order)
    VALUES (${t}, ${parentId}, ${JSON.stringify(data)}::jsonb, ${order})
    RETURNING *`;
  return shape(rows[0]);
}

/* 批量上限：一次最多 500 条，防止有人拿接口当压测工具 */
const BATCH_MAX = 500;

/* ---------------------------------------------------------------------------
   批量建内容。
   设计要点：
   1. 先「全量预校验」再写库——任何一条不合法（字段缺失/类型不对/重复），
      整批直接 400 拒绝，一条都不会写进去。避免出现「写了一半」的脏状态。
   2. 预校验通过后，逐条 INSERT。个别条目若因数据库层的意外失败（比如并发
      触发唯一约束），只把这条记为失败，其余照常成功，不会整批回滚。
   3. 返回逐条结果：{ total, created, failed, items:[{index, ok, id?, error?}] }
   --------------------------------------------------------------------------- */
async function createMany(sql, list) {
  if (!Array.isArray(list)) {
    const e = new Error('items 要是一个数组');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (!list.length) {
    const e = new Error('没有要导入的内容');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (list.length > BATCH_MAX) {
    const e = new Error(`一次最多导入 ${BATCH_MAX} 条，当前 ${list.length} 条`);
    e.code = 'BAD_INPUT';
    throw e;
  }

  /* ---- 第一步：全量预校验（只校验，不写库） ---- */
  const prepared = [];
  const problems = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const t = String(raw.type || '');
    try {
      checkType(t);
      if (needsParent(t)) needId(raw.parent_id);   // 归属校验放第二步真正查库
      const data = normalize(t, raw.data);
      prepared.push({ index: i, type: t, data: data, src: raw });
    } catch (err) {
      problems.push({
        index: i,
        error: (err && err.message) ? err.message : '这一条格式不对',
      });
    }
  }
  if (problems.length) {
    const e = new Error(`有 ${problems.length} 条不对，整批没有导入（先修好再传）：\n` +
      problems.slice(0, 8).map(function (p) { return `第 ${p.index + 1} 条：${p.error}`; }).join('\n') +
      (problems.length > 8 ? `\n…还有 ${problems.length - 8} 条` : ''));
    e.code = 'BAD_INPUT';
    e.badItems = problems;
    throw e;
  }

  /* ---- 第二步：逐条写入（个别失败不影响其余） ---- */
  const results = list.map(function (_, i) { return { index: i, ok: false }; });
  let created = 0;
  let failed = 0;

  await sql.transaction(async (tx) => {
    /* 批次内要挡掉同批重复的 slug / key（库里还没有，单看库查不出来） */
    const seenSlug = {};
    const seenKey = {};

    for (const p of prepared) {
      const b = { type: p.type, data: p.data, parent_id: p.src.parent_id, sort_order: p.src.sort_order };
      try {
        if (p.type === 'post') {
          if (seenSlug[p.data.slug]) {
            throw Object.assign(new Error('短链接「' + p.data.slug + '」在本批里重复了'), { code: 'DUP' });
          }
          seenSlug[p.data.slug] = true;
        }
        if (p.type === 'page') {
          if (seenKey[p.data.key]) {
            throw Object.assign(new Error('页面标识「' + p.data.key + '」在本批里重复了'), { code: 'DUP' });
          }
          seenKey[p.data.key] = true;
        }
        const item = await createOne(tx, p.type, b);
        results[p.index] = { index: p.index, ok: true, id: item.id, item: item };
        created++;
      } catch (err) {
        results[p.index] = {
          index: p.index,
          ok: false,
          error: (err && err.message) ? err.message : '这一条没写进去',
        };
        failed++;
      }
    }
  });

  return {
    total: list.length,
    created: created,
    failed: failed,
    items: results,
  };
}

/* ---------------------------------------------------------------------------
   按名字查 AniList（GET /api/content?action=lookup&q=名字&kind=anime|comic）
   ---------------------------------------------------------------------------
   纯逻辑（入参校验 / 打分换算 / 结果整形）都在 _lib/lookup.js，可单测；
   这里只负责鉴权、进程内缓存、发请求和错误兜底。
   为什么走服务端代理：AniList 是跨域接口，也不该把第三方地址散在页面里；
   走这里还能统一做超时和错误兜底，并且挡住「把本站当免费代理白嫖」。
   中文名在 AniList 上基本搜不到（上游限制），0 结果时会直接给提示。
   --------------------------------------------------------------------------- */
const ANILIST = 'https://graphql.anilist.co';
const TIMEOUT_MS = 8000;
const CACHE = new Map();          /* 函数实例内存，冷启动清空 */
const CACHE_MAX = 200;
const CACHE_TTL = 30 * 60 * 1000; /* 30 分钟 */

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

async function lookupMedia(res, query) {
  let q, kind;
  try {
    q = normalizeQuery(query && query.q);
    kind = normalizeKind(query && query.kind);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }

  const key = cacheKey(kind, q);
  const cached = cacheGet(key);
  if (cached) return ok(res, { ok: true, q: q, kind: kind, results: cached, cached: true });

  let r;
  try {
    r = await fetch(ANILIST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'eraser-site/1.0 (+https://eraser.de5.net)',
      },
      body: JSON.stringify(buildQuery(kind, q)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return send(res, 502, {
      error: '连不上番剧资料库（AniList）。可能是网络问题，稍后再试，或直接手填。',
    });
  }

  if (!r.ok) {
    const hint = r.status === 403
      ? '番剧资料库（AniList）目前暂停服务，先直接手填；贴 B 站番剧链接后，放送时间可以自动补。'
      : '番剧资料库返回了 ' + r.status + '，稍后再试，或直接手填。';
    return send(res, 502, { error: hint });
  }

  let json;
  try {
    json = await r.json();
  } catch (e) {
    return send(res, 502, { error: '番剧资料库返回的内容看不懂，稍后再试。' });
  }

  /* AniList 用 GraphQL 的 errors 数组报告问题（比如查询语法不对） */
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
}

/* ---------------------------------------------------------------------------
   按 B 站番剧链接查放送表（GET /api/content?action=airing&url=...）
   ---------------------------------------------------------------------------
   只认 bilibili.com 的番剧页（ss / ep / md），再拼固定地址取公开资料；
   用户的原始 URL 不会被直接请求（避免 SSRF）。返回里的 airday / airtime
   由 _lib/airing.js 解析，优先用官方「每周X HH:MM」文案，缺失时用最近一集
   正片的北京时间推算。漫画没有稳定的公开日历，不走这里。
   --------------------------------------------------------------------------- */
const AIRING_API = 'https://api.bilibili.com/pgc/view/web/season';
const AIR_CACHE = new Map();
const AIR_CACHE_MAX = 200;
const AIR_CACHE_TTL = 6 * 60 * 60 * 1000;   /* 6 小时：更新日不会频繁变 */

function airCacheGet(k) {
  const hit = AIR_CACHE.get(k);
  if (hit && hit.exp > Date.now()) return hit.value;
  if (hit) AIR_CACHE.delete(k);
  return null;
}
function airCacheSet(k, value) {
  if (AIR_CACHE.size >= AIR_CACHE_MAX) AIR_CACHE.delete(AIR_CACHE.keys().next().value);
  AIR_CACHE.set(k, { value: value, exp: Date.now() + AIR_CACHE_TTL });
}

async function airingInfo(res, query) {
  const raw = String((query && query.url) || '').trim();
  if (!raw) return send(res, 400, { error: '请先给一个 B 站番剧链接' });
  if (raw.length > 2000) return send(res, 400, { error: '链接太长了' });

  const ref = biliRef(raw);
  if (!ref) {
    return ok(res, { ok: true, supported: false, reason: 'not-bilibili' });
  }
  const apiUrl = seasonApiUrl(ref);
  if (!apiUrl) {
    return ok(res, { ok: true, supported: false, reason: 'no-id' });
  }

  const key = ref.kind + ':' + ref.id;
  const cached = airCacheGet(key);
  if (cached) return ok(res, { ok: true, supported: true, data: cached, cached: true });

  let r;
  try {
    r = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'eraser-site/1.0 (+https://eraser.de5.net)',
        Referer: 'https://www.bilibili.com/',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return send(res, 502, { error: '连不上 B 站资料接口，稍后再试。' });
  }

  if (!r.ok) {
    return send(res, 502, { error: 'B 站资料接口返回了 ' + r.status + '，稍后再试。' });
  }

  let json;
  try {
    json = await r.json();
  } catch (e) {
    return send(res, 502, { error: 'B 站返回的内容看不懂，稍后再试。' });
  }
  if (json && json.code != null && Number(json.code) !== 0) {
    return send(res, 502, { error: 'B 站没有给出这部番的资料（' + (json.message || json.msg || json.code) + '）。' });
  }

  const data = shapeSeason(json && (json.result || json.data));
  if (!data) {
    return send(res, 502, { error: 'B 站返回的番剧资料不完整，稍后再试。' });
  }
  airCacheSet(key, data);
  return ok(res, { ok: true, supported: true, data: data });
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const sql = db();

    /* ---------------- 读取 ---------------- */
    if (req.method === 'GET') {
      /* 按名字查外部资料库：需要登录（前台批量补字段用），单独鉴权、不走下面公开读取 */
      if (req.query && req.query.action === 'lookup') {
        requireAuth(req);
        return await lookupMedia(res, req.query);
      }

      /* 按 B 站链接补放送表：同样只给登录后的站主用 */
      if (req.query && req.query.action === 'airing') {
        requireAuth(req);
        return await airingInfo(res, req.query);
      }

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
      let items = rows.map(shape);

      /* 文章草稿只给登录后的站主看：
         公开 GET 不带令牌时把 published === false 的行过滤掉。
         写接口本来就要求登录，这里补上读侧，避免草稿被前台接口直接读走。 */
      if (t === 'post') {
        let authed = false;
        try { requireAuth(req); authed = true; } catch (e) { authed = false; }
        if (!authed) {
          items = items.filter(function (r) { return !r.data || r.data.published !== false; });
        }
      }
      return ok(res, { ok: true, items: items });
    }

    /* 按名字查只认 GET。其它方法在这里明确挡掉，
       否则会掉到下面被当成「建一条内容」，报一个莫名其妙的 400。 */
    if (req.query && req.query.action === 'lookup') {
      return send(res, 405, { error: '按名字查询只支持 GET' });
    }
    if (req.query && req.query.action === 'airing') {
      return send(res, 405, { error: '查放送表只支持 GET' });
    }

    /* ---------------- 以下都需要登录 ---------------- */
    requireAuth(req);

    if (req.method === 'POST') {
      const b = await readJson(req);

      /* 批量导入：POST /api/content?batch=1，body { items:[{type,data,...}, …] }
         与单条走同一套校验；全量预校验过了才写，逐条报成败。 */
      if (req.query && String(req.query.batch) === '1') {
        const r = await createMany(sql, b.items);
        return ok(res, Object.assign({ ok: true }, r));
      }

      const t = String(b.type || '');
      const item = await createOne(sql, t, b);
      return ok(res, { ok: true, item: item });
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

      /* touch:false 用于后台自动补字段（封面 / 放送时间）：写了数据但不改
         updated_at，否则「接着追」按最近更新排序会被一次批量补全整体打乱。 */
      const touch = b.touch !== false;
      const rows = await sql`
        UPDATE content
        SET data = ${JSON.stringify(data)}::jsonb, sort_order = ${order},
            updated_at = CASE WHEN ${touch}::boolean THEN now() ELSE updated_at END
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
