/* ===========================================================================
   /api/learn   学习地图（给「助手 / AI」用的读写接口）
   ---------------------------------------------------------------------------
   为什么单独一个接口，而不是直接用 /api/content：
   /api/content 是「整条记录覆盖写」，AI 想勾掉一个节点就得把整张地图重发一遍，
   既啰嗦又容易因为并发/漏字段把数据写坏。
   这里提供**按节点粒度的原子操作**：
     - 标记某个节点完成 / 取消完成
     - 追加节点、改节点、删节点
     - 重排 / 改组
   还有 AI 最需要的两个只读能力：
     - 读进度（完成数 / 总数 / 还差哪些）
     - 查漏补缺（哪些分组里还有没完成的节点）

   鉴权：复用后台同一套令牌（Authorization: Bearer <token>）。
        先 POST /api/auth 用密码换 token，再带着 token 调这里。

   方法一览（除 GET 外都需要登录）：
     GET    /api/learn                      列全部地图（含进度概览）
     GET    /api/learn?id=123               读一张地图（含节点 + 进度明细）
     POST   /api/learn                      新建地图 { title, desc?, nodes? }
     PATCH  /api/learn                      改地图信息 { id, title?, desc?, status? }
     DELETE /api/learn?id=123               删整张地图
     POST   /api/learn?action=addNode       加节点   { id, node:{ text, group?, note? } }
     POST   /api/learn?action=updateNode    改节点   { id, nodeId, patch:{ text?, group?, note?, done? } }
     POST   /api/learn?action=removeNode    删节点   { id, nodeId }
     POST   /api/learn?action=toggleNode    勾选   { id, nodeId }
     POST   /api/learn?action=setNodes      整表替换 { id, nodes:[…] }
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readJson, needId } from './_lib/http.js';
import { normalize } from './_lib/content.js';

const TYPE = 'learn_map';
const NODE_MAX = 500;   // 与 api/_lib/content.js 保持一致

/* jsonb 正常会被驱动解析成对象，这里防一手 */
function asObj(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

function shape(row) {
  const d = asObj(row.data);
  return {
    id: row.id,
    type: row.type,
    updated_at: row.updated_at,
    data: d,
  };
}

/* 进度摘要：总数 / 完成数 / 百分比 + 按分组统计 */
function progressOf(d) {
  const nodes = Array.isArray(d.nodes) ? d.nodes : [];
  const total = nodes.length;
  const done = nodes.filter(function (n) { return n && n.done; }).length;
  const groups = [];
  const idx = {};
  nodes.forEach(function (n) {
    const g = (n && n.group) || '未分组';
    if (idx[g] === undefined) { idx[g] = groups.length; groups.push({ name: g, total: 0, done: 0 }); }
    const slot = groups[idx[g]];
    slot.total++;
    if (n && n.done) slot.done++;
  });
  return {
    total: total,
    done: done,
    left: total - done,
    percent: total ? Math.round((done / total) * 100) : 0,
    groups: groups,
  };
}

/* 带进度概览的地图（列表用，不带 nodes，省流量） */
function brief(row) {
  const s = shape(row);
  const p = progressOf(s.data);
  return {
    id: s.id,
    title: s.data.title || '',
    desc: s.data.desc || '',
    status: s.data.status || 'active',
    updated_at: s.updated_at,
    progress: { total: p.total, done: p.done, left: p.left, percent: p.percent },
  };
}

/* 读一张地图，找不到就抛 404 */
async function loadMap(sql, id) {
  const rows = await sql`SELECT * FROM content WHERE id = ${id} AND type = ${TYPE}`;
  if (!rows.length) {
    const e = new Error('这张地图不存在，可能已被删除');
    e.code = 'NOT_FOUND';
    throw e;
  }
  return rows[0];
}

/* 写回：只更新 data，顺带刷新 updated_at */
async function saveNodes(sql, id, data) {
  const clean = normalize(TYPE, data);   // 统一走校验，保证落库数据干净
  const rows = await sql`
    UPDATE content SET data = ${JSON.stringify(clean)}::jsonb, updated_at = now()
    WHERE id = ${id} AND type = ${TYPE}
    RETURNING *`;
  return shape(rows[0]);
}

function badInput(msg) {
  const e = new Error(msg);
  e.code = 'BAD_INPUT';
  return e;
}

/* 从节点数组里按 nodeId 找下标；找不到就报错（AI 传错 id 时给明确提示） */
function nodeIndex(nodes, nodeId) {
  const key = String(nodeId == null ? '' : nodeId).trim();
  if (!key) throw badInput('缺少 nodeId');
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i] && String(nodes[i].id) === key) return i;
  }
  const avail = nodes.map(function (n) { return n && n.id; }).filter(Boolean).slice(0, 30).join('、');
  throw badInput('这张地图里没有 id 为「' + key + '」的节点' + (avail ? '。现有节点 id：' + avail : ''));
}

