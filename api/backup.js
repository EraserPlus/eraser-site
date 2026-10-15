/* ===========================================================================
   /api/backup   全站数据备份与还原（给「一个人用」的兜底，全部需要登录）
   ---------------------------------------------------------------------------
   为什么需要它：
   数据都在 Neon 上，一旦误删或想搬家，没有备份就只能干看着。交接页把这一点
   列为「当前最大风险」。后台原本只有一个「导出备份」按钮，只能下载、不能回灌——
   这里把两头都补齐：能拉全量 JSON，也能把 JSON 灌回去。

   GET  /api/backup                拉全量快照（含每张学习地图的 nodes）
   POST /api/backup                还原：body 就是备份 JSON（或 {data: 备份JSON}）
   POST /api/backup?action=verify  只校验备份文件合不合法，不写库

   还原策略（刻意保守，宁可少做也不做错）：
   - 按 id upsert：备份里有、库里没有 → 插入；两边都有 → 用备份覆盖。
   - 库里多出来的记录：**不动**。这样「还原一个旧备份」不会顺手删掉你后来
     新加的东西——真要清空请自己到对应标签里删。
   - 学习地图的节点是内嵌数组，跟着地图一起写回。
   - 整个还原包一层事务（Neon 的 sql.transaction），中途失败整体回滚。

   备份格式（与后台「导出备份」下载的 JSON 一致，互相通用）：
     {
       exportedAt, site,
       todos: [...], events: [...],
       posts: [...], files: [...], pages: [...],
       nav: { categories: [...], links: [...] },
       media: [...],
       learnMaps: [...]
     }
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readJson } from './_lib/http.js';
import { normalize, knownType } from './_lib/content.js';

/* 备份的顶层字段 → 对应的 content 类型（nav 特殊，含两种类型） */
const CONTENT_SECTIONS = {
  posts: 'post',
  files: 'file',
  pages: 'page',
  media: 'media',
  learnMaps: 'learn_map',
};

function asObj(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

function shape(row) {
  const d = asObj(row.data);
  return {
    id: row.id,
    type: row.type,
    parent_id: row.parent_id != null ? row.parent_id : null,
    sort_order: row.sort_order,
    updated_at: row.updated_at,
    data: d,
  };
}

/* 拉一份全量快照 */
async function snapshot(sql) {
  const todos = await sql`SELECT * FROM todos ORDER BY id ASC`;
  const events = await sql`SELECT * FROM events ORDER BY id ASC`;
  const content = await sql`SELECT * FROM content ORDER BY id ASC`;
  const items = content.map(shape);
  const pick = (t) => items.filter((r) => r.type === t);
  return {
    exportedAt: new Date().toISOString(),
    site: 'eraser.de5.net',
    todos: todos,
    events: events,
    posts: pick('post'),
    files: pick('file'),
    pages: pick('page'),
    nav: { categories: pick('nav_category'), links: pick('nav_link') },
    media: pick('media'),
    learnMaps: pick('learn_map'),
  };
}

/* ---------- 校验备份文件 ---------- */
/* 返回 { ok, errors: [], counts: {} }，不抛异常，方便直接回给前端看 */
function verifyBackup(b) {
  const errors = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return { ok: false, errors: ['备份内容不是一个对象'], counts: {} };
  }
  const arrays = ['todos', 'events', 'posts', 'files', 'pages', 'media', 'learnMaps'];
  arrays.forEach(function (k) {
    if (b[k] != null && !Array.isArray(b[k])) errors.push(k + ' 应该是一个数组');
  });
  if (b.nav != null && (typeof b.nav !== 'object' || Array.isArray(b.nav))) {
    errors.push('nav 应该是一个对象（含 categories / links）');
  }

  const counts = {
    todos: (b.todos || []).length,
    events: (b.events || []).length,
    posts: (b.posts || []).length,
    files: (b.files || []).length,
    pages: (b.pages || []).length,
    media: (b.media || []).length,
    learnMaps: (b.learnMaps || []).length,
    navCategories: (b.nav && b.nav.categories ? b.nav.categories.length : 0),
    navLinks: (b.nav && b.nav.links ? b.nav.links.length : 0),
  };
  const total = Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0);
  if (total === 0 && errors.length === 0) errors.push('备份里一条数据也没有');

  /* 逐条试跑 normalize，把坏数据挡在写库之前。
     注意先确认是数组——上面把「不是数组」记成错误了，这里别再对着字符串迭代。 */
  const arr = (v) => (Array.isArray(v) ? v : []);
  Object.keys(CONTENT_SECTIONS).forEach(function (k) {
    const type = CONTENT_SECTIONS[k];
    arr(b[k]).forEach(function (it, i) {
      const data = (it && it.data) || {};
      try { normalize(type, data); }
      catch (e) { errors.push(k + '[' + i + ']：' + e.message); }
    });
  });
  arr(b.nav && b.nav.categories).forEach(function (it, i) {
    try { normalize('nav_category', (it && it.data) || {}); }
    catch (e) { errors.push('nav.categories[' + i + ']：' + e.message); }
  });
  arr(b.nav && b.nav.links).forEach(function (it, i) {
    try { normalize('nav_link', (it && it.data) || {}); }
    catch (e) { errors.push('nav.links[' + i + ']：' + e.message); }
  });

  return { ok: errors.length === 0, errors: errors.slice(0, 20), counts: counts };
}

