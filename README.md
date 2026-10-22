# Eraser 的小站 · 使用手册与开发指南

> 站点：<https://eraser.de5.net> ｜ 个人站 ｜ Vercel Hobby 免费档
> 仓库：GitHub `EraserPlus/eraser-site`（Public）｜ 技术栈：纯静态 HTML/CSS/JS + Vercel Serverless Functions（Node ESM）+ Neon Postgres
> 本文面向「未来的 Eraser 和接手的 AI」：所有内容以仓库当前真实状态为准，随改随更新。

---

## 一、一页纸架构

### 目录树（当前真实文件清单）

```text
eraser-site/
├── index.html            首页 = 全站搜索（导航栏 + 搜索框 + 分组结果）
├── style.css             全站统一样式（改这里 = 公开页换肤）
├── md.js                 自研 Markdown 渲染器（内置转义，见「已知取舍」）
├── shell.js              全站公共交互层（主题切换按钮 / Ctrl+K 命令面板 / g 前缀跳转 / 注册 Service Worker）
├── owner.js              站主就地编辑（Ctrl/⌘+Shift+L 登录；与后台共用 eraser.admin.token）
├── owner.css             站主态样式（左下浮条 / 行内编辑按钮 / 登录弹层）
├── watch.js              追更站内播放（B 站 / YouTube / Vimeo 官方嵌入 + mp4 直链续播；播完只提示、不自动记进度）
├── workbench.js          追更工作台纯逻辑（M20：星期换算 / 接着追取舍 / 放送排序 / 进度文案；M22：最新集 / 上游完结 / 新集计数，可单测）
├── sw.js                 Service Worker（HTML 网络优先带缓存兜底、静态资源缓存优先、接口不缓存、离线兜底页）
├── manifest.webmanifest  PWA 清单（可「添加到主屏幕」）
├── icon.svg              站点图标（可选作 maskable 的版本见 icon-maskable.svg）
├── og.png                分享卡片图（1200×630，各公开页的 og:image 指向它）
├── robots.txt            爬虫规则（屏蔽 /admin/ /dev/ /api/）+ 指向 sitemap
├── vercel.json           响应头配置 + /sitemap.xml 重写到 api/sitemap：/api/ 不缓存，静态资源缓存 1 小时 + 安全头
├── .gitattributes        锁死 LF 行尾，杜绝 Windows CRLF 污染 diff
├── .gitignore            忽略 node_modules / .vercel / 临时文件，不进仓库
├── package.json          两个运行时依赖（@neondatabase/serverless + @vercel/blob）+ npm test 脚本
├── package-lock.json     锁版本，CI 用 npm ci 安装
│
├── api/                  Vercel Serverless 函数目录（每个 .js 自动成为一个 /api 路由）
│   ├── auth.js           POST 登录换令牌 / GET 配置自检
│   ├── todos.js          待办 CRUD（全部需登录，私人数据）
│   ├── events.js         日程 CRUD（全部需登录，私人数据）
│   ├── content.js        全站内容 CRUD（读公开，写需登录；?batch=1 批量导入、?action=lookup 按名字查 AniList、?action=airing 查 B 站放送表）
│   ├── learn.js          学习地图（GET 公开；写需后台或 AI 令牌；?gaps=1 查漏补缺快照；节点粒度 action）
│   ├── ai.js             给外部 AI 的接入信息与长效令牌（需后台令牌）；M24 起兼作公开协作板：GET ?board=1 / POST ?action=log|project（只追加）
│   ├── backup.js         全量备份 / 校验 / 按 id 合并还原（需登录；永不 DELETE）
│   ├── sitemap.js        动态 /sitemap.xml（读 content 表出全部页面/文章/地图）
│   ├── rss.js            博客 RSS 订阅源（GET 公开，免登录）
│   ├── upload.js         文件上传（需登录，裸 body 存 Vercel Blob）
│   ├── favicon.js        站点图标代理（GET 公开，SSRF 防护 + 魔数识别 + 7 天缓存）
│   ├── search.js         全站搜索（GET 公开，跨类型 ilike，草稿过滤）
│   └── _lib/             公共库（不会成为路由）
│       ├── db.js         数据库连接 + ensureSchema() 首次自动建表 + meta 键值存取
│       ├── token.js      HMAC 令牌签发/校验（后台 30 天 / AI 365 天两套密钥）、密码校验、配置自检
│       ├── http.js       响应封装 ok/send/fail、readJson、readBody（二进制安全、带大小上限）、入参校验
│       ├── ratelimit.js  登录限流（5 次失败锁 15 分钟，按 IP）
│       ├── favicon.js    favicon 的 SSRF 防护与图片魔数识别（纯函数，可单测）
│       ├── lookup.js     AniList GraphQL 查询的纯逻辑：入参校验/关键词进 variables/打分换算/结果整形（可单测）
│       ├── airing.js     B 站番剧链接识别 / 中文星期与时间解析 / 北京时间换算 / 预告过滤 / 最新集与完结推断（纯函数，可单测）
│       └── content.js    九种内容类型（含追更 media 的 latest / finished、学习地图 learn_map、M24 的 project / project_log）的归一化与校验，含批量导入预校验与逐条写入
│
│
├── admin/                管理后台（独立单文件应用，自带样式）
│   ├── index.html        后台全部界面与逻辑（9 个标签，含「一键接上 AI」「数据」备份，追更列表带搜索/筛选/排序/行内改状态）
│   └── content.js        导航/博客/页面/追更/学习地图/AI 项目 内容管理模块（SCHEMA 驱动，含批量导入解析与按名字自动填充）
│
├── tests/                十三套测试 + 测试用假数据库驱动
│   ├── api_test.mjs      令牌/密码/入参校验/favicon SSRF 与魔数识别/后台令牌与 AI 令牌互不通用（183 项）
│   ├── content_test.mjs  九种内容类型归一化（含追更进度/播放位置/放送时间、学习地图、M24 项目与日志）/ Markdown 渲染与安全（243 项）
│   ├── watch_test.mjs    站内播放器纯逻辑：四类源解析/嵌入地址/时间工具/续播语义 + collect 接入审计（121 项）
│   ├── workbench_test.mjs 追更工作台纯逻辑：星期换算/接着看取舍/放送排序/进度文案（71 项）
│   ├── airing_test.mjs   B 站放送表纯逻辑：链接识别/中文星期与时间/北京时间/预告过滤/完结处理（67 项）
│   ├── api_routes_test.mjs 接口全流程：鉴权/CRUD/注入/限流/PATCH 合并语义/RSS/上传/favicon/追更/学习地图 gaps/sitemap/备份/批量导入/放送表/AI 公开协作板（475 项）
│   ├── pages_audit.mjs   9 个公开页面（含追更/协作区/交接页）：结构/零站外资源/静态兜底/注入防护/PWA/前台快捷录入/站主态/漫画对等与放送补全（501 项）
│   ├── admin_audit.mjs   管理后台：主题/隐私/接口/安全/功能点/接上 AI 面板/批量导入与自动填充/项目字段（230 项）
│   ├── outline_check.mjs 大纲解析（从 learn 页抽函数跑）：Markdown 标记/缩进/Tab/CRLF/坏输入（11 项）
│   ├── media_import_test.mjs  批量导入解析：TSV/JSON/中英表头/无表头/管道分隔/评分越界/更新日与时间/坏 JSON（79 项）
│   ├── lookup_test.mjs   AniList 查询纯逻辑：入参/关键词进 variables/打分换算/episodes 回落 chapters/结果整形（38 项）
│   ├── nav_test.cjs      导航页核心逻辑：数据体检/查询/视图/最近访问/高亮/导入导出（145 项）
│   ├── nav_audit.cjs     导航页静态审计：结构/零外部请求/DOM 接线/功能点（84 项）
│   ├── stubs/@neondatabase/serverless/   手写假驱动（只记录 SQL 不连库）
│   └── stubs/@vercel/blob/               手写假驱动（只记录 put 调用不连 Blob）
│
├── .github/workflows/ci.yml   GitHub Actions：push / PR 自动跑 npm test
│
├── about/index.html      关于页（内容可在后台改）
├── ai/
│   └── index.html        AI 项目协作区（M24：项目架构 / 难点 / 约定 / 工作日志；公开只读 + 只追加，站主可就地改删）
├── nav/                  网址导航页
│   ├── index.html        全部界面与逻辑（约 41KB：侧栏+横滑双端、密度、最近访问、favicon 真图标）
│   └── links.js          静态兜底数据（纯数据，无代码）
├── blog/
│   ├── index.html        文章列表（读 /api/content?type=post）
│   └── post.html         文章详情（?slug=xxx，用 md.js 渲染正文）
├── collect/
│   └── index.html        追更页（M20–M22 个人工作台：顶部「接着追 + 本周放送」，下面是追番/漫画海报墙；读 /api/content?type=media；登录后有「＋ 快速添加」；可播的链接显示 ▶ 站内播放；漫画外链可 ＋1；番剧每日自动同步放送表 / 最新集 / 完结状态，新集有绿色标记）
├── learn/
│   └── index.html        学习地图（列表可搜可汇总 / 分组折叠 / 节点就地编辑 / 拖动排序 / 导入大纲成图）
├── dev/
│   ├── index.html        开发交接页（给接手的 AI：现状 / 六步流程 / 红线 / 批次记录）
│   └── push-branch.sh    推送脚本（git push 直连不通时走 gh API；从自身位置推断仓库目录）
└── tools/
    ├── index.html        工具列表
```

