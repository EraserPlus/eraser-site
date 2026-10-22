/* ===========================================================================
   shell.js   全站公共交互层（公开页统一引入，用 <script src> 加载）
   ---------------------------------------------------------------------------
   四件事：
     ① 顶栏「主题」按钮：切换深浅色，选择存 localStorage（键 eraser.theme）
     ② Ctrl+K 命令面板：快速跳分区 / 搜当前关键词 / 触发常用动作
     ③ 复制当前链接 + g 前缀快捷键（见下）
     ④ 注册 Service Worker（PWA 离线外壳，仅前台页；后台页不注册）
   为什么单独一个文件：这几处 UI 全站重复，写一份、各页共用（和 md.js 一样是
   「零构建的普通脚本」，不打包、不引框架）。
   注意：主题的「防闪」必须在每页 <head> 的内联脚本里先写好 data-theme（见各页
   head），本文件只负责按钮与面板；不请求任何外部资源，数据全部来自页面自身。
   无 JS 时顶栏没有按钮、面板打不开，但正文照常可读（不白屏）。
   =========================================================================== */
(function () {
  "use strict";

  var THEME_KEY = "eraser.theme";
  var root = document.documentElement;

  /* 相对站点根的路径前缀：还在根目录（/ 或 /index.html）时为空，其余（都在一级目录）为 "../" */
  var PATH = location.pathname;
  var PREFIX = (PATH === "/" || /^\/[^/]*\.html$/.test(PATH)) ? "" : "../";

  /* key = g 前缀快捷键的第二段（g 后按它跳转），见下面的 keydown 处理 */
  var PAGES = [
    { ic: "⌕", name: "搜索", href: "index.html", key: "h" },
    { ic: "🧰", name: "工具箱", href: "tools/index.html", key: "t" },
    { ic: "📝", name: "博客", href: "blog/index.html", key: "b" },
    { ic: "📺", name: "追更", href: "collect/index.html", key: "c" },
    { ic: "🗺️", name: "学习", href: "learn/index.html", key: "l" },
    { ic: "🔗", name: "导航", href: "nav/index.html", key: "n" },
    { ic: "📄", name: "关于", href: "about/index.html", key: "a" },
    { ic: "🎛️", name: "开发交接", href: "dev/index.html", key: "d" }
  ];

  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function byId(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- 主题 */
  function themeNow() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  /* 系统开了「减弱动态效果」就不做视觉过渡（与 style.css 尾部的总开关口径一致） */
  function motionOK() {
    return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function applyTheme(t) {
    var paint = function () {
      root.setAttribute("data-theme", t);
      try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
      paintThemeBtn();
    };
    /* 浏览器支持 View Transitions 时，深浅切换做一次全页交叉淡化，不再是生硬跳变；
       不支持（或用户要求减弱动态）就照旧直接切，功能完全不变。 */
    if (document.startViewTransition && motionOK()) document.startViewTransition(paint);
    else paint();
  }
  function toggleTheme() { applyTheme(themeNow() === "dark" ? "light" : "dark"); }
  function paintThemeBtn() {
    var b = byId("shellTheme");
    if (!b) return;
    var dark = themeNow() === "dark";
    b.textContent = dark ? "☀️" : "🌙";
    b.title = dark ? "切换到浅色" : "切换到深色";
    b.setAttribute("aria-label", b.title);
  }

  /* ---------------------------------------------------------------- 提示 */
  var toastTimer = null;
  function toast(msg) {
    var t = byId("shellToast");
    if (!t) {
      t = make("div", "shell-toast");
      t.id = "shellToast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  /* ---------------------------------------------------------- 复制链接 */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function copyText(text, okMsg) {
    function done(ok) { toast(ok ? (okMsg || "已复制") : "复制失败，请手动复制"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
    } else {
      done(legacyCopy(text));
    }
  }

  /* ---------------------------------------------------------------- 面板 */
  var mask = null, input = null, listBox = null, items = [], sel = 0;

  function go(href) { location.href = PREFIX + href; }

  /* 面板列表：有输入时置顶一个「搜索 xxx」，下面是过滤后的分区，最后是固定动作 */
  function buildItems(q) {
    var query = String(q || "").trim();
    var lq = query.toLowerCase();
    var out = [];
    if (query) {
      out.push({ ic: "⌕", lb: "搜索 “" + query + "”", hint: "站内搜索",
                 run: function () { go("index.html?q=" + encodeURIComponent(query)); } });
    }
    PAGES.forEach(function (p) {
      if (query && p.name.toLowerCase().indexOf(lq) === -1) return;
      out.push({ ic: p.ic, lb: p.name, hint: "前往 · g " + p.key, run: function () { go(p.href); } });
    });
    /* 站主登录后，常用动作直接出现在面板里（写文章 / 下载备份 / 后台） */
    if (window.Owner && window.Owner.hasToken && window.Owner.hasToken() &&
        typeof window.Owner.quickActions === "function") {
      window.Owner.quickActions().forEach(function (a) {
        if (query && a.lb.toLowerCase().indexOf(lq) === -1) return;
        out.push({ ic: a.ic, lb: a.lb, hint: a.hint, run: function () { closePalette(); a.run(); } });
      });
    }
    out.push({ ic: "🌓", lb: themeNow() === "dark" ? "切换到浅色" : "切换到深色",
               hint: "主题", run: function () { toggleTheme(); closePalette(); } });
    out.push({ ic: "🔗", lb: "复制当前链接", hint: "剪贴板",
               run: function () { copyText(location.href, "已复制当前链接"); closePalette(); } });
    out.push({ ic: "↑", lb: "回到顶部", hint: "滚动",
               run: function () { window.scrollTo({ top: 0, behavior: motionOK() ? "smooth" : "auto" }); closePalette(); } });
    return out;
  }

  function renderList() {
    listBox.textContent = "";
    if (!items.length) {
      listBox.appendChild(make("div", "cmdk-empty", "没有匹配项，换个词试试"));
      return;
    }
    items.forEach(function (it, i) {
      var row = make("div", "cmdk-item" + (i === sel ? " on" : ""));
      row.appendChild(make("span", "ic", it.ic));
      row.appendChild(make("span", "lb", it.lb));
      if (it.hint) row.appendChild(make("span", "hint", it.hint));
      row.addEventListener("mousemove", function () { if (sel !== i) { sel = i; paintSel(); } });
      row.addEventListener("click", function () { it.run(); });
      listBox.appendChild(row);
    });
  }
  function paintSel() {
    var rows = listBox.querySelectorAll(".cmdk-item");
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("on", i === sel);
  }
  function refresh() {
    items = buildItems(input.value);
    sel = 0;
    renderList();
  }
  function openPalette() {
    if (!mask) return;
    mask.classList.remove("hide");
    input.value = "";
    refresh();
    input.focus();
  }
  function closePalette() {
    if (mask) mask.classList.add("hide");
  }
  function paletteOpen() { return !!(mask && !mask.classList.contains("hide")); }

  function buildPalette() {
    mask = make("div", "cmdk-mask hide");
    mask.id = "shellCmdk";
    var box = make("div", "cmdk");
    input = make("input");
    input.type = "text";
    input.placeholder = "跳转分区、搜关键词、切换主题……";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    listBox = make("div", "cmdk-list");
    box.appendChild(input);
    box.appendChild(listBox);
    mask.appendChild(box);
    document.body.appendChild(mask);

    input.addEventListener("input", refresh);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (sel < items.length - 1) { sel++; paintSel(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (sel > 0) { sel--; paintSel(); } }
      else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) items[sel].run(); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    });
    mask.addEventListener("mousedown", function (e) { if (e.target === mask) closePalette(); });
  }

  /* ---------------------------------------------------------------- 装配 */
  function mountNavOps() {
    var host = document.querySelector(".navbar") || document.querySelector(".doc-head");
    if (!host || host.querySelector(".nav-ops")) return;
    var ops = make("div", "nav-ops");
    var tb = make("button", "nav-btn");
    tb.type = "button";
    tb.id = "shellTheme";
    tb.addEventListener("click", toggleTheme);
    var kb = make("button", "nav-btn");
    kb.type = "button";
    kb.id = "shellCmdkBtn";
    kb.title = "快捷面板 (Ctrl+K)";
    kb.setAttribute("aria-label", kb.title);
    kb.appendChild(document.createTextNode("⌘"));
    kb.appendChild(make("kbd", null, "K"));
    kb.addEventListener("click", openPalette);
    ops.appendChild(tb);
    ops.appendChild(kb);
    host.appendChild(ops);
    paintThemeBtn();
  }

  /* ------------------------------------------------------- g 前缀快捷键 */
  /* 在输入框 / 文本域 / 可编辑区里打字时不要触发跳转 */
  function typingIn(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName.toUpperCase();
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable === true;
  }

  /* 找到了 g 后面那个字母对应的页面就跳过去；返回是否命中 */
  function goByKey(letter) {
    var lc = String(letter || "").toLowerCase();
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].key === lc) { go(PAGES[i].href); return true; }
    }
    return false;
  }

  /* 全局快捷键：
       Ctrl/⌘+K  开合命令面板
       g 然后再按一个字母 → 跳到对应分区（gh 首页 / gl 学习 / gb 博客 …）
     g 前缀只在非输入状态下生效，且 1.5 秒内没按第二个键就作废。 */
  var gArmed = false, gTimer = null;
  function disarmG() { gArmed = false; if (gTimer) { clearTimeout(gTimer); gTimer = null; } }

  document.addEventListener("keydown", function (e) {
    /* Ctrl/⌘+K：开合面板（编辑器 / 登录框开着时不抢键盘） */
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      if (document.getElementById("ownerLogin") || document.querySelector(".cf-overlay")) return;
      e.preventDefault();
      if (paletteOpen()) closePalette(); else openPalette();
      return;
    }
    /* 面板开着时，键盘都归面板管，不走 g 前缀 */
    if (paletteOpen()) return;
    /* 修饰键组合不参与（别抢浏览器快捷键） */
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    /* 正在输入框里打字，不管 */
    if (typingIn(document.activeElement)) return;

    if (!gArmed) {
      if (e.key === "g" || e.key === "G") {
        gArmed = true;
        gTimer = setTimeout(disarmG, 1500);
      }
      return;
    }
    /* 第二段：命中就跳，没命中就取消待命 */
    disarmG();
    if (goByKey(e.key)) e.preventDefault();
  });

  /* ------------------------------------------------------ Service Worker */
  /* 注册离线外壳。只在安全上下文（https / localhost）注册；失败也不影响页面。
     后台页（/admin/）不注册——它是动态管理界面，缓存住旧版反而误事。 */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (/^\/admin\//.test(location.pathname)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(PREFIX + "sw.js").catch(function () { /* 忽略 */ });
    });
  }

  function init() {
    mountNavOps();
    buildPalette();
    paintThemeBtn();
    registerSW();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
