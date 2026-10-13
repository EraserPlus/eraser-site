# Eraser 的小站 · 架构与开发手册

> 最后更新：2026-10-13
> 本文档是网站的完整技术档案 + 未来开发蓝本。建议同时复制一份为仓库里的 `README.md`。

---

## 一、架构全景

```javascript
访客浏览器
    │  HTTPS
    ▼
┌─────────────────────────────────────────────┐
│  Vercel（免费 Hobby 计划）                    │
│  ├─ 静态文件托管：HTML/CSS/JS 直接分发         │
│  ├─ Serverless 函数：api/*.js 自动成为接口     │
│  ├─ HTTPS 证书：自动签发/续期（Let's Encrypt） │
│  └─ 自动部署：监听 GitHub 仓库，Commit 即上线  │
└──────────────────┬──────────────────────────┘
                   │  每次 push 自动拉取构建
                   ▼
        GitHub 仓库（唯一代码来源）
        github.com/EraserPlus/eraser-site

域名层：
  eraser.de5.net  ──A记录──▶  216.198.79.1（Vercel 任意Cast IP）
  解析托管：DNSHE 免费域名平台（de5.net 子域名）
```

**核心原则：GitHub 是唯一代码来源。Vercel 只是"自动搬运工"。**

### 资产清单（账号密码自己保管好）

| 资产 | 位置 | 说明 |
| --- | --- | --- |
| 代码仓库 | GitHub / EraserPlus / **eraser-site** | Public 仓库 |
| 托管平台 | Vercel 项目 **eraser** | Hobby 免费计划 |
| 主域名 | **eraser.de5.net** | DNSHE 平台管理，A 记录指向 Vercel |
| 副域名 | eraser-pi.vercel.app | Vercel 自带，永远可用 |
| 后端函数 | 仓库 `api/` 目录 | 目前：hello.js |
| 数据库 | （未启用） | 需要时用 Vercel Storage → Postgres |

---

## 二、仓库文件结构

```javascript
eraser-site/
├── index.html            首页（导航栏 + 分区卡片）
├── style.css             ★ 全站统一样式（改这里 = 全站换肤）
├── trigger.txt           触发部署用，可删
│
├── tools/                工具箱
│   ├── index.html        工具列表页
│   └── password.html     密码生成器（新工具的复制模板）
│
├── files/                文件仓库（放可下载文件）
│   ├── index.html        下载列表页
│   └── demo.txt          示例文件
│
├── blog/                 博客
│   ├── index.html        文章列表页
│   └── posts/
│       └── hello.html    示例文章（新文章的复制模板）
│
├── nav/                  网址导航
│   └── index.html
│
├── about/                关于我
│   └── index.html
│
└── api/                  ★ Serverless 函数目录（每个 .js = 一个接口）
    └── hello.js          示例接口 /api/hello
```

### 页面通用结构（每个页面都一样）

```html
<head>      标题 + 引用 ../style.css
<body>
  <div class="navbar">  顶部导航（六个分区的链接）
  <div class="container">  正文内容
```

子文件夹页面用 `../style.css`、`../index.html` 这样的相对路径——**保证本地双击 html 也能正常预览**。

---

## 三、标准工作流（最重要的章节）

### 改任何东西的通用流程

```javascript
1. 打开 github.com/EraserPlus/eraser-site
2. 点进要改的文件
3. 点右上角 ✏️ 铅笔（Edit this file）
4. 改 → 点绿色 Commit changes
5. 等 1~2 分钟（Vercel 自动部署）
6. Ctrl+Shift+N 无痕窗口打开网站验证
```

### 新增文件 / 上传文件

- 仓库首页 → **Add file → Upload files** → 拖文件 → Commit
- 网页上传单文件上限 25MB；文件夹可以整拖

### 删除文件

- 点进文件 → 右上角 **⋯ → Delete file** → Commit

### 新建文件

- **Add file → Create new file** → 文件名可以带路径（如 `api/xxx.js` 会自动建 api 目录）

### 部署没触发时（万能药）

在仓库里随便建一个空文件再删掉（或改任意文件），Commit 会推送 webhook，Vercel 必然收到。

---

## 四、修改指南（按场景速查）

