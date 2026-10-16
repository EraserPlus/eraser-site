import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const C = await load('api/_lib/content.js');

console.log('=== 类型识别 ===');
{
  check('nav_category 是已知类型', C.knownType('nav_category'));
  check('nav_link 是已知类型', C.knownType('nav_link'));
  check('post 是已知类型', C.knownType('post'));
  check('file 是已知类型', C.knownType('file'));
  check('page 是已知类型', C.knownType('page'));
  check('media 是已知类型（追更）', C.knownType('media'));
  check('未知类型不被认', !C.knownType('hack'));
  check('原型链上的属性不算已知类型', !C.knownType('constructor') && !C.knownType('toString'));
  check('只有 nav_link 需要父分类',
        C.needsParent('nav_link') && !C.needsParent('nav_category') && !C.needsParent('post'));
}

console.log('\n=== nav_category ===');
{
  check('正常通过', C.normalize('nav_category', { name: '常用' }).name === '常用');
  check('去首尾空格', C.normalize('nav_category', { name: '  常用  ' }).name === '常用');
  check('空名字报错', code(() => C.normalize('nav_category', { name: '' })) === 'BAD_INPUT');
  check('缺名字报错', code(() => C.normalize('nav_category', {})) === 'BAD_INPUT');
  check('超长报错', code(() => C.normalize('nav_category', { name: 'x'.repeat(51) })) === 'BAD_INPUT');
  check('只保留白名单字段（多传的字段被丢掉）',
        !('evil' in C.normalize('nav_category', { name: 'a', evil: 1 })));
}

console.log('\n=== nav_link ===');
{
  const r = C.normalize('nav_link', { name: 'GitHub', url: 'https://github.com', desc: '代码', tags: ['代码'] });
  check('正常通过', r.name === 'GitHub' && r.url === 'https://github.com');
  check('说明可省略', C.normalize('nav_link', { name: 'a', url: 'https://a.com' }).desc === null);
  check('http 也接受', C.normalize('nav_link', { name: 'a', url: 'http://a.com' }).url === 'http://a.com');
  check('缺协议报错', code(() => C.normalize('nav_link', { name: 'a', url: 'github.com' })) === 'BAD_INPUT');
  check('javascript: 伪协议被拒', code(() => C.normalize('nav_link', { name: 'a', url: 'javascript:alert(1)' })) === 'BAD_INPUT');
  check('data: 伪协议被拒', code(() => C.normalize('nav_link', { name: 'a', url: 'data:text/html,x' })) === 'BAD_INPUT');
  check('非法网址报错', code(() => C.normalize('nav_link', { name: 'a', url: 'https://' })) === 'BAD_INPUT');

  const t1 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', tags: ['x', 'y', 'x'] });
  check('标签去重', JSON.stringify(t1.tags) === '["x","y"]', JSON.stringify(t1.tags));
  const t2 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', tags: 'x, y，z' });
  check('标签支持逗号分隔字符串（中英文逗号都行）', JSON.stringify(t2.tags) === '["x","y","z"]', JSON.stringify(t2.tags));
  check('不传标签给空数组', JSON.stringify(C.normalize('nav_link', { name: 'a', url: 'https://a.com' }).tags) === '[]');
  const t3 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', tags: Array(30).fill(0).map((_, i) => 't' + i) });
  check('标签最多 20 个', t3.tags.length === 20, String(t3.tags.length));
  const t4 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', tags: ['  x  ', '', '  '] });
  check('空标签被丢掉、标签去空格', JSON.stringify(t4.tags) === '["x"]', JSON.stringify(t4.tags));

  const k1 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', keywords: ['git', 'github', 'git'] });
  check('关键词去重', JSON.stringify(k1.keywords) === '["git","github"]', JSON.stringify(k1.keywords));
  const k2 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', keywords: 'git, 代码托管，hub' });
  check('关键词支持逗号分隔字符串（中英文逗号都行）', JSON.stringify(k2.keywords) === '["git","代码托管","hub"]', JSON.stringify(k2.keywords));
  check('不传关键词给空数组', JSON.stringify(C.normalize('nav_link', { name: 'a', url: 'https://a.com' }).keywords) === '[]');

  check('不传提示词给 null', C.normalize('nav_link', { name: 'a', url: 'https://a.com' }).tip === null);
  check('提示词原样保留', C.normalize('nav_link', { name: 'a', url: 'https://a.com', tip: '备用入口' }).tip === '备用入口');
  check('提示词去首尾空格', C.normalize('nav_link', { name: 'a', url: 'https://a.com', tip: '  备用  ' }).tip === '备用');
  check('提示词超长报错', code(() => C.normalize('nav_link', { name: 'a', url: 'https://a.com', tip: 'x'.repeat(201) })) === 'BAD_INPUT');
  const k3 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', keywords: Array(30).fill(0).map((_, i) => 'k' + i) });
  check('关键词最多 20 个', k3.keywords.length === 20, String(k3.keywords.length));
  const k4 = C.normalize('nav_link', { name: 'a', url: 'https://a.com', keywords: ['  x  ', '', '  '] });
  check('空关键词被丢掉、去空格', JSON.stringify(k4.keywords) === '["x"]', JSON.stringify(k4.keywords));
}

