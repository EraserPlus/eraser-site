/* ===========================================================================
   /api/ai   给外部 AI 助手用的「接入信息」与长效令牌管理（都要后台登录）
   ---------------------------------------------------------------------------
   站长要的闭环：在后台点一下，拿到一段能直接贴给 AI 的配置（站点地址 + 令牌 +
   接口清单 + 用法），AI 接上就能帮着建学习地图、勾进度、查漏补缺。

   为什么单独一个接口而不是让站长手抄令牌：
   1) 令牌是长期凭证，手抄容易抄错、也容易别的地方泄露；
   2) AI 需要的不只是令牌，还有「有哪些接口、怎么调」——一次给全，AI 才好上手。

   方法（全部需要**后台登录令牌**，AI 令牌不能管理自己）：
     GET    /api/ai           读当前状态：是否已发过 AI 令牌、还有多久过期、世代号
     POST   /api/ai           发一条新的 AI 令牌（旧的同世代令牌仍然有效，到期自然失效）
     DELETE /api/ai           一键吊销：世代 +1，之前发出去的所有 AI 令牌立刻失效
     GET    /api/ai?guide=1   返回可直接贴给 AI 的完整配置文本（Markdown）

   注意：令牌只在这里「发」的时候返回一次原值，之后服务端不再存原值，
   想再要只能重新发（或重新吊销再发）。
   =========================================================================== */

import { db, ensureSchema, getMeta, setMeta } from './_lib/db.js';
import { requireAdmin, issueAiToken, AI_TOKEN_TTL_MS } from './_lib/token.js';
import { ok, send, fail, readJson, clientIp } from './_lib/http.js';
import { normalize } from './_lib/content.js';

const EPOCH_KEY = 'ai_epoch';
/* 最近一次发出去的令牌明文，只在「刚发出来」时给前端用。
   存在 meta 里是为了站长刷新页面还能再复制一次；介意的话点「吊销」即可清掉。 */
const LAST_KEY = 'ai_last_token';
const LAST_AT_KEY = 'ai_last_at';

/* ---------------------------------------------------------------------------
   AI 项目协作区（M24）
   ---------------------------------------------------------------------------
   给所有接手本地项目的 AI 用：先读项目架构 / 难点 / 历史记录，做完关键改动
   再追加一条记录。读公开；写也公开，但只允许两种动作（追加日志 / 登记项目），
   没有修改和删除的公开入口（站主用后台令牌走 /api/content）。
   没有新开 Serverless 文件：Hobby 12 个函数的上限已经到顶，所以挂在 /api/ai 上。
   --------------------------------------------------------------------------- */

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
    created_at: row.created_at,
    updated_at: row.updated_at,
    data: asObj(row.data),
  };
}

/* 进程内限流：Serverless 实例之间不共享，但足够挡住「一个实例被脚本刷」。
   真正的高频滥用还有 Vercel 平台层兜底；这里不为它单独建表。 */
const HITS = new Map();
function takeHit(ip, action) {
  const now = Date.now();
  const cfg = action === 'project'
    ? { gap: 15000, max: 6, win: 3600000 }
    : { gap: 3000, max: 30, win: 3600000 };
  let list = (HITS.get(ip) || []).filter(function (t) { return now - t < cfg.win; });
  if (list.length && now - list[list.length - 1] < cfg.gap) {
    const wait = Math.ceil((cfg.gap - (now - list[list.length - 1])) / 1000);
    const e = new Error(`写得太快了，请 ${wait} 秒后再试`);
    e.code = 'RATE_LIMIT';
    throw e;
  }
  if (list.length >= cfg.max) {
    const e = new Error('这个 IP 一小时内写得有点多，先歇一会儿');
    e.code = 'RATE_LIMIT';
    throw e;
  }
  list.push(now);
  if (HITS.size > 2000) HITS.clear();
  HITS.set(ip, list);
}