/* ---------- 还原 ---------- */
/* 全部包在一个事务里：任何一条写失败，整体回滚，库保持原样 */
async function restore(sql, b) {
  const report = { todos: 0, events: 0, content: 0 };
  /* 进到这里理论上已经过 verify，但再防一手：非数组一律当空，避免迭代炸掉 */
  const arr = (v) => (Array.isArray(v) ? v : []);

  let parentId = null;

  /* ① 待办 */
  for (const t of arr(b.todos)) {
    const id = Number(t && t.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    await sql`
      INSERT INTO todos (id, title, note, done, due_date, priority, created_at, done_at)
      VALUES (${id}, ${String((t && t.title) || '（无标题）')}, ${t && t.note ? String(t.note) : null},
              ${!!(t && t.done)}, ${(t && t.due_date) || null}, ${Number(t && t.priority) || 1},
              ${(t && t.created_at) || new Date().toISOString()}, ${(t && t.done_at) || null})
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, note = EXCLUDED.note, done = EXCLUDED.done,
        due_date = EXCLUDED.due_date, priority = EXCLUDED.priority, done_at = EXCLUDED.done_at`;
    report.todos++;
  }

  /* ② 日程 */
  for (const e of arr(b.events)) {
    const id = Number(e && e.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!(e && e.start_at)) continue;   /* start_at 是 NOT NULL，缺了就跳过 */
    await sql`
      INSERT INTO events (id, title, note, start_at, end_at, all_day, created_at)
      VALUES (${id}, ${String((e && e.title) || '（无标题）')}, ${e && e.note ? String(e.note) : null},
              ${e.start_at}, ${(e && e.end_at) || null}, ${!!(e && e.all_day)},
              ${(e && e.created_at) || new Date().toISOString()})
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, note = EXCLUDED.note, start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day`;
    report.events++;
  }

  /* ③ 导航分类（先写，链接要指向它们） */
  for (const c of arr(b.nav && b.nav.categories)) {
    const id = Number(c && c.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const data = normalize('nav_category', (c && c.data) || {});
    await sql`
      INSERT INTO content (id, type, parent_id, data, sort_order)
      VALUES (${id}, 'nav_category', ${null}, ${JSON.stringify(data)}::jsonb, ${Number(c && c.sort_order) || 0})
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data, sort_order = EXCLUDED.sort_order, updated_at = now()`;
    report.content++;
  }
  /* 链接：parent_id 可能指向备份里的分类 id */
  for (const l of arr(b.nav && b.nav.links)) {
    const id = Number(l && l.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    parentId = (l && l.parent_id != null) ? Number(l.parent_id) : null;
    if (!Number.isInteger(parentId) || parentId <= 0) parentId = null;
    const data = normalize('nav_link', (l && l.data) || {});
    await sql`
      INSERT INTO content (id, type, parent_id, data, sort_order)
      VALUES (${id}, 'nav_link', ${parentId}, ${JSON.stringify(data)}::jsonb, ${Number(l && l.sort_order) || 0})
      ON CONFLICT (id) DO UPDATE SET
        parent_id = EXCLUDED.parent_id, data = EXCLUDED.data,
        sort_order = EXCLUDED.sort_order, updated_at = now()`;
    report.content++;
  }

  /* ④ 其余内容类型（文章 / 文件 / 页面 / 追更 / 学习地图） */
  for (const key of Object.keys(CONTENT_SECTIONS)) {
    const type = CONTENT_SECTIONS[key];
    for (const it of arr(b[key])) {
      const id = Number(it && it.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (!knownType(type)) continue;
      const data = normalize(type, (it && it.data) || {});
      await sql`
        INSERT INTO content (id, type, parent_id, data, sort_order)
        VALUES (${id}, ${type}, ${null}, ${JSON.stringify(data)}::jsonb, ${Number(it && it.sort_order) || 0})
        ON CONFLICT (id) DO UPDATE SET
          data = EXCLUDED.data, sort_order = EXCLUDED.sort_order, updated_at = now()`;
      report.content++;
    }
  }

  /* ⑤ 序列号对齐：上面按显式 id 插入，serial 序列还停在旧位置，
        不推进的话下次「新建一条」会撞 id。 */
  await sql`SELECT setval(pg_get_serial_sequence('todos', 'id'), COALESCE((SELECT MAX(id) FROM todos), 1))`;
  await sql`SELECT setval(pg_get_serial_sequence('events', 'id'), COALESCE((SELECT MAX(id) FROM events), 1))`;
  await sql`SELECT setval(pg_get_serial_sequence('content', 'id'), COALESCE((SELECT MAX(id) FROM content), 1))`;

  return report;
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const sql = db();
    requireAuth(req);     /* 备份 / 还原都涉及全站数据，必须登录 */

    const q = req.query || {};

    /* ---------------- 拉快照 ---------------- */
    if (req.method === 'GET') {
      const data = await snapshot(sql);
      return ok(res, { ok: true, backup: data });
    }

    /* ---------------- 还原 / 校验 ---------------- */
    if (req.method === 'POST') {
      const body = await readJson(req);
      const action = String(q.action || body.action || '').trim();
      /* 允许整个请求体就是备份，也允许包一层 {data: ...} */
      const backup = (body && body.learnMaps === undefined && body.todos === undefined && body.data)
        ? body.data : body;

      const verdict = verifyBackup(backup);
      if (action === 'verify') {
        return ok(res, { ok: verdict.ok, errors: verdict.errors, counts: verdict.counts });
      }
      if (!verdict.ok) {
        const e = new Error('备份文件有问题，没有写入：' + verdict.errors.join('；'));
        e.code = 'BAD_INPUT';
        throw e;
      }

      /* 有事务能力就包事务（Neon 的 sql.transaction 会传入一个 tx 句柄）；
         没有就退化成逐条写——测试里的假驱动两个都支持。 */
      const report = (typeof sql.transaction === 'function')
        ? await sql.transaction(function (tx) { return restore(tx, backup); })
        : await restore(sql, backup);
      return ok(res, { ok: true, restored: report, counts: verdict.counts });
    }

    return send(res, 405, { error: '不支持的请求方法' });
  } catch (e) {
    return fail(res, e);
  }
}