### 1. 改文字内容

直接改对应 html 文件里的中文文字。Commit 即上线。

### 2. 加一个工具页

1. 复制 `tools/password.html` → 重命名（如 `tools/json.html`）
2. 改 `<h1>` 标题、中间的 HTML 控件、`<script>` 里的逻辑
3. 打开 `tools/index.html`，复制一行：

```html
<div class="list-item">
  <div><div class="name">工具名</div><div class="desc">一句话说明</div></div>
  <a href="json.html"><button class="ghost">打开</button></a>
</div>
```

### 3. 加一个可下载文件

1. 文件传进 `files/` 目录
2. `files/index.html` 里复制一行：

```html
<div class="list-item">
  <div><div class="name">文件名</div><div class="desc">说明</div></div>
  <a href="文件名" download><button class="ghost">下载</button></a>
</div>
```

### 4. 写一篇博客文章

1. 进 `blog/posts/` → Add file → Create new file → `文章名.html`
2. 把 `hello.html` 内容复制进去，改标题/日期/正文
3. `blog/index.html` 加一条 `<div class="list-item">…`

### 5. 导航站加链接

`nav/index.html` 里复制一行 `<a href="https://…" target="_blank">名字</a>`。
浏览器主页可设为 `https://eraser.de5.net/nav/`。

### 6. 全站换配色

`style.css` 全局替换 `#2563eb`（主题蓝）→ 想要的颜色。
常用：#16a34a 绿 / #dc2626 红 / #7c3aed 紫 / #0f172a 暗黑系。

### 7. 加一个全新分区（如 /games/）

1. 仓库建 `games/index.html`，从 about/index.html 复制改导航高亮
2. 首页 index.html 的 `.cards` 里加一个卡片
3. （可选）其他页面的 navbar 里补一个链接

---

## 五、Serverless 函数（api/ 目录）

### 规则

- 仓库根目录的 `api/` 文件夹，**每个 .js 文件 = 一个 HTTPS 接口**
- `api/hello.js` → `https://eraser.de5.net/api/hello`
- 支持 GET/POST，Node.js 运行环境，无需服务器

### 最小模板

```js
export default function handler(request, response) {
  // request.query.xxx   → URL 参数 ?xxx=
  // request.body        → POST 的 JSON/表单数据
  // request.headers     → 请求头
  response.status(200).json({ ok: true });
}
```

### 返回方式

```js
res.status(200).json({...})      // JSON（最常用）
res.status(200).send('文本')      // 纯文本
res.setHeader('Content-Type','text/html'); res.send('<h1>…</h1>')
res.redirect('https://目标网址')   // 302 跳转
res.status(400).json({error:'…'}) // 错误
```

### 依赖第三方包

仓库根目录建 `package.json`：

```json
{ "dependencies": { "@vercel/postgres": "^0.10.0" } }
```

部署时 Vercel 自动 npm install（首次会慢一些）。

### 环境变量（藏密钥的唯一正确方式）

1. Vercel → 项目 → Settings → **Environment Variables** → 添加
2. 函数里读取：`process.env.变量名`
3. **永远不要**把 API Key 写进前端 html/js（仓库 Public，全世界可见）

---

## 六、域名与 DNS 备忘

| 项 | 值 |
| --- | --- |
| 域名注册/解析平台 | DNSHE（de5.net 免费子域名） |
| 记录类型 | **A 记录** |
| 主机记录 | @ |
| 记录值 | 216.198.79.1 |
| TTL | 600（10 分钟） |

- 换 Vercel IP 时：Vercel 面板 Domains 页会提示新 IP，去 DNSHE 改 A 记录即可
- Vercel 侧无需动：证书自动、域名已绑定
- ⚠️ 历史教训：de5.net 父域 DNSSEC 曾损坏导致 Let's Encrypt 拒签证书（2026-10-13）。
若再次遇到 "DNSSEC: Bogus" 报错 → 找 DNSHE 平台修复，或等其自行恢复，不是你配置的问题

---

## 七、故障排查手册

