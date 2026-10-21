/* ===========================================================================
   sw.js   全站 Service Worker（PWA 离线外壳）
   ---------------------------------------------------------------------------
   目标只有一个：把站点加到手机主屏后，断网也能打开、不白屏。
   优先级永远排在「内容新鲜」之后——所以策略刻意保守：

     ① HTML 页面    network-first。联网时永远拿最新页；断网才回落到缓存副本，
                    连缓存都没有就返回一个内置的离线页（内联 HTML，不依赖网络）。
     ② 静态资源      cache-first（style.css / *.js / 图标 / manifest）。
                    JS/CSS 带内容变化时靠 CACHE 版本号整体换新，见下面 VERSION。
     ③ /api/*       一律不缓存。接口响应本来就是 no-store，缓存会读到过期数据
                    （勾了节点还显示没勾），得不偿失。
     ④ 其余请求     直接放行，交给浏览器。

   注册入口在 shell.js。后台页（/admin/）不注册——后台是动态管理界面，
   离线打开没有意义，还可能因为缓存住旧版页误导操作。
   =========================================================================== */

/* 改站点样式 / 脚本后，把这个版本号 +1，旧缓存会被清掉，客户端拿到新文件 */
/* v1 → v2：M11 修了 style.css 的暗色按钮、M12 改了页面、M13 又动了 style.css（跳转链接）与全站 head */
/* v2 → v3：公开页接入站主就地编辑（owner.js / owner.css / 新版 content.js） */
/* v3 → v4：M18 阅读便利（style.css 移动端顶栏、post.html 阅读增强、md.js 阅读统计） */
/* v4 → v5：M19 追更页站内播放（watch.js、collect 弹层、续播点字段） */
const VERSION = 'eraser-v5';
const CACHE = VERSION;

/* 预缓存：离线时至少能打开首页外壳（页面本体走 network-first，这是兜底） */
const PRECACHE = [
  '/',
  '/style.css',
  '/shell.js',
  '/watch.js',
  '/manifest.webmanifest',
  '/icon.svg',
];

/* 断网且没缓存副本时的离线页（内联，不依赖任何外部资源） */
const OFFLINE_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>离线 · Eraser 的小站</title>'
  + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
  + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#0f172a}'
  + '.b{text-align:center;padding:32px}.b .i{font-size:52px}.b h1{font-size:19px;margin:14px 0 6px}'
  + '.b p{color:#64748b;font-size:14px;margin:0 0 18px}'
  + '.b a{display:inline-block;padding:9px 18px;border-radius:9px;background:#2563eb;color:#fff;'
  + 'text-decoration:none;font-size:14px}</style></head><body><div class="b">'
  + '<div class="i">🧩</div><h1>现在没网</h1>'
  + '<p>这个页面还没被缓存下来，连上网再打开就好。</p>'
  + '<a href="/">回首页</a></div></body></html>';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* 单个文件失败不应该让整个安装失败，逐个 add 并吞掉错误 */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url).catch(function () { /* 忽略：离线时首次安装可能取不到 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);   /* 清掉旧版本缓存 */
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 这些路径一律不缓存 */
function isApi(url) {
  return url.pathname.indexOf('/api/') === 0;
}
function isHtml(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0;
}
function isStatic(url) {
  return /\.(css|js|svg|png|jpg|jpeg|gif|webp|ico|woff2?|webmanifest)$/.test(url.pathname)
      || url.pathname === '/manifest.webmanifest';
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;              /* 写操作永不拦截 */

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   /* 站外资源不碰 */

  /* ① 接口：直接放行，不缓存 */
  if (isApi(url)) return;

  /* ② HTML / 导航：network-first，断网回落缓存，再回落离线页 */
  if (isHtml(req)) {
    event.respondWith(
      fetch(req).then(function (res) {
        /* 顺手更新缓存副本（只缓存同源成功的 200） */
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response(OFFLINE_HTML, {
            status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        });
      })
    );
    return;
  }

  /* ③ 静态资源：cache-first，后台悄悄更新缓存 */
  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) {
          fetch(req).then(function (res) {
            if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res); });
          }).catch(function () { /* 离线，保持旧副本 */ });
          return hit;
        }
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  /* ④ 其余：放行 */
});
