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
               'search/index.html', 'about/index.html', 'tools/index.html'];

console.log('=== 所有页面（7 个）：结构与语法 ===');for (const f of PAGES) {
  const html = read(f);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let ok = true, err = '';
  for (const s of scripts) {
    try { new Function(s); } catch (e) { ok = false; err = e.message; }
  }
  check(`${f} 内联脚本语法正确（${scripts.length} 段）`, ok, err);
}

console.log('\n=== 所有页面（7 个）：零站外资源 ===');
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

console.log('\n=== 所有页面（7 个）：只请求同源接口 ===');
for (const f of PAGES) {
  const html = read(f);
  const fetches = [...html.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map(m => m[1]);
  const bad = fetches.filter(u => !u.startsWith('/'));
  check(`${f} 的 fetch 都是同源路径（${fetches.length} 处）`, bad.length === 0, bad.join(', '));
  const other = [...html.matchAll(/\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/g)];
  check(`${f} 没有用其它网络 API`, other.length === 0, other.map(m => m[1]).join(', '));
}

console.log('\n=== 所有页面（7 个）：导航栏统一 ===');
for (const f of PAGES) {
  const html = read(f);
  check(`${f} 品牌名统一`, /<span class="logo">🧩 Eraser 的小站<\/span>/.test(html));
  check(`${f} 菜单含「搜索」`, /搜索<\/a>/.test(html));
  check(`${f} 引用全站 style.css`, /<link[^>]*href="[^"]*style\.css"/.test(html));
  check(`${f} 标了当前页 active`, /class="active"/.test(html));
}

console.log('\n=== 静态兜底：接口挂了也不能白屏 ===');
{
  const cases = [
    ['nav/index.html', /applyData\(window\.NAV_DATA\)/, '先渲染 links.js'],
    ['blog/index.html', /id="list"/, '列表有静态内容'],
    ['about/index.html', /id="article"/, '正文有静态内容'],
    ['index.html', /id="welcomeTitle"/, '欢迎语有静态内容'],
    ['search/index.html', /id="q"/, '搜索框'],
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
    ['index.html', /p\.innerHTML\s*=\s*MD\.render/],
  ];
  for (const [f, re] of uses) {
    check(`${f} 用 MD.render 渲染（内部会先转义）`, re.test(read(f)));
  }
  for (const f of ['blog/post.html', 'about/index.html', 'index.html']) {
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

console.log('\n=== 搜索页 ===');
{
  const html = read('search/index.html');
  check('从网址读 q 参数', /decodeURIComponent/.test(html));
  check('搜索请求走同源 /api/search', /fetch\("\/api\/search\?q="/.test(html));
  check('没搜词时显示静态引导（不白屏）', /showIdle/.test(html) && /输入关键词，回车开始搜索/.test(html));
  check('接口失败给可读提示且保留页面', /搜索服务开小差了/.test(html));
  check('命中词高亮用 DOM 节点', /el\("mark"/.test(html));
  check('站外结果新窗口打开且带 noopener', /rel = "noopener noreferrer"/.test(html));
  check('结果标题/描述用 textContent 拼（防注入）', /el\("div", "t"\)/.test(html) && /el\("div", "d"\)/.test(html));
}

console.log('\n=== 首页 ===');
{
  const html = read('index.html');
  check('欢迎语有 id 可被替换', /id="welcomeTitle"/.test(html) && /id="welcomeText"/.test(html));
  check('四个分区卡片都在', (html.match(/class="card"/g) || []).length === 4);
  check('读取的是 home 这个页面标识', /"home"/.test(html));
}

console.log('\n=== 关于页 ===');
{
  const html = read('about/index.html');
  check('读取的是 about 这个页面标识', /"about"/.test(html));
  check('标题会跟着变', /document\.title = page\.data\.title/.test(html));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
