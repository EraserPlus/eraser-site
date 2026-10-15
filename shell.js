/* ===========================================================================
   shell.js   全站公共交互层（公开页统一引入，用 <script src> 加载）
   ---------------------------------------------------------------------------
   三件事：
     ① 顶栏「主题」按钮：切换深浅色，选择存 localStorage（键 eraser.theme）
     ② Ctrl+K 命令面板：快速跳分区 / 搜当前关键词 / 触发常用动作
     ③ 复制当前链接
   为什么单独一个文件：这三处 UI 全站重复，写一份、各页共用（和 md.js 一样是
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

  var PAGES = [
    { ic: "⌕", name: "搜索", href: "index.html" },
    { ic: "🧰", name: "工具箱", href: "tools/index.html" },
    { ic: "📝", name: "博客", href: "blog/index.html" },
    { ic: "📺", name: "追更", href: "collect/index.html" },
    { ic: "🗺️", name: "学习", href: "learn/index.html" },
    { ic: "🔗", name: "导航", href: "nav/index.html" },
    { ic: "📄", name: "关于", href: "about/index.html" },
    { ic: "🎛️", name: "开发交接", href: "dev/index.html" }
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
  function applyTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    paintThemeBtn();
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
      out.push({ ic: p.ic, lb: p.name, hint: "前往", run: function () { go(p.href); } });
    });
    out.push({ ic: "🌓", lb: themeNow() === "dark" ? "切换到浅色" : "切换到深色",
               hint: "主题", run: function () { toggleTheme(); closePalette(); } });
    out.push({ ic: "🔗", lb: "复制当前链接", hint: "剪贴板",
               run: function () { copyText(location.href, "已复制当前链接"); closePalette(); } });
    out.push({ ic: "↑", lb: "回到顶部", hint: "滚动",
               run: function () { window.scrollTo({ top: 0, behavior: "smooth" }); closePalette(); } });
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

  /* 全局快捷键：Ctrl/⌘+K 开合面板 */
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (paletteOpen()) closePalette(); else openPalette();
    }
  });

  function init() {
    mountNavOps();
    buildPalette();
    paintThemeBtn();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