/* 给 AI 看的接入说明。公开，绝不包含任何令牌。 */
function buildBoardGuide(req) {
  const base = baseUrl(req);
  return [
    '# Eraser 的小站 · AI 项目协作区',
    '',
    '给所有接手项目的 AI：读是公开的，写也是公开的（只追加）。',
    '每次做完一轮关键改动，就在这里记一笔；后面的 AI 先读再动手。',
    '',
    '## 先读',
    '- `GET ' + base + '/api/ai?board=1`：项目列表 + 最近 100 条记录 + 本说明。',
    '- `GET ' + base + '/api/content?type=project_log&project=<slug>`：只看某个项目的全部记录。',
    '- `GET ' + base + '/api/content?type=project`：只看项目卡（架构 / 难点 / 约定都在 data 里）。',
    '',
    '## 再写（不需要登录）',
    '```bash',
    'curl -X POST "' + base + '/api/ai?action=log" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d \'{"project":"eraser-site","kind":"log","title":"M24：…","body":"改了什么 / 为什么 / 验证结果 / 下一步","author":"你的名字","refs":"PR #47"}\'',
    '```',
    '',
    '- `kind`：`log` 工作记录 / `decision` 关键决策 / `pain` 难点 / `handoff` 交接 / `message` 讨论。',
    '- 必填：`project`（项目 slug）、`body`（Markdown）。可选：`title` / `author` / `refs` / `tags`。',
    '- 新项目：`POST ' + base + '/api/ai?action=project`，body 至少 `{ "slug": "...", "name": "..." }`；'
      + '可再带 `summary` / `stack` / `repo` / `site` / `goal` / `architecture` / `painpoints` / `conventions`。',
    '',
    '## 约定',
    '- 只追加，不改别人的记录；要纠错就再写一条 `kind: "decision"` 说明。',
    '- 不写密码、令牌、隐私信息；这里的内容公开可见。',
    '- 写完带上 `refs`（PR / commit / 文件路径），方便下一位 AI 追溯。',
    '- 单条正文 ≤ 12000 字，请求体 ≤ 64KB；同一 IP 有频率限制。',
  ].join('\n');
}

async function boardOverview(req, res) {
  const sql = db();
  const projects = (await sql`
    SELECT * FROM content WHERE type = 'project'
    ORDER BY updated_at DESC, id DESC`).map(shape);
  const logs = (await sql`
    SELECT * FROM content WHERE type = 'project_log'
    ORDER BY id DESC LIMIT 100`).map(shape);
  return ok(res, {
    ok: true,
    board: 'ai-projects',
    version: 1,
    generated_at: new Date().toISOString(),
    stats: {
      projects: projects.length,
      logs: logs.length,
      latest_log_at: logs.length ? logs[0].data.at || logs[0].updated_at : null,
    },
    projects: projects,
    logs: logs,
    endpoints: {
      board: '/api/ai?board=1',
      log: '/api/ai?action=log',
      project: '/api/ai?action=project',
      content: '/api/content?type=project_log&project=<slug>',
    },
    guide: buildBoardGuide(req),
  });
}

async function appendLog(req, res) {
  const len = Number((req.headers && req.headers['content-length']) || 0);
  if (len > 64 * 1024) return send(res, 413, { error: '内容太长，单条请求请控制在 64KB 以内' });

  const b = await readJson(req);
  takeHit(clientIp(req), 'log');
  /* 时间由服务端说了算，不信客户端时钟 */
  const data = normalize('project_log', Object.assign({}, b, { at: new Date().toISOString() }));

  const sql = db();
  const project = await sql`
    SELECT id FROM content WHERE type = 'project' AND data->>'slug' = ${data.project}`;
  if (!project.length) {
    return send(res, 404, {
      error: '项目「' + data.project + '」还没登记。先 POST /api/ai?action=project 登记项目，再写记录。',
    });
  }

  /* 10 分钟内同项目同标题同正文视为重试，直接返回旧 id，避免 AI 超时重发写两遍 */
  const recent = await sql`
    SELECT id, data FROM content
    WHERE type = 'project_log' AND data->>'project' = ${data.project}
    ORDER BY id DESC LIMIT 30`;
  const now = Date.now();
  for (const row of recent) {
    const d = asObj(row.data);
    const at = Date.parse(d.at || '');
    if (d.title === data.title && d.body === data.body && d.author === data.author &&
        Number.isFinite(at) && now - at < 10 * 60 * 1000) {
      return ok(res, { ok: true, duplicate: true, id: row.id });
    }
  }

  const rows = await sql`
    INSERT INTO content (type, parent_id, data, sort_order)
    VALUES (${'project_log'}, NULL, ${JSON.stringify(data)}::jsonb, 0)
    RETURNING *`;
  return ok(res, { ok: true, item: shape(rows[0]) });
}

