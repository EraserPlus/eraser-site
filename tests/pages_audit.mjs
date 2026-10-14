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
               'collect/index.html'];

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
