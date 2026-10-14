const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'nav', 'index.html'), 'utf8');

const S = '/* ===== NAV-CORE-START ===== */';
const E = '/* ===== NAV-CORE-END ===== */';
const a = HTML.indexOf(S), b = HTML.indexOf(E);
if (a < 0 || b < 0) { console.error('找不到 NAV-CORE 标记'); process.exit(1); }
const C = new Function(HTML.slice(a, b) + '\nreturn NavCore;')();

const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'nav', 'links.js'), 'utf8'))(win);
const DATA = win.NAV_DATA;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

console.log('=== 数据文件体检 ===');
{
  check('links.js 暴露了 NAV_DATA', !!(DATA && Array.isArray(DATA.categories)));
  const cats = DATA.categories;
  check(`有 ${cats.length} 个分类`, cats.length > 0);

  const ids = cats.map(c => c.id);
  check('分类 id 都不重复', new Set(ids).size === ids.length,
        ids.filter((v, i) => ids.indexOf(v) !== i).join(', '));
  check('分类 id 都非空', ids.every(id => typeof id === 'string' && id.length > 0));
  check('分类名称都非空', cats.every(c => c.name && c.name.length > 0));
  check('每个分类至少一条链接', cats.every(c => Array.isArray(c.links) && c.links.length > 0),
        cats.filter(c => !c.links || !c.links.length).map(c => c.id).join(', '));

  const links = C.allLinks(DATA);
  check(`共 ${links.length} 条链接`, links.length > 0);
  check('每条都有 name', links.every(l => l.name && String(l.name).trim().length > 0));
  check('每条都有 url', links.every(l => l.url && String(l.url).trim().length > 0));
  check('url 都以 http(s):// 开头',
        links.every(l => /^https?:\/\//.test(l.url)),
        links.filter(l => !/^https?:\/\//.test(l.url)).map(l => l.url).join(', '));
  check('url 都能被 URL 解析',
        links.every(l => { try { new URL(l.url); return true; } catch (e) { return false; } }),
        links.filter(l => { try { new URL(l.url); return false; } catch (e) { return true; } }).map(l => l.url).join(', '));
  check('url 没有重复', new Set(links.map(l => l.url)).size === links.length,
        links.map(l => l.url).filter((v, i, arr) => arr.indexOf(v) !== i).join(', '));
  check('tags 都是字符串数组',
        links.every(l => l.tags === undefined || (Array.isArray(l.tags) && l.tags.every(t => typeof t === 'string'))));
  check('名称没有首尾空格', links.every(l => l.name === l.name.trim()));
  check('标签没有首尾空格',
        links.every(l => (l.tags || []).every(t => t === t.trim() && t.length > 0)));
  check('每个分类都有 id 和 name 之外没有多余必填项', cats.every(c => 'links' in c));
}

console.log('\n=== 基础函数 ===');
{
  check('hostOf 去掉 www', C.hostOf('https://www.github.com/a/b') === 'github.com', C.hostOf('https://www.github.com/a/b'));
  check('hostOf 处理子域', C.hostOf('https://chat.deepseek.com/x') === 'chat.deepseek.com');
  check('hostOf 容忍非法 url', C.hostOf('not a url') === 'not a url', C.hostOf('not a url'));
  check('hostOf 容忍缺协议', C.hostOf('github.com/a') === 'github.com', C.hostOf('github.com/a'));
  check('hostOf 容忍空值', C.hostOf(null) === '');

  check('initialOf 取首字母大写', C.initialOf('github') === 'G');
  check('initialOf 中文取首字', C.initialOf('百度') === '百');
  check('initialOf 空值兜底', C.initialOf('') === '?');
  check('initialOf 忽略前导空格', C.initialOf('  abc') === 'A');

  const h1 = C.hueOf('GitHub'), h2 = C.hueOf('GitHub'), h3 = C.hueOf('百度');
  check('hueOf 稳定', h1 === h2);
  check('hueOf 落在 0-359', [h1, h3].every(h => h >= 0 && h < 360), `${h1}, ${h3}`);
  check('hueOf 不同名称给出不同色相', h1 !== h3);
}

console.log('\n=== 查询解析与匹配 ===');
{
  check('parseQuery 拆空格', JSON.stringify(C.parseQuery('a b')) === '["a","b"]');
  check('parseQuery 去多余空格', JSON.stringify(C.parseQuery('  a   b  ')) === '["a","b"]');
  check('parseQuery 空串给空数组', C.parseQuery('').length === 0);

  const gh = { name: 'GitHub', url: 'https://github.com', desc: '代码仓库', tags: ['代码', '英文'] };
  check('空查询全部命中', C.matchesQuery(gh, []));
  check('命中名称', C.matchesQuery(gh, ['github']));
  check('命中大小写不敏感', C.matchesQuery(gh, ['GITHUB']));
  check('命中描述', C.matchesQuery(gh, ['代码']));
  check('命中标签', C.matchesQuery(gh, ['英文']));
  check('命中网址', C.matchesQuery(gh, ['github.com']));
  check('多词是 AND', C.matchesQuery(gh, ['github', '代码']));
  check('多词有一项不中就不中', !C.matchesQuery(gh, ['github', '不存在']));
  check('完全不中', !C.matchesQuery(gh, ['zzzz']));

  check('标签空数组放行', C.matchesTags(gh, []));
  check('标签全中才通过', C.matchesTags(gh, ['代码', '英文']));
  check('标签缺一不通过', !C.matchesTags(gh, ['代码', '不存在']));
  check('链接没标签时被标签筛掉', !C.matchesTags({ name: 'x', url: 'y' }, ['代码']));

  /* 搜索关键词（后台设置的别名）：名称不中，关键词中也要能搜到 */
  const aliased = { name: 'Bilibili', url: 'https://bilibili.com', desc: '视频', tags: ['视频'], keywords: ['B站', '哔哩哔哩'] };
  check('命中搜索关键词（中文别名）', C.matchesQuery(aliased, ['b站']));
  check('命中搜索关键词（全称别名）', C.matchesQuery(aliased, ['哔哩哔哩']));
  check('关键词也进 haystack', C.haystack(aliased, '').indexOf('b站') !== -1);
  const tipped = { name: 'Bilibili', url: 'https://bilibili.com', tip: '备用入口' };
  check('命中提示词也能搜到', C.matchesQuery(tipped, ['备用入口']));
  check('提示词也进 haystack', C.haystack(tipped, '').indexOf('备用入口') !== -1);
  check('没关键词的老链接不受影响', C.matchesQuery({ name: 'x', url: 'https://x.com' }, ['x']));
}

console.log('\n=== 分类过滤 ===');
{
  const data = {
    categories: [
      { id: 'a', name: '甲', links: [
        { name: 'One', url: 'https://one.com', desc: 'first', tags: ['t1'] },
        { name: 'Two', url: 'https://two.com', desc: 'second', tags: ['t2'] }
      ]},
      { id: 'b', name: '乙', links: [
        { name: 'Three', url: 'https://three.com', desc: 'third', tags: ['t1', 't2'] }
      ]},
      { id: 'c', name: '丙', links: [
        { name: 'Four', url: 'https://four.com', desc: 'fourth', tags: [] }
      ]}
    ]
  };

  let r = C.filterCategories(data, {});
  check('无筛选返回全部 3 个分类', r.length === 3, String(r.length));
  check('无筛选返回全部 4 条', r.reduce((n, c) => n + c.links.length, 0) === 4);

  r = C.filterCategories(data, { query: 't1' });
  check('按标签文字搜索命中 2 个分类', r.length === 2, String(r.length));
  check('空分类被丢掉', r.every(c => c.links.length > 0));

  r = C.filterCategories(data, { query: 'zzz' });
  check('搜不到时返回空数组', r.length === 0);

  r = C.filterCategories(data, { tags: ['t1'] });
  check('标签筛选 t1 命中 2 条', r.reduce((n, c) => n + c.links.length, 0) === 2);

  r = C.filterCategories(data, { tags: ['t1', 't2'] });
  check('两个标签是 AND，只命中 1 条', r.reduce((n, c) => n + c.links.length, 0) === 1);

  r = C.filterCategories(data, { view: 'star', stars: ['https://two.com'] });
  check('星标视图只留星标过的', r.length === 1 && r[0].links[0].url === 'https://two.com');

  r = C.filterCategories(data, { view: 'star', stars: [] });
  check('没有星标时星标视图为空', r.length === 0);

  const clicks = { 'https://four.com': 1, 'https://two.com': 9, 'https://one.com': 4 };
  r = C.filterCategories(data, { view: 'top', clicks });
  check('常用视图只留点过的', r.reduce((n, c) => n + c.links.length, 0) === 3);
  check('常用视图按次数降序', r[0].links[0].url === 'https://two.com', r[0].links[0].url);
  check('常用视图跨分类排序', r[0].links.map(l => l.url).join() === 'https://two.com,https://one.com',
        r[0].links.map(l => l.url).join());

  r = C.filterCategories(data, { view: 'top', clicks: {} });
  check('没有点击记录时常用视图为空', r.length === 0);

  r = C.filterCategories(data, { query: 'three', tags: ['t1'] });
  check('搜索 + 标签可以叠加', r.length === 1 && r[0].links.length === 1);

  check('数据为空时不炸', C.filterCategories({ categories: [] }, {}).length === 0);
  check('数据为 null 时不炸', C.filterCategories(null, {}).length === 0);
}

console.log('\n=== 标签收集 ===');
{
  const data = { categories: [
    { id: 'a', name: '甲', links: [
      { name: 'x', url: 'u1', tags: ['常用', '中文'] },
      { name: 'y', url: 'u2', tags: ['常用'] },
      { name: 'z', url: 'u3', tags: ['中文'] }
    ]}
  ]};
  const tags = C.collectTags(data);
  check('标签去重', tags.length === 2, JSON.stringify(tags));
  check('按出现次数降序', tags[0].tag === '常用' && tags[0].count === 2, JSON.stringify(tags));
  check('次数统计正确', tags[1].count === 2 || tags[1].count === 1);
  check('无标签时返回空数组', C.collectTags({ categories: [{ id: 'a', name: 'a', links: [{ name: 'x', url: 'u' }] }] }).length === 0);
}

console.log('\n=== 高亮区间 ===');
{
  let r = C.matchRanges('GitHub', ['git']);
  check('单个命中', r.length === 1 && r[0].start === 0 && r[0].end === 3, JSON.stringify(r));

  r = C.matchRanges('abcXabc', ['abc']);
  check('不相邻的多处命中都找到', r.length === 2 && r[0].start === 0 && r[1].start === 4, JSON.stringify(r));

  r = C.matchRanges('abcabc', ['abc']);
  check('相邻命中合并成一段（视觉上等价）', r.length === 1 && r[0].end === 6, JSON.stringify(r));

  r = C.matchRanges('abcabc', ['abc', 'bc']);
  check('重叠区间被合并', r.length === 1 && r[0].start === 0 && r[0].end === 6, JSON.stringify(r));

  r = C.matchRanges('hello', ['l', 'll']);
  check('相邻重叠合并成一个', r.length === 1 && r[0].start === 2 && r[0].end === 4, JSON.stringify(r));

  check('没有命中返回空', C.matchRanges('hello', ['zzz']).length === 0);
  check('空查询返回空', C.matchRanges('hello', []).length === 0);
  check('空文本不炸', C.matchRanges('', ['a']).length === 0);
  check('null 文本不炸', C.matchRanges(null, ['a']).length === 0);

  /* 大小写转换改变长度时应放弃高亮，避免错位 */
  const weird = '\u0130stanbul';
  check('长度会变的字符放弃高亮', C.matchRanges(weird, ['stanbul']).length === 0);
  check('普通中文正常高亮', C.matchRanges('百度搜索', ['搜索'])[0].start === 2);
}

console.log('\n=== 导出 / 导入往返 ===');
{
  const text = C.serialize(DATA);
  check('导出以 window.NAV_DATA 开头', text.startsWith('window.NAV_DATA = '));
  check('导出是合法 JSON 负载', (() => {
    try { C.parseImport(text); return true; } catch (e) { return false; }
  })());

  const back = C.parseImport(text);
  check('导出再导入，分类数一致', back.categories.length === DATA.categories.length);
  check('导出再导入，链接数一致', C.countLinks(back) === C.countLinks(DATA));
  check('导出再导入，内容完全一致', JSON.stringify(back) === JSON.stringify(DATA));

  check('纯 JSON 也能导入', C.parseImport(JSON.stringify(DATA)).categories.length === DATA.categories.length);

  let err1 = null;
  try { C.parseImport('{"nope":1}'); } catch (e) { err1 = e.message; }
  check('缺少 categories 时报错', !!err1, String(err1));

  let err2 = null;
  try { C.parseImport('{"categories":[{"id":"a","name":"a"}]}'); } catch (e) { err2 = e.message; }
  check('分类缺 links 时报错', !!err2, String(err2));

  let err3 = null;
  try { C.parseImport('这不是 json'); } catch (e) { err3 = e.message; }
  check('非 JSON 文本报错', !!err3);

  /* 导出文件带中文，必须原样还原 */
  check('中文标签往返不乱码', C.parseImport(C.serialize(DATA)).categories[0].links[0].tags.length > 0);
}

/* 回归：links.js 原文是手写的 JS 对象 literal（键名不带引号），不是合法 JSON。
   历史上后台「从现有 links.js 导入」用 JSON.parse 直接解析它，必挂
   （Expected property name or '}'）——这里锁定 parseImport 必须能吃原始格式。 */
console.log('\n=== parseImport 兼容 links.js 原始格式 ===');
{
  const raw = fs.readFileSync(path.join(ROOT, 'nav', 'links.js'), 'utf8');

  let rawData = null, rawErr = null;
  try { rawData = C.parseImport(raw); } catch (e) { rawErr = e.message; }
  check('parseImport 能解析 links.js 原文（无引号键名）', !!rawData, String(rawErr));
  check('解析 links.js 原文得 11 个分类',
        !!rawData && rawData.categories.length === DATA.categories.length,
        rawData ? String(rawData.categories.length) : String(rawErr));
  check('解析 links.js 原文得 34 条链接',
        !!rawData && C.countLinks(rawData) === C.countLinks(DATA),
        rawData ? String(C.countLinks(rawData)) : String(rawErr));
  check('解析 links.js 原文的内容与 <script> 加载一致',
        !!rawData && JSON.stringify(rawData) === JSON.stringify(DATA));

  check('内联无引号键名文本也能导入',
        C.parseImport('window.NAV_DATA = {categories:[{id:"a",name:"A",links:[]}]};').categories.length === 1);

  let err4 = null;
  try { C.parseImport('not a links file'); } catch (e) { err4 = e.message; }
  check('非 links 文件文本报错', !!err4, String(err4));
}

console.log('\n=== 真实数据跑一遍所有视图 ===');
{
  const total = C.countLinks(DATA);
  check(`全部视图显示 ${total} 条`,
        C.filterCategories(DATA, {}).reduce((n, c) => n + c.links.length, 0) === total);

  const tags = C.collectTags(DATA);
  check(`收集到 ${tags.length} 个标签`, tags.length > 0);

  /* 每个标签单独筛一次，不能报错、不能筛出空 */
  let bad = null;
  tags.forEach(t => {
    const r = C.filterCategories(DATA, { tags: [t.tag] });
    if (!r.length) bad = t.tag;
  });
  check('每个标签都能筛出结果', bad === null, String(bad));

  /* 模拟一次点击，验证常用视图 */
  const first = C.allLinks(DATA)[0];
  const clicks = {}; clicks[first.url] = 3;
  const top = C.filterCategories(DATA, { view: 'top', clicks });
  check('常用视图能取到点击过的站点', top.length === 1 && top[0].links[0].url === first.url);

  /* 每个分类名都能搜到（分类名也进了搜索索引）。
     注意：其他分类里的链接如果说明/标签里也有这个词，一并命中是正确行为。 */
  let miss = null;
  DATA.categories.forEach(c => {
    const r = C.filterCategories(DATA, { query: c.name });
    const hit = r.filter(x => x.id === c.id)[0];
    if (!hit) miss = c.name;
    else if (hit.links.length !== c.links.length) miss = c.name + ' (条数不全)';
  });
  check('每个分类名都能搜到，且该分类下链接齐全', miss === null, String(miss));

  /* 分类名不该把别的分类也带出来 */
  const fun = C.filterCategories(DATA, { query: '娱乐' });
  check('搜「娱乐」只返回娱乐分类', fun.length === 1 && fun[0].id === 'fun', JSON.stringify(fun.map(c => c.id)));
}

console.log('\n=== 分类筛选（桌面侧栏 / 移动横滑条共用） ===');
{
  const data = {
    categories: [
      { id: 'a', name: '甲', links: [
        { name: 'One', url: 'https://one.com', desc: 'first', tags: ['t1'] },
        { name: 'Two', url: 'https://two.com', desc: 'second', tags: ['t2'] }
      ]},
      { id: 'b', name: '乙', links: [
        { name: 'Three', url: 'https://three.com', desc: 'third', tags: ['t1', 't2'] }
      ]},
      { id: 'c', name: '丙', links: [
        { name: 'Four', url: 'https://four.com', desc: 'fourth', tags: [] }
      ]}
    ]
  };

  let r = C.filterCategories(data, { cat: 'a' });
  check('按分类筛选只留该分类', r.length === 1 && r[0].id === 'a' && r[0].links.length === 2,
        JSON.stringify(r.map(c => c.id)));
  check('分类按钮点第二下等于取消（由界面层处理），这里只验证 id 过滤',
        C.filterCategories(data, { cat: 'zzz' }).length === 0);
  check('不传 cat 返回全部分类', C.filterCategories(data, {}).length === 3);
  check('cat 与搜索叠加', (() => {
    const x = C.filterCategories(data, { cat: 'a', query: 'one' });
    return x.length === 1 && x[0].links.length === 1;
  })());
  check('cat 与标签叠加', (() => {
    const x = C.filterCategories(data, { cat: 'b', tags: ['t1'] });
    return x.length === 1 && x[0].links.length === 1;
  })());
}

console.log('\n=== 最近访问 ===');
{
  const data = {
    categories: [
      { id: 'a', name: '甲', links: [
        { name: 'One', url: 'https://one.com' },
        { name: 'Two', url: 'https://two.com' }
      ]},
      { id: 'b', name: '乙', links: [
        { name: 'Three', url: 'https://three.com' }
      ]}
    ]
  };
  const recents = [
    { url: 'https://one.com', t: 100 },
    { url: 'https://three.com', t: 300 },
    { url: 'https://two.com', t: 200 },
    { url: 'https://one.com', t: 400 }   // 同一 url 再次访问：只留一次，时间为新时间
  ];

  const list = C.recentLinks(data, recents);
  check('recentLinks 按时间倒序',
        list.map(l => l.url).join() === 'https://one.com,https://three.com,https://two.com',
        list.map(l => l.url).join());
  check('recentLinks 去重', list.length === 3, String(list.length));
  check('recentLinks 忽略数据里不存在的 url',
        C.recentLinks(data, [{ url: 'https://nope.com', t: 1 }]).length === 0);
  check('recentLinks 容忍空值和坏记录',
        C.recentLinks(data, null).length === 0 && C.recentLinks(data, [null, {}, { t: 5 }]).length === 0);
  check('recentLinks limit 生效', C.recentLinks(data, recents, 1).length === 1);

  let r = C.filterCategories(data, { view: 'recent', recents });
  check('最近视图跨分类返回', r.length === 2, JSON.stringify(r.map(c => c.id)));
  check('最近视图组内也按时间倒序',
        r.filter(c => c.id === 'a')[0].links.map(l => l.url).join() === 'https://one.com,https://two.com',
        JSON.stringify(r.filter(c => c.id === 'a')[0].links.map(l => l.url)));
  check('没有访问记录时最近视图为空', C.filterCategories(data, { view: 'recent', recents: [] }).length === 0);
  check('不传 recents 不炸', C.filterCategories(data, { view: 'recent' }).length === 0);
  check('recentLimit 限制展示总数', (() => {
    const x = C.filterCategories(data, { view: 'recent', recents, recentLimit: 2 });
    return x.reduce((n, c) => n + c.links.length, 0) === 2;
  })());
  check('最近视图 + 分类筛选叠加', (() => {
    const x = C.filterCategories(data, { view: 'recent', recents, cat: 'a' });
    return x.length === 1 && x[0].id === 'a' && x[0].links.length === 2;
  })());
  check('最近视图 + 搜索叠加', (() => {
    const x = C.filterCategories(data, { view: 'recent', recents, query: 'three' });
    return x.length === 1 && x[0].id === 'b';
  })());
}

console.log('\n=== 相对时间 ===');
{
  const now = 1700000000000;   // 2023-11-14 22:13:20 UTC
  check('一分钟内是刚刚', C.relTime(now - 30000, now) === '刚刚');
  check('N 分钟前', C.relTime(now - 5 * 60000, now) === '5 分钟前');
  check('59 分钟还是分钟前', C.relTime(now - 59 * 60000, now) === '59 分钟前');
  check('N 小时前', C.relTime(now - 3 * 3600000, now) === '3 小时前');
  check('N 天前', C.relTime(now - 2 * 86400000, now) === '2 天前');
  check('超过一周给 MM-DD', /^\d{1,2}-\d{2}$/.test(C.relTime(now - 30 * 86400000, now)));
  check('未来时间不回负', C.relTime(now + 999999, now) === '刚刚');
  check('空值不炸（按很早以前处理）', typeof C.relTime(null, now) === 'string');
  check('0 不炸', typeof C.relTime(0, now) === 'string');
}

console.log('\n=== 导出 Markdown ===');
{
  const data = { categories: [
    { id: 'a', name: '甲', links: [
      { name: 'One', url: 'https://one.com', desc: '第一个' },
      { name: 'Two', url: 'https://two.com' }
    ]}
  ]};
  const md = C.toMarkdown(data);
  check('以 # 网址导航 开头', md.indexOf('# 网址导航') === 0);
  check('分类是二级标题', md.indexOf('## 甲') !== -1);
  check('链接是 [name](url) 格式', md.indexOf('- [One](https://one.com)') !== -1);
  check('有描述的带上描述', md.indexOf('- [One](https://one.com) — 第一个') !== -1);
  check('没描述的不带破折号',
        md.indexOf('- [Two](https://two.com)') !== -1 && md.indexOf('- [Two](https://two.com) —') === -1);
  check('空数据也生成标题', C.toMarkdown({ categories: [] }).indexOf('# 网址导航') === 0);
  check('null 不炸', C.toMarkdown(null).indexOf('# 网址导航') === 0);
  check('真实数据的每条链接都在', (() => {
    const mdAll = C.toMarkdown(DATA);
    return C.allLinks(DATA).every(l => mdAll.indexOf('](' + l.url + ')') !== -1);
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