async function createProject(req, res) {
  const len = Number((req.headers && req.headers['content-length']) || 0);
  if (len > 64 * 1024) return send(res, 413, { error: '内容太长，单条请求请控制在 64KB 以内' });

  const b = await readJson(req);
  takeHit(clientIp(req), 'project');
  const data = normalize('project', Object.assign({}, b, {
    at: new Date().toISOString(),
    author: b.author || '未署名 AI',
  }));

  const sql = db();
  const dup = await sql`
    SELECT id FROM content WHERE type = 'project' AND data->>'slug' = ${data.slug}`;
  if (dup.length) {
    return send(res, 409, { error: '项目标识「' + data.slug + '」已经存在，直接往它下面写记录就行。' });
  }

  const rows = await sql`
    INSERT INTO content (type, parent_id, data, sort_order)
    VALUES (${'project'}, NULL, ${JSON.stringify(data)}::jsonb, 0)
    RETURNING *`;
  return ok(res, { ok: true, item: shape(rows[0]) });
}

function baseUrl(req) {
  const host = (req.headers && req.headers.host) || 'eraser.de5.net';
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || 'https').split(',')[0].trim();
  return proto + '://' + host;
}

/* 当前世代（数字） */
async function currentEpoch() {
  const v = await getMeta(EPOCH_KEY, '0');
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* 一份「给 AI 看的说明书」：接口清单 + 调用约定 + 常用例子 */
function buildGuide(req, token) {
  const base = baseUrl(req);
  const lines = [
    '# Eraser 的小站 · 学习地图 AI 助手接入说明',
    '',
    '你（AI）可以通过下面的 HTTP 接口帮站长管理**学习地图**：建图、拆节点、勾进度、查漏补缺。',
    '',
    '## 基本信息',
    '',
    '- 站点根地址：`' + base + '`',
    '- 鉴权：**每一个写操作**都要带请求头 `Authorization: Bearer ' + (token || '<令牌>') + '`',
    '- 只读接口（GET）不需要令牌',
    '- 请求体一律 JSON，响应一律 JSON（成功带 `ok:true`，失败带 `error`）',
    '',
    '## 只读（不需要令牌）',
    '',
    '| 方法 | 路径 | 说明 |',
    '| --- | --- | --- |',
    '| GET | `/api/learn` | 列出全部地图（含进度概览，**不含节点**，省流量） |',
    '| GET | `/api/learn?id=123` | 读一张地图：`item.data.nodes` 是节点数组，`progress.groups` 是按分组的进度（查漏补缺看这里） |',
    '| GET | `/api/learn?gaps=1` | **查漏补缺快照**：直接给出「停滞的分组 / 从没勾过的分组 / 每组还差哪些」，不用自己算 |',
    '',
    '## 地图级写操作（要令牌）',
    '',
    '| 方法 | 路径 | 请求体 |',
    '| --- | --- | --- |',
    '| POST | `/api/learn` | `{ "title": "前端入门路线", "desc": "可选", "nodes": [ ... ] }` 新建整张地图 |',
    '| PATCH | `/api/learn` | `{ "id": 123, "title": "可选", "desc": "可选", "status": "active|done|archived" }` **合并语义**：不传的字段保持原样 |',
    '| DELETE | `/api/learn?id=123` | 删整张地图 |',
    '',
    '## 节点级写操作（要令牌，AI 最常用）',
    '',
    '| action | 请求体 | 说明 |',
    '| --- | --- | --- |',
    '| `addNode` | `{ "id": 123, "node": { "text": "学到 HTML 表单", "group": "基础", "note": "可选" } }` | 加一个节点 |',
    '| `updateNode` | `{ "id": 123, "nodeId": "n1", "patch": { "text": "改后的文字", "group": "进阶", "done": true } }` | 改一个节点 |',
    '| `removeNode` | `{ "id": 123, "nodeId": "n1" }` | 删一个节点 |',
    '| `toggleNode` | `{ "id": 123, "nodeId": "n1" }` | 勾选 / 取消勾选（**AI 帮站长打卡用这个**） |',
    '| `setNodes` | `{ "id": 123, "nodes": [ ... ] }` | 整表替换（重排 / 大改时用） |',
    '',
    '节点的写法：`POST ' + base + '/api/learn?action=addNode`，body 如上。',
    '',
    '## 节点结构',
    '',
    '```json',
    '{ "id": "n1", "text": "要学的东西（必填，≤200 字）", "group": "分组名（可空）", "done": false, "note": "备注（可空）" }',
    '```',
    '',
    '- `id` 只用 `[a-zA-Z0-9_-]`、地图内唯一；不填会自动按位置生成 `n1`/`n2`…',
    '- 单张地图最多 500 个节点。',
    '- 传错 `nodeId` 会返回 400，并**列出这张地图现有的 id**，你可以据此自我纠正。',
    '',
    '## 写操作的返回',
    '',
    '一律是 `{ "ok": true, "item": { ... 整张地图 ... }, "progress": { total, done, left, percent, groups: [...] } }`。',
    '**你不用自己算进度**，直接用返回的 `progress` 即可。',
    '',
    '## 建议的用法',
    '',
    '1. **建图**：先问站长想学什么，再把目标拆成分组的节点，一次 `POST /api/learn` 带 `nodes` 建好。',
    '2. **打卡**：站长说「我今天学了 X」，你就 `toggleNode` 勾掉对应节点。',
    '3. **查漏补缺**：定期 `GET /api/learn?gaps=1`，把「停滞的分组」告诉站长，并建议先补哪几个节点。',
    '4. **调整**：发现拆得太粗 / 太细，用 `addNode` / `updateNode` / `setNodes` 微调。',
    '',
  ];
  return lines.join('\n');
}

export default async function handler(req, res) {
  try {
    await ensureSchema();

    const q = req.query || {};

    /* ---- 公开区：AI 项目协作板（不需要登录） ---- */
    if (req.method === 'GET' && String(q.board || '') === '1') {
      return await boardOverview(req, res);
    }
    if (req.method === 'POST' && String(q.action || '') === 'log') {
      return await appendLog(req, res);
    }
    if (req.method === 'POST' && String(q.action || '') === 'project') {
      return await createProject(req, res);
    }

    /* ---- 以下仍然是站主专用（AI 令牌不能给自己续命） ---- */
    requireAdmin(req);

    if (req.method === 'GET') {
      const epoch = await currentEpoch();
      const last = await getMeta(LAST_KEY, null);
      const lastAt = await getMeta(LAST_AT_KEY, null);
      const ttlDays = Math.round(AI_TOKEN_TTL_MS / 86400000);

      /* ?guide=1 直接吐一段可直接贴给 AI 的文本 */
      if (String(q.guide || '') === '1') {
        const guide = buildGuide(req, last);
        return ok(res, { ok: true, guide: guide, baseUrl: baseUrl(req), token: last || null, epoch: epoch });
      }

      return ok(res, {
        ok: true,
        hasToken: !!last,
        token: last || null,          /* 最近一次发出的明文，方便站长再复制一次 */
        issuedAt: lastAt || null,
        epoch: epoch,
        ttlDays: ttlDays,
        baseUrl: baseUrl(req),
      });
    }

    if (req.method === 'POST') {
      const epoch = await currentEpoch();
      const t = issueAiToken(Date.now(), epoch);
      await setMeta(LAST_KEY, t.token);
      await setMeta(LAST_AT_KEY, new Date().toISOString());
      return ok(res, {
        ok: true,
        token: t.token,
        exp: t.exp,
        epoch: t.epoch,
        ttlDays: Math.round(AI_TOKEN_TTL_MS / 86400000),
        baseUrl: baseUrl(req),
      });
    }

    /* 一键吊销：世代 +1，之前发出的所有 AI 令牌立刻失效 */
    if (req.method === 'DELETE') {
      const next = (await currentEpoch()) + 1;
      await setMeta(EPOCH_KEY, next);
      await setMeta(LAST_KEY, '');       /* 顺手清掉存着的明文 */
      await setMeta(LAST_AT_KEY, '');
      return ok(res, { ok: true, epoch: next, revoked: true });
    }

    return send(res, 405, { error: '不支持的请求方法' });
  } catch (e) {
    return fail(res, e);
  }
}