console.log('\n=== post ===');
{
  const r = C.normalize('post', { slug: 'Hello World', title: '标题', content: '正文' });
  check('slug 转小写并去空格', r.slug === 'hello-world', r.slug);
  check('中文 slug 保留', C.normalize('post', { slug: '我的第一篇', title: 't', content: 'c' }).slug === '我的第一篇');
  check('特殊字符转成连字符', C.normalize('post', { slug: 'a/b?c=d' , title: 't', content: 'c' }).slug === 'a-b-c-d',
        C.normalize('post', { slug: 'a/b?c=d', title: 't', content: 'c' }).slug);
  check('published 默认 true', C.normalize('post', { slug: 'a', title: 't', content: 'c' }).published === true);
  check('published 可为 false', C.normalize('post', { slug: 'a', title: 't', content: 'c', published: false }).published === false);
  check('缺正文报错', code(() => C.normalize('post', { slug: 'a', title: 't' })) === 'BAD_INPUT');
  check('缺 slug 报错', code(() => C.normalize('post', { title: 't', content: 'c' })) === 'BAD_INPUT');
  check('slug 全是特殊字符时报错', code(() => C.normalize('post', { slug: '///', title: 't', content: 'c' })) === 'BAD_INPUT');
}

console.log('\n=== file / page ===');
{
  check('file 正常通过', C.normalize('file', { name: 'a.zip', url: 'a.zip' }).name === 'a.zip');
  check('file 的 url 允许相对路径', C.normalize('file', { name: 'a', url: 'files/a.zip' }).url === 'files/a.zip');
  check('file 缺 url 报错', code(() => C.normalize('file', { name: 'a' })) === 'BAD_INPUT');

  check('page 正常通过', C.normalize('page', { key: 'about', title: '关于', content: 'x' }).key === 'about');
  check('page key 转小写', C.normalize('page', { key: 'ABOUT', title: 't', content: 'x' }).key === 'about');
  check('page key 过滤非法字符', C.normalize('page', { key: 'a b/c!', title: 't', content: 'x' }).key === 'abc',
        C.normalize('page', { key: 'a b/c!', title: 't', content: 'x' }).key);
  check('page key 全非法时报错', code(() => C.normalize('page', { key: '!!!', title: 't', content: 'x' })) === 'BAD_INPUT');
}