/* 生成一个没被占用的节点 id */
function nextNodeId(nodes) {
  const used = {};
  nodes.forEach(function (n) { if (n && n.id) used[String(n.id)] = true; });
  let i = nodes.length + 1;
  while (used['n' + i]) i++;
  return 'n' + i;
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const sql = db();
    const q = req.query || {};

    /* ---------------- 只读：公开（前台页面要读） ---------------- */
    if (req.method === 'GET') {
      if (q.id) {
        const row = await loadMap(sql, needId(q.id));
        const s = shape(row);
        return ok(res, { ok: true, item: s, progress: progressOf(s.data) });
      }
      const rows = await sql`
        SELECT * FROM content WHERE type = ${TYPE} ORDER BY sort_order ASC, id ASC`;
      const items = rows.map(brief);
      return ok(res, { ok: true, items: items });
    }

    /* ---------------- 以下都需要登录 ---------------- */
    requireAuth(req);

    if (req.method === 'POST') {
      const b = await readJson(req);
      const action = String(q.action || b.action || '').trim();

      /* 新建整张地图 */
      if (!action) {
        const data = normalize(TYPE, {
          title: b.title,
          desc: b.desc,
          status: b.status,
          nodes: b.nodes,
        });
        const order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
        const rows = await sql`
          INSERT INTO content (type, parent_id, data, sort_order)
          VALUES (${TYPE}, ${null}, ${JSON.stringify(data)}::jsonb, ${order})
          RETURNING *`;
        const s = shape(rows[0]);
        return ok(res, { ok: true, item: s, progress: progressOf(s.data) });
      }

      const id = needId(b.id);
      const row = await loadMap(sql, id);
      const data = asObj(row.data);
      let nodes = Array.isArray(data.nodes) ? data.nodes.slice() : [];

      if (action === 'addNode') {
        const n = (b.node && typeof b.node === 'object') ? b.node : {};
        if (nodes.length >= NODE_MAX) throw badInput('一张地图最多 ' + NODE_MAX + ' 个节点');
        const id2 = n.id ? String(n.id) : nextNodeId(nodes);
        nodes.push({ id: id2, text: n.text, group: n.group, done: !!n.done, note: n.note });
        const saved = await saveNodes(sql, id, Object.assign({}, data, { nodes: nodes }));
        return ok(res, { ok: true, item: saved, progress: progressOf(saved.data) });
      }

      if (action === 'updateNode') {
        const i = nodeIndex(nodes, b.nodeId);
        const patch = (b.patch && typeof b.patch === 'object') ? b.patch : {};
        nodes[i] = Object.assign({}, nodes[i], patch);
        if (patch.id !== undefined) nodes[i].id = patch.id;   // 允许改 id
        const saved = await saveNodes(sql, id, Object.assign({}, data, { nodes: nodes }));
        return ok(res, { ok: true, item: saved, progress: progressOf(saved.data) });
      }

      if (action === 'removeNode') {
        const i = nodeIndex(nodes, b.nodeId);
        const removed = nodes.splice(i, 1)[0];
        const saved = await saveNodes(sql, id, Object.assign({}, data, { nodes: nodes }));
        return ok(res, { ok: true, removed: removed, item: saved, progress: progressOf(saved.data) });
      }

      if (action === 'toggleNode') {
        const i = nodeIndex(nodes, b.nodeId);
        nodes[i] = Object.assign({}, nodes[i], { done: !nodes[i].done });
        const saved = await saveNodes(sql, id, Object.assign({}, data, { nodes: nodes }));
        return ok(res, { ok: true, item: saved, progress: progressOf(saved.data) });
      }

      if (action === 'setNodes') {
        if (!Array.isArray(b.nodes)) throw badInput('nodes 要是一个数组');
        const saved = await saveNodes(sql, id, Object.assign({}, data, { nodes: b.nodes }));
        return ok(res, { ok: true, item: saved, progress: progressOf(saved.data) });
      }

      return send(res, 400, { error: '不认识的 action：' + action });
    }

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      const id = needId(b.id);
      const row = await loadMap(sql, id);
      const cur = asObj(row.data);
      /* PATCH 合并语义：只覆盖请求体里出现的字段，nodes 不传就原样保留 */
      const merged = {
        title: b.title === undefined ? cur.title : b.title,
        desc: b.desc === undefined ? cur.desc : b.desc,
        status: b.status === undefined ? cur.status : b.status,
        nodes: b.nodes === undefined ? cur.nodes : b.nodes,
      };
      const saved = await saveNodes(sql, id, merged);
      return ok(res, { ok: true, item: saved, progress: progressOf(saved.data) });
    }

    if (req.method === 'DELETE') {
      const id = needId(q.id);
      await loadMap(sql, id);
      await sql`DELETE FROM content WHERE id = ${id} AND type = ${TYPE}`;
      return ok(res, { ok: true, id: id });
    }

    return send(res, 405, { error: '不支持的请求方法' });
  } catch (e) {
    if (e && e.code === 'NOT_FOUND') return send(res, 404, { error: e.message });
    return fail(res, e);
  }
}
