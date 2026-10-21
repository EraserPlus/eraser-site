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

console.log('\n=== 站主身份合并：公开页就地编辑 ===');
{
  const editable = ['nav/index.html', 'blog/index.html', 'blog/post.html',
                    'about/index.html', 'collect/index.html', 'learn/index.html'];
  for (const f of editable) {
    const html = read(f);
    check(`${f} 引入站主浮条样式`, /href="[^"]*owner\.css"/.test(html));
    check(`${f} 引入站主层与共享编辑器`,
          /src="[^"]*owner\.js"/.test(html) && /src="[^"]*admin\/content\.js"/.test(html));
    check(`${f} 用后台同一把令牌判断身份`, /Owner\.(hasToken|token)\(\)/.test(html));
    check(`${f} 编辑器请求走 Owner.api（自动带令牌）`,
          /ContentAdmin\.init\(\{\s*api:\s*Owner\.api/.test(html));
  }
  for (const f of ['index.html', 'tools/index.html']) {
    const html = read(f);
    check(`${f} 纯浏览页不加载站主编辑器`, !/owner\.(css|js)|admin\/content\.js/.test(html));
  }

  const owner = read('owner.js');
  check('owner.js 复用后台令牌键', /TOKEN_KEY = "eraser\.admin\.token"/.test(owner));
  check('没有令牌时不画编辑浮条', /if \(!hasToken\(\)\) \{[\s\S]*removeChild\(dock\)/.test(owner));
  check('401 时先清本地令牌再提示登录',
        /r\.status === 401[\s\S]*expire\(\)/.test(owner) && /setToken\(""\)/.test(owner));
  check('登录框不拼 innerHTML（密码与错误都走 textContent）', !/innerHTML\s*=/.test(owner));
  check('页面里没有写死密码或令牌',
        PAGES.every(f => !/(password|token)\s*[:=]\s*["'][^"']{8,}/i.test(read(f))));
}

console.log('\n=== 无障碍 / 分享 / 品牌一致性（M13）===');
for (const f of PAGES) {
  const html = read(f);
  check(`${f} 有 <main id="main"> 地标`, /<main[^>]*id="main"/.test(html));
  check(`${f} 有跳过导航的链接`, /<a class="skip-link" href="#main">/.test(html));
  check(`${f} 有 meta description`, /<meta name="description" content="[^"]{10,}"/.test(html));
  check(`${f} 有 og 分享卡片`,
        /property="og:title"/.test(html) && /property="og:image"/.test(html) &&
        /property="og:url" content="https:\/\/eraser\.de5\.net\//.test(html));
  check(`${f} 标题用统一品牌名「Eraser 的小站」`,
        /<title>[^<]*Eraser 的小站<\/title>/.test(html));
  check(`${f} 标题分隔符统一为 ·`, /<title>[^<]* · Eraser 的小站<\/title>/.test(html));
}
check('skip-link 样式在 style.css 里', /\.skip-link\s*\{/.test(read('style.css')));
check('sw.js 缓存版本号已升级到 v8', /VERSION = 'eraser-v8'/.test(read('sw.js')));
check('sw.js 预缓存站内播放器与工作台逻辑', /PRECACHE = \[[\s\S]*?'\/watch\.js'/.test(read('sw.js')) && /PRECACHE = \[[\s\S]*?'\/workbench\.js'/.test(read('sw.js')));
check('移动端顶栏：控件与品牌同排、导航整行下移',
      /@media \(max-width: 768px\)[\s\S]*?\.navbar nav\s*\{\s*order:\s*3;\s*flex-basis:\s*100%;/.test(read('style.css')));
check('孤儿页 files/ 已删除（T10 已下架）',
      !fs.existsSync(path.join(REPO, 'files/index.html')));
check('全站不再出现「Eraser 小站」这种少一个「的」的写法',
      PAGES.every(f => !/Eraser 小站/.test(read(f))));

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

  /* 阅读进度条：到底判定必须同时有「≤1px 容差」和「不足一屏视为读完」两条 */
  check('进度条用 data-progress 作唯一判定值', /data-progress/.test(html));
  check('距底 1px 内直接记 100%', /max - y <= 1 \? 1/.test(html));
  check('不足一屏视为读完并隐藏', /max <= 0 \? 1/.test(html) && /#readbar\[data-idle="1"\]/.test(html));
  check('平滑滚动停止后补算一次', /addEventListener\("scrollend"/.test(html));
  check('进度条对读屏隐藏（纯视觉）', /setAttribute\("aria-hidden", "true"\)/.test(html));

  /* 个人阅读便利 */
  check('字号调节持久化到本地', /eraser\.readSize/.test(html) && /--read-scale/.test(html));
  check('续读位置按文章 slug 保存', /eraser\.read\./.test(html) && /localStorage\.setItem\(posKey\(\)/.test(html));
  check('续读位置 30 天后失效', /30 \* 864e5/.test(html));
  check('标题锚点可复制小节链接', /a\.className = "hlink"/.test(html) && /小节链接/.test(html));
  check('图片放大用原生 dialog', /createElement\("dialog"\)/.test(html) && /showModal/.test(html));
  check('打印时隐藏导航、目录与按钮',
        /@media print/.test(html) && /\.navbar,\.skip-link,\.toc-side/.test(html));
  check('浮动按钮尊重减弱动态', /prefers-reduced-motion/.test(html) && /motionOK\(\)/.test(html));
  check('复制链接与打印入口都在元信息里', /复制链接/.test(html) && /window\.print\(\)/.test(html));
  check('阅读时长走共用 MD.stats（不再只按字数除 400）',
        /MD\.stats\(d\.content\)/.test(html) && !/Math\.round\(chars \/ 400\)/.test(html));
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
  check('名称用 textContent 渲染（防注入）', /el\("div", "nm", d\.name/.test(html));
  check('站外链接只放行 http(s)', /function safeUrl/.test(html));
  check('站外链接带 noopener', /noopener/.test(html));
  check('封面图加载失败有兜底（不空着）', /img\.addEventListener\("error"/.test(html) && /makeFallback/.test(html));

  // M11：仿 dudulu.moe 的海报墙改造
  check('海报网格（CSS Grid，不是单列列表）', /\.mg-grid\s*\{[\s\S]{0,140}?display: grid/.test(html));
  check('海报 3:4.1 竖版比例', /aspect-ratio:\s*3\s*\/\s*4\.1/.test(html));
  check('响应式列数（2 / 3 / 5 列）', /repeat\(2, minmax/.test(html) && /repeat\(3, minmax/.test(html) && /repeat\(5, minmax/.test(html));
  check('悬停海报放大', /\.mg-item:hover img\s*\{\s*transform:\s*scale\(1\.05\)/.test(html));
  check('右上角状态角标', /mg-tag t-/.test(html));
  check('左上角评分角标', /"mg-rate"/.test(html));
  check('底部渐变压名字', /"mg-mask"/.test(html) && /linear-gradient\(to top/.test(html));
  check('没封面时渐变兜底 + 首字', /function makeFallback/.test(html) && /function firstChar/.test(html));
  check('顶部统计条', /id="mgStats"/.test(html) && /function renderStats/.test(html));
  check('状态筛选条（纯前端过滤）', /id="mgFilters"/.test(html) && /function renderFilters/.test(html));
  check('筛选切换即时重渲染，不打接口', /filter = key;\s*\n\s*apply\(allItems\)/.test(html));
  check('筛选按钮带计数', /el\("span", "n", String\(counts\[key\]\)\)/.test(html));
  check('没内容时不显示空筛选按钮', /if \(key !== "all" && !counts\[key\]\) return/.test(html));
  check('主色沿用全站蓝（没有硬搬粉色）', !/#ff5c7c/.test(html) && /var\(--blue\)/.test(html));
  check('深浅色都处理了兜底块透明度', /html\[data-theme="dark"\] \.mg-fallback/.test(html));
  check(
    '筛选按钮权重压过全局暗色 button 规则（否则暗色下看不见）',
    /\.mg-filters\.mg-filters button \{/.test(html) &&
      !/^\s*\.mg-filters button \{/m.test(html)
  );
  check('暗色下收纳栏/次要统计不糊成禁用色', /html\[data-theme="dark"\] \.mg-fold/.test(html) && /html\[data-theme="dark"\] \.mg-stat\.mute b/.test(html));
  check('没有把数据拼进 innerHTML', !/innerHTML\s*=\s*[^"';]*d\.(name|note|cover|url)/.test(html));

  /* --- 前台快速添加（M12）：登录后才出现，访客看不到 --- */
  check('有「快速添加」按钮（默认隐藏）', /id="mgAdd"/.test(html) && /style="display:none"/.test(html));
  check('读的是后台同一把令牌钥匙', /eraser\.admin\.token/.test(html));
  check('没令牌就不显示按钮（静默）', /if \(!getToken\(\)\) return;/.test(html));
  check('按钮绑定在数据到手之后（不闪一下）', /setupQuickAdd\(\);\s*\/\* 数据到手后/.test(html));
  check('快速添加弹层用 DOM API 构建', /function openQuickAdd/.test(html) && /document\.createElement\("select"\)/.test(html));
  check('提交走需登录的 content 接口并带令牌', /Authorization: "Bearer " \+ t/.test(html) && /apiPost\("content"/.test(html));
  check('前台也能按名字补全（调按名字查接口）', /\/api\/content\?action=lookup&q=/.test(html));
  check('快速添加也做了转义（不拼 innerHTML）', !/innerHTML\s*=\s*[^"';]*(name|note|cover)/.test(html));

  /* --- 追更进度（M13）：看到第几集 + 一键 ＋1 --- */
  check('有进度解析函数 progressOf', /function progressOf/.test(html));
  check('进度条样式（.mg-prog / .track i）', /\.mg-prog \.track i/.test(html));
  check('有总集数才画进度条，否则只显示文字',
        /if \(pg\.pct != null\)/.test(html) && /text: "共 " \+ tot \+ " 话"/.test(html));
  check('「＋1 话」只在登录后且状态是在看时出现',
        /if \(canEdit && d\.status === "watching"\)/.test(html) && /classList\.add\("has-plus"\)/.test(html));
  check('＋1 走 PATCH 且带后台令牌',
        /function patchMedia[\s\S]*?method: "PATCH"/.test(html) &&
        /patchMedia\(it\.id, \{ progress: next, position: 0 \}\)/.test(html) &&
        /Authorization: "Bearer " \+ getToken\(\)/.test(html));
  check('＋1 成功后就地改数据重画（不整页刷新）',
        /d\.progress = next;/.test(html) && /apply\(allItems\);/.test(html));
  check('卡片是 <div> 容器 + 覆盖式链接层（button 不能嵌在 a 里）',
        /el\("div", "mg-item"\)/.test(html) && /"mg-hit"/.test(html));
  check('＋1 按钮压在链接层之上（否则点不到）',
        /\.mg-plus \{[\s\S]{0,200}?z-index: 4/.test(html));
  check('快速添加表单也能填总集数 / 进度', /epInput/.test(html) && /pgInput/.test(html));
  check('按名字补全会带出总集数', /if \(hit\.episodes != null\) epInput\.value/.test(html));

  /* --- M20 个人工作台：接着看 + 本周放送 --- */
  check('工作台脚本 workbench.js 在页内引入', /src="\.\.\/workbench\.js"/.test(html));
  check('顶栏有日期 / 问候，不是冷冰冰的标题', /id="wbDate"/.test(html) && /function renderHero/.test(html) && /Workbench\.greeting/.test(html));
  check('两栏工作台布局（桌面 1.55fr + 300px 侧栏）',
        /\.wb-grid\s*\{[\s\S]{0,120}?grid-template-columns:\s*minmax\(0, 1\.55fr\) minmax\(300px, \.9fr\)/.test(html));
  check('接着看面板有明确下一步动作', /function continueAction/.test(html) && /接着看|开看/.test(html));
  check('接着看只收在追 / 有进度的（逻辑在 workbench.js）', /Workbench\.continueList/.test(html));
  check('本周放送 7 个星期格 + 当天列表', /id="wbDays"/.test(html) && /id="wbAirList"/.test(html) && /function renderAir/.test(html));
  check('默认落在今天，可点别的天', /airDay == null\) airDay = today/.test(html) && /function \(\) \{\s*airDay = n;/.test(html));
  check('星期格带每天更新数', /Workbench\.dayCounts/.test(html) && /el\("span", "n"/.test(html));
  check('放送行显示时间 / 名称 / 下一话', /"wb-time"/.test(html) && /"wb-air-name"/.test(html) && /Workbench\.nextEpText/.test(html));
  check('空放送日有说明，不留白框', /今天没有安排放送/.test(html));
  check('快速添加能填更新日 / 更新时间', /daySel/.test(html) && /tmInput/.test(html) && /airday: daySel\.value/.test(html));
  check('点开播放器自动把「想看」转「在看」', /function markWatching/.test(html) && /d\.status !== "wish"/.test(html) && /status: "watching"/.test(html));
  check('工作台也走 textContent（不拼数据进 innerHTML）', !/innerHTML\s*=\s*[^"';]*d\.(name|note|cover|url)/.test(html));
  check('手机端工作台收紧间距', /@media \(max-width: 480px\)[\s\S]{0,240}?\.wb-panel\s*\{/.test(html));

  /* --- M21 漫画对等 + 放送表自动补全 --- */
  check('「接着追」同时覆盖番 / 漫', /接着追/.test(html) && /function renderCats/.test(html));
  check('漫画外链有「接着读 / 开读」主按钮', /"接着读"|"开读"/.test(html) && /d\.category === "comic"/.test(html));
  check('外链旁也有 ＋1（不用开表单）', /"wb-mini"/.test(html) && /\.wb-mini\.wb-mini/.test(html));
  check('点外链自动把「想看 / 想读」转「在看 / 在读」',
        /function markWatching/.test(html) && /silent: true, keepalive: true/.test(html));
  check('番 / 漫都有时出现栏目筛选（纯前端切换）',
        /id="wbCats"/.test(html) && /renderContinue\(allItems\);\s*\/\* 纯前端切换/.test(html));
  check('有「补全放送表」按钮与手动动作',
        /id="wbSync"/.test(html) && /function syncSchedules/.test(html) && /manual: true/.test(html));
  check('登录后每天最多自动补一次',
        /function autoSyncSchedules/.test(html) && /eraser\.airing\.sync/.test(html) && /todayStamp/.test(html));
  check('只补空字段，不覆盖手填',
        /function airingPatch/.test(html) && /!hasValue\(d\.airday\)/.test(html) && /!hasValue\(d\.airtime\)/.test(html));
  check('补全写入不改 updated_at（不打乱排序）',
        /touch: false/.test(html) && /opts\.touch === false/.test(html));
  check('只给 B 站番剧链接补全（漫画不瞎猜）',
        /function isBiliUrl/.test(html) && /d\.category !== "anime"/.test(html));
  check('说明里写清漫画 / 各站手填', /漫画和各站没有统一日历，手填一次即可/.test(html));
  check('暗色下补全按钮 / 栏目按钮 / ＋1 可读（双类名提权）',
        /html\[data-theme="dark"\] \.wb-sync\.wb-sync/.test(html) &&
        /html\[data-theme="dark"\] \.wb-cats\.wb-cats button/.test(html) &&
        /html\[data-theme="dark"\] \.wb-mini\.wb-mini/.test(html));

  /* --- M22 自动同步最新集数 / 新集提示 / 播完确认 --- */
  check('同步会补最新集数与完结状态', /patch\.latest = latest/.test(html) && /patch\.finished = true/.test(html));
  check('同步不写用户进度 / 状态', /function airingPatch/.test(html) &&
        !/patch\.progress/.test(html.slice(html.indexOf('function airingPatch'), html.indexOf('function updateSyncBtn'))) &&
        !/patch\.status/.test(html.slice(html.indexOf('function airingPatch'), html.indexOf('function updateSyncBtn'))));
  check('有新一话的卡片显示绿色「新 N」', /\.mg-prog \.fresh/.test(html) && /Workbench\.freshCount/.test(html));
  check('接着看行也标「新 N 话」', /\.wb-new/.test(html) && /"wb-new"/.test(html));
  check('封面图懒加载 + no-referrer', /referrerPolicy = "no-referrer"/.test(html) && /loading = "lazy"/.test(html));
  check('播放器有播完确认条（不自动记）', /\.watch-ended/.test(html) && /watch-ended/.test(read('watch.js')));
  check('同步说明写明最新集数 / 完结状态自动更新',
        /最新集数 \/ 完结状态每天自动同步/.test(html));
  check('已完结的番剧不再进本周放送（逻辑在 workbench.js）', /d\.finished !== true/.test(read('workbench.js')));
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
  check('M11 海报墙批次记录在', /M11/.test(html) && /dudulu/.test(html) && /mg-filters\.mg-filters button/.test(html));
  check('M11 的选择器笔误已在交接页更正', /后代选择器/.test(html) && !/\.mg-filters \.mg-filters button\s*\{/.test(html));
  check('M12 批量导入批次记录在', /M12/.test(html) && /batch=1/.test(html) && /action=lookup/.test(html) && /eraser\.admin\.token/.test(html));
  check('追更数据上游取舍写进了交接页', /AniList/.test(html) && /中文名搜不到/.test(html) && /api\.bgm\.tv/.test(html));
  check('测试套数已更新为十三套', /十三套/.test(html) && /outline_check/.test(html) && /media_import_test/.test(html) && /lookup_test/.test(html) && /watch_test/.test(html) && /workbench_test/.test(html) && /airing_test/.test(html));
  check('M14–M18 批次记录在', /M14/.test(html) && /M16/.test(html) && /M17/.test(html) && /M18/.test(html));
  check('M19 站内播放批次记录在', /M19/.test(html) && /watch\.js/.test(html) && /position/.test(html) && /B 站/.test(html));
  check('M20 工作台批次记录在', /M20/.test(html) && /workbench\.js/.test(html) && /airday/.test(html) && /接着看/.test(html) && /本周放送/.test(html));
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