console.log('\n=== media（追更）===');
{
  const base = { category: 'anime', name: '葬送的芙莉莲', status: 'watching' };
  const r = C.normalize('media', base);
  check('正常通过', r.category === 'anime' && r.name === '葬送的芙莉莲' && r.status === 'watching');
  check('评分/备注/日期/链接/封面可留空',
        r.score === null && r.note === null && r.date === null && r.url === null && r.cover === null);
  check('名称去首尾空格', C.normalize('media', { ...base, name: '  x  ' }).name === 'x');
  check('缺名称报错', code(() => C.normalize('media', { category: 'anime', status: 'wish' })) === 'BAD_INPUT');
  check('栏目只能是追番/漫画', code(() => C.normalize('media', { ...base, category: 'book' })) === 'BAD_INPUT');
  check('状态只能是四种之一', code(() => C.normalize('media', { ...base, status: 'watched' })) === 'BAD_INPUT');
  check('四种状态都通过',
        ['wish', 'watching', 'finished', 'paused'].every(s => C.normalize('media', { ...base, status: s }).status === s));
  check('漫画栏目通过', C.normalize('media', { ...base, category: 'comic' }).category === 'comic');
  check('评分接受数字字符串', C.normalize('media', { ...base, score: '9.0' }).score === 9);
  check('评分接受数字', C.normalize('media', { ...base, score: 8.5 }).score === 8.5);
  check('评分最多保留一位小数', C.normalize('media', { ...base, score: 8.47 }).score === 8.5);
  check('评分空串等于不评分', C.normalize('media', { ...base, score: '' }).score === null);
  check('评分为 0 合法', C.normalize('media', { ...base, score: 0 }).score === 0);
  check('满分 10 合法', C.normalize('media', { ...base, score: 10 }).score === 10);
  check('评分超上限报错', code(() => C.normalize('media', { ...base, score: 10.5 })) === 'BAD_INPUT');
  check('评分负数报错', code(() => C.normalize('media', { ...base, score: -1 })) === 'BAD_INPUT');
  check('评分非数字报错', code(() => C.normalize('media', { ...base, score: 'abc' })) === 'BAD_INPUT');
  check('备注/日期/链接/封面正常保留',
        C.normalize('media', { ...base, note: '周五更新', date: '2026-10-14', url: 'https://bgm.tv/subject/1', cover: 'https://x.com/c.jpg' }).note === '周五更新');
  check('多传字段被丢掉', !('evil' in C.normalize('media', { ...base, evil: 1 })));

  /* 进度（M13）：episodes = 总集数，progress = 看到第几集，两个都可空 */
  const empty = C.normalize('media', base);
  check('总集数/进度默认是 null', empty.episodes === null && empty.progress === null);
  check('总集数接受数字字符串', C.normalize('media', { ...base, episodes: '28' }).episodes === 28);
  check('总集数接受数字', C.normalize('media', { ...base, episodes: 28 }).episodes === 28);
  check('进度接受数字字符串', C.normalize('media', { ...base, progress: '12' }).progress === 12);
  check('进度为 0 合法（还没开始）', C.normalize('media', { ...base, progress: 0 }).progress === 0);
  check('空串等于不填', C.normalize('media', { ...base, episodes: '', progress: '' }).progress === null);
  check('总集数小数报错', code(() => C.normalize('media', { ...base, episodes: 28.5 })) === 'BAD_INPUT');
  check('进度负数报错', code(() => C.normalize('media', { ...base, progress: -1 })) === 'BAD_INPUT');
  check('进度非数字报错', code(() => C.normalize('media', { ...base, progress: '看到12话' })) === 'BAD_INPUT');
  check('进度超上限报错', code(() => C.normalize('media', { ...base, progress: 999999 })) === 'BAD_INPUT');
  /* PATCH 是「先合并再归一化」，所以只改 progress 不会把 episodes 冲掉 */
  const merged = C.normalize('media', { ...C.normalize('media', { ...base, episodes: 28, progress: 12 }), progress: 13 });
  check('合并语义：只改进度不会丢掉总集数', merged.episodes === 28 && merged.progress === 13);
}

