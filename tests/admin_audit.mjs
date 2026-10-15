import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const html = fs.readFileSync(path.join(REPO, 'admin', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

console.log('=== 结构 ===');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check('有 2 个内联 script（主题预设 + 主逻辑）', scripts.length === 2, String(scripts.length));
scripts.forEach((s, i) => {
  try { new Function(s); check(`内联 script #${i + 1} 语法正确`, true); }
  catch (e) { check(`内联 script #${i + 1} 语法正确`, false, e.message); }
});
check('主题预设脚本在 <head> 里、样式之前（避免闪白）',
      html.indexOf('data-theme') < html.indexOf('<style>') && html.indexOf('<style>') < html.indexOf('</head>'));

console.log('\n=== 样式与主题 ===');
check('自带完整样式（管理页是独立应用，不依赖全站 style.css）', /<style>[\s\S]{2000,}<\/style>/.test(html));
check('定义了浅色变量', /:root\{[\s\S]*--card:#ffffff/.test(html));
check('定义了深色变量', /html\[data-theme="dark"\]\{/.test(html));
check('深色变量覆盖了背景、文字、边框、卡片', (() => {
  const m = html.match(/html\[data-theme="dark"\]\{([\s\S]*?)\}/);
  return !!m && /--bg:/.test(m[1]) && /--ink:/.test(m[1]) && /--line:/.test(m[1]) && /--card:/.test(m[1]);
})());
check('有主题切换按钮', /id="btnTheme"/.test(html));
check('主题选择会持久化', /lsSet\(THEME_KEY/.test(html));
check('首次访问跟随系统偏好', /prefers-color-scheme: dark/.test(html));
check('手机端适配（viewport-fit=cover）', /viewport-fit=cover/.test(html));
check('顶栏处理刘海屏安全区', /env\(safe-area-inset-top\)/.test(html));

console.log('\n=== 隐私与外部请求 ===');
check('声明不被搜索引擎收录', /name="robots"[^>]*noindex/i.test(html));
{
  const ext = [...html.matchAll(/(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi)].map(m => m[1]);
  check('没有任何站外资源引用', ext.length === 0, ext.join(', '));
  const cdn = [...html.matchAll(/\/\/(cdn|unpkg|fonts|googleapis|jsdelivr)[^"'\s)]*/gi)];
  check('没有 CDN / 字体域名', cdn.length === 0, cdn.map(m => m[0]).join(', '));
}

console.log('\n=== 接口调用 ===');
{
  ['auth', 'todos', 'events'].forEach(function (p) {
    check(`调用了 /api/${p}`, new RegExp('api\\("' + p + '"').test(html));
  });
  check('带上了 Bearer 令牌', /Authorization = "Bearer "/.test(html));
  check('收到 401 自动退出登录', /r\.status === 401/.test(html) && /logout\(\)/.test(html));
  check('令牌存 localStorage 且键名带命名空间', /eraser\.admin\.token/.test(html));
  check('localStorage 读写包在 try/catch 里',
        /function lsGet[\s\S]{0,140}catch/.test(html) && /function lsSet[\s\S]{0,160}catch/.test(html));
  check('服务器未配好时给出可读提示', /服务器还没配好/.test(html));
}

console.log('\n=== 安全 ===');
{
  check('密码框是 type=password', /<input type="password"/.test(html));
  check('密码框关闭自动填充建议', /autocomplete="current-password"/.test(html));
  check('有 escapeHtml 用于提示文案', /function escapeHtml/.test(html));

  check('el() 辅助函数用 textContent 而非 innerHTML',
        /function el\(tag, cls, text\)\{[\s\S]{0,220}textContent/.test(html));
  check('待办标题走 el() 渲染', /el\("div", "t", t\.title\)/.test(html));
  check('日程标题走 el() 渲染', /el\("div", "t", ev\.title\)/.test(html));
  check('待办备注走 el() 渲染', /el\("div", "note", t\.note\)/.test(html));
  check('日程备注走 el() 渲染', /el\("div", "note", ev\.note\)/.test(html));

  const assigns = [...html.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  const risky = assigns.filter(v => {
    if (v === '""') return false;
    if (/escapeHtml/.test(v)) return false;
    if (/^"最近 7 天完成 <b>"\s*\+\s*doneWeek/.test(v)) return false;
    return true;
  });
  check('innerHTML 只用于清空 / 转义文案 / 纯数字', risky.length === 0, risky.join(' | '));
  check('清空列表用 innerHTML = ""（不拼数据）', assigns.includes('""'));

  check('删除操作有二次确认', (html.match(/confirm\(/g) || []).length >= 3,
        String((html.match(/confirm\(/g) || []).length));
  check('源码里没有硬编码密码', !/password\s*[:=]\s*["'][^"']{6,}["']/.test(html));
}

console.log('\n=== 功能点 ===');
{
  const must = [
    ['三个标签页：今天 / 待办 / 日程', /data-tab="today"[\s\S]*data-tab="todos"[\s\S]*data-tab="events"/],    ['今日总览：日期与星期', /id="heroDate"/],
    ['今日总览：三个统计数字', /id="sTodo"[\s\S]*id="sEvent"[\s\S]*id="sOver"/],
    ['今日总览：今日日程区块', /id="todayEvents"/],
    ['今日总览：今天该做的区块', /id="todayTodos"/],
    ['今日总览：逾期区块（有才显示）', /id="overdueCard"/],
    ['今日总览：最近 7 天完成统计', /weekSummary/],
    ['月历：标题与翻月', /id="calTitle"[\s\S]*id="calPrev"[\s\S]*id="calNext"/],
    ['月历：回到今天', /id="calToday"/],
    ['月历：有日程的日期显示圆点', /el\("span", "dot"\)/],
    ['月历：点日期切换选中日', /selDay = day/],
    ['日程：按天查看', /function renderDayEvents/],
    ['计划表：月历/计划表切换', /id="evViews"[\s\S]*data-v="agenda"/],
    ['计划表：按天分组渲染', /function renderAgenda/],
    ['计划表：复用 eventNode 带编辑删除', /card\.appendChild\(eventNode\(e\)\)/],
    ['待办优先级：高 / 中 / 低', /data-p="2"[\s\S]*data-p="1"[\s\S]*data-p="0"/],
    ['待办筛选：未完成 / 全部 / 逾期 / 已完成', /data-f="open"[\s\S]*data-f="all"[\s\S]*data-f="over"[\s\S]*data-f="done"/],
    ['新增待办', /api\("todos",\{method:"POST"/],
    ['编辑待办（复用顶部表单）', /function startEditTodo/],
    ['勾选完成', /function toggleTodo/],
    ['删除待办', /function removeTodo/],
    ['新增日程', /api\("events",\{method:"POST"/],
    ['编辑日程', /function startEditEvent/],
    ['删除日程', /function removeEvent/],
    ['截止日期友好显示', /今天到期[\s\S]*明天到期[\s\S]*逾期 /],
    ['优先级用颜色圆点表示', /\.pri\.p2\{ background:var\(--red\)/],
    ['加载失败不静默', /catch\(function\(e\)\{ say\("app", e\.message, "err"\)/],
  ];
  must.forEach(([name, re]) => check(`包含：${name}`, re.test(html)));
}

console.log('\n=== 内容管理（导航 / 博客 / 页面 / 追更 / 学习）===');
{
  const must = [
    ['九个标签页', /data-tab="today"[\s\S]*data-tab="todos"[\s\S]*data-tab="events"[\s\S]*data-tab="nav"[\s\S]*data-tab="post"[\s\S]*data-tab="media"[\s\S]*data-tab="learn"[\s\S]*data-tab="page"[\s\S]*data-tab="data"/],
    ['导航标签内容区', /id="tab-nav"[\s\S]*id="navHost"/],
    ['博客标签内容区', /id="tab-post"[\s\S]*id="postHost"/],
    ['追更标签内容区', /id="tab-media"[\s\S]*id="mediaHost"/],
    ['学习标签内容区', /id="tab-learn"[\s\S]*id="learnHost"/],
    ['页面标签内容区', /id="tab-page"[\s\S]*id="pageHost"/],
    ['加载了 Markdown 渲染器', /<script src="\.\.\/md\.js"><\/script>/],
    ['加载了内容管理模块', /<script src="content\.js"><\/script>/],
    ['初始化时把 api 和 say 传进去', /ContentAdmin\.init\(\{\s*api:\s*api,\s*say:\s*say\s*\}\)/],
    ['切标签时调用内容渲染', /ContentAdmin\.render\(tab\)/],
    ['标签栏可横向滚动（手机上有 9 个标签）', /\.tabs\{\s*overflow-x:auto/],
    ['表单弹层样式', /\.cf-overlay\{/],
    ['Markdown 预览样式', /\.mdprev\{/],
    ['学习地图：节点行样式', /\.lmrow\{/],
    ['学习地图：分组小标题样式', /\.lmgrp-h\{/],
    ['数据标签内容区（备份 / 还原）', /id="tab-data"[\s\S]*id="btnBackupPull"[\s\S]*id="backupReport"/],
    ['TABS 数组含 data（切标签用）', /var TABS = \[[^\]]*"data"\]/],
  ];
  must.forEach(([name, re]) => check(`包含：${name}`, re.test(html)));

  /* ---------- 备份与还原（M10 新增的「数据」标签） ---------- */
  const bkMust = [
    ['有下载全量备份按钮', /id="btnBackupPull"/],
    ['有选备份文件的输入框', /id="backupFile"[^>]*type="file"|type="file"[^>]*id="backupFile"/],
    ['有还原文本框', /id="restoreText"/],
    ['有「先检查一下」按钮', /id="btnBackupVerify"/],
    ['有「确认还原」按钮', /id="btnBackupRestore"/],
    ['下载走 /api/backup', /api\("backup"\)/],
    ['校验走 /api/backup?action=verify', /api\("backup\?action=verify"/],
    ['还原走 POST /api/backup', /api\("backup", \{ method:"POST"/],
    ['还原前有二次确认弹窗', /confirm\("确认把这份备份灌回去/],
    ['确认文案说明了「库里多出来的不会删」', /库里多出来的不会删/],
    ['选文件用 FileReader 读入', /new FileReader\(\)/],
    ['还原结果用 DOM API 渲染（防注入，不拼 innerHTML）', /function backupReport\(kind, lines\)/],
    ['报告文案走 textContent', /box\.appendChild\(document\.createTextNode/],
  ];
  bkMust.forEach(([name, re]) => check(`备份还原：${name}`, re.test(html)));

  /* 备份报告绝不能把 JSON 内容拼进 innerHTML */
  const badInner = [...html.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  const riskyBk = badInner.filter(v => /lines|errors|message|backup/i.test(v));
  check('备份还原没有把数据拼进 innerHTML', riskyBk.length === 0, riskyBk.join(' | '));

  const cjs = fs.readFileSync(path.join(REPO, 'admin', 'content.js'), 'utf8');
  try { new Function(cjs); check('admin/content.js 语法正确', true); }
  catch (e) { check('admin/content.js 语法正确', false, e.message); }

  const cMust = [
    ['六种内容都有字段定义', /nav_category:[\s\S]*nav_link:[\s\S]*post:[\s\S]*page:[\s\S]*media:[\s\S]*learn_map:/],
    ['学习地图：有状态下拉框（在学/学完/归档）', /\{ k: "status", l: "状态", t: "select"[\s\S]*\["active"[\s\S]*\["done"[\s\S]*\["archived"/],
    ['学习地图：走 /api/learn 而不是 /api/content', /api\("learn\?action=toggleNode"|api\("learn\?action=updateNode"/],
    ['学习地图：节点文字可编辑', /var t = el\("input", "lmt"\)/],
    ['学习地图：节点分组可编辑', /var g = el\("input", "lmg"\)/],
    ['学习地图：节点备注可编辑', /var nt = el\("input", "lmnt"\)/],
    ['学习地图：失焦自动保存（不逐字打接口）', /addEventListener\("blur", function \(\) \{[\s\S]{0,120}patchNode/],
    ['学习地图：回车即保存', /if \(e\.key === "Enter"\) inp\.blur\(\)/],
    ['学习地图：节点可上移下移', /function moveNode\(refresh, nodes, i, i2\)/],
    ['学习地图：可在下面插一个（继承分组）', /function insertAfter\(refresh, nodes, i\)/],
    ['学习地图：新增节点自动生成 id', /function newNodeId\(nodes\)/],
    ['学习地图：分组小标题只在变化时出现', /if \(g !== current\)/],
    ['学习地图：删除节点走 removeNode', /api\("learn\?action=removeNode"/],
    ['学习地图：删除前二次确认', /删了就找不回来了/],
    ['学习地图：编辑面板可返回列表', /← 返回地图列表/],
    ['学习地图：列表显示进度', /"完成 " \+ \(p\.done \|\| 0\) \+ " \/ " \+ \(p\.total \|\| 0\)/],
    ['追更：栏目和状态用下拉框', /\{ k: "category", l: "栏目", t: "select"/],
    ['追更：状态四种齐全', /\["wish"[\s\S]*\["watching"[\s\S]*\["finished"[\s\S]*\["paused"/],
    ['追更：列表显示栏目 / 状态 / 评分', /category === "comic" \? "漫画" : "追番"/],
    ['追更的链接与封面带上传按钮（可达）', /\{ file: \["url"\], media: \["url", "cover"\] \}/],
    ['下拉框有选项（select 构建）', /var sel = el\("select"\)/],
    ['链接表单带搜索关键词字段', /\{ k: "keywords", l: "搜索关键词/],
    ['通用表单构建器', /function buildForm\(type, onSave, onCancel\)/],
    ['表单弹层', /function openForm\(title, formNode\)/],
    ['导航：可导入旧的 links.js', /function importFromLinksJs/],
    ['导入用 parseLinksJs 解析（links.js 是 JS literal，不能 JSON.parse）', /var data = parseLinksJs\(text\);/],
    ['导入 links.js 时带上搜索关键词', /keywords: l\.keywords \|\| \[\]/],
    ['导入 links.js 时带上提示词', /tip: l\.tip/],
    ['链接表单带提示词字段', /\{ k: "tip", l: "提示词/],
    ['博客一键发布/转草稿', /pub \? "转草稿" : "发布"/],
    ['通用列表支持各类型快捷操作', /if \(opts\.ops\) opts\.ops\(it\)/],
    ['导航：分类可增删改', /function editCategory/],
    ['导航：链接可增删改', /function editLink/],
    ['删除前二次确认', /if \(!confirm\(/],
    ['失败时提示不静默', /catch\(function \(e\) \{ say\("app", e\.message, "err"\); \}\)/],
    ['Markdown 预览用 MD.render', /md\.render\(ta\.value\)/],
    ['Markdown 实时预览（输入即渲染）', /ta\.addEventListener\("input", function \(\) \{ paint\(\)/],
    ['草稿自动保存', /function saveDraft/],
    ['草稿恢复/丢弃条', /检测到未保存的草稿/],
    ['保存成功后清草稿', /box\.clearDraft/],
    ['关弹层时停掉草稿定时器', /draftTimers\.forEach/],
  ];
  cMust.forEach(([name, re]) => check(`content.js 包含：${name}`, re.test(cjs)));

  /* content.js 里不能把用户数据拼进 innerHTML */
  const assigns = [...cjs.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  const risky = assigns.filter(v => v !== '""' && !/md\.render|MD\.render/.test(v));
  check('content.js 的 innerHTML 只用于清空或 MD.render', risky.length === 0, risky.join(' | '));
  check('content.js 用 textContent 渲染列表内容',
        /el\("div", "t", opts\.title\(it\)\)/.test(cjs) && /function el\(tag, cls, text\)/.test(cjs));
  /* 学习地图的节点文字必须走 value= 而不是 innerHTML */
  check('学习地图节点文字走 input.value（防注入）', /t\.value = node\.text \|\| ""/.test(cjs));
}

console.log('\n=== 与全站一致性 ===');
{
  check('标题正确', /<title>管理后台 · Eraser 小站<\/title>/.test(html));
  check('主色与全站一致（#2563eb）', html.includes('#2563eb'));
  check('管理页没有加入公开导航栏（保持隐蔽）', !/class="navbar"/.test(html));
}

/* parseLinksJs 的运行时用例：用标记从 content.js 抽出纯函数直接跑。
   回归背景：links.js 是手写的 JS 对象 literal（键名不带引号），JSON.parse 必挂。 */
console.log('\n=== links.js 导入解析 ===');
{
  const cjs = fs.readFileSync(path.join(REPO, 'admin', 'content.js'), 'utf8');
  const S = '/* ===== LINKS-IMPORT-START ===== */';
  const E = '/* ===== LINKS-IMPORT-END ===== */';
  const a = cjs.indexOf(S), b = cjs.indexOf(E);
  check('content.js 带 LINKS-IMPORT 标记', a >= 0 && b > a, `a=${a} b=${b}`);

  let parseLinksJs = null;
  if (a >= 0 && b > a) {
    try { parseLinksJs = new Function(cjs.slice(a, b) + '\nreturn parseLinksJs;')(); } catch (e) {}
  }
  check('能提取出 parseLinksJs 函数', typeof parseLinksJs === 'function');

  const raw = fs.readFileSync(path.join(REPO, 'nav', 'links.js'), 'utf8');
  let data = null, rawErr = null;
  try { data = parseLinksJs(raw); } catch (e) { rawErr = e.message; }
  check('parseLinksJs 能解析 links.js 原文', !!data && Array.isArray(data.categories), String(rawErr));
  check('解析出 11 个分类', !!data && data.categories.length === 11,
        data ? String(data.categories.length) : String(rawErr));
  const total = data ? data.categories.reduce((n, c) => n + c.links.length, 0) : 0;
  check('解析出 34 条链接', !!data && total === 34, String(total));

  let e1 = null;
  try { parseLinksJs('window.NAV_DATA = {oops};'); } catch (e) { e1 = e.message; }
  check('垃圾输入抛错且错误信息非空', !!e1 && e1.length > 0, String(e1));

  let e2 = null;
  try { parseLinksJs('window.NAV_DATA = {categories: "x"};'); } catch (e) { e2 = e.message; }
  check('categories 不是数组时报「找不到 categories 数组」', e2 === '找不到 categories 数组', String(e2));

  let e3 = null;
  try { parseLinksJs('window.NAV_DATA = {categories:[{id:"a",name:"A"}]};'); } catch (e) { e3 = e.message; }
  check('分类缺 links 时报错', !!e3, String(e3));
}

/* agendaGroups 的运行时用例：用标记从 admin/index.html 抽出纯函数直接跑。
   回归背景：计划表要按天分组、过滤过去、全天优先——逻辑错一天就乱。 */
console.log('\n=== 计划表分组 ===');
{
  const S = '/* ===== AGENDA-START ===== */';
  const E = '/* ===== AGENDA-END ===== */';
  const a = html.indexOf(S), b = html.indexOf(E);
  check('admin/index.html 带 AGENDA 标记', a >= 0 && b > a, `a=${a} b=${b}`);

  let agendaGroups = null;
  if (a >= 0 && b > a) {
    try { agendaGroups = new Function(html.slice(a, b) + '\nreturn agendaGroups;')(); } catch (e) {}
  }
  check('能提取出 agendaGroups 函数', typeof agendaGroups === 'function');

  const evs = [
    { id: 1, title: '全天事', start_at: '2026-10-16T00:00:00Z', all_day: true },
    { id: 2, title: '下午会', start_at: '2026-10-16T14:00:00Z', end_at: '2026-10-16T15:00:00Z' },
    { id: 3, title: '昨天的事', start_at: '2026-10-13T09:00:00Z' },
    { id: 4, title: '太远的', start_at: '2027-01-01T09:00:00Z' },
  ];
  const g = agendaGroups(evs, '2026-10-14', 60);
  check('过去和超范围的被过滤', g.length === 1 && g[0].date === '2026-10-16', JSON.stringify(g.map(x => x.date)));
  check('同一天全天的排在前', g.length === 1 && g[0].items[0].title === '全天事' && g[0].items[1].title === '下午会',
        JSON.stringify(g[0].items.map(x => x.title)));
  check('分组标签带月和星期', g.length === 1 && /10 月 16 日 周/.test(g[0].label), g[0].label);
  check('多天按日期升序', (() => {
    const r = agendaGroups([
      { id: 5, title: 'b', start_at: '2026-10-20T09:00:00Z' },
      { id: 6, title: 'a', start_at: '2026-10-15T09:00:00Z' },
    ], '2026-10-14', 60);
    return r.length === 2 && r[0].date === '2026-10-15' && r[1].date === '2026-10-20';
  })());
  check('空数组不炸', agendaGroups([], '2026-10-14', 60).length === 0);
  check('坏数据不炸', agendaGroups([{ id: 9 }, null, { start_at: null }], '2026-10-14', 60).length === 0);
  check('不传 days 就不限天数', agendaGroups([{ id: 7, start_at: '2030-01-01T00:00:00Z' }], '2026-10-14').length === 1);
}

console.log('\n=== 一键接上 AI 面板（M10）===');
{
  check('学习 tab 里有接上 AI 的标题', /🤖\s*一键接上 AI/.test(html));
  check('有状态容器 #aiStatus', /id="aiStatus"/.test(html));
  check('有配置文件文本框 #aiGuide（只读）', /id="aiGuide"[\s\S]{0,120}?readonly/.test(html));
  check('有「生成 / 换一条令牌」按钮', /id="btnAiIssue"/.test(html));
  check('有「复制接入配置」按钮', /id="btnAiCopy"/.test(html));
  check('有「展开说明书」按钮', /id="btnAiShow"/.test(html));
  check('有「吊销全部令牌」按钮', /id="btnAiRevoke"/.test(html));
  check('吊销按钮是危险样式', /id="btnAiRevoke"[^>]*/.test(html) && /class="btn danger" id="btnAiRevoke"/.test(html));

  check('读状态用 GET /api/ai', /api\("ai"\)/.test(html));
  check('发令牌用 POST /api/ai', /api\("ai",\s*\{\s*method:\s*"POST"/.test(html));
  check('吊销用 DELETE /api/ai', /api\("ai",\s*\{\s*method:\s*"DELETE"/.test(html));
  check('拉说明书用 ?guide=1', /api\("ai\?guide=1"\)/.test(html));

  check('面板函数 renderAiPanel 存在', /function renderAiPanel\(/.test(html));
  check('切到学习 tab 时会刷新面板', /tab === "learn"[\s\S]{0,120}?renderAiPanel\(\)/.test(html));
  check('进入后台时绑定了按钮事件', /function enterApp\(\)[\s\S]{0,220}?aiBind\(\)/.test(html));

  check('复制按钮用 navigator.clipboard', /navigator\.clipboard\.writeText/.test(html));
  check('复制失败有 execCommand 兜底', /execCommand\("copy"\)/.test(html));
  check('吊销前有确认弹窗', /confirm\("吊销后[\s\S]{0,80}?\)/.test(html));

  check('状态区用 textContent 渲染（防注入）', /function aiRenderStatus\([\s\S]{0,900}?textContent/.test(html));
  check('状态区不用 innerHTML 拼令牌', !/aiStatus[\s\S]{0,400}?\.innerHTML/.test(html));
  check('已有令牌时一次性填好配置（不重复请求）', /if \(j && j\.hasToken && !\$\("aiGuide"\)\.value\) aiFillGuide/.test(html));
  check('生成令牌后本地更新状态（不再回读接口）', /aiRenderStatus\(\{ hasToken: true/.test(html));
  check('吊销后本地更新状态（不再回读接口）', /aiRenderStatus\(\{ hasToken: false/.test(html));

  check('说明书提到只读接口 /api/learn', /GET\s+"?\s*\+?\s*base\s*\+\s*"\/api\/learn/.test(html)
        || /\/api\/learn\s+列出全部地图/.test(html));
  check('说明书提到查漏补缺 gaps=1', /gaps=1/.test(html));
  check('说明书提到 toggleNode 打卡', /toggleNode/.test(html));
  check('说明书提到 addNode', /addNode/.test(html));
  check('说明书带 Authorization 请求头写法', /Authorization:\s*Bearer/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);