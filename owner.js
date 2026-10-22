/* ===========================================================================
   owner.js   站主身份层（公开页复用后台令牌，登录后直接就地编辑）
   ---------------------------------------------------------------------------
   做四件事：
     ① 读写和后台同一把令牌（eraser.admin.token），所有写请求自动带 Bearer
     ② 页面加载时校验令牌；过期/伪造就清掉并回到访客态（编辑入口不残留）
     ③ 登录态在左下角显示一个很轻的「编辑模式」浮条，可退出、可回后台
     ④ 给各页提供统一 toast / 401 处理（写操作失败时弹出登录，不丢正在填的表单）

   安全边界：编辑入口只是「有令牌才画」。真正的权限校验始终在服务端，
   访客即使手动塞一个假令牌，也只能看到按钮，写不进去。
   无令牌时本文件不渲染任何界面，访客完全看不出后台存在。
   =========================================================================== */
(function (global) {
  "use strict";

  var TOKEN_KEY = "eraser.admin.token";
  var AUTH_API = "/api/auth";
  var ADMIN_URL = "/admin/";
  /* 站点根前缀：根目录为空，一级子目录为 "../"（与 shell.js 同一口径） */
  var HERE = location.pathname;
  var PREFIX = (HERE === "/" || /^\/[^/]*\.html$/.test(HERE)) ? "" : "../";
  var loginOpen = false;
  var expiredNotified = false;
  var toastTimer = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function hasToken() { return !!token(); }
  function setToken(v) {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- 提示 */
  function toast(text, kind) {
    if (!text) return;
    var node = document.getElementById("ownerToast");
    if (!node) {
      node = el("div", "owner-toast");
      node.id = "ownerToast";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      document.body.appendChild(node);
    }
    node.textContent = text;
    node.className = "owner-toast show" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.className = "owner-toast"; }, kind === "err" ? 4200 : 2400);
  }
  /* content.js 的 say(which, text, kind) 直接接进来 */
  function say(which, text, kind) {
    if (!text) return;
    toast(text, kind === "err" ? "err" : kind);
  }

  /* ---------------------------------------------------------------- 请求 */
  function api(path, opts) {
    opts = opts || {};
    var url = /^\//.test(path) ? path : "/api/" + path;
    var headers = { Accept: "application/json" };
    if (opts.body) headers["Content-Type"] = "application/json";
    var t = token();
    if (t) headers.Authorization = "Bearer " + t;

    return fetch(url, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) {
          expire();
          throw new Error("登录已过期，请重新登录");
        }
        if (!r.ok) throw new Error((j && j.error) || ("请求失败（" + r.status + "）"));
        return j;
      });
    });
  }

  /* 令牌失效：清掉、收起浮条、弹一次登录；正在填的表单保持不动 */
  function expire() {
    if (!hasToken()) return;
    setToken("");
    refreshDock();
    if (expiredNotified) return;
    expiredNotified = true;
    toast("登录已过期，请重新登录", "err");
    openLogin();
  }

  /* ---------------------------------------------------------------- 登录 */
  function openLogin() {
    if (loginOpen) {
      var present = document.getElementById("ownerPwd");
      if (present) present.focus();
      return;
    }
    loginOpen = true;
    var prevOverflow = document.body.style.overflow;

    var mask = el("div", "owner-login");
    mask.id = "ownerLogin";
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    mask.setAttribute("aria-labelledby", "ownerLoginTitle");

    var panel = el("div", "owner-panel");
    var head = el("div", "owner-login-head");
    head.appendChild(el("h3", null, "站主登录"));
    var closeBtn = el("button", "owner-login-x", "✕");
    closeBtn.type = "button";
    closeBtn.title = "关闭";
    closeBtn.setAttribute("aria-label", "关闭登录框");
    head.appendChild(closeBtn);
    panel.appendChild(head);

    panel.appendChild(el("p", "owner-login-hint", "只认站主本人。登录后这台设备会记住 30 天，之后进任何页面都能直接改。"));

    var input = document.createElement("input");
    input.type = "password";
    input.id = "ownerPwd";
    input.className = "owner-login-input";
    input.placeholder = "管理密码";
    input.autocomplete = "current-password";
    input.setAttribute("aria-label", "管理密码");
    panel.appendChild(input);

    var msg = el("div", "owner-login-msg");
    msg.setAttribute("aria-live", "polite");
    panel.appendChild(msg);

    var acts = el("div", "owner-login-acts");
    var cancel = el("button", "owner-btn", "取消");
    cancel.type = "button";
    var submit = el("button", "owner-btn primary", "登录");
    submit.type = "button";
    acts.appendChild(cancel);
    acts.appendChild(submit);
    panel.appendChild(acts);

    mask.appendChild(panel);
    mask.addEventListener("mousedown", function (e) { if (e.target === mask) close(); });

    function close() {
      loginOpen = false;
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey, true);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    }
    function fail(text) {
      msg.textContent = text || "";
      msg.className = "owner-login-msg" + (text ? " err" : "");
    }
    function submitLogin() {
      var pwd = input.value;
      if (!pwd) { fail("请输入密码"); input.focus(); return; }
      submit.disabled = true;
      submit.textContent = "登录中…";
      fail("");
      fetch(AUTH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ password: pwd })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || ("登录失败（" + r.status + "）"));
          return j;
        });
      }).then(function (j) {
        if (!j || !j.token) throw new Error("服务器没有返回令牌，稍后再试");
        setToken(j.token);
        expiredNotified = false;
        close();
        refreshDock();
        var editing = document.querySelector(".cf-overlay");
        if (editing) {
          toast("登录成功，可以继续保存了", "ok");
        } else {
          toast("登录成功，编辑入口已开启", "ok");
          setTimeout(function () { location.reload(); }, 320);
        }
      }).catch(function (e) {
        submit.disabled = false;
        submit.textContent = "登录";
        fail(e.message || "登录失败");
      });
    }

    closeBtn.addEventListener("click", close);
    cancel.addEventListener("click", close);
    submit.addEventListener("click", submitLogin);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submitLogin(); }
    });

    document.body.appendChild(mask);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey, true);
    input.focus();
  }

  /* ---------------------------------------------------- 站主快捷操作（M23） */
  /* 写文章 / 下载备份原先都藏在后台，进后台再找标签其实很绕。
     这里放到全局：浮条一个按钮、Ctrl+K 面板三条动作。 */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("脚本加载失败：" + src)); };
      document.head.appendChild(s);
    });
  }
  /* 不在博客页也能写文章：按需把编辑器和 Markdown 渲染器拉进来 */
  var editorLoading = null;
  function ensureEditor() {
    if (global.ContentAdmin && global.MD) {
      global.ContentAdmin.init({ api: api, say: say, onAuthError: expire });
      return Promise.resolve(global.ContentAdmin);
    }
    if (editorLoading) return editorLoading;
    editorLoading = (global.MD ? Promise.resolve() : loadScript(PREFIX + "md.js").catch(function () {}))
      .then(function () {
        if (global.ContentAdmin) return null;
        return loadScript(PREFIX + "admin/content.js");
      })
      .then(function () {
        if (!global.ContentAdmin) throw new Error("编辑器加载失败，去后台试试");
        global.ContentAdmin.init({ api: api, say: say, onAuthError: expire });
        return global.ContentAdmin;
      });
    editorLoading.catch(function () { editorLoading = null; });
    return editorLoading;
  }

  function writePost() {
    if (!hasToken()) { openLogin(); return; }
    ensureEditor().then(function (CA) {
      CA.openNew("post", {
        title: "写新文章",
        afterSave: function (item) {
          var d = (item && item.data) || {};
          var slug = d.slug || d.title || "";
          if (/\/blog\/post\.html$/.test(location.pathname)) { location.reload(); return; }
          location.href = PREFIX + "blog/post.html" +
            (slug ? "?slug=" + encodeURIComponent(slug) : "");
        }
      });
    }).catch(function (e) { toast((e && e.message) || "编辑器加载失败", "err"); });
  }

  function backupName(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "eraser-backup-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".json";
  }
  function backupCount(b) {
    b = b || {};
    var n = 0;
    ["todos", "events", "posts", "files", "pages", "media", "learnMaps"].forEach(function (k) {
      if (Array.isArray(b[k])) n += b[k].length;
    });
    if (b.nav) {
      if (Array.isArray(b.nav.categories)) n += b.nav.categories.length;
      if (Array.isArray(b.nav.links)) n += b.nav.links.length;
    }
    return n;
  }
  function backup() {
    if (!hasToken()) { openLogin(); return; }
    toast("正在打包全站数据…");
    api("backup")
      .then(function (j) {
        var bk = (j && j.backup) || j;
        var blob = new Blob([JSON.stringify(bk, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = backupName(new Date());
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast("备份已下载 · 共 " + backupCount(bk) + " 条数据", "ok");
      })
      .catch(function (e) { toast((e && e.message) || "备份失败", "err"); });
  }

  var OPEN_ACTIONS = [
    { ic: "✍️", lb: "写新文章", hint: "站主", run: writePost },
    { ic: "⬇️", lb: "下载全站备份", hint: "站主", run: backup },
    { ic: "🎛️", lb: "管理后台", hint: "站主", run: function () { location.href = ADMIN_URL; } }
  ];
  function quickActions() { return hasToken() ? OPEN_ACTIONS : []; }

  /* ---------------------------------------------------------------- 浮条 */
  function refreshDock() {
    var dock = document.getElementById("ownerDock");
    if (!hasToken()) {
      if (dock && dock.parentNode) dock.parentNode.removeChild(dock);
      return;
    }
    if (dock) return;

    dock = el("div", "owner-dock");
    dock.id = "ownerDock";
    dock.title = "已登录，可以直接在页面上修改";

    var mark = el("span", "owner-dock-mark", "✎");
    mark.setAttribute("aria-hidden", "true");
    dock.appendChild(mark);
    dock.appendChild(el("span", "owner-dock-text", "编辑模式"));

    var writeBtn = el("button", "owner-dock-act", "＋");
    writeBtn.type = "button";
    writeBtn.title = "写新文章（不开后台也能写）";
    writeBtn.setAttribute("aria-label", writeBtn.title);
    writeBtn.addEventListener("click", writePost);
    dock.appendChild(writeBtn);

    var dlBtn = el("button", "owner-dock-act", "⬇");
    dlBtn.type = "button";
    dlBtn.title = "下载全站备份（JSON）";
    dlBtn.setAttribute("aria-label", dlBtn.title);
    dlBtn.addEventListener("click", backup);
    dock.appendChild(dlBtn);

    var back = el("a", "owner-dock-link", "后台");
    back.href = ADMIN_URL;
    back.title = "打开管理后台（待办 / 日程 / 备份）";
    dock.appendChild(back);

    var out = el("button", "owner-dock-exit", "退出");
    out.type = "button";
    out.addEventListener("click", function () {
      if (!confirm("退出编辑模式？下次修改需要重新输入密码。")) return;
      setToken("");
      location.reload();
    });
    dock.appendChild(out);

    document.body.appendChild(dock);
  }

  /* ------------------------------------------------------- 启动时校验令牌 */
  function verify() {
    var t = token();
    if (!t) return;
    fetch(AUTH_API, {
      headers: { Accept: "application/json", Authorization: "Bearer " + t }
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (j && j.loggedIn === false) {
        setToken("");
        refreshDock();
        location.reload();
      }
    }).catch(function () { /* 网络问题不误伤本地令牌 */ });
  }

  /* Ctrl/⌘+Shift+L：在任意公开页唤起登录，不必先绕去后台 */
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      if (hasToken()) toast("已经是登录状态", "ok");
      else openLogin();
    }
  });

  function init() {
    refreshDock();
    verify();
  }

  global.Owner = {
    TOKEN_KEY: TOKEN_KEY,
    token: token,
    hasToken: hasToken,
    api: api,
    say: say,
    toast: toast,
    openLogin: openLogin,
    logout: function () { setToken(""); location.reload(); },
    verify: verify,
    expire: expire,
    refreshDock: refreshDock,
    /* 站主快捷操作：全局浮条与 Ctrl+K 面板共用 */
    writePost: writePost,
    backup: backup,
    quickActions: quickActions,
    /* 按需加载共享编辑器（AI 协作区等新页面用，避免给访客多下 90KB） */
    ensureEditor: ensureEditor
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