console.log('\n=== learn_map（学习地图）===');
{
  const base = { title: '学 Rust', nodes: [{ id: 'n1', text: '所有权' }] };
  const r = C.normalize('learn_map', base);
  check('learn_map 是已知类型', C.knownType('learn_map'));
  check('正常通过', r.title === '学 Rust' && Array.isArray(r.nodes) && r.nodes.length === 1);
  check('标题去首尾空格', C.normalize('learn_map', { ...base, title: '  x  ' }).title === 'x');
  check('缺标题报错', code(() => C.normalize('learn_map', { nodes: [] })) === 'BAD_INPUT');
  check('说明可空', r.desc === null);
  check('状态默认 active', r.status === 'active');
  check('三种状态都通过',
        ['active', 'done', 'archived'].every(s => C.normalize('learn_map', { ...base, status: s }).status === s));
  check('非法状态报错', code(() => C.normalize('learn_map', { ...base, status: 'zzz' })) === 'BAD_INPUT');
  check('节点缺省为空数组', JSON.stringify(C.normalize('learn_map', { title: 't' }).nodes) === '[]');
  check('nodes 不是数组报错', code(() => C.normalize('learn_map', { title: 't', nodes: 'x' })) === 'BAD_INPUT');

  /* 节点字段 */
  const full = C.normalize('learn_map', { title: 't', nodes: [
    { id: 'a1', text: '所有权', group: '基础', done: true, note: '看第 4 章' },
  ]}).nodes[0];
  check('节点四个字段都保留',
        full.id === 'a1' && full.text === '所有权' && full.group === '基础' && full.done === true && full.note === '看第 4 章');
  check('节点 done 归一成布尔', C.normalize('learn_map', { title: 't', nodes: [{ id: 'a', text: 'x', done: 1 }] }).nodes[0].done === true);
  check('节点 group/note 可空', C.normalize('learn_map', { title: 't', nodes: [{ id: 'a', text: 'x' }] }).nodes[0].group === null);
  check('节点文本去空格', C.normalize('learn_map', { title: 't', nodes: [{ id: 'a', text: '  x  ' }] }).nodes[0].text === 'x');
  check('节点缺文本报错', code(() => C.normalize('learn_map', { title: 't', nodes: [{ id: 'a' }] })) === 'BAD_INPUT');
  check('节点 id 非法字符被清洗', C.normalize('learn_map', { title: 't', nodes: [{ id: 'a b!c', text: 'x' }] }).nodes[0].id === 'abc');
  check('节点 id 全非法时报错', code(() => C.normalize('learn_map', { title: 't', nodes: [{ id: '!!!', text: 'x' }] })) === 'BAD_INPUT');
  check('节点缺 id 按位置兜底', C.normalize('learn_map', { title: 't', nodes: [{ text: 'a' }, { text: 'b' }] }).nodes.map(n => n.id).join() === 'n1,n2');
  check('节点 id 重复报错',
        code(() => C.normalize('learn_map', { title: 't', nodes: [{ id: 'x', text: 'a' }, { id: 'x', text: 'b' }] })) === 'BAD_INPUT');
  check('节点超上限报错',
        code(() => C.normalize('learn_map', { title: 't', nodes: Array.from({ length: 501 }, (_, i) => ({ id: 'n' + i, text: 'x' })) })) === 'BAD_INPUT');
  check('多传字段被丢掉', !('evil' in C.normalize('learn_map', { ...base, evil: 1 })));
  check('节点里的多余字段也被丢掉',
        !('evil' in C.normalize('learn_map', { title: 't', nodes: [{ id: 'a', text: 'x', evil: 1 }] }).nodes[0]));
}

console.log('\n=== 未知类型 ===');
{
  check('normalize 未知类型报错', code(() => C.normalize('hack', {})) === 'BAD_INPUT');
  check('normalize null 数据不炸', code(() => C.normalize('nav_category', null)) === 'BAD_INPUT');
}

/* ---------------- Markdown 渲染 ---------------- */
console.log('\n=== Markdown 渲染 ===');
const win = {};
new Function('window', fs.readFileSync(path.join(REPO, 'md.js'), 'utf8'))(win);
const MD = win.MD;
const R = (s) => MD.render(s);

