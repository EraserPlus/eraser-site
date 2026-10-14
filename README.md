# Eraser 的小站 · 使用手册与开发指南

> 站点：<https://eraser.de5.net> ｜ 个人站 ｜ Vercel Hobby 免费档
> 仓库：GitHub `EraserPlus/eraser-site`（Public）｜ 技术栈：纯静态 HTML/CSS/JS + Vercel Serverless Functions（Node ESM）+ Neon Postgres
> 本文面向「未来的 Eraser 和接手的 AI」：所有内容以仓库当前真实状态为准，随改随更新。

---

## 一、一页纸架构

### 目录树（当前真实文件清单）

```text
eraser-site/
├── index.html            首页（导航栏 + 四个分区卡片）
├── style.css             全站统一样式（改这里 = 公开页换肤）
├── md.js                 自研 Markdown 渲染器（内置转义，见「已知取舍」）
├── vercel.json           响应头配置：/api/ 不缓存，静态资源缓存 1 小时 + 安全头
├── .gitattributes        锁死 LF 行尾，杜绝 Windows CRLF 污染 diff
├── .gitignore            忽略 node_modules / .vercel / 临时文件，不进仓库
├── package.json          两个运行时依赖（@neondatabase/serverless + @vercel/blob）+ npm test 脚本
├── package-lock.json     锁版本，CI 用 npm ci 安装
│
├── api/                  Vercel Serverless 函数目录（每个 .js 自动成为一个 /api 路由）
│   ├── auth.js           POST 登录换令牌 / GET 配置自检
│   ├── todos.js          待办 CRUD（全部需登录，私人数据）
│   ├── events.js         日程 CRUD（全部需登录，私人数据）
│   ├── content.js        全站内容 CRUD（读公开，写需登录）
│   ├── rss.js            博客 RSS 订阅源（GET 公开，免登录）
│   ├── upload.js         文件上传（需登录，裸 body 存 Vercel Blob）
│   ├── favicon.js        站点图标代理（GET 公开，SSRF 防护 + 魔数识别 + 7 天缓存）
│   ├── search.js         全站搜索（GET 公开，跨类型 ilike，草稿过滤）
│   └── _lib/             公共库（不会成为路由）
│       ├── db.js         数据库连接 + ensureSchema() 首次自动建表
│       ├── token.js      HMAC 令牌签发/校验、密码校验、配置自检
│       ├── http.js       响应封装 ok/send/fail、readJson、readBody（二进制安全、带大小上限）、入参校验
│       ├── ratelimit.js  登录限流（5 次失败锁 15 分钟，按 IP）
│       ├── favicon.js    favicon 的 SSRF 防护与图片魔数识别（纯函数，可单测）
│       └── content.js    五种内容类型的归一化与校验
│
├── admin/                管理后台（独立单文件应用，自带样式）
│   ├── index.html        后台全部界面与逻辑（约 43KB）
│   └── content.js        导航/博客/文件/页面 四大内容管理模块
│
├── tests/                七套测试 + 测试用假数据库驱动
│   ├── api_test.mjs      令牌/密码/入参校验/favicon SSRF 与魔数识别/api 与 admin 源文件语法（156 项）
│   ├── content_test.mjs  内容类型归一化 + Markdown 渲染/图片/安全（112 项）
│   ├── api_routes_test.mjs 四个接口全流程：鉴权/CRUD/注入/限流/配置/PATCH 合并语义/RSS 订阅源/favicon 代理（202 项）
│   ├── pages_audit.mjs   8 个公开页面：结构/零站外资源/静态兜底/注入防护（122 项）
│   ├── admin_audit.mjs   管理后台：主题/隐私/接口/安全/功能点（114 项）
│   ├── nav_test.cjs      导航页核心逻辑：数据体检/查询/视图/最近访问/高亮/导入导出（135 项）
│   ├── nav_audit.cjs     导航页静态审计：结构/零外部请求/DOM 接线/功能点（74 项）
│   ├── stubs/@neondatabase/serverless/   手写假驱动（只记录 SQL 不连库）
│   └── stubs/@vercel/blob/               手写假驱动（只记录 put 调用不连 Blob）
│
├── .github/workflows/ci.yml   GitHub Actions：push / PR 自动跑 npm test
│
├── about/index.html      关于页（内容可在后台改）
├── nav/                  网址导航页
│   ├── index.html        全部界面与逻辑（约 41KB：侧栏+横滑双端、密度、最近访问、favicon 真图标）
│   └── links.js          静态兜底数据（纯数据，无代码）
├── blog/
│   ├── index.html        文章列表（读 /api/content?type=post）
│   └── post.html         文章详情（?slug=xxx，用 md.js 渲染正文）
├── search/
│   └── index.html        全站搜索页（读 /api/search，静态兜底）
└── tools/
    ├── index.html        工具列表
    └── password.html     密码生成器（新工具的复制模板）
```

### 数据流（文字版）

**公开页（8 个：/、/nav/、/blog/、/blog/post.html、/search/、/about/、/tools/、/tools/password.html）**

```text
打开页面
  → ① 先渲染写死在 HTML / links.js 里的静态内容（断网、双击本地文件都能看）
  → ② 再 fetch 同源接口（/api/content?type=nav 等，只读同源路径）
  → ③ 成功：用数据库返回的数据替换静态内容
  → ④ 失败（接口挂了 / 数据库没内容）：保持静态内容，catch 兜底
  → 另：/api/rss 公开输出博客 RSS（阅读器订阅用，免登录）；/blog/ 页面 head 有 autodiscovery 链接
  → 结果：任何情况下不白屏
```

**管理后台（/admin/，六个标签：今天 / 待办 / 日程 / 导航 / 博客 / 页面）**

```text
打开后台 → POST /api/auth 用密码换 HMAC 令牌（30 天有效）→ 存 localStorage
  → 之后每个请求带 Authorization: Bearer <令牌>
  → /api/todos、/api/events 的所有操作都要登录（401 自动退出登录）
  → 密码连错 5 次锁 15 分钟（login_attempts 表按 IP 记录）
  → 「日程」标签：月历看整月分布，计划表看今天起 60 天按天分组的安排（全天优先）
```

**数据库四张表（Neon Postgres，ensureSchema 首次访问自动建）**

| 表 | 用途 |
| --- | --- |
| `todos` | 待办：标题 / 备注 / 完成 / 截止日期 / 优先级（0 低 1 中 2 高） |
| `events` | 日程：标题 / 备注 / 开始 / 结束 / 全天 |
| `login_attempts` | 登录限流：ip / fails / locked_until |
| `content` | 全站内容一张表：nav_category / nav_link / post / file / page 五种 type 共用，data 为 jsonb |

---

## 二、快速开始

```bash
npm test
```

一条命令按顺序跑完七套测试，共 **732 项**，全部通过即说明站点核心逻辑健康。

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

## 六、测试与 CI

| 套件 | 覆盖 | 项数 |
| --- | --- | --- |
| `tests/api_test.mjs` | 令牌签发/校验/过期/改密码失效、密码校验、safeEqual、requireAuth、配置自检、入参校验、favicon SSRF 防护与图片魔数识别、api/ 与 admin/ 源文件语法 | 156 |
| `tests/content_test.mjs` | 五种内容类型归一化、Markdown 渲染 / 图片 / 安全性 / 边界、plain() 摘要 | 112 |
| `tests/api_routes_test.mjs` | 四个接口全流程：未登录 401、CRUD、入参 400、404、405、优先级、SQL 注入、登录限流、缺配置 503、409 唯一性、级联删除、响应头、PATCH 合并语义（只更新出现的字段，done_at 三态）、RSS 订阅源（公开/草稿过滤/XML 转义/空库合法）、文件上传（401/405/503/超 4MB/空 body/文件名清洗/路径穿越）、favicon 代理（405/400 与 SSRF 挡在发请求前/魔数兜底/缓存/302 跳内网/首页声明图标/404） | 202 |
| `tests/pages_audit.mjs` | 8 个公开页：内联脚本语法、零站外资源、同源 fetch、导航栏统一、静态兜底、Markdown 安全、各页功能点 | 122 |
| `tests/admin_audit.mjs` | 后台：结构、深浅色主题、隐私（noindex/零站外资源）、Bearer 令牌、XSS 防护、六个标签功能点、链接关键词、Markdown 实时预览与草稿自动保存 | 114 |
| `tests/nav_test.cjs` | 导航核心逻辑：links.js 数据体检、hostOf/initialOf/hueOf、查询匹配、分类过滤（含侧栏 cat）、最近访问、标签收集、高亮区间、导入导出往返、真实数据全视图 | 114 |
| `tests/nav_audit.cjs` | 导航静态审计：结构、零外部请求、DOM 接线、localStorage 键规范、功能点（含最近视图/密度切换/复制/回到顶部）、全站一致性 | 74 |
| **合计** | | **915** |