### 数据流（文字版）

**公开页（8 个分区 / 9 个页面：/（全站搜索）、/nav/、/blog/ 与 blog/post.html、/collect/、/learn/、/ai/、/about/、/tools/）**

```text
打开页面
  → ① 先渲染写死在 HTML / links.js 里的静态内容（断网、双击本地文件都能看）
  → ② 再 fetch 同源接口（/api/content?type=nav 等，只读同源路径）
  → ③ 成功：用数据库返回的数据替换静态内容
  → ④ 失败（接口挂了 / 数据库没内容）：保持静态内容，catch 兜底
  → 另：/api/rss 公开输出博客 RSS（阅读器订阅用，免登录）；/blog/ 页面 head 有 autodiscovery 链接
  → 另：/api/sitemap 输出 /sitemap.xml（读 content 表出全部页面/文章/地图）；sw.js 提供离线兜底
  → 另：/ai/ 走公开协作板：GET /api/ai?board=1 读全部项目与最近 100 条日志；POST 只追加，不支持改删
  → 结果：任何情况下不白屏
```

**管理后台（/admin/，九个标签：今天 / 待办 / 日程 / 导航 / 博客 / 追更 / 学习 / 页面 / 数据）**

```text
打开后台 → POST /api/auth 用密码换 HMAC 令牌（30 天有效）→ 存 localStorage
  → 之后每个请求带 Authorization: Bearer <令牌>
  → /api/todos、/api/events 的所有操作都要登录（401 自动退出登录）
  → 密码连错 5 次锁 15 分钟（login_attempts 表按 IP 记录）
  → 「日程」标签：月历看整月分布，计划表看今天起 60 天按天分组的安排（全天优先）
  → 「学习」标签：最上面是「一键接上 AI」面板（生成令牌 / 复制配置 / 吊销），下面是地图列表与节点编辑
  → 「数据」标签：全量备份下载 / 校验 / 按 id 合并还原（永不 DELETE）
  → 给外部 AI 的令牌是另一套：365 天、独立密钥、带世代号，一起走 /api/ai 管理
```

**数据库四张表（Neon Postgres，ensureSchema 首次访问自动建）**

| 表 | 用途 |
| --- | --- |
| `todos` | 待办：标题 / 备注 / 完成 / 截止日期 / 优先级（0 低 1 中 2 高） |
| `events` | 日程：标题 / 备注 / 开始 / 结束 / 全天 |
| `login_attempts` | 登录限流：ip / fails / locked_until |
| `content` | 全站内容一张表：nav_category / nav_link / post / file / page / media / learn_map / project / project_log 九种 type 共用，data 为 jsonb |
| `meta` | 键值小仓库：存 AI 令牌世代号（`ai_epoch`）与最近一次发出的令牌明文等零散状态 |

---

## 二、快速开始

```bash
npm test
```

一条命令按顺序跑完十三套测试，共 **2134 项**，全部通过即说明站点核心逻辑健康。

- **不需要真数据库 / 真 Blob**：`tests/stubs/` 里有手写的假 Neon 驱动（全局 `__FAKE_DB__` 预设 SQL 返回值）和假 @vercel/blob 驱动（全局 `__FAKE_BLOB__` 预设 put 返回值），只验证逻辑不连外部服务。
- CI 里也是同一套路：`npm ci` 装回真包后，用假驱动覆盖 `node_modules/@neondatabase/serverless`，再 `npm test`。
- 本地开发同样直接 `npm test`，无需任何额外配置。

---

## 三、环境变量

只在 Vercel 项目 Settings → Environment Variables 里配，**永远不要**写进仓库（仓库是 Public）。

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PASSWORD` | 管理后台密码，**至少 8 位**。短于 8 位按「没配」处理，登录接口返回 503。令牌签名密钥由它派生，改密码 = 所有旧令牌立即失效 |
| `DATABASE_URL` | Neon Postgres 连接串。通过 Vercel Marketplace 安装 Neon 集成后**自动注入**，不用手填 |
| `POSTGRES_URL` | 旧名。代码里 `DATABASE_URL` 优先，回退认 `POSTGRES_URL`，两个都没配时写数据的接口返回 503 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 读写令牌，连接 Blob 存储后自动注入；没配时上传返回 503，可手填链接兜底 |

---

## 四、如何加一个新接口

> `api/hello.js`（原示例接口）已删除，本节接管它的教学职能。
> **规则：`api/` 目录下每个 `.js` 文件自动成为一个路由**——`api/notes.js` → `https://eraser.de5.net/api/notes`。
> `api/_lib/` 子目录里的文件不会成为路由，放公共库。

完整可抄的范例（新建 `api/notes.js`）：

```js
/* ===========================================================================
   /api/notes   读书笔记（示例：抄我改字段即可）
   =========================================================================== */

import { db, ensureSchema } from './_lib/db.js';
import { requireAuth } from './_lib/token.js';
import { ok, send, fail, readJson, needText, optionalText, needId } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    // 1. 需要登录的接口：先校验令牌。没过期返回 payload，失败抛 UNAUTHORIZED（→ 401）
    requireAuth(req);

    // 2. 用到数据库：ensureSchema 保证表存在（IF NOT EXISTS，重复调用安全）
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, title, body, created_at
        FROM notes
        ORDER BY id DESC`;
      return ok(res, { ok: true, items: rows });
    }

    if (req.method === 'POST') {
      const b = await readJson(req);
      const rows = await sql`
        INSERT INTO notes (title, body)
        VALUES (${needText(b.title, '标题', 200)}, ${optionalText(b.body)})
        RETURNING id, title, body, created_at`;
      return ok(res, { ok: true, item: rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = needId((req.query && req.query.id) || (await readJson(req)).id);
      const rows = await sql`DELETE FROM notes WHERE id = ${id} RETURNING id`;
      if (!rows.length) return send(res, 404, { error: '这条笔记不存在，可能已被删除' });
      return ok(res, { ok: true, id });
    }

    return send(res, 405, { error: '不支持的请求方法' });
  } catch (e) {
    // 3. 兜底：fail() 把内部异常翻译成用户看得懂的话（401/429/503/400/500）
    return fail(res, e);
  }
}
```

用到新表时，在 `api/_lib/db.js` 的 `ensureSchema()` 里补一段（同样用 IF NOT EXISTS，对已有数据库安全）：

```js
await sql`
  CREATE TABLE IF NOT EXISTS notes (
    id          serial PRIMARY KEY,
    title       text NOT NULL,
    body        text,
    created_at  timestamptz NOT NULL DEFAULT now()
  )`;