| 症状 | 排查 |
| --- | --- |
| 网站没更新 | ① 无痕窗口 ② 确认 Commit 成功 ③ Vercel → Deployments 看最新一条状态 |
| Deployments 没有新记录 | 再随便 Commit 一次（推 webhook） |
| 部署显示 Error | 点进该部署 → Build Logs 看红色报错；常见：JS 语法错、package.json 写错 |
| 页面 404 | 检查文件名大小写、路径是否一致（GitHub 区分大小写） |
| 接口 500 | Vercel → 该部署 → Runtime Logs 看报错 |
| 域名打不开 | dig/nslookup 查解析；DNSHE 面板看 A 记录；Vercel Domains 页看状态 |
| 证书报错 | 多半是 DNSSEC/解析问题，等或找平台，参见第六节 |

---

## 八、安全红线

1. **仓库是 Public**：密码、Key、隐私数据一律不进仓库
2. 密钥只放 Vercel Environment Variables
3. 数据库表如需访问控制，函数里自行校验（如简单 token）
4. Vercel Hobby 计划**仅限非商业用途**

## 九、免费额度（Hobby 计划）

| 资源 | 额度 |
| --- | --- |
| 静态托管带宽 | 100 GB/月 |
| 函数调用 | 125,000 次/天 |
| 函数执行时长 | 最长 60 秒/次 |
| 构建时间 | 6000 分钟/月 |
| 团队成员 | 1 人（自己） |
| 项目数量 | 够用 |

个人项目极难触顶。触顶 = 你该考虑升级或接广告回血了（笑）。

---

## 十、升级路线图（未来蓝本）

### Level 1：纯前端（当前 ✅）

- 加工具：JSON 格式化、二维码、时间戳、Base64、Hash、正则测试、Markdown 编辑器
- 加游戏：2048、贪吃蛇、数独
- 加 PWA（手机可"安装"到桌面）
- 浏览器本地应用：备忘录/待办（localStorage）

### Level 2：+ 数据库（Vercel Postgres，免费档）

启用路径：Vercel → Storage → Create Database → Postgres → Connect to Project
（自动注入 POSTGRES_URL 环境变量）

- 留言板 / 访客簿
- Pastebin（贴文字给别人）
- 短链接 + 点击统计
- 匿名提问箱
- 每日一言（自己维护语录库）

### Level 3：+ 外部 API（环境变量藏 Key）

- AI 聊天页（OpenAI/DeepSeek/Claude 中转，流式输出）
- 在线跑代码（Judge0）
- 每日壁纸 / Bing 美图 API
- 访客信息查询

### Level 4：+ Cron Jobs（Settings → Cron Jobs）

- 网站监控告警（挂了就推 Telegram）
- RSS 定时抓取，个人信息流
- 定时签到/数据备份

### Level 5：架构外扩（本站不够用时）

- Cloudflare Workers + D1/KV：全球边缘、免费额度更狠、可商用
- 廉价 VPS（~5 美元/月）：常驻进程、机器人、游戏服务器、跑本地大模型
- 图床/大文件：Cloudflare R2（ egress 免费）

---

## 十一、已讨论过的功能灵感池（按 wow 值排序）

| 功能 | 技术点 | 难度 |
| --- | --- | --- |
| 阅后即焚加密分享 | 前端 AES + 一次性令牌 | ★★★ |
| 网页版隔空投送（Snapdrop 类） | WebRTC P2P + 信令函数 | ★★★★ |
| 个人知识库 AI 问答（RAG） | 向量库 + 嵌入 + LLM | ★★★★★ |
| 匿名聊天室 | SSE 实时推送 + 存库 | ★★★ |
| 在线运行代码 | Judge0 API | ★★ |
| 匿名提问箱 | CRUD + 简单后台 | ★★ |
| 抽奖/投票 | 聚合统计 + IP 防刷 | ★★ |
| 网站监控告警 | Cron + TG/邮件通知 | ★★★ |
| Webhook 中转站 | 签名验证 + 转发 | ★★ |
| 图床 | Vercel Blob/R2 + 压缩 | ★★★ |
| 个人 RSS 阅读器 | 定时抓取 + 解析 | ★★★ |
| 状态页 status page | Cron + 历史存储 | ★★ |

---

*本手册随网站迭代持续更新。改架构时同步改文档。*