> 注：`api_test.mjs` 的项数随 `api/` 与 `admin/` 下的 `.js` 文件数浮动（每个文件一条语法断言）；`api/hello.js` 删除后为 102，`api/rss.js` 加入后为 103，`api/upload.js` 加入后为 104，T08 加入 favicon 两个文件与 SSRF/魔数纯函数用例后为 155。

**CI**：`.github/workflows/ci.yml` —— push 或 PR 自动触发，ubuntu + Node 20，`npm ci` → 假驱动（neon + vercel/blob）覆盖真包 → `npm test`。全绿才允许合并。

---

## 七、部署

```text
push 到 main → GitHub → Vercel 监听到 webhook → 自动构建 → 1~2 分钟生效
```

- 站点：<https://eraser.de5.net>（DNSHE 解析，A 记录指向 Vercel；副域名 eraser-pi.vercel.app 永远可用）
- **没有构建步骤**：HTML/CSS/JS 原样分发，`api/*.js` 即函数，部署 = 搬运文件。
- 改完先用无痕窗口（Ctrl+Shift+N）验证，避开缓存。

---

## 八、已知取舍（明确不做的事）

1. **单文件大页不拆**：`nav/index.html` 约 26KB、`admin/index.html` 约 43KB。「双击能开、断网能看」是刻意选择——不引构建、不打包模块，一个文件就是一个完整应用。
2. **无评论 / 无多人 / 无 PWA / 无构建步骤**：个人单用户站，这些都不需要。评论和多用户要一张用户表和一整套会话体系，与「密码放环境变量」的极简模型冲突。
3. **md.js 转义三铁律**（改渲染器前必读）：① 先整体转义，再生成标签；② 已转义的内容不再二次转义（query string 里的 `&` 只变 `&amp;` 一次）；③ 代码块抽出后单独转义。`tests/content_test.mjs` 的「Markdown 安全性」一节就是这三条的死锁。
4. **PATCH 语义现状**：`todos` / `events` 是**全量更新**（不传的字段会被重置），`content` 是**合并更新**（只传的字段被改，旧字段保留）。两者不统一——统一成合并语义是后续批次的事，现在照实写、照实用。
5. **管理后台不引 `style.css`**：后台是独立应用，自带完整样式（含深色模式、刘海屏安全区），与公开页面视觉体系刻意隔离，改公开页样式不会波及后台。

---

## 九、本机提交方式

本机 git https 直连不通（schannel 报错），提交走 GitHub API 脚本，不走 `git push`：

```bash
# 1. 写 manifest.tsv：每行 <A|M|D><Tab><仓库内相对路径>（A 新增 / M 修改 / D 删除）
# 2. 用脚本推分支（manifest + gh api 完成 blob/tree/commit/ref）
COMMIT_MSG="改了什么" bash eraser-site-plan/tools/push-branch.sh <分支名> eraser-site-plan/tools/<manifest>.tsv
# 3. 开 PR（先不合并，QA 验证后由主理人合）
gh pr create --base main --head <分支名> --title "标题" --body-file pr-body.md
```

脚本：`eraser-site-plan/tools/push-branch.sh`。分支名建议 `tXX-简述`（如 `t01-engineering-baseline`）。

---

*本手册随网站迭代持续更新。改架构时同步改文档。*
