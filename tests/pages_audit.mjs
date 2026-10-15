import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const PAGES = ['index.html', 'nav/index.html', 'blog/index.html', 'blog/post.html',
               'about/index.html', 'tools/index.html',
               'collect/index.html', 'learn/index.html'];

console.log('=== 所有页面（8 个）：结构与语法 ===');for (const f of PAGES) {
  const html = read(f);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let ok = true, err = '';
  for (const s of scripts) {
    try { new Function(s); } catch (e) { ok = false; err = e.message; }
  }
  check(`${f} 内联脚本语法正确（${scripts.length} 段）`, ok, err);
}

console.log('\n=== 所有页面（8 个）：零站外资源 ===');
for (const f of PAGES) {
  const html = read(f);
  /* 只算「会被加载的资源」。普通的外链 <a href> 是内容，不是资源，不算 */
  const ext = [
    ...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...html.matchAll(/<link[^>]*\shref\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...html.matchAll(/<img[^>]*\ssrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...html.matchAll(/<iframe[^>]*\ssrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...html.matchAll(/@import\s+["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...html.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/gi),
  ].map(m => m[1]);
  check(`${f} 没有站外资源（脚本/样式/图片/字体）`, ext.length === 0, ext.join(', '));

  /* 站外链接必须带 noopener，防止被反向控制 */
  const anchors = [...html.matchAll(/<a[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi)];
  const unsafe = anchors.filter(a => !/rel\s*=\s*["'][^"']*noopener/i.test(a[0]));
  check(`${f} 站外链接都带 noopener（${anchors.length} 个）`, unsafe.length === 0,
        unsafe.map(a => a[1]).join(', '));
}

console.log('\n=== 所有页面（8 个）：只请求同源接口 ===');
for (const f of PAGES) {
  const html = read(f);
  const fetches = [...html.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map(m => m[1]);
  const bad = fetches.filter(u => !u.startsWith('/'));
  check(`${f} 的 fetch 都是同源路径（${fetches.length} 处）`, bad.length === 0, bad.join(', '));
  const other = [...html.matchAll(/\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/g)];
  check(`${f} 没有用其它网络 API`, other.length === 0, other.map(m => m[1]).join(', '));
}

console.log('\n=== 所有页面（8 个）：导航栏统一 ===');
for (const f of PAGES) {
  const html = read(f);
  check(`${f} 品牌名统一`, /<span class="logo">🧩 Eraser 的小站<\/span>/.test(html));
  check(`${f} 菜单含「搜索」`, /搜索<\/a>/.test(html));
  check(`${f} 导航没有多余的「首页」入口`, !/>首页<\/a>/.test(html));
  check(`${f} 引用全站 style.css`, /<link[^>]*href="[^"]*style\.css"/.test(html));
  check(`${f} 标了当前页 active`, /class="active"/.test(html));
}

console.log('\n=== 静态兜底：接口挂了也不能白屏 ===');
{
  const cases = [
    ['nav/index.html', /applyData\(window\.NAV_DATA\)/, '先渲染 links.js'],
    ['blog/index.html', /id="list"/, '列表有静态内容'],
    ['about/index.html', /id="article"/, '正文有静态内容'],
    ['index.html', /id="q"/, '搜索框'],
    ['collect/index.html', /id="hint-anime"/, '两个栏目有静态空状态'],
    ['learn/index.html', /id="listEmpty"/, '地图列表有静态空状态'],
  ];
  for (const [f, re, what] of cases) {
    check(`${f} 保留${what}`, re.test(read(f)));
    check(`${f} 接口失败时有 catch 兜底`, /\.catch\(function/.test(read(f)));
    check(`${f} 数据库为空时保留静态内容`,
          /还没内容|还没在后台写过|保留静态/.test(read(f)));
  }
}

console.log('\n=== Markdown 渲染安全 ===');
{
  const uses = [
    ['blog/post.html', /art\.innerHTML\s*=\s*window\.MD\s*\?\s*MD\.render/],
    ['about/index.html', /art\.innerHTML\s*=\s*window\.MD\s*\?\s*MD\.render/],
  ];
  for (const [f, re] of uses) {
    check(`${f} 用 MD.render 渲染（内部会先转义）`, re.test(read(f)));
  }
  for (const f of ['blog/post.html', 'about/index.html']) {
    const html = read(f);
    check(`${f} 加载了 md.js`, /<script src="[^"]*md\.js"><\/script>/.test(html));
    const assigns = [...html.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
    const risky = assigns.filter(v => v !== '""' && !/MD\.render/.test(v) && !/esc\(/.test(v));
    check(`${f} 没有把数据直接塞进 innerHTML`, risky.length === 0, risky.join(' | '));
  }
  check('md.js 自己会转义（先 esc 再生成标签）',
        /function esc\(s\)/.test(read('md.js')) && /text = esc\(text\)/.test(read('md.js')));
}

console.log('\n=== 博客文章页 ===');
{
  const html = read('blog/post.html');
  check('从网址读 slug 参数', /param\("slug"\)/.test(html));
  check('没有 slug 时给出提示和返回链接', /没有指定文章/.test(html));
  check('找不到文章时给出提示', /找不到这篇文章/.test(html));
  check('草稿不显示（published === false）', /published === false/.test(html));
  check('标题用 textContent 设置（防注入）', /h1\.textContent = d\.title/.test(html));
  check('标签用 textContent 设置', /s\.textContent = t/.test(html));
  check('页面标题会跟着文章变', /document\.title = d\.title/.test(html));
  check('有返回博客列表的链接', /回到博客列表/.test(html));
}

console.log('\n=== 博客列表页 ===');
{
  const html = read('blog/index.html');
  check('过滤掉草稿', /published !== false/.test(html));
  check('按更新时间倒序', /localeCompare/.test(html));
  check('链接指向 post.html?slug=', /post\.html\?slug=/.test(html));
  check('slug 做了 URL 编码', /encodeURIComponent\(d\.slug\)/.test(html));
  check('标题用 textContent 设置', /name\.textContent = d\.title/.test(html));
}

console.log('\n=== 全站搜索页（现为首页 /）===');
{
  const html = read('index.html');
  check('从网址读 q 参数', /decodeURIComponent/.test(html));
  check('搜索请求走同源 /api/search', /fetch\("\/api\/search\?q="/.test(html));
  check('没搜词时显示静态引导（不白屏）', /showIdle/.test(html) && /输入关键词，回车开始搜索/.test(html));
  check('接口失败给可读提示且保留页面', /搜索服务开小差了/.test(html));
  check('命中词高亮用 DOM 节点', /el\("mark"/.test(html));
  check('站外结果新窗口打开且带 noopener', /rel = "noopener noreferrer"/.test(html));
  check('结果标题/描述用 textContent 拼（防注入）', /el\("div", "t"\)/.test(html) && /el\("div", "d"\)/.test(html));
  check('结果分组含追更栏目', /type: "media"/.test(html) && /name: "追更"/.test(html));
  /* M7 搜索增强 */
  check('↑↓ 键选结果、循环移动并高亮', /e\.key === "ArrowDown"/.test(html) && /e\.key === "ArrowUp"/.test(html)
        && /classList\.add\("active"\)/.test(html));
  check('Enter 打开当前选中项', /hitEls\[activeIdx\]\.click\(\)/.test(html));
  check('搜索历史存本地且能清空', /eraser\.search\.history/.test(html) && /localStorage\.removeItem\(HKEY\)/.test(html));
  check('按内容类型分区过滤（全部/各分区）', /state\.tab === "all"/.test(html) && /r\.type === state\.tab/.test(html));
  check('结果分批展示 + 剩余条数', /state\.shown/.test(html) && /加载更多（还剩/.test(html));
  check('模糊命中带「模糊」标记', /el\("span", "fz", "模糊"\)/.test(html));
  /* M9 收窄搜索：正文不进搜索，一个字的词先拦掉 */
  check('结果分组含学习地图', /type: "learn_map"/.test(html) && /name: "学习地图"/.test(html));
  check('静态引导说明了「只搜标题和摘要」', /只搜标题和摘要，不搜正文/.test(html));
  check('一个字的词本地先拦掉（提示再打一个字）', /q\.length < 2/.test(html) && /再打一个字吧/.test(html));
  check('接口返回 tooShort 时也提示（双层保险）', /j\.tooShort/.test(html));
  check('页面文字不再被宣传为可搜', !/页面文字<\/b>（关于页等）/.test(html));
}

console.log('\n=== 旧首页已下线（首页与搜索合并）===');
{
  const html = read('index.html');
  check('旧的欢迎语已移除', !/id="welcomeTitle"/.test(html) && !/id="welcomeText"/.test(html));
  check('旧的五分区卡片已移除', !/class="card"/.test(html));
  check('不再读 home 页面标识', !/"home"/.test(html));
  check('根路径导航项是「搜索」且高亮', /<a href="index\.html" class="active">搜索<\/a>/.test(html));
  check('独立的 /search/ 页已删除', !fs.existsSync(path.join(REPO, 'search', 'index.html')));
}

console.log('\n=== 关于页 ===');
{
  const html = read('about/index.html');
  check('读取的是 about 这个页面标识', /"about"/.test(html));
  check('标题会跟着变', /document\.title = page\.data\.title/.test(html));
  check('有站点运行徽章', /id="runDays"/.test(html));
  check('徽章按上线日期算天数', /SITE_LAUNCH/.test(html) && /86400000/.test(html));
  check('徽章在正文容器外（后台改正文不影响）',
        html.indexOf('id="runDays"') > html.indexOf('id="article"'));
}

console.log('=== 工具箱页 ===');
{
  const html = read('tools/index.html');
  check('工具清单是数据驱动（TOOLS 数组）', /var TOOLS = \[/.test(html));
  check('空清单有空状态提示', /id="toolEmpty"/.test(html));
  check('预留了加工具的接口说明', /预留接口/.test(html));
  check('工具名/描述用 textContent 渲染', /name\.textContent = t\.name/.test(html));
  check('密码生成器已下架', !fs.existsSync(path.join(REPO, 'tools', 'password.html')));
}

console.log('\n=== 追更页 ===');
{
  const html = read('collect/index.html');
  check('两个栏目骨架（追番 / 漫画）', /id="list-anime"/.test(html) && /id="list-comic"/.test(html));
  check('读的是 media 内容类型', /content\?type=media/.test(html));
  check('看完的自动进收纳栏（按状态分流）', /status === "finished"/.test(html));
  check('收纳栏默认收起、点击展开', /fold\.classList\.toggle\("open"\)/.test(html));
  check('名称用 textContent 渲染（防注入）', /nm\.textContent = d\.name/.test(html));
  check('站外链接只放行 http(s)', /function safeUrl/.test(html));
  check('站外链接带 noopener', /noopener/.test(html));
  check('封面图加载失败自动隐藏', /img\.addEventListener\("error"/.test(html));
}

console.log('\n=== 学习地图页 ===');
{
  const html = read('learn/index.html');
  check('列表 + 详情两个视图骨架', /id="viewList"/.test(html) && /id="viewDetail"/.test(html));
  check('读的是 learn 接口', /\/api\/learn/.test(html));
  check('有进度条（.lm-bar）', /lm-bar/.test(html));
  check('按分组渲染节点', /function groupNodes/.test(html));
  check('勾选完成走 toggleNode', /action=toggleNode/.test(html));
  check('未登录时复选框禁用（避免点了没反应）', /chk\.disabled = !canEdit\(\)/.test(html) && /function canEdit\(\)/.test(html));
  check('勾选失败会回滚', /chk\.checked = !chk\.checked/.test(html));
  check('节点文字用 textContent 渲染（防注入）', /el\("div", "t", node\.text/.test(html));
  check('没有把节点数据塞进 innerHTML', !/innerHTML\s*=\s*[^"']*node\.text/.test(html));
  check('进度用服务端返回的值（不在本地瞎算）', /if \(j && j\.progress\) progress = j\.progress;\s*\n\s*paintDetailHead\(progress\)/.test(html));
  check('深链 ?id= 可直接打开某张地图', /URLSearchParams\(location\.search\)/.test(html));
  check('令牌 key 与后台一致', /eraser\.admin\.token/.test(html));

  // M10 主线 A4：仿 MapFlow 的交互增强
  check('地图卡可点开（键盘可达）', /card\.addEventListener\("click"/.test(html) && /ev\.key === "Enter"/.test(html));
  check('有搜索框过滤地图', /id="filterInput"/.test(html));
  check('有汇总条（几张图 / 总进度）', /function renderSummary/.test(html) && /总进度/.test(html));
  check('分组可折叠', /lm-grp" \+ \(cmap\[g\.name\] \? " collapsed"/.test(html) && /function rebuildNodes/.test(html));
  check('分组头带进度条', /lm-bar slim gbar/.test(html));
  check('节点可就地改文字', /function inlineEdit/.test(html));
  check('节点可改分组', /inlineEdit\(node, "group"/.test(html));
  check('节点可拖动排序', /dragstart/.test(html) && /function bindDrag/.test(html) && /function moveNode/.test(html));
  check('拖动限定同组、不跨组', /不跨组/.test(html));
  check('排序走 setNodes', /action=setNodes/.test(html));
  check('节点可删除', /action=removeNode/.test(html));
  check('可加节点（addNode）', /action=addNode/.test(html));
  check('未登录时顶部有只读提示', /id="lockNote"/.test(html) && /只能看，不能改/.test(html));
  check('可一键复制给 AI 的指令', /function copyAiPrompt/.test(html) && /复制给 AI 的指令/.test(html));
  check('复制内容提到 gaps=1', /gaps=1/.test(html));
  check('导入大纲：能解析 Markdown / 缩进列表', /function parseOutline/.test(html));
  check('导入前有预览', /function previewGroups/.test(html) && /解析出 /.test(html));
  check('导入走 POST /api/learn', /api\("\/api\/learn",\s*\{\s*method:\s*"POST"/.test(html));
  check('有新建地图入口', /function newMap/.test(html) && /id="btnNew"/.test(html));
}

console.log('\n=== 开发交接页（dev/，给接手的 AI）===');
{
  const html = read('dev/index.html');
  check('不进搜索引擎收录（noindex）', /name="robots"[^>]*noindex/i.test(html));
  check('引用了全站 style.css', /<link[^>]*href="[^"]*style\.css"/.test(html));
  check('品牌名与全站一致', /🧩 Eraser 的小站/.test(html));
  check('有回首页的出口', /href="\.\.\/index\.html"/.test(html));
  check('六步工作流程在', /工作流程/.test(html) && /六步/.test(html));
  check('红线约定在', /不换框架/.test(html) && /永不白屏/.test(html));
  check('本机特殊性在（推送脚本 / 禁 npm install）', /push-branch\.sh/.test(html) && /npm install/.test(html));
  check('批次记录在（T 批 + M 批）', /T15/.test(html) && /M1/.test(html) && /M2/.test(html));
  check('站点地图含核心路径', /collect\//.test(html) && /admin\//.test(html) && /api\/_lib/.test(html));
  check('给下一个 AI 的复制指令在', /eraser\.de5\.net\/dev\//.test(html));
  check('有当前版本一栏', /当前版本/.test(html) && /main @/.test(html));

  // M10：交接页必须跟上工程进度
  check('M10 主线C 批次记录在', /M10c/.test(html) && /sitemap/.test(html) && /sw\.js/.test(html));
  check('M10 主线A 批次记录在', /M10a/.test(html) && /一键接上 AI/.test(html) && /gaps=1/.test(html));
  check('两种令牌的说明在', /eraser-ai-token-v1::/.test(html) && /eraser-admin-token-v1::/.test(html));
  check('测试套数已更新为八套', /八套/.test(html) && /outline_check/.test(html));
  check('后台标签数已更新为 9', /9 个标签/.test(html) || /9 标签/.test(html));
  check('本机坑位补充了 BOM / PowerShell / gh PR 退出码', /BOM/.test(html) && /PowerShell/.test(html) && /SIGTERM/.test(html));
  check('待办里写明 M10 主线B 搁置原因', /主线 B/.test(html) && /(0 篇|博客 0)/.test(html));
  const anchors = [...html.matchAll(/<a[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi)];
  const unsafe = anchors.filter(a => !/rel\s*=\s*["'][^"']*noopener/i.test(a[0]));
  check(`站外链接都带 noopener（${anchors.length} 个）`, unsafe.length === 0,
        unsafe.map(a => a[1]).join(', '));
  const ext = [
    ...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...html.matchAll(/<link[^>]*\shref\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...html.matchAll(/<img[^>]*\ssrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
  ].map(m => m[1]);
  check('没有站外资源（脚本/样式/图片）', ext.length === 0, ext.join(', '));
}

console.log('\n=== PWA 可安装（manifest + 图标 + Service Worker，M10） ===');
{
  /* ---- manifest ---- */
  let mf = null, mfErr = '';
  try { mf = JSON.parse(read('manifest.webmanifest')); } catch (e) { mfErr = e.message; }
  check('manifest.webmanifest 是合法 JSON', !!mf, mfErr);
  if (mf) {
    check('有 name 与 short_name', !!mf.name && !!mf.short_name, JSON.stringify([mf.name, mf.short_name]));
    check('start_url 是站点根', mf.start_url === '/', String(mf.start_url));
    check('display 是 standalone（可加到主屏独立运行）', mf.display === 'standalone', String(mf.display));
    check('theme_color 与全站主题蓝一致（#2563eb）', mf.theme_color === '#2563eb', String(mf.theme_color));
    check('icons 含 svg 图标', Array.isArray(mf.icons) && mf.icons.length > 0
          && mf.icons.every(i => /svg/.test(i.type)), JSON.stringify(mf.icons));
    check('有 maskable 图标（被裁圆角也不缺角）',
          (mf.icons || []).some(i => String(i.purpose).includes('maskable')));
    check('scope 限定在同站', mf.scope === '/', String(mf.scope));
  }

  /* ---- 图标文件存在且是 SVG ---- */
  for (const f of ['icon.svg', 'icon-maskable.svg']) {
    let ok = true, body = '';
    try { body = read(f); } catch (e) { ok = false; }
    check(`${f} 存在且是 SVG`, ok && /<svg[\s>]/.test(body), body.slice(0, 40));
    check(`${f} 没有站外引用`, !/https?:\/\//.test(body.replace(/xmlns="[^"]*"/g, '')));
  }

  /* ---- Service Worker ---- */
  const sw = read('sw.js');
  check('sw.js 注册 install / activate / fetch 三个事件',
        /addEventListener\('install'/.test(sw) && /addEventListener\('activate'/.test(sw)
        && /addEventListener\('fetch'/.test(sw));
  check('sw.js 有缓存版本号（改样式后靠它换新）', /const VERSION = 'eraser-v\d+'/.test(sw));
  check('activate 里清理旧版本缓存', /caches\.delete\(k\)/.test(sw));
  check('接口（/api/）一律不缓存', /isApi\(url\)\) return/.test(sw));
  check('HTML 走 network-first（联网时永远拿最新页）', /isHtml\(req\)/.test(sw) && /fetch\(req\)\.then/.test(sw));
  check('静态资源走 cache-first', /isStatic\(url\)/.test(sw) && /caches\.match\(req\)/.test(sw));
  check('只处理 GET（写操作永不拦截）', /req\.method !== 'GET'\) return/.test(sw));
  check('站外请求不碰（只处理同源）', /url\.origin !== self\.location\.origin/.test(sw));
  check('有内联离线页（断网不白屏）', /OFFLINE_HTML/.test(sw) && /现在没网/.test(sw));
  check('预缓存了首页外壳', /PRECACHE/.test(sw) && /'\/'/.test(sw));

  /* ---- 各公开页 head 都挂了 manifest + 图标 + 主题色 ---- */
  for (const f of PAGES) {
    const html = read(f);
    check(`${f} 引了 manifest`, /rel="manifest"[^>]*manifest\.webmanifest/.test(html));
    check(`${f} 引了 svg 图标`, /rel="icon"[^>]*icon\.svg/.test(html));
    check(`${f} 有 theme-color（地址栏 / 状态栏跟随主题）`, /name="theme-color"[^>]*#2563eb/.test(html));
  }

  /* ---- 后台页刻意不注册 SW ---- */
  const shell = read('shell.js');
  check('shell.js 负责注册 Service Worker', /serviceWorker\.register/.test(shell));
  check('注册逻辑避开后台页（/admin/ 不注册）', /\/\^\\\/admin\\\/\//.test(shell));
  check('只在安全上下文注册（https / localhost）', /location\.protocol !== "https:"/.test(shell));
  check('SW 注册失败被吞掉（不影响页面）', /register\([^)]*\)\.catch\(function \(\) \{ \/\* 忽略 \*\/ \}\)/.test(shell));
}

console.log('\n=== 键盘快捷键：g 前缀跳转（M10） ===');
{
  const shell = read('shell.js');
  check('PAGES 每条带快捷键字母（key 字段）', /key: "h"/.test(shell) && /key: "l"/.test(shell)
        && /key: "b"/.test(shell));
  check('有 g 前缀待命机制', /gArmed/.test(shell) && /disarmG/.test(shell));
  check('按 g 后 1.5 秒没跟上第二个键就作废', /setTimeout\(disarmG, 1500\)/.test(shell));
  check('输入框里打字不触发跳转', /function typingIn/.test(shell) && /typingIn\(document\.activeElement\)/.test(shell));
  check('面板开着时键盘归面板管', /paletteOpen\(\)\) return/.test(shell));
  check('修饰键组合不参与（不抢浏览器快捷键）', /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/.test(shell));
  check('按字母跳转到对应页面', /function goByKey/.test(shell) && /go\(PAGES\[i\]\.href\)/.test(shell));
  check('Ctrl+K 面板仍然保留', /e\.key === "k" \|\| e\.key === "K"/.test(shell));
  check('命令面板里显示 g 快捷键（可发现性）', /"前往 · g " \+ p\.key/.test(shell));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
