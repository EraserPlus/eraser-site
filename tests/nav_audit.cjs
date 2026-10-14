const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'nav', 'index.html'), 'utf8');
const links = fs.readFileSync(path.join(ROOT, 'nav', 'links.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

console.log('=== 结构 ===');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const external = [...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
check('有 2 个内联 script（核心 + 界面）', inline.length === 2, `实际 ${inline.length}`);
check('有 1 个外部 script', external.length === 1, external.join(', '));
check('外部 script 指向 links.js', external[0] === 'links.js', external[0]);
check('links.js 是相对路径（本地双击也能用）', external[0] && !/^[/.]/.test(external[0]), external[0]);
check('links.js 在 index.html 之前加载',
      html.indexOf('src="links.js"') < html.indexOf('NAV-CORE-START'));
check('页面有 1 个 style 块', (html.match(/<style>/g) || []).length === 1);

inline.forEach((s, i) => {
  try { new Function(s); check(`内联 script #${i + 1} 语法正确`, true); }
  catch (e) { check(`内联 script #${i + 1} 语法正确`, false, e.message); }
});
try { new Function('window', links); check('links.js 语法正确', true); }
catch (e) { check('links.js 语法正确', false, e.message); }

console.log('\n=== 零外部请求 ===');
{
  /* 只把真正的站外资源算作外部请求；../style.css 是同站文件，不算 */
  const res = [
    ...html.matchAll(/<link[^>]*\shref\s*=\s*["']([^"']+)["']/gi),
    ...html.matchAll(/<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi),
    ...html.matchAll(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi),
    ...html.matchAll(/@import\s+["']([^"']+)["']/gi),
    ...html.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/gi),
  ].map(m => m[1]).filter(u => /^(https?:)?\/\//i.test(u));
  check('没有站外样式 / 图片 / 内嵌框架', res.length === 0, res.join(', '));

  check('引用了全站统一样式 style.css', /<link[^>]*href="\.\.\/style\.css"/.test(html));

  /* 导航页现在会读数据库，但必须保留静态兜底：接口挂了页面照样能看 */
  check('先渲染 links.js 静态数据，再尝试接口（不白屏）',
        /applyData\(window\.NAV_DATA\)/.test(html) && html.indexOf('applyData(window.NAV_DATA)') < html.indexOf('fetch('));
  check('接口失败时静默保留静态数据（有 catch）',
        /\.catch\(function\(\)\{[^}]*静态/.test(html) || /接口不可用，静默保留静态数据/.test(html));
  check('数据库没内容时也保留静态数据',
        /还没内容，保持静态/.test(html) || /return;\s*\/\/ 数据库里还没内容/.test(html));

  /* 只允许请求自己的同源接口，不能有站外请求 */
  const fetches = [...html.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map(m => m[1]);
  check('所有 fetch 都是同源相对路径', fetches.length > 0 && fetches.every(u => u.startsWith('/')),
        fetches.join(', '));
  const net = [...html.matchAll(/\b(XMLHttpRequest|importScripts|WebSocket|EventSource|sendBeacon)\s*\(/g)];
  check('没有用其它网络 API', net.length === 0, net.map(m => m[1]).join(', '));

  const cdn = [...html.matchAll(/\/\/(cdn|unpkg|fonts|ajax|googleapis|jsdelivr)[^"'\s)]*/gi)];
  check('没有 CDN / 字体域名', cdn.length === 0, cdn.map(m => m[0]).join(', '));

  /* links.js 里的 url 是数据，不是被加载的资源——但要确认它们只出现在数据字段里 */
  const badInLinks = [...links.matchAll(/\b(fetch|XMLHttpRequest|importScripts)\s*\(/g)];
  check('links.js 里没有任何代码（纯数据）', badInLinks.length === 0);
}

console.log('\n=== DOM 接线 ===');
{
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...html.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]));
  const missing = [...used].filter(id => !htmlIds.has(id));
  check('脚本引用的每个 id 都存在', missing.length === 0, missing.join(', '));

  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dupes = all.filter((v, i) => all.indexOf(v) !== i);
  check('没有重复 id', dupes.length === 0, [...new Set(dupes)].join(', '));

  const htmlFor = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(m => m[1]);
  check('label 指向的控件都存在', htmlFor.every(f => htmlIds.has(f)), htmlFor.filter(f => !htmlIds.has(f)).join(', '));
}

console.log('\n=== 本地存储 ===');
{
  check('localStorage 键统一带 nav. 前缀，不与别的页冲突',
        /localStorage\.getItem\("nav\." \+ key\)/.test(html) &&
        /localStorage\.setItem\("nav\." \+ key/.test(html));
  const logical = [...new Set([...html.matchAll(/(?:load|save)\("([a-z]+)"/g)].map(m => m[1]))].sort();
  check('只用了 6 个逻辑键：clicks / density / folded / order / recent / stars',
        logical.join(',') === 'clicks,density,folded,order,recent,stars', logical.join(','));
  check('读写都包在 try/catch 里（隐私模式不炸）',
        (html.match(/try\s*\{[^}]*localStorage/g) || []).length >= 2);
  check('没有往 localStorage 存明文链接内容以外的敏感数据',
        !/localStorage[^;]*password|localStorage[^;]*token/i.test(html));
}

console.log('\n=== 功能点 ===');
{
  const must = [
    ['搜索输入框', /id="q"/],
    ['标签筛选条', /id="tagbar"/],
    ['分类折叠状态保存', /save\("folded"/],
    ['星标保存', /save\("stars"/],
    ['点击次数保存', /save\("clicks"/],
    ['三种视图（全部/星标/常用）', /data-view="all"[\s\S]*data-view="star"[\s\S]*data-view="top"/],
    ['快捷键 /', /e\.key === "\/"/],
    ['快捷键 Ctrl+K', /e\.key === "k" \|\| e\.key === "K"/],
    ['上下键选择', /ArrowDown/],
    ['回车打开', /e\.key === "Enter"/],
    ['Esc 清空', /e\.key === "Escape"/],
    ['导出 links.js', /serialize\(state\.data\)/],
    ['导入并提示是临时的', /刷新页面会恢复原样/],
    ['高亮命中词', /matchRanges/],
    ['卡片新窗口打开且带 noopener', /rel = "noopener noreferrer"/],
    ['空状态提示', /没有匹配的链接/],
    ['搜索框关掉拼写检查', /spellcheck="false"/],
    ['最近访问视图（第四个视图）', /data-view="recent"/],
    ['最近访问记录与去重', /function pushRecent/],
    ['桌面分类侧栏', /id="side"/],
    ['移动端分类横滑条', /id="catbar"/],
    ['分类筛选状态（cat）', /cat: state\.cat/],
    ['密度切换（紧凑/舒适）', /id="btnDensity"/],
    ['卡片复制链接按钮', /el\("span", "copy"/],
    ['复制提示对 URL 转义', /esc\(link\.url\)/],
    ['剪贴板 API + execCommand 兜底', /execCommand\("copy"\)/],
    ['回到顶部按钮', /id="btnTop"/],
    ['桌面/移动双端断点', /min-width:1024px/],
    ['favicon 服务端同源代理', /\/api\/favicon\?url=/],
    ['favicon 抓不到回落首字母图标', /addEventListener\("error", function\(\)\{ fv\.style\.display = "none"/],
    ['favicon 地址做了 URL 编码', /encodeURIComponent\(link\.url\)/],
    ['导出 Markdown 链接表', /id="btnExportMd"/],
    ['Markdown 导出是纯函数', /function toMarkdown/],
    ['搜索词在网址行也高亮', /highlighted\(C\.hostOf/],
    ['最近访问显示相对时间', /function relTime/],
    ['卡片悬停显示完整网址', /a\.title = link\.url/],
    ['链接带搜索关键词（进搜索索引）', /link\.keywords/],
    ['链接带提示词（进搜索索引 + 卡片小字）', /highlighted\(link\.tip, terms, "tip"\)/],
    ['分类可拖拽排序（纯函数 + 持久化）', /function applyOrder[\s\S]*function moveCategory/],
    ['分类标题可拖拽', /h\.draggable = true/],
    ['拖拽顺序存本地', /save\("order", ids\)/],
    ['启动时应用本地顺序', /state\.data = C\.applyOrder\(data, state\.order\)/],
  ];
  must.forEach(([name, re]) => check(`包含：${name}`, re.test(html)));

  /* 用户数据一律走 textContent，只有静态文案才用 innerHTML */
  const innerHtmlUses = [...html.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  const suspicious = innerHtmlUses.filter(v => /link\.|l\.name|l\.desc|state\.data|categories/.test(v));
  check('没有把链接数据塞进 innerHTML（防注入）', suspicious.length === 0, suspicious.join(' | '));
  check('导入报错信息做了转义', /esc\(err && err\.message/.test(html));
  check('卡片内容用 createElement / textContent 构建', /el\("a", "card"\)/.test(html));
}

console.log('\n=== 与站点其它页的一致性 ===');
{
  /* 导航栏必须和其他页面的结构、文字完全一致 */
  const nav = html.match(/<div class="navbar">[\s\S]*?<\/div>/);
  check('用的是全站统一的 .navbar 结构', !!nav);
  check('品牌名与其他页一致（.logo + 🧩 Eraser 的小站）',
        /<span class="logo">🧩 Eraser 的小站<\/span>/.test(html));
  check('菜单包在 <nav> 里（与其他页一致）', /<nav>[\s\S]*<\/nav>/.test(html));
  check('菜单文字与其他页一致（搜索）', /搜索<\/a>/.test(html));
  check('本页导航项标记为 active', /<a href="index\.html" class="active">导航<\/a>/.test(html));

  const expected = ['../index.html', '../search/index.html', '../tools/index.html',
                    '../blog/index.html', 'index.html', '../about/index.html'];
  check('六个分区链接齐全', expected.every(h => html.includes(`href="${h}"`)));

  /* 导航栏样式不应该在本页重复定义 */
  check('本页没有重复定义 .navbar 样式（交给 style.css）', !/\.navbar\s*\{/.test(html));

  check('主题色与全站一致（#2563eb）', html.includes('#2563eb'));
  check('页面标题正确', /<title>网址导航 · Eraser 小站<\/title>/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