{
  check('标题', R('# 一级') === '<h1>一级</h1>', R('# 一级'));
  check('二级标题', R('## 二级') === '<h2>二级</h2>');
  check('粗体', R('**粗**') === '<p><strong>粗</strong></p>', R('**粗**'));
  check('斜体', R('*斜*') === '<p><em>斜</em></p>', R('*斜*'));
  check('删除线', R('~~删~~') === '<p><del>删</del></p>');
  check('行内代码', R('`code`') === '<p><code>code</code></p>');
  check('段落', R('第一行\n\n第二行') === '<p>第一行</p>\n<p>第二行</p>', R('第一行\n\n第二行'));
  check('段内换行变 <br>', R('一\n二') === '<p>一<br>二</p>', R('一\n二'));
  check('无序列表', R('- a\n- b') === '<ul><li>a</li><li>b</li></ul>', R('- a\n- b'));
  check('有序列表', R('1. a\n2. b') === '<ol><li>a</li><li>b</li></ol>', R('1. a\n2. b'));
  check('引用', R('> 引用') === '<blockquote>引用</blockquote>', R('> 引用'));
  check('分割线', R('---') === '<hr>');
  check('代码块', /<pre><code[^>]*>/.test(R('```\ncode\n```')), R('```\ncode\n```'));
  check('代码块保留语言标记', /lang-js/.test(R('```js\nx\n```')));

  const link = R('[名](https://a.com)');
  check('链接', link.includes('href="https://a.com"'), link);
  check('外链带 target=_blank', link.includes('target="_blank"'));
  check('外链带 noopener', link.includes('rel="noopener noreferrer"'));
  check('站内链接不加 target', !R('[名](/a)').includes('target='), R('[名](/a)'));
}

