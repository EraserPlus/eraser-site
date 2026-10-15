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