```

要点速查：

- **参数化 SQL 用标签模板**：`` sql`... WHERE id = ${id}` ``——值永远走参数，禁止字符串拼接 SQL（`api_routes_test.mjs` 有注入防护断言）。
- **入参校验**：`needText`（必填）、`optionalText`（可空）、`needId`、`optionalDate`、`needTimestamp`，不合法抛 `BAD_INPUT`（→ 400）。
- **公开读 / 登录写**：GET 不调 `requireAuth` 就是公开的；写操作放在 `requireAuth(req)` 之后。
- **响应**：`ok(res, body)` = 200 JSON；`send(res, 404, { error })` 自定义状态码；`fail(res, e)` 兜底。
- **自测**：在 `tests/api_routes_test.mjs` 里仿照现有用例加几条（假数据库 `fakeDb(handler)` + `mockReq`/`mockRes`），然后 `npm test`。

---

## 五、文件上传（接口保留，后台入口已下架）

T10 起文件仓库（公开页 + 后台「文件」标签）按主人要求下架，但 `/api/upload`（Vercel Blob 通道）**保留**——博客插图等未来功能直接复用：

```text
POST /api/upload?name=文件名（需登录，body 传原始文件，单文件上限 4MB）→ { data: { url } }
```

- 走**裸 body 上传**：前端 `fetch('/api/upload?name=文件名', { method: 'POST', body: 文件 })`，服务端直接读原始 body 存进 Blob 的 `files/` 前缀。单文件场景够用，不写 multipart 解析器。
- **令牌只在服务端**：浏览器永远拿不到 `BLOB_READ_WRITE_TOKEN`；上传和其他写接口一样，先过 `requireAuth` 登录校验。
- **需要在 Vercel 项目里连接 Blob 存储**：Vercel 控制台 → 项目 → Storage/Marketplace → 创建 Blob Store 并连接到项目，令牌自动注入（具体以界面为准）。
- 没配令牌时上传返回 503，表单仍可手填链接兜底，不影响建文件条目。

---

## 五之二、让 AI 管学习地图（M10 主线A）

站长要的闭环是「我接上 API，它就能帮我建知识图 / 打卡 / 查漏补缺」。做法是：**后台点一下拿配置 → 贴给 AI → AI 直接调接口**。

**第一步（站长在后台做）**：`/admin/` → 「学习」标签 → 「生成 / 换一条令牌」→「复制接入配置」。那段文字里已经有站点地址、令牌、接口清单、节点结构和建议用法。

**第二步（AI 拿到后）**：每个写操作带 `Authorization: Bearer <令牌>`，`GET` 免登录。

| | 方法 / 路径 | 说明 |
| --- | --- | --- |
| 拿说明书 | `GET /api/ai?guide=1` | 返回一份完整 Markdown 说明书（需后台令牌） |
| 读令牌状态 | `GET /api/ai` | 是否已发 / 签发时间 / 世代号 / 有效期天数 |
| 发新令牌 | `POST /api/ai` | 返回明文令牌（只在此时返回一次） |
| 一键吊销 | `DELETE /api/ai` | 世代 +1，之前发出的所有 AI 令牌立刻失效 |
| 列地图 | `GET /api/learn` | 含进度概览，不带节点 |
| 读地图 | `GET /api/learn?id=123` | 含节点 + 按分组进度 |
| **查漏补缺** | `GET /api/learn?gaps=1` | 每组状态 / 从没动过的组 / 落后的组 / 建议先补哪几个 |
| 建图 | `POST /api/learn` | `{title, desc?, nodes?}` |
| 改图信息 | `PATCH /api/learn` | 合并语义，不传的字段保持原样 |
| 节点操作 | `POST /api/learn?action=…` | `addNode` / `updateNode` / `removeNode` / `toggleNode` / `setNodes` |

写操作一律返回 `{ ok, item, progress }`，AI 不必自己算进度。

**两种令牌的区别（重要）**：后台登录令牌 30 天、前缀 `eraser-admin-token-v1::`；AI 令牌 365 天、前缀 `eraser-ai-token-v1::`、payload 带 `kind:'ai'` 和世代号 `ep`。签名密钥不同，**互不通用**——吊销 AI 令牌不会把站长的后台登录踢掉；反过来 AI 令牌也**不能**管理令牌自己（`api/ai.js` 只认 `requireAdmin`）。

**前台交互**：`/learn/` 页面本身也是完整可用的编辑器（登录后）：节点可就地改文字 / 改分组、可拖动排序（同组内）、可加删，还能把 Markdown / 缩进大纲整段导进来一次成图。未登录时整页只读并给出明确提示。

---

## 五之四、追更批量导入与按名字填充（M12）

起因：线上只有 1 条追更，每次进后台都要翻列表——**问题在「录入口」不在页面**。这一批把三条一起做了（后台批量导入 + 后台列表可用性 + 前台快捷录入），共用两个新接口。

**`POST /api/content?batch=1` —— 批量写入**

```text
body: { items: [ {type:"media", data:{...}}, ... ] }     一次最多 500 条
  → ① 全量预校验（只校验不写库）：任何一条不合法 → 400，整批一条都不写
  → ② 预检通过后逐条 insert（在同一个事务里）
  → ③ 返回 { ok, total, created, failed, items:[{index, ok, id?, error?}] }
