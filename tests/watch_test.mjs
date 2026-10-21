/* watch.js：链接解析、官方嵌入地址、追更页接入的静态检查
   解析逻辑在 Node 的 vm 里跑（watch.js 加载时不碰 document）。 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

const sandbox = {
  URL, encodeURIComponent, decodeURIComponent,
  location: { origin: 'https://eraser.de5.net' },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('watch.js'), sandbox, { filename: 'watch.js' });
const W = sandbox.Watch;

console.log('\n=== watch.js 入口 ===');
check('挂到 window.Watch', !!W);
check('暴露 parse / open / embedUrl', typeof W.parse === 'function' && typeof W.open === 'function' && typeof W.embedUrl === 'function');
check('白名单只有四类来源', JSON.stringify(W.providers) === JSON.stringify(['bilibili', 'youtube', 'vimeo', 'video']));

console.log('\n=== B 站 ===');
{
  const v = W.parse('https://www.bilibili.com/video/BV1xx411c7mD?p=3&t=90');
  check('普通视频解析出 bvid', v && v.provider === 'bilibili' && v.bvid === 'BV1xx411c7mD');
  check('分 P 解析出 page=3', v && v.page === 3);
  check('t=90 解析出起播秒数', v && v.start === 90);
  check('B 站标记为不开放时间同步', v && v.timeSync === false);

  const av = W.parse('https://www.bilibili.com/video/av170001');
  check('av 号解析出 aid', av && av.aid === '170001');

  const ep = W.parse('https://www.bilibili.com/bangumi/play/ep123456');
  check('番剧 ep 解析出 episodeId', ep && ep.episodeId === '123456');

  const ss = W.parse('https://www.bilibili.com/bangumi/play/ss28747');
  check('番剧 ss 解析出 seasonId', ss && ss.seasonId === '28747');

  const pl = W.parse('https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=2');
  check('player.html 链接也能认', pl && pl.bvid === 'BV1xx411c7mD' && pl.page === 2);

  check('b23.tv 短链不硬猜（返回 null）', W.parse('https://b23.tv/abc123') === null);
}

console.log('\n=== YouTube ===');
{
  const a = W.parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s');
  check('watch?v= 解析出 id', a && a.provider === 'youtube' && a.id === 'dQw4w9WgXcQ');
  check('t=1m30s 转成 90 秒', a && a.start === 90);
  check('YouTube 标记为可读时间', a && a.timeSync === true);

  const b = W.parse('https://youtu.be/dQw4w9WgXcQ?t=42');
  check('youtu.be 短链解析正确', b && b.id === 'dQw4w9WgXcQ' && b.start === 42);

  const c = W.parse('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  check('shorts 解析正确', c && c.id === 'dQw4w9WgXcQ');

  const d = W.parse('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  check('nocookie embed 链接也能认', d && d.id === 'dQw4w9WgXcQ');

  check('非法视频 ID 返回 null', W.parse('https://www.youtube.com/watch?v=../evil') === null);
}

console.log('\n=== Vimeo ===');
{
  const a = W.parse('https://vimeo.com/76979871');
  check('vimeo.com/ID 解析正确', a && a.provider === 'vimeo' && a.id === '76979871');

  const b = W.parse('https://player.vimeo.com/video/76979871?h=abc123#t=1m');
  check('player.vimeo.com + 私享 hash 正确', b && b.id === '76979871' && b.hash === 'abc123');
  check('片段里的 #t=1m 转成 60 秒', b && b.start === 60);
}

console.log('\n=== 直链视频 / 拒绝清单 ===');
{
  const a = W.parse('https://cdn.example.com/a.mp4?token=1');
  check('mp4 直链识别为 video', a && a.provider === 'video' && a.src.indexOf('a.mp4') !== -1);
  check('webm 直链识别', W.parse('https://cdn.example.com/a.webm') !== null);
  check('普通网页不当视频', W.parse('https://example.com/page.html') === null);
  check('无扩展名地址不当视频', W.parse('https://example.com/watch/123') === null);
  check('javascript: 一律拒绝', W.parse('javascript:alert(1)') === null);
  check('data: 视频一律拒绝', W.parse('data:video/mp4;base64,AAAA') === null);
  check('把站外地址塞进查询参数也骗不过', W.parse('https://evil.example/?u=https://www.bilibili.com/video/BV1xx411c7mD') === null);
  check('漫画站不会进 iframe', W.parse('https://mangadex.org/title/abc') === null);
}

console.log('\n=== 官方播放器地址 ===');
{
  const b = W.parse('https://www.bilibili.com/video/BV1xx411c7mD?p=3&t=90');
  const bu = W.embedUrl(b, {});
  check('B 站用官方 player.bilibili.com', bu.startsWith('https://player.bilibili.com/player.html?'));
  check('B 站地址带 bvid / page / t', /bvid=BV1xx411c7mD/.test(bu) && /page=3/.test(bu) && /t=90/.test(bu));
  check('B 站地址不会出现原始页面 URL', bu.indexOf('www.bilibili.com') === -1);

  const y = W.parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90');
  const yu = W.embedUrl(y, { origin: 'https://eraser.de5.net' });
  check('YouTube 用隐私增强 embed 域', yu.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?'));
  check('YouTube 开启 enablejsapi（读时间的前提）', /enablejsapi=1/.test(yu));
  check('YouTube 带 start 与 origin', /start=90/.test(yu) && /origin=https%3A%2F%2Feraser\.de5\.net/.test(yu));

  const v = W.parse('https://vimeo.com/76979871');
  const vu = W.embedUrl(v, { start: 60 });
  check('Vimeo 用官方 player.vimeo.com', vu.startsWith('https://player.vimeo.com/video/76979871?'));
  check('Vimeo 开启 api=1 并带起播片段', /api=1/.test(vu) && /#t=60s$/.test(vu));

  const d = W.parse('https://cdn.example.com/a.mp4');
  check('直链视频原样返回给 <video>', W.embedUrl(d, {}) === 'https://cdn.example.com/a.mp4');
}

console.log('\n=== 时间小工具 ===');
{
  check('toSeconds 纯数字', W.toSeconds('90') === 90);
  check('toSeconds 1h2m3s', W.toSeconds('1h2m3s') === 3723);
  check('toSeconds 非法值归零', W.toSeconds('abc') === 0);
  check('fmt 9:05', W.fmt(545) === '9:05');
  check('fmt 1:01:01', W.fmt(3661) === '1:01:01');
  check('fmt 负数归零', W.fmt(-3) === '0:00');
}

console.log('\n=== 代码边界 ===');
{
  const js = read('watch.js');
  check('iframe 地址只来自 embedUrl，不直接吃用户 URL', /frame\.src = embedUrl\(/.test(js));
  check('没有 innerHTML / document.write', !/innerHTML\s*=/.test(js) && !/document\.write/.test(js));
  check('没有 eval / new Function', !/\beval\s*\(/.test(js) && !/new Function/.test(js));
  check('收消息时校验来源是 YouTube / Vimeo', /YT_ORIGINS\.indexOf\(e\.origin\)/.test(js) && /e\.origin === VIMEO_ORIGIN/.test(js));
  check('续播点只 PATCH position / duration', /position: pos/.test(js) && /patch\.duration = dur/.test(js));
  check('＋1 集数时在页面侧把续播点归零', /progress: next, position: 0/.test(read('collect/index.html')));
  check('＋1 后本集不再写续播点，避免盖回旧位置', /episodeAdvanced = true;[\s\S]*?canSave = false;/.test(js));
  check('已看完的条目重看从头开始', /d\.status !== "finished"/.test(js));
  check('有 pagehide / visibilitychange 兜底保存', /pagehide/.test(js) && /visibilitychange/.test(js));
  check('支持 keepalive 保存', /keepalive/.test(js));
  check('对话框有 Esc 关闭与 Tab 圈定', /Escape/.test(js) && /e\.key !== "Tab"/.test(js));
  check('B 站明确提示只记集数', /不开放画面进度/.test(js));
}

console.log('\n=== 追更页接入 ===');
{
  const html = read('collect/index.html');
  check('在页内脚本之前引入 watch.js',
        html.indexOf('src="../watch.js"') !== -1
        && html.indexOf('src="../watch.js"') < html.indexOf('追更：追番 / 漫画的留档'));
  check('引入顺序在 owner.js 之前', html.indexOf('src="../watch.js"') < html.indexOf('src="../owner.js"'));
  check('卡片用 Watch.parse 判断能否站内播放', /Watch\.parse\(link\)/.test(html));
  check('能播放的卡片是 button 点击层（键盘可达）', /el\("button", "mg-hit"\)/.test(html));
  check('海报中央有 ▶ 徽标', /el\("span", "mg-play"\)/.test(html) && /\.mg-play\s*\{/.test(html));
  check('弹层打开时传入 save 与 plus', /Watch\.open\(it, \{/.test(html)
        && /save: function \(patch, o\)/.test(html) && /plus: function \(done, fail\)/.test(html));
  check('续播点走单条 PATCH（带 keepalive）', /function patchMedia\(id, patch, opts\)/.test(html)
        && /keepalive: !!\(opts && opts\.keepalive\)/.test(html));
  check('不能播放仍走站外链接（带 noopener）', /hit\.rel = "noopener noreferrer"/.test(html));
  check('播放器样式在页内', /\.watch-mask\s*\{/.test(html) && /\.watch-stage\s*\{/.test(html));
  check('移动端播放器全宽', /@media \(max-width: 640px\)[\s\S]*?\.watch-mask\s*\{\s*padding: 0;/.test(html));
  check('页面有站内播放说明', /海报上会出现 ▶/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