console.log('\n=== Markdown 安全性 ===');
{
  check('HTML 标签被转义', !R('<script>alert(1)</script>').includes('<script>'),
        R('<script>alert(1)</script>'));
  check('img onerror 被转义', !/<img/i.test(R('<img src=x onerror=alert(1)>')), R('<img src=x onerror=alert(1)>'));
  check('javascript: 链接被拦成 #', R('[点](javascript:alert(1))').includes('href="#"'),
        R('[点](javascript:alert(1))'));
  check('data: 链接被拦成 #', R('[点](data:text/html,x)').includes('href="#"'));
  check('代码块里的 HTML 也被转义', !R('```\n<script>x</script>\n```').includes('<script>'),
        R('```\n<script>x</script>\n```'));
  check('引号被转义（防属性逃逸）', R('"onmouseover="x').includes('&quot;'), R('"onmouseover="x'));
  /* 真正的属性逃逸尝试：在链接地址里塞引号，试图跑出 href 属性 */
  const inj = R('[x](https://a.com/"onmouseover="alert(1))');
  check('链接地址里的引号被转义，无法逃出 href 属性',
        !/"onmouseover=/.test(inj), inj);
  check('逃逸尝试后仍然只有一个 href 属性',
        (inj.match(/href="/g) || []).length === 1, inj);
  check('注入的引号被转成实体', inj.includes('&quot;'), inj);

  /* 转义过的 &gt; 不应该被当成引用 */
  check('字面量 &gt; 不会被误认成引用', !R('&gt; 不是引用').includes('<blockquote>'),
        R('&gt; 不是引用'));

  /* 真实场景：带 query string 的链接不能被二次转义 */
  const qs = R('[x](https://a.com/?a=1&b=2)');
  check('链接里的 & 只转义一次（query string 不失效）',
        qs.includes('href="https://a.com/?a=1&amp;b=2"'), qs);
  check('不会出现 &amp;amp; 这种双重转义', !qs.includes('&amp;amp;'), qs);
}

console.log('\n=== Markdown 边界 ===');
{
  check('空串返回空', R('') === '');
  check('null 返回空', R(null) === '');
  check('undefined 返回空', R(undefined) === '');
  check('只有空白', R('   ') === '');
  check('CRLF 能处理', R('a\r\n\r\nb') === '<p>a</p>\n<p>b</p>');
  check('代码块里的星号不被当粗体', R('```\n**x**\n```').includes('**x**'));
  check('未闭合代码块不炸', typeof R('```\nabc') === 'string');
  check('连续多个代码块', (R('```\na\n```\n\n```\nb\n```').match(/<pre>/g) || []).length === 2);
}

console.log('\n=== Markdown 图片 ===');
{
  const cat = R('![猫](https://example.com/cat.png)');
  check('基本图片渲染成 <img>',
        cat.includes('<img src="https://example.com/cat.png" alt="猫" loading="lazy">'), cat);
  check('图片包在段落里', /^<p><img .*><\/p>$/.test(cat), cat);

  const js = R('![x](javascript:alert(1))');
  check('javascript: 伪协议图片不渲染', !/<img/i.test(js), js);
  check('伪协议图片不生成标签，! 作为字面文本留下', js.startsWith('<p>!'), js);

  const amp = R('![a&b](https://x.com/i.png)');
  check('alt 里的 & 只转义一次（已转义文本不二次转义）', amp.includes('alt="a&amp;b"'), amp);
  check('不会出现 &amp;amp; 双重转义', !amp.includes('&amp;amp;'), amp);

  check('空 alt 也渲染', R('![](https://x.com/i.png)').includes('alt=""'), R('![](https://x.com/i.png)'));
  check('站内相对路径图片正常渲染', R('![x](/files/a.png)').includes('<img src="/files/a.png"'), R('![x](/files/a.png)'));
  check('锚点路径图片正常渲染', R('![x](#fig)').includes('<img src="#fig"'), R('![x](#fig)'));

  const mix = R('看图 ![猫](https://x/c.png) 完毕');
  check('混排：图片前面的文字在', mix.includes('看图'), mix);
  check('混排：图片后面的文字在', mix.includes('完毕'), mix);
  check('混排：图片本身在', mix.includes('<img'), mix);
  check('混排时图片前后空格保留', /图 <img/.test(mix) && /> 完毕/.test(mix), mix);

  const li = R('- ![猫](https://x/c.png)');
  check('列表项里的图片也能渲染', /<ul><li><img/.test(li), li);

  const two = R('![a](https://x/a.png) 和 ![b](https://x/b.png)');
  check('一篇里多张图片都渲染', (two.match(/<img/g) || []).length === 2, two);
  check('多张图片各自参数正确',
        two.includes('src="https://x/a.png"') && two.includes('src="https://x/b.png"'), two);

  /* 图片分支在链接正则之前：![alt](url) 整体是图片，不会被链接正则吃掉前半截 */
  const inLink = R('[![封面](https://x/c.png)](https://x/post)');
  check('图片在链接里也先按图片处理', inLink.includes('<img') && inLink.includes('href="https://x/post"'), inLink);

  /* 代码里的图片记号不渲染 */
  const inCode = R('`![x](https://x/c.png)`');
  check('行内代码里的图片记号不渲染', !/<img/i.test(inCode) && inCode.includes('<code>'), inCode);
}

console.log('\n=== 摘要提取 plain() ===');
{
  check('去掉标题记号', MD.plain('# 标题\n正文') === '标题 正文', MD.plain('# 标题\n正文'));
  check('去掉粗体记号', MD.plain('**粗**') === '粗');
  check('去掉代码块', MD.plain('前\n```\ncode\n```\n后') === '前 后', MD.plain('前\n```\ncode\n```\n后'));
  check('链接只留文字', MD.plain('[名](https://a.com)') === '名');
  check('图片只留 alt 文字', MD.plain('![猫](https://x/c.png)') === '猫', MD.plain('![猫](https://x/c.png)'));
  check('图片和链接混排只留文字', MD.plain('看 ![猫](https://x/c.png) 和 [名](https://a.com)') === '看 猫 和 名',
        MD.plain('看 ![猫](https://x/c.png) 和 [名](https://a.com)'));
  check('超长截断并加省略号', MD.plain('x'.repeat(50), 10) === 'x'.repeat(10) + '…');
  check('不超长不加省略号', MD.plain('abc', 10) === 'abc');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