```

设计要点（都是刻意的）：**先全量预校验**，坏条目永远不会造成「写了一半」；**个别失败只报那条**，不回滚已经写好的；**批内互相去重** `post.slug` / `page.key`（这种冲突查库看不出来）；超 500 条直接 400 并告诉你当前多少条。

**`GET /api/content?action=lookup&q=名字&kind=anime|comic` —— 按名字自动填充**

> ⚠️ **Vercel Hobby 档每个部署最多 12 个 Serverless Function**，`api/` 目录已经正好 12 个在上限上。加第 13 个 `.js` 会让**整个部署失败**（`npm test` 照过，只有 Vercel 那一步红）。新接口请并进现有路由用 `?action=xxx`（照 `api/learn.js` 抄），`api/_lib/` 下的文件不算函数、可以随便加。

走 AniList GraphQL（免 key），返回候选列表，每条带 `name / altName / cover / score / year / episodes / note / url`，封面 CDN 可直接热链。30 分钟进程内缓存（上限 200 条），上游不通时返回 502 并给人话提示。

| | 方法 / 路径 | 说明 |
| --- | --- | --- |
| 批量导入 | `POST /api/content?batch=1` | `{items:[…]}`，≤500 条，先全量预校验再写库 |
| 按名字查 | `GET /api/content?action=lookup&q=Frieren` | **需要登录**；返回候选（封面/评分/话数/年份/链接） |
| 查放送表 | `GET /api/content?action=airing&url=…` | **需要登录**；只认 B 站番剧 `ss / ep / md` 页，返回 `airday / airtime / cover / score / latest / episodes / finished`，缓存 6 小时 |

**上游选型的实测结论**：AniList 可用且能热链；Bangumi / TMDB / Jikan / 豆瓣图在本机沙箱全部不可达。AniList 对**中文标题基本返回 0 条**（英文名 / 罗马字 / 日文原名都正常），这是上游限制，已在 0 结果里直接提示。

**前台入口**：`/collect/` 页顶多了「＋ 快速添加」按钮，**认 `eraser.admin.token`**（和后台同源同键，共用登录态），没令牌就整段不渲染——匿名访客看到的海报墙和以前完全一样。弹层内可以先「按名字补全」再保存，全程 DOM API + `textContent` 拼装，不碰 `innerHTML`。

---

## 五之五、追更进度 + 门面收尾（M13）

起因：站长说「继续寻找可能存在的优化点并优化」。整站扫了一遍，挑出四条一起做。

### 1. 追更进度（看到第几集）

`media` 类型新增两个**可空非负整数**字段，校验在 `api/_lib/content.js` 的 `count()`（上限 100000）：

| 字段 | 含义 | 来源 |
| --- | --- | --- |
| `episodes` | 总集数 | 「按名字自动填充」从 AniList 带出来，也可手填 |
| `progress` | 看到第几集 | 前台「＋1 话」或手填 |

海报墙的显示规则（`collect/index.html` 的 `progressOf()`）：两个都有 → 进度条 + `12 / 28`；只有总集数 → `共 28 话`；只有进度 → `看到 12 话`（连载中不知道总数是常态，不硬凑）。

**「＋1 话」按钮**：登录后（认 `eraser.admin.token`）、且状态是「在看」时，卡片右下角出现一个小圆钮，点一下走 `PATCH /api/content {id, data:{progress: n+1}}`，成功后就地重画整面墙。后台列表行里也有同样的 ＋1。

> ⚠️ 卡片原本是 `<a>`，现在改成 `<div>` + 一层覆盖式 `<a class="mg-hit">`——**`<button>` 不允许嵌在 `<a>` 里**。按钮 `z-index: 4` 压在链接层（`z-index: 3`）之上才点得到。

**PATCH 是「先合并再归一化」**（`Object.assign({}, row.data, patch)` 之后再 `normalize`），所以只传 `{progress: 13}` 不会把 `episodes` 冲掉。回归测试专门钉了这条。

批量导入新增可识别的列名：`总集数 / 集数 / 话数 / episodes / eps / total` 与 `进度 / 看到 / progress / current`，能从「28 话」「第 12 集」里抠出数字（抠不到就留空，不瞎猜）。

### 2. 全站 meta / 分享卡片

8 个公开页都补了 `meta description` + `og:*` + `twitter:card`，图片统一指向仓库根的 `og.png`（1200×630）。想换图直接改它——**它没有源文件**，是当时用无头 Chrome 截一张临时 HTML 出来的；重做请保持 1200×630，否则微信 / Telegram 会裁切。

### 3. 无障碍

公开页 + 交接页的内容容器由 `<div class="container">` 改为 `<main class="container" id="main">`，并在 `<body>` 后加「跳到正文」链接（样式见 `style.css` 的 `.skip-link`：平时 `left:-9999px`，聚焦才滑出）。

### 4. 一致性收尾

- 品牌名统一为 **`Eraser 的小站`**（原来 index / nav / admin 少一个「的」）；
- 标题分隔符统一为 **`·`**（早期页用的 `-` 全改掉）；
- **删掉孤儿页 `/files/`**：T10 就下架了，页面却一直留着——站内零链接、不在 sitemap、导航栏还是旧结构、缺防闪主题脚本与 `shell.js`、还教人去点一个已经不存在的「文件」标签；
- `sw.js` 缓存版本号 `eraser-v1 → v2`：M11/M12/M13 都动过 `style.css` 和页面，文件注释本来就要求 +1，之前一直没升（后果是老访客会先看到一次旧 CSS）。

> ⚠️ **`.gitattributes` 挡不住 CRLF**：里面的 `* text=auto eol=lf` **只管 `git add`**，而 `dev/push-branch.sh` 走 GitHub API 直接建 blob，完全绕过 git 的行尾规范化。推送前请逐文件查（用 Python 数 `b'\r'` 字节，别信 `grep -c $'\r'`——Git Bash 里那个转义会给出虚高的数）。

---

## 五之六、追更站内播放（M19）

目标：在 `collect/` 海报墙上直接看，并把「看到哪一集 / 看到第几秒」记回同一条追更记录。**只嵌官方播放器**，不下载、不代理、不绕过任何限制。

### 支持哪些链接

| 来源 | 认的链接 | 说明 |
| --- | --- | --- |
| B 站 | `bilibili.com/video/BV…`（可带 `?p=`）或番剧页 `/bangumi/play/ep…` / `ss…` | 用官方 `player.bilibili.com/player.html`；`b23.tv` 短链**不解析**（拿不到 BV 号，不猜） |
| YouTube | `youtube.com/watch?v=…` / `youtu.be/…` / `youtube.com/shorts/…` | 用 `youtube-nocookie.com/embed`，带 `enablejsapi=1` |
| Vimeo | `vimeo.com/<数字>` / `player.vimeo.com/video/<数字>` | 带 `api=1` |
| 直链视频 | 以 `.mp4 / .m4v / .webm / .ogv / .ogg` 结尾 | 原生 `<video>` |

其余链接（漫画页、网盘、未知站点）保持原来的「站外打开」。**漫画没有可嵌入的官方播放器**，所以漫画条目仍是外链，进度靠「＋1 话」手记。

### 进度怎么记

- `media` 新增 `position`（秒）与 `duration`（秒），可空非负整数，上限 1,000,000，校验在 `api/_lib/content.js` 的 `count()`。
- 播放中每 15 秒（且位置变化 ≥8 秒）保存一次；关闭弹层、切后台、离开页面时再补一次（`keepalive`）。
- 再次点开：未看完（`status !== "finished"`）且已存 ≥5 秒 → 从续播点开始；距结尾 5 秒内视为看完 → 从头开始；已看完的条目再看一遍也从头。
- 「＋1 话」会同时把 `position` 归零，下一集不会跳到上一集的片尾；加完这一话后旧播放器停止保存，避免把上一集的时间写进新一集。
- 没登录（没有 `eraser.admin.token`）可以看，但**不记录播放位置**，弹层里会直说。

> ⚠️ **B 站拿不到播放时间**。官方 iframe 不向父页暴露 `currentTime`（实测 0 条 postMessage），所以 B 站只同步「第几集」（`progress`），秒级续播只对 YouTube / Vimeo / 直链生效。这不是本站能绕过的限制。
>
> ⚠️ **没有新开接口**。Vercel Hobby 最多 12 个函数，`api/` 已经满编；播放器读写全部复用 `PATCH /api/content`（JSONB 合并），`watch.js` 是纯前端文件。
>
> 建议：YouTube / Vimeo 在部分网络环境不可达；打不开时弹层 8 秒后会提示「站外打开」。B 站与直链是当前最稳的两条。

### 缓存

`sw.js` 版本升到 `eraser-v8`，预缓存仍是 `/watch.js` 与 `/workbench.js`。改 `watch.js` / `workbench.js` / `collect/index.html` / `style.css` 后记得再 +1。

---

## 五之十二、AI 项目协作区：公开只追加的交接板（M24）

站长原话：「把这个网址做成一个 AI 项目管理区……记录各类项目的工作记录、关键痛点难点、底层架构，为所有访问的 AI 开放权限。每在本地项目里修改、进行关键调整的时候就在对应的工作日志里加上一笔，让后面的 AI 都可以清晰地知道自己要做什么，甚至可以互相借鉴，类似于一个不同步的 AI 交互群聊。」

结论：**不用另申请域名**。协作区直接挂在同一个站点的 `/ai/`，共用同一套身份（站主令牌）、同一个 Neon 库、同一次 Vercel 部署；以后想换独立域名，把子域指到同一个 Vercel 项目即可，数据不用搬家。

### 数据模型：两种新 type，零迁移

仍然写进 `content` 表（`type` + `data jsonb`），不建新表、不新增 Serverless Function（Hobby 12 个函数已满编，接口复用了 `/api/ai`）：

| type | 用途 | 关键字段 |
| --- | --- | --- |
| `project` | 一个项目的长期档案 | `slug / name / summary / status / stack / repo / site / goal / architecture / painpoints / conventions / author / at` |
| `project_log` | 一条工作记录 / 决策 / 难点 / 交接 / 讨论 | `project / kind / title / body / author / refs / tags / at` |

- `kind` 五选一：`log`（做了什么）、`decision`（为什么这么定）、`pain`（踩坑）、`handoff`（交接）、`message`（给后来 AI 的话）。
- 所有 Markdown 字段（`architecture` / `painpoints` / `conventions` / 日志 `body`）走 `md.js` 渲染，先转义再出标签。
- 时间由服务端兜底：不传 `at` 就用服务器当前时间；传了必须能解析成日期。

### 公开接口：读全部，只追加

```text
GET  /api/ai?board=1                项目 + 最近 100 条日志 + 统计 + 端点说明 + 给 AI 的 Markdown 指南
POST /api/ai?action=log             追加一条 project_log
POST /api/ai?action=project         登记一个新项目
```

- **不需要令牌**：任何 AI 只要能发 HTTP 就能读、能写；这是站长明确要的「为所有访问的 AI 开放权限」。
- **只能追加，不能改删**：公开接口没有 PATCH/DELETE；改字段、删项目、级联删日志都要站主令牌走 `/api/content`。页面上站主登录后才有「编辑 / 删除」。
- **防滥用**：单条请求 ≤64KB；`body` ≤12000 字、`architecture` ≤20000 字；同一 IP 追加日志最短 3 秒一条、每小时 30 条，登记项目 15 秒一条、每小时 6 条；10 分钟内同项目 + 同标题 + 同正文视为重复，直接返回已有 id，不重复入库。
- **不暴露秘密**：公开页与公开接口都不返回令牌、环境变量或后台数据；`/ai/` 加 `noindex`，不进搜索与 sitemap。
- **项目必须先登记**：日志的 `project` 必须是已存在的 slug（支持大小写与空格归一），否则 404，避免日志散落成孤儿。

### 页面：/ai/

- 顶部统计（项目数 / 记录数 / 最近一笔时间）+「给 AI 的 30 秒上手」和可复制的 curl 示例。
- 左侧项目列表（状态点、记录数、新建项目）；右侧项目档案（目标 / 架构 / 痛点 / 约定，长文默认折叠）+ 按 `kind` 过滤的时间线。
- 访客可直接追加记录 / 登记项目；署名存 `localStorage`（`eraser.ai.author`），下次自动带出。
- 支持 `?p=slug` 深链，发给 AI 直接落到对应项目。
- 站主登录后就地编辑 / 删除项目和日志，复用 `admin/content.js` 的共享编辑器（按需加载）；删除项目会级联删除它的日志。
- 导航栏、`Ctrl+K` 命令面板与 `g i` 都能到 `/ai/`。

### 给后来 AI 的约定

1. 先 `GET /api/ai?board=1` 找项目，读 `architecture / painpoints / conventions` 再动手。
2. 完成一次关键修改、踩到一个坑、做一个取舍、或准备交接时，`POST /api/ai?action=log` 追加一笔，写清「改了什么 / 为什么 / 怎么验证 / 下一步」。
3. 新项目先 `POST /api/ai?action=project` 登记，再写日志。
4. 追加是公开的，**不要写密码、令牌、连接串或用户隐私**。

### 边界与验证

- 公开写入是站长的明确选择，适合「单人站 + 多个 AI 助手」；它不是多用户评论系统，没有账号体系、没有编辑历史、没有通知。
- 日志默认只展示最近 100 条（`board=1`）；页面当前直接读 `/api/content?type=project` 与 `project_log` 全量，数据量大后再切到分页。
- `tests/content_test.mjs` 覆盖字段归一化与边界；`tests/api_routes_test.mjs` 覆盖公开读、追加、404、413、重复、429、登记、冲突与「公开写不能改删」；`tests/pages_audit.mjs` 覆盖页面安全与接线。
- 无头 e2e 41 项全过：访客桌面 / 追加 / 过滤 / 新项目 / 深链 / 站主编辑 / 暗色 / 移动单列 / 零站外请求 / 无控制台报错。
- `sw.js` → `eraser-v10`（新增 `/ai/` 与相关资源）。
- 上线：PR #47 → main @ `1749816`（2026-10-22）；首个种子项目就是本站 `eraser-site`，M23 / M24 的决策、踩坑与交接记录已写入板子。

---

## 五之十一、写作顺手：草稿、插图、快捷入口（M23）

站长原话：「还有什么可以优化的地方，真正适合个人使用且比较便利的，都帮我推进一下」。

目标：把「写一篇东西」的路径缩到最短——不用先进后台、不怕丢稿、截图直接进来。

### 草稿按篇隔离

- 旧草稿键只有类型（`eraser.admin.draft.post`），编辑 A 篇的草稿会被恢复进 B 篇。现在改成 `eraser.admin.draft.v2.<type>.<id>`，新建用 `.new`；存的是**整份表单**（标题 / 标签 / 发布状态 / 正文），不再只存正文。
- 关弹层 / 按 Esc 前把未落盘的改动写进 localStorage；下次编辑同一条会出现「检测到未保存的草稿 · MM-DD HH:MM」+ 恢复 / 丢弃。
- 旧版正文草稿仍能恢复，但只对「新建」生效，避免串稿；保存成功后新旧两把键一起清掉。

### 截图直接进正文

- Markdown 编辑器加了「🖼 插入图片」，也可以直接**粘贴 / 拖入**。
- 只收 PNG / JPG / WebP / GIF / AVIF（不收 SVG，避免脚本随图进站）；GIF 不压。
- 大图（>1.2MB 或长边 >1600）先在浏览器压到长边 1600、质量从 0.86 起、最低 0.55，压完仍超 4MB 就明确拒绝；小图原样上传。
- 上传仍走 `/api/upload`（Vercel Blob），新增可选 `type` 参数：只有白名单 MIME 才写 `Content-Type`，解决「压成 JPEG 后扩展名与真实类型不一致」。
- 上传遇到 401 不清空表单：公开页弹出登录框，登录后原表单还在；后台先存草稿再回登录页。

### 更短的入口

- 左下角「编辑模式」浮条新增 **＋**（写新文章）与 **⬇**（下载全站备份）。
- `Ctrl/⌘+K` 面板登录后多三条：写新文章 / 下载全站备份 / 管理后台。
- 不在博客页也能写：第一次点「＋」时才按需加载 `md.js` + `admin/content.js`，访客不会为编辑器多付流量；保存后直接跳到文章页。
- 编辑器内 `Ctrl/⌘+S` 或 `Ctrl/⌘+Enter` 保存，`Esc` 关闭；登录框开着时 Esc 只关登录框。
- 博客列表与文章页多了「发布 / 转草稿」按钮，点一下 `PATCH published` 立即生效，不用打开表单。

### 边界

- 没有新开接口；图片仍存 Vercel Blob，4MB 请求体上限不变（本地压缩就是为了守住它）。
- 草稿只在本机 localStorage，换设备 / 清缓存不会跟着走；重要内容仍然靠「保存」入库 + 定期备份。
- `sw.js` → `eraser-v9`。
- 上线：PR #45 → main @ `9db94b1`（2026-10-22）。

---

## 五之十、自动同步最新集数 + 播完确认（M22）

站长原话：「还有什么可以优化点，比如自动抓取，自动抓取封面，自动更新之类的」；随后拍板：「按你想法来，我的原则就是要方便，不要我手动维护的太多，并且可以满足我的大部分日常需求」。

目标：把 M21 的「一次性补放送表」推进成「每天打开就是最新」，同时**不替用户改观看进度**。

### 服务端：多认两件事

- [`api/_lib/airing.js`](api/_lib/airing.js) 新增 `episodeNumber()` / `latestEpisodeNumber()`：只从 `title / show_title / index_show` 里认纯数字或「第 N 话」，不猜 `long_title`；`2.5`、`PV`、`预告`、`0` 都返回 null。
- `shapeSeason()` 新增 `latest` 与 `finished`：`total > 0` 时用 total；连载中 `total: 0` 时 `episodes` 留空、只给 latest；上游完结且 total 缺失时用 latest 当总集数。实测 2026-10-21 `ss28747`：`total: 0`、最新正片第 196 话、`publish.is_finish: 0`，解析结果与页面一致。
- [`api/_lib/content.js`](api/_lib/content.js) 的 media 增加 `latest`（正整数，可空）与 `finished`（boolean，可空）。PATCH 仍是「先合并再归一化」，只传 latest 不会把 episodes / progress 冲掉。

### 前台：每天自动同步

- `syncCandidates()` 从「缺更新日的番」扩到「所有在追的 B 站番剧」（排除用户标完结 / 搁置），所以最新集数每天都会被拉一次；登录状态下每天最多自动跑一次，右上角按钮随时手动再跑，文案「同步 N 部」。
- `airingPatch()` 的写入规则：
  - `latest` 只增不减；`episodes` 只补空或向上修正，连载中的 0 不会被写死；
  - 上游完结写 `finished: true`，重新连载会改回 false；
  - `airday / airtime / cover / score` 仍然只填空，手填优先；
  - **绝不写 `progress / status`**，所有写入带 `touch:false`，不打乱「接着追」排序。
- 新集标记：`Workbench.freshCount(d) = latest - progress`。卡片右下绿色「新 N」，接着追行「新 N 话」，追平后自动消失。进度条分母优先总集数，总集数比最新集还旧时用 latest 兜底，避免算出 >100%。
- 上游完结只影响「本周放送」：完结季不再占日历格；如果自己还没看完，它仍留在「接着追」，且**不会**把用户状态改成完结。
- 封面：卡片 / 继续看缩略图统一 `loading="lazy" decoding="async" referrerPolicy="no-referrer"`，B 站图床防盗链下也能显示；加载失败仍回落到首字渐变。

### 播完提示：只建议，不自动写

- `watch.js` 的 `endedPlan()` 只看 progress 和 latest，给出下一话；YouTube（`infoDelivery` / `onStateChange`）、Vimeo（`ended`）、直链 `<video>`（`ended`）都会触发。
- 非静默确认条：「这集看完了，要记到第 N 话吗？」→「记到第 N 话 / 先不记」。**只有点确认才 PATCH `progress: N, position: 0`**；点「先不记」只收起。
- 已经追平（`next > latest`）时只显示「这集看完了，已经追平最新第 N 话」，不再劝 +1。
- B 站 iframe 拿不到 ended，不会弹；手动「＋1」始终保留。

### 边界

- 没有新开 Serverless Function，仍是 12 个；同步继续复用 `GET /api/content?action=airing` 与 `PATCH /api/content`。
- 仍然只做元数据：不下载、不代理、不爬站、不碰登录 / Cookie、不绕过 DRM；B 站只到「第几话」，没有秒级进度。
- `sw.js` → `eraser-v8`（M22 动了 `collect/index.html`、`watch.js`、`workbench.js`）。
- 全站测试合计 **2101 项 / 十三套**：`airing_test` 67、`watch_test` 121、`workbench_test` 71、`content_test` 208、`api_routes_test` 441、`pages_audit` 446。

---

## 五之九、漫画对等 + 放送表自动补全（M21）

站长原话：「漫画呢，能不能附上同样的功能，还有周几更新能不能直接抓取数据，这个网页可以让我方便的使用，但不需要太多心思维护」。

### 漫画：同一套工作台，正文仍在站外

- 「接着追」不再只服务番剧：同时有番 / 漫时出现「全部 / 追番 / 漫画」筛选（纯前端，不打接口）；计数拆成「番 X · 漫 Y」。
- 漫画外链的主按钮是「接着读 / 开读」，旁边给登录后的站主一个「＋1」；点开外链会把「想读」自动转成「在读」（`keepalive` 保证跳转前的 PATCH 能发出去）。
- 漫画**没有官方 iframe 阅读器**，本站不镜像、不代理正文，只负责记录和提醒；阅读本身跳原站。

### 番剧：B 站链接 → 自动补更新日 / 时间

- 新增纯逻辑 [`api/_lib/airing.js`](api/_lib/airing.js)：只认 `bilibili.com` 的番剧页（`/bangumi/play/ss…`、`ep…`、`/bangumi/media/md…`），再拼**固定**的公开资料地址，原始 URL 不会被直接请求（防 SSRF）。
- 优先解析官方文案 `new_ep.desc`（如「6月13日起 每周六11:00」）；文案缺时间时用最近一集**正片**的发布时间换算成北京时间（UTC+8），自动跳过 `预告 / PV / 花絮`。
- 新增 `GET /api/content?action=airing&url=…`（需登录、只认 GET、进程内缓存 6 小时）。**没有新开 Serverless Function**，仍复用 `api/content.js`，12 个函数上限没破。
- 前端：登录状态下每天最多自动跑一次（`eraser.airing.sync` 记日期）；只补空的 `airday / airtime / cover / score`，**绝不覆盖手填**；写入带 `touch:false`，不改 `updated_at`，不会因为一次批量补全把「接着追」的最近更新排序整体打乱。右上角另有「补全 N 部」手动按钮。
- 漫画没有稳定、免登录的公开更新日历（实测 B 站漫画接口返回 `code:99`，补齐 cookie 后详情接口仍不稳定），所以**不瞎猜、不爬站**：漫画更新日保留手填 / 批量导入，填一次就进「本周放送」。

### AniList 停服说明（2026-10-21 实测）

`graphql.anilist.co` 当前返回 **403「The AniList API has been temporarily disabled due to severe stability issues.」**，所以「✨ 按名字自动填充」暂时不可用，不是本站代码坏了。前端会明确提示「先手填 / 贴 B 站链接」；B 站番剧链接的封面、评分、放送时间仍可自动补。上游恢复后无需改代码。

### 边界

- `sw.js` → `eraser-v7`（M21 动了 `collect/index.html` 的样式与交互；M22 已升到 `eraser-v8`）。
- 新测试：`tests/airing_test.mjs`（51 项）、`api_routes_test` 的放送表分支（16 项）、`watch_test` / `pages_audit` 的 M21 接线审计（9 + 12 项）。
- M21 当时全站测试合计 **2010 项 / 十三套**；M22 已到 **2101 项**。

---

## 五之八、个人追更工作台（M20）

目标：把 `/collect/` 从「海报墙留档」变成打开就知道**现在该看什么**的个人工作台，参考 dudulu.moe 的双栏信息层级，但配色与组件沿用全站蓝。

### 顶部两栏

- **接着追**（M21 起由「接着看」更名）：只收「在看」或已有进度 / 续播点的条目；完结、搁置不打扰。按最近更新排序，每行是缩略图 + 名称 + 分类 + 进度 + 剩余时长 + 一个明确动作（B 站 / YouTube / Vimeo / 直链给「接着看 / 开看」，漫画外链给「接着读 / 开读」并带「＋1」，其他外链给「去站点」，没链接的登录后给「＋1 话」）。最多展示 6 条，更多时提示去下面的海报墙。
- **本周放送**：7 个星期格（带每天更新数、今天有小圆点），默认选中今天；当天列表按 `airtime` 升序，没填时间的排最后。用户标完结 / 搁置 / 上游已完结 / 没填 `airday` 的条目不进放送；上游完结但自己还没看完的仍留在「接着追」。

### 新字段与录入

`media` 新增两个可空字段：

| 字段 | 含义 | 校验 |
| --- | --- | --- |
| `airday` | 更新日，周一=1 … 周日=7 | 只收 1–7 的整数，空 = 不固定 |
| `airtime` | 更新时间 `HH:MM` | `8:05` 自动补成 `08:05`，全角冒号也认；空 = 只按日显示 |

后台编辑表单、`/collect/` 的「＋ 快速添加」、批量导入 / 导出 TSV、后台列表行都支持这两个字段。批量导入认「更新日 / 放送日 / 星期 / 周几 / weekday」与「更新时间 / 放送时间 / airtime」，值可以写「周三 / 星期三 / 3 / Wed」和「20:00 / 20点30 / 晚上 20 点」。

### 顺手的一步

登录状态下从海报墙或「接着看」点开播放器时，如果是「想看」会自动 PATCH 成「在看」——这是追更里最常做的一步，不必再手动改状态。公开访客没有令牌，不会发写请求。

### 边界与缓存

- 纯计算抽到 `workbench.js`（星期换算、接着看取舍、放送排序、进度文案），页面只负责画 DOM；`tests/workbench_test.mjs` 直接测这一层。
- **没有新开接口**：仍然复用 `PATCH /api/content`，`workbench.js` 是纯前端文件。
- B 站播放器仍只同步到「第几话」，秒级续播只对 YouTube / Vimeo / 直链生效；放送表只负责「提醒哪天更新」，不会自动切下一集 URL（B 站官方播放器自带剧集列表）。
- `sw.js` → `eraser-v6`，预缓存加入 `/workbench.js`。

---

## 五之七、M14–M18 速览（交接补充）

- **M14 动效基座**：只改 `style.css` 与 `shell.js`——≤300ms 反馈型动效、`prefers-reduced-motion` 总开关、统一 `:focus-visible` 焦点环、卡片悬停上浮、命令面板开合、主题切换交叉淡化。布局零变化。
- **M15 三态与触控**：博客列表 / 文章页 / 追更双栏 / 学习列表在接口失败时不再伪装成「空库」，改为「加载失败 + 重试」，空库与失败分开；全站 <24px 可点元素 63 → 1；移动导航链接与分类折叠按钮加大触控区。
- **M16 正文阅读增强**：`blog/post.html` 自动目录（h2/h3、中文锚点、当前节高亮）、顶部阅读进度、代码块复制、阅读时长/字数；修掉 `main.container` 的 `transform` 造成的吸顶栏层叠 Bug（`elementFromPoint` 已回到导航链接）。
- **M17 站主就地编辑**：`owner.js` + `owner.css`，任何可编辑页按 `Ctrl/⌘+Shift+L` 登录（与后台共用 `eraser.admin.token`），博客 / 文章 / 关于 / 导航 / 追更 / 学习地图直接长出「新建 / 编辑 / 删除」入口；访客看不到入口，草稿不会出现在公开列表与直链。表单、Markdown 预览、上传等全部复用 `admin/content.js`，没有第二套实现。
- **M18 阅读便利**：正文续读（只存百分比，30 天过期）、字号 90%–130%、标题锚点复制、复制链接 / 打印、图片灯箱、回到顶部；博客列表显示「约 N 分钟 · 读到 55%」与 RSS 入口；移动端顶栏从 126px 收到 90px，列表「阅读」按钮不再竖排。

---

## 五之三、加一个新工具（工具箱预留接口）

工具箱页面（`tools/index.html`）是**数据驱动**的：页面里的 `TOOLS` 数组就是唯一清单。上架一个新工具只要两步：

1. 在 `tools/` 目录放一个纯前端页面 `xxx.html`（复制现有结构：导航栏 + `<div class="container">` + 自己的 JS；**不引任何站外资源**）；
2. 在 `tools/index.html` 里给 `TOOLS` 加一行：

```js
var TOOLS = [
  { name: "工具名", desc: "一句话说明", href: "xxx.html" },
];
```

刷新 `/tools/` 即上架；删工具删行即可。空清单时页面显示筹备中提示，不会白屏。
T12 起密码生成器已下架（主人预留位置回头补内容），数组清空。

---

## 六、测试与 CI

| 套件 | 覆盖 | 项数 |
| --- | --- | --- |
| `tests/api_test.mjs` | 令牌签发/校验/过期/改密码失效、密码校验、safeEqual、requireAuth、后台令牌与 AI 令牌互不通用、配置自检、入参校验、favicon SSRF 防护与图片魔数识别、api/ 与 admin/ 源文件语法 | 183 |
| `tests/content_test.mjs` | 九种内容类型归一化（含追更 media 的**进度 / 播放位置 / 更新日 / 更新时间 / 最新集数 / 上游完结字段与合并语义**、学习地图 learn_map、**M24 project / project_log 的字段、状态、URL、长度、时间与默认值**）、Markdown 渲染 / 图片 / 安全性 / 边界、plain() 摘要 | 243 |
| `tests/watch_test.mjs` | 站内播放器纯逻辑：B 站 / YouTube / Vimeo / 直链四类解析、拒绝 javascript / data / 漫画 / b23 短链、嵌入地址与起始秒、时间格式化、续播语义、无 innerHTML/eval、**collect 接入与 M20 工作台接线审计、M21 漫画外链 ＋1 / 放送表自动补全接线、M22 播完确认（endedPlan / 追平不劝 +1 / 确认才写进度）与同步审计** | 121 |
| `tests/workbench_test.mjs` | 追更工作台纯逻辑（`workbench.js`）：周一–周日换算、日期 / 问候、更新日与时间解析、接着看的取舍与排序、本周放送按天筛选 / 时间排序 / 完结排除、进度百分比与下一话文案、续播剩余时长、**最新集 / 上游完结 / 新集计数 / 总集数过期时的分母兜底** | 71 |
| `tests/airing_test.mjs` | B 站放送表纯逻辑（`api/_lib/airing.js`）：番剧链接识别与伪造域名拒绝、固定资料地址、中文「每周X / 星期X」、HH:MM 与全角冒号、UTC+8 跨日换算、预告 / PV 过滤、完结番不给放送时间、**最新集号解析（纯数字 / 第 N 话 / 拒绝 2.5 与 PV）/ total=0 与完结季的兜底** | 67 |
| `tests/api_routes_test.mjs` | 接口全流程：未登录 401、CRUD、入参 400、404、405、优先级、SQL 注入、登录限流、缺配置 503、409 唯一性、级联删除、响应头、PATCH 合并语义、RSS 订阅源、文件上传（**M23 图片 Content-Type 白名单**）、favicon 代理、追更、学习地图（节点粒度 action / 深链 / gaps 快照）、sitemap.xml、备份与还原、**批量导入（预校验零写入 / 上限 500 / 批内去重 / 个别失败 / 进度字段校验）**、**按名字查（AniList 打桩全流程，挂在 /api/content 上）**、**PATCH 只改进度不丢总集数 / 只改播放位置不丢其它字段**、**B 站放送表（鉴权 / 非 B 站不放行 / 防 SSRF / 缓存 / 上游错误兜底 / latest 与 finished 透传）**、**M24 公开协作板（board=1 / 追加 / 项目不存在 404 / 64KB 413 / 重复幂等 / 限流 429 / 登记项目 / slug 冲突 409 / 公开写不能改删）** | 475 |
| `tests/pages_audit.mjs` | 9 个公开页面（含追更工作台/学习地图/AI 协作区/开发交接页）：内联脚本语法、零站外资源、同源 fetch、导航栏统一、静态兜底、Markdown 安全、PWA（manifest/图标/sw 策略）、各页功能点、**追更页「＋ 快速添加」与进度条 / ＋1 话 / ▶ 站内播放 / M20 接着看 + 本周放送 / M21 漫画对等 + 放送表自动补全 / M22 最新集同步 + 新集标 + 播完确认、交接页批次与套数同步**、**无障碍（main 地标 / 跳转链接）、分享卡片（description / og）、品牌与标题一致性、站主就地编辑入口、三态与阅读增强、M23 快捷写文章 / 备份 / 发布开关、M24 协作区 noindex / 公开接口 / 无令牌 / 深链 / 空态 / 移动单列 / 暗色 / 减弱动效** | 501 |
| `tests/admin_audit.mjs` | 后台：结构、深浅色主题、隐私（noindex/零站外资源）、Bearer 令牌、XSS 防护、九个标签功能点（含追更表单、学习地图节点编辑、一键接上 AI、备份还原）、**追更列表搜索/筛选/排序、行内改状态、封面缩略图回落、批量导入弹层与失败上报、按名字自动填充、进度字段与行内 ＋1**、Markdown 实时预览与草稿自动保存、**M23 整份草稿 / 插图 / 拖拽粘贴 / 压缩 / Ctrl+S**、**M24 项目 / 日志字段与五种 kind** | 230 |
| `tests/outline_check.mjs` | 大纲解析（直接从 `learn/index.html` 抽函数来跑）：四种 Markdown 标记、缩进与 Tab 等价、空格缩进、三层嵌套、CRLF、空/坏输入 | 11 |
| `tests/media_import_test.mjs` | 批量导入解析（在 vm 沙箱里加载 `admin/content.js` 的真函数）：TSV 带表头、中文逗号表头、英文表头、无表头纯名字、无表头带状态、管道分隔、JSON 数组 / `{type,data}` / `{items:[…]}`、空名字行、评分越界（99 / -3 / 8.4 / abc）、坏 JSON 抛错、**总集数 / 进度列（含别名与从「28 话」抠数字）**、**更新日 / 更新时间列（中文星期 / 英文缩写 / 全角冒号 / 点 / 2000 归一）**、**M23 插图上传纯逻辑（扩展名归一 / 长边缩放 / Markdown 片段）** | 79 |
| `tests/lookup_test.mjs` | AniList 查询纯逻辑：空/超长入参、kind 归一化、perPage 夹取、**关键词只进 variables 不进查询串**、打分 0–100→0–10、name 取 native→romaji→english、episodes 回落 chapters、note 拼装、0 结果过滤 | 38 |
| `tests/nav_test.cjs` | 导航核心逻辑：links.js 数据体检、hostOf/initialOf/hueOf、查询匹配、分类过滤（含侧栏 cat）、最近访问、标签收集、高亮区间、导入导出往返、真实数据全视图 | 145 |
| `tests/nav_audit.cjs` | 导航静态审计：结构、零外部请求、DOM 接线、localStorage 键规范、功能点（含最近视图/密度切换/复制/回到顶部）、全站一致性 | 84 |
| **合计** | | **2248** |

> 注：`api_test.mjs` 的项数随 `api/` 与 `admin/` 下的 `.js` 文件数浮动（每个文件一条语法断言）。

**CI**：`.github/workflows/ci.yml` —— push 或 PR 自动触发，ubuntu + Node 20，`npm ci` → 假驱动（neon + vercel/blob）覆盖真包 → `npm test`。全绿才允许合并。

---

## 七、部署

```text
push 到 main → GitHub → Vercel 监听到 webhook → 自动构建 → 1~2 分钟生效
```

- 站点：<https://eraser.de5.net>（DNS 解析与备用域名 eraser.888.moe 的配置记录见仓库 `domains.config.yaml`；Vercel 默认域名 eraser-pi.vercel.app 永远可用）
- **没有构建步骤**：HTML/CSS/JS 原样分发，`api/*.js` 即函数，部署 = 搬运文件。
- 改完先用无痕窗口（Ctrl+Shift+N）验证，避开缓存。

---

## 八、已知取舍（明确不做的事）

1. **单文件大页不拆**：`nav/index.html` 约 26KB、`admin/index.html` 约 43KB、`learn/index.html` 约 30KB。「双击能开、断网能看」是刻意选择——不引构建、不打包模块，一个文件就是一个完整应用。
2. **无用户体系 / 无构建步骤**：个人单用户站，不需要账号、权限组和会话管理。M24 的 `/ai/` 是「公开只追加」的例外：给 AI 开放读与追加，但没有登录、编辑历史、通知，也不涉及任何私人数据——与「密码放环境变量」的极简模型保持一致。（PWA 已在 M10 主线C 补上：`manifest.webmanifest` + `sw.js`，可「添加到主屏幕」并离线打开。）
3. **md.js 转义三铁律**（改渲染器前必读）：① 先整体转义，再生成标签；② 已转义的内容不再二次转义（query string 里的 `&` 只变 `&amp;` 一次）；③ 代码块抽出后单独转义。`tests/content_test.mjs` 的「Markdown 安全性」一节就是这三条的死锁。
4. **PATCH 语义现状**：`todos` / `events` 是**全量更新**（不传的字段会被重置），`content` 是**合并更新**（只传的字段被改，旧字段保留）。两者不统一——统一成合并语义是后续批次的事，现在照实写、照实用。
5. **管理后台不引 `style.css`**：后台是独立应用，自带完整样式（含深色模式、刘海屏安全区），与公开页面视觉体系刻意隔离，改公开页样式不会波及后台。

---

## 九、本机提交方式

本机 git https 直连不通（schannel 报错），提交走 GitHub API 脚本，不走 `git push`：

```bash
# 1. 写 manifest.tsv：每行 <A|M|D><Tab><仓库内相对路径>（A 新增 / M 修改 / D 删除）
# 2. 用脚本推分支（manifest + gh api 完成 blob/tree/commit/ref）
COMMIT_MSG="改了什么" bash dev/push-branch.sh <分支名> <manifest.tsv> main
# 3. 开 PR（先不合并，CI 与验收通过后合并）
gh pr create -R EraserPlus/eraser-site --base main --head <分支名> --title "标题" --body-file pr-body.md
```

脚本：`dev/push-branch.sh`（已收进仓库，自动从自身位置推断仓库目录；也可用环境变量 `REPO_DIR`/`REPO` 覆盖）。分支名建议 `tXX-简述`（如 `t01-engineering-baseline`）。

> 完整的接手说明（工作流程六步、环境特殊性、红线、批次记录）见仓库 `dev/index.html`，线上地址：<https://eraser.de5.net/dev/>

---

*本手册随网站迭代持续更新。改架构时同步改文档。*
