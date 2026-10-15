/* ===========================================================================
   admin/content.js · 内容管理（导航 / 博客 / 页面 / 追更）
   ---------------------------------------------------------------------------
   由 admin/index.html 加载，复用它的 api() 和 say()。
   各种内容共用「字段定义 → 通用表单 / 通用列表」的写法，避免重复代码。
   =========================================================================== */
(function (global) {
  "use strict";

  var api = null, say = null, md = null;

  /* ---------------- 字段定义 ---------------- */
  var SCHEMA = {
    nav_category: {
      name: "分类",
      fields: [{ k: "name", l: "分类名", t: "text", ph: "比如：开发", req: true }]
    },
    nav_link: {
      name: "链接",
      fields: [
        { k: "name", l: "名称", t: "text", ph: "比如：GitHub", req: true },
        { k: "url", l: "网址", t: "text", ph: "https://…", req: true },
        { k: "desc", l: "说明（可空）", t: "text", ph: "一句话说明" },
        { k: "tip", l: "提示词（可空）", t: "text", ph: "给自己的小提示，前台卡片显示" },
        { k: "tags", l: "标签（逗号分隔）", t: "tags", ph: "代码, 英文" },
        { k: "keywords", l: "搜索关键词（逗号分隔）", t: "tags", ph: "别名、拼音、缩写，搜这些词也能找到" }
      ]
    },
    post: {
      name: "文章",
      fields: [
        { k: "title", l: "标题", t: "text", ph: "文章标题", req: true },
        { k: "slug", l: "短链接（网址里用）", t: "text", ph: "留空则按标题自动生成", auto: "title" },
        { k: "summary", l: "摘要（可空）", t: "text", ph: "列表里显示的一句话" },
        { k: "tags", l: "标签（逗号分隔）", t: "tags", ph: "笔记, 教程" },
        { k: "published", l: "公开显示", t: "bool" },
        { k: "content", l: "正文（Markdown）", t: "md", req: true }
      ]
    },
    page: {
      name: "页面",
      fields: [
        { k: "key", l: "页面标识", t: "text", ph: "about / home", req: true },
        { k: "title", l: "标题", t: "text", req: true },
        { k: "content", l: "正文（Markdown）", t: "md", req: true }
      ]
    },
    media: {
      name: "追更",
      fields: [
        { k: "category", l: "栏目", t: "select", opts: [["anime", "追番"], ["comic", "漫画"]], req: true },
        { k: "name", l: "名称", t: "text", ph: "比如：葬送的芙莉莲", req: true },
        { k: "status", l: "状态", t: "select", req: true, opts: [
            ["wish", "想看 / 想读"],
            ["watching", "在看 / 在读"],
            ["finished", "看完 / 读完（自动进收纳栏）"],
            ["paused", "搁置（弃坑 / 缓一缓）"]
        ] },
        { k: "score", l: "评分（可空，0-10）", t: "text", ph: "比如：9.0 或 8.5，留空不显示" },
        { k: "note", l: "备注（可空）", t: "text", ph: "一句话，比如：周五更新 · 看到第 8 话" },
        { k: "date", l: "日期（可空）", t: "text", ph: "比如：2026-10-14" },
        { k: "url", l: "链接（可空）", t: "text", ph: "https://…（豆瓣 / B站 / bgm 页面）" },
        { k: "cover", l: "封面图链接（可空）", t: "text", ph: "https://…图片地址，留空则只显示文字" }
      ]
    },
    learn_map: {
      name: "学习地图",
      fields: [
        { k: "title", l: "地图标题", t: "text", ph: "比如：前端入门路线", req: true },
        { k: "desc", l: "地图说明（可空）", t: "text", ph: "一句话说明这张地图要学到哪" },
        { k: "status", l: "状态", t: "select", req: true, opts: [
            ["active", "在学"],
            ["done", "学完"],
            ["archived", "归档（不显示在列表，但数据还在）"]
        ] }
      ]
    }
  };

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function tagsToText(t) { return Array.isArray(t) ? t.join(", ") : (t || ""); }

  /* ---------------- 草稿自动保存（写长文不怕误关） ---------------- */
  function draftKeyOf(type) { return "eraser.admin.draft." + type; }
  function loadDraft(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }
  function saveDraft(key, value) {
    try { if (value && value.trim()) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) {}
  }
  function clearDraft(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  var draftTimers = [];

  /* 哪些字段旁挂「上传」按钮：直传 Vercel Blob，成功后回填地址。
     文件仓库（type=file）下架后，改挂在追更的链接 / 封面图上，让上传仍然可达。 */
  var UPLOAD_FIELDS = { file: ["url"], media: ["url", "cover"] };

  /* ---------------- 通用表单 ---------------- */
  /* 返回一个 <div>，调用 form.read() 取数据、form.fill(item) 回填 */
  function buildForm(type, onSave, onCancel) {
    var spec = SCHEMA[type];
    var box = el("div", "cform");
    var inputs = {};

    spec.fields.forEach(function (f) {
      var wrap = el("div", "cf-row");
      var lab = el("label", "fl" + (box.children.length === 0 ? " first" : ""), f.l);
      wrap.appendChild(lab);

      if (f.t === "md") {
        var ta = el("textarea");
        ta.rows = 12;
        ta.placeholder = "支持 Markdown：# 标题、**粗体**、- 列表、`代码`、[链接](https://…)、```代码块```";
        /* 实时预览：输入即渲染，不用点「预览」按钮 */
        var prev = el("div", "mdprev");
        var cnt = el("div", "mdcnt");
        var dkey = draftKeyOf(type);
        function paint() {
          cnt.textContent = ta.value.length + " 字";
          prev.innerHTML = md ? md.render(ta.value) : "";
        }
        ta.addEventListener("input", function () { paint(); saveDraft(dkey, ta.value); });
        ta.addEventListener("blur", function () { saveDraft(dkey, ta.value); });
        var dt = setInterval(function () { saveDraft(dkey, ta.value); }, 3000);
        draftTimers.push(dt);

        /* 有未保存草稿时给出恢复/丢弃条 */
        var saved = loadDraft(dkey);
        if (saved && saved.trim()) {
          var dbar = el("div", "draftbar");
          dbar.appendChild(el("span", null, "检测到未保存的草稿（" + saved.length + " 字）"));
          var rb = el("button", "btn ghost sm", "恢复");
          rb.type = "button";
          rb.addEventListener("click", function () { ta.value = saved; paint(); });
          var db = el("button", "btn ghost sm", "丢弃");
          db.type = "button";
          db.addEventListener("click", function () {
            clearDraft(dkey);
            if (dbar.parentNode) dbar.parentNode.removeChild(dbar);
          });
          dbar.appendChild(rb); dbar.appendChild(db);
          wrap.appendChild(dbar);
        }

        wrap.appendChild(ta);
        wrap.appendChild(cnt);
        wrap.appendChild(prev);
        inputs[f.k] = ta;
        box.mdKeys = box.mdKeys || [];
        box.mdKeys.push(dkey);
      } else if (f.t === "bool") {
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = true;
        var line = el("div", "cf-bool");
        line.appendChild(cb);
        line.appendChild(el("span", null, "打勾则在前台显示"));
        wrap.appendChild(line);
        inputs[f.k] = cb;
      } else if (f.t === "select") {
        var sel = el("select");
        (f.opts || []).forEach(function (o) {
          var opt = el("option", null, o[1]);
          opt.value = o[0];
          sel.appendChild(opt);
        });
        wrap.appendChild(sel);
        inputs[f.k] = sel;
      } else {
        var inp = el("input");
        inp.type = "text";
        if (f.ph) inp.placeholder = f.ph;
        if (f.t === "tags") inp.autocomplete = "off";

        /* 可上传字段（文件仓库的 url、追更的链接 / 封面）旁加「上传」按钮，成功后回填地址 */
        if (UPLOAD_FIELDS[type] && UPLOAD_FIELDS[type].indexOf(f.k) !== -1) {
          var upRow = el("div");
          upRow.style.display = "flex";
          upRow.style.gap = "8px";
          upRow.style.alignItems = "center";
          inp.style.flex = "1";
          upRow.appendChild(inp);
          var upBtn = el("button", "btn ghost sm", "上传");
          upBtn.type = "button";
          var filePicker = el("input");
          filePicker.type = "file";
          filePicker.style.display = "none";
          upBtn.addEventListener("click", function () { filePicker.click(); });
          filePicker.addEventListener("change", function () {
            var file = filePicker.files && filePicker.files[0];
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) { say("app", "文件超过 4MB，传不了", "err"); return; }
            upBtn.disabled = true;
            upBtn.textContent = "上传中…";
            /* 令牌直读 localStorage——与 admin/index.html 的 TOKEN_KEY（eraser.admin.token）同一个键 */
            var token = "";
            try { token = localStorage.getItem("eraser.admin.token") || ""; } catch (e) {}
            fetch("/api/upload?name=" + encodeURIComponent(file.name), {
              method: "POST",
              headers: token ? { Authorization: "Bearer " + token } : {},
              body: file
            }).then(function (r) {
              return r.json().catch(function () { return {}; }).then(function (j) {
                if (r.status === 401) { say("app", "登录已过期，请重新登录", "err"); return; }
                if (!r.ok) { say("app", j.error || ("上传失败（" + r.status + "）"), "err"); return; }
                inp.value = (j.data && j.data.url) || "";
                say("app", "上传成功，地址已填好，点保存即可", "ok");
              });
            }).catch(function () {
              say("app", "上传失败：网络错误", "err");
            }).then(function () {
              upBtn.disabled = false;
              upBtn.textContent = "上传";
              filePicker.value = "";
            });
          });
          upRow.appendChild(upBtn);
          upRow.appendChild(filePicker);
          wrap.appendChild(upRow);
        } else {
          wrap.appendChild(inp);
        }
        inputs[f.k] = inp;
      }
      box.appendChild(wrap);
    });

    var acts = el("div", "form-acts");
    var save = el("button", "btn", "保存");
    save.type = "button";
    save.addEventListener("click", function () {
      var data = {};
      for (var i = 0; i < spec.fields.length; i++) {
        var f = spec.fields[i], node = inputs[f.k];
        if (f.t === "bool") data[f.k] = !!node.checked;
        else if (f.t === "tags") data[f.k] = node.value;
        else data[f.k] = node.value;
      }
      /* 短链接留空时按标题自动生成 */
      var slugField = spec.fields.filter(function (x) { return x.auto; })[0];
      if (slugField && !String(data[slugField.k] || "").trim()) {
        data[slugField.k] = String(data[slugField.auto] || "").trim();
      }
      for (var j = 0; j < spec.fields.length; j++) {
        var g = spec.fields[j];
        if (g.req && !String(data[g.k] == null ? "" : data[g.k]).trim()) {
          say("app", "「" + g.l.replace(/（.*?）/g, "") + "」不能为空", "err");
          return;
        }
      }
      save.disabled = true;
      onSave(data, function () { save.disabled = false; });
    });
    acts.appendChild(save);

    var cancel = el("button", "btn ghost", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", onCancel);
    acts.appendChild(cancel);
    box.appendChild(acts);

    box.read = function () { return inputs; };
    /* 保存成功后由调用方触发：清掉已入库内容的草稿 */
    box.clearDraft = function () {
      (box.mdKeys || []).forEach(function (k) { clearDraft(k); });
    };
    box.fill = function (data) {
      spec.fields.forEach(function (f) {
        var v = data ? data[f.k] : "";
        if (f.t === "bool") inputs[f.k].checked = data ? (v !== false) : true;
        else if (f.t === "tags") inputs[f.k].value = tagsToText(v);
        else if (f.t === "select") {
          var opts = f.opts || [];
          var has = opts.some(function (o) { return o[0] === v; });
          inputs[f.k].value = has ? v : (opts[0] ? opts[0][0] : "");
        }
        else inputs[f.k].value = v == null ? "" : v;
      });
    };
    box.focusFirst = function () {
      var first = spec.fields[0];
      if (first && inputs[first.k] && inputs[first.k].focus) inputs[first.k].focus();
    };
    return box;
  }

  /* ---------------- 通用：打开一个表单弹层 ---------------- */
  var overlay = null;
  function openForm(title, formNode) {
    closeForm();
    overlay = el("div", "cf-overlay");
    var panel = el("div", "cf-panel");
    var head = el("div", "cf-head");
    head.appendChild(el("b", null, title));
    var x = el("button", "btn icon", "✕");
    x.type = "button";
    x.addEventListener("click", closeForm);
    head.appendChild(x);
    panel.appendChild(head);

    var body = el("div", "cf-body");
    body.appendChild(formNode);
    panel.appendChild(body);
    overlay.appendChild(panel);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeForm(); });
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    if (formNode.focusFirst) formNode.focusFirst();
  }
  function closeForm() {
    draftTimers.forEach(function (t) { clearInterval(t); });
    draftTimers.length = 0;
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.body.style.overflow = "";
  }

  /* ---------------- 内容操作 ---------------- */
  function create(type, data, parentId, done) {
    return api("content", { method: "POST", body: { type: type, data: data, parent_id: parentId || undefined } })
      .then(done).catch(function (e) { say("app", e.message, "err"); });
  }
  function update(id, data, done) {
    return api("content", { method: "PATCH", body: { id: id, data: data } })
      .then(done).catch(function (e) { say("app", e.message, "err"); });
  }
  function remove(id, what, done) {
    if (!confirm("删除这个" + what + "？删了就找不回来了。")) return;
    api("content?id=" + encodeURIComponent(id), { method: "DELETE" })
      .then(function (j) {
        if (j.alsoDeletedLinks) say("app", "已删除，同时删掉了 " + j.alsoDeletedLinks + " 条链接");
        else say("app", "已删除");
        return done();
      })
      .catch(function (e) { say("app", e.message, "err"); });
  }

  /* ---------------- 渲染：导航 ---------------- */
  var navCache = { categories: [], links: [] };

  function loadNav() {
    return api("content?type=nav").then(function (j) {
      navCache.categories = j.categories || [];
      navCache.links = j.links || [];
    });
  }

  function renderNav() {
    var host = $("navHost");
    host.innerHTML = "";
    var cats = navCache.categories;

    if (!cats.length) {
      var empty = el("div", "empty");
      empty.appendChild(el("div", null, "还没有任何分类。"));
      var imp = el("button", "btn", "从现有 links.js 导入");
      imp.type = "button";
      imp.style.marginTop = "12px";
      imp.addEventListener("click", importFromLinksJs);
      empty.appendChild(imp);
      var add = el("button", "btn ghost", "手动新建一个分类");
      add.type = "button";
      add.style.margin = "12px 0 0 8px";
      add.addEventListener("click", function () { editCategory(null); });
      empty.appendChild(add);
      host.appendChild(empty);
      return;
    }

    cats.forEach(function (cat) {
      var card = el("div", "card");
      var h = el("h2");
      h.appendChild(el("span", null, cat.data.name || "(未命名)"));
      var links = navCache.links.filter(function (l) { return l.parent_id === cat.id; });
      h.appendChild(el("span", "cnt", String(links.length)));
      var ops = el("span", "cf-catops");
      var b1 = el("button", "btn ghost sm", "加链接");
      b1.type = "button";
      b1.addEventListener("click", function () { editLink(null, cat.id); });
      var b2 = el("button", "btn ghost sm", "改名");
      b2.type = "button";
      b2.addEventListener("click", function () { editCategory(cat); });
      var b3 = el("button", "btn ghost sm danger", "删除");
      b3.type = "button";
      b3.addEventListener("click", function () {
        remove(cat.id, "分类（连同它下面的 " + links.length + " 条链接）", refreshNav);
      });
      ops.appendChild(b1); ops.appendChild(b2); ops.appendChild(b3);
      h.appendChild(ops);
      card.appendChild(h);

      if (!links.length) card.appendChild(el("div", "empty", "这个分类下还没有链接。"));
      else links.forEach(function (l) {
        var row = el("div", "item");
        var main = el("div", "main");
        main.appendChild(el("div", "t", l.data.name || ""));
        var sub = el("div", "sub");
        sub.appendChild(el("span", "pill", l.data.url || ""));
        (l.data.tags || []).forEach(function (t) { sub.appendChild(el("span", "pill", t)); });
        main.appendChild(sub);
        if (l.data.desc) main.appendChild(el("div", "note", l.data.desc));
        row.appendChild(main);
        var o = el("div", "ops");
        var e1 = el("button", null, "✎");
        e1.addEventListener("click", function () { editLink(l, cat.id); });
        var e2 = el("button", null, "✕");
        e2.addEventListener("click", function () { remove(l.id, "链接", refreshNav); });
        o.appendChild(e1); o.appendChild(e2);
        row.appendChild(o);
        card.appendChild(row);
      });

      host.appendChild(card);
    });

    var bar = el("div", "cf-actions");
    var addCat = el("button", "btn ghost", "＋ 新建分类");
    addCat.type = "button";
    addCat.addEventListener("click", function () { editCategory(null); });
    bar.appendChild(addCat);
    host.appendChild(bar);
  }

  function refreshNav() { return loadNav().then(renderNav); }

  function editCategory(cat) {
    var form = buildForm("nav_category", function (data, unlock) {
      var p = cat ? update(cat.id, data, unlock) : create("nav_category", data, null, unlock);
      p.then(function () { closeForm(); return refreshNav(); })
       .then(function () { say("app", cat ? "已保存" : "已添加"); });
    }, closeForm);
    form.fill(cat ? cat.data : null);
    openForm(cat ? "编辑分类" : "新建分类", form);
  }

  function editLink(link, categoryId) {
    var form = buildForm("nav_link", function (data, unlock) {
      var p = link ? update(link.id, data, unlock) : create("nav_link", data, categoryId, unlock);
      p.then(function () { closeForm(); return refreshNav(); })
       .then(function () { say("app", link ? "已保存" : "已添加"); });
    }, closeForm);
    form.fill(link ? link.data : null);
    openForm(link ? "编辑链接" : "添加链接", form);
  }

  /* ===== LINKS-IMPORT-START ===== */
  /* 解析 links.js 原文（window.NAV_DATA = {...};）。
     注意：links.js 是手写的 JS 对象 literal（键名不带引号），不是合法 JSON，
     不能 JSON.parse（历史上就是这么挂的：Expected property name）。
     用 Function 求值——内容是自己仓库的同源文件，与导航页直接 <script> 加载它等价，
     无额外风险。 */
  function parseLinksJs(text) {
    var s = String(text == null ? "" : text);
    var m = s.match(/window\.NAV_DATA\s*=\s*([\s\S]*?);?\s*$/);
    if (!m) throw new Error("links.js 格式看不懂");
    var data = (new Function("return (" + m[1] + ")"))();
    if (!data || !Array.isArray(data.categories)) throw new Error("找不到 categories 数组");
    data.categories.forEach(function (c, i) {
      if (!c || !Array.isArray(c.links)) throw new Error("第 " + (i + 1) + " 个分类缺少 links 数组");
    });
    return data;
  }
  /* ===== LINKS-IMPORT-END ===== */

  /* 把旧的 links.js 数据一次性导入数据库 */
  function importFromLinksJs() {
    if (!confirm("把 links.js 里现有的分类和链接全部导入？只在数据库为空时做一次。")) return;
    fetch("../nav/links.js").then(function (r) { return r.text(); }).then(function (text) {
      var data = parseLinksJs(text);
      var chain = Promise.resolve(0);
      (data.categories || []).forEach(function (cat) {
        chain = chain.then(function (n) {
          return api("content", { method: "POST", body: { type: "nav_category", data: { name: cat.name } } })
            .then(function (j) {
              var id = j.item.id;
              var inner = Promise.resolve();
              (cat.links || []).forEach(function (l) {
                inner = inner.then(function () {
                  return api("content", {
                    method: "POST",
                    body: { type: "nav_link", parent_id: id,
                            data: { name: l.name, url: l.url, desc: l.desc, tip: l.tip, tags: l.tags || [], keywords: l.keywords || [] } }
                  });
                });
              });
              return inner.then(function () { return n + 1 + (cat.links || []).length; });
            });
        });
      });
      return chain;
    }).then(function (n) {
      say("app", "已导入 " + n + " 条内容");
      return refreshNav();
    }).catch(function (e) { say("app", "导入失败：" + e.message, "err"); });
  }

  /* ---------------- 渲染：通用列表型内容 ---------------- */
  function renderList(type, hostId, opts) {
    opts = opts || {};
    var host = $(hostId);
    host.innerHTML = "";
    var items = cache[type] || [];

    var bar = el("div", "cf-actions");
    var add = el("button", "btn", "＋ 新增" + SCHEMA[type].name);
    add.type = "button";
    add.addEventListener("click", function () { editItem(type, null, hostId, opts); });
    bar.appendChild(add);
    host.appendChild(bar);

    if (!items.length) {
      host.appendChild(el("div", "empty", "还没有" + SCHEMA[type].name + "。点上面的按钮加一个。"));
      return;
    }

    var card = el("div", "card");
    items.forEach(function (it) {
      var row = el("div", "item");
      var main = el("div", "main");
      main.appendChild(el("div", "t", opts.title(it)));
      var sub = el("div", "sub");
      (opts.meta ? opts.meta(it) : []).forEach(function (t) {
        sub.appendChild(el("span", "pill", t));
      });
      if (sub.childNodes.length) main.appendChild(sub);
      if (opts.note) {
        var n = opts.note(it);
        if (n) main.appendChild(el("div", "note", n));
      }
      row.appendChild(main);
      var o = el("div", "ops");
      var e1 = el("button", null, "✎");
      e1.addEventListener("click", function () { editItem(type, it, hostId, opts); });
      var e2 = el("button", null, "✕");
      e2.addEventListener("click", function () {
        remove(it.id, SCHEMA[type].name, function () { return reload(type).then(function () { renderList(type, hostId, opts); }); });
      });
      o.appendChild(e1); o.appendChild(e2);
      /* 各内容类型自己的快捷操作（如博客的一键发布/转草稿） */
      if (opts.ops) opts.ops(it).forEach(function (b) { o.appendChild(b); });
      row.appendChild(o);
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  function editItem(type, item, hostId, opts) {
    var form = buildForm(type, function (data, unlock) {
      var p = item ? update(item.id, data, unlock) : create(type, data, null, unlock);
      p.then(function () {
        if (form.clearDraft) form.clearDraft();
        closeForm();
        return reload(type);
      })
       .then(function () { renderList(type, hostId, opts); say("app", item ? "已保存" : "已添加"); });
    }, closeForm);
    form.fill(item ? item.data : null);
    openForm(item ? "编辑" + SCHEMA[type].name : "新增" + SCHEMA[type].name, form);
  }

  var cache = { post: [], page: [], media: [], learn_map: [] };
  function reload(type) {
    return api("content?type=" + type).then(function (j) { cache[type] = j.items || []; });
  }

  /* ===== LEARN-NODES-START ===== */
  /* 学习地图的节点编辑。
     节点不是独立记录，而是内嵌在地图的 data.nodes 数组里，
     所以这里不走通用 buildForm，而是自己画一份「一张地图 + 节点列表」的编辑面板。
     要点：
       - id 是节点在地图内的唯一标识，AI 靠它精确定位；这里自动生成，不让手填
       - 上下移动 / 所在分组一起决定前台显示顺序，所以排序要能改
       - 新增节点默认继承上一行的分组，连续加同一组的节点就不用反复输入
     数据落库统一走 /api/learn（节点粒度的原子接口），避免整表覆盖写。 */

  /* 组内顺序 = 数组顺序；分组名按首次出现排 */
  function groupOf(nodes) {
    var order = [], map = {};
    nodes.forEach(function (n) {
      var g = (n && n.group) || "";
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(n);
    });
    return order.map(function (g) { return { name: g, nodes: map[g] }; });
  }

  /* 生成一个地图内没被占用的节点 id */
  function newNodeId(nodes) {
    var used = {};
    nodes.forEach(function (n) { if (n && n.id) used[String(n.id)] = true; });
    var i = nodes.length + 1;
    while (used["n" + i]) i++;
    return "n" + i;
  }

  function nodeRow(node, nodes, idx, refresh) {
    var row = el("div", "lmrow" + (node.done ? " done" : ""));
    row.dataset.nid = node.id;

    /* 左：拖动把手 + 完成勾选 */
    var lead = el("div", "lmlead");
    var grip = el("span", "lmgrip", "⠿");
    grip.title = "拖动或点 ↑↓ 调整顺序";
    lead.appendChild(grip);
    var chk = el("input");
    chk.type = "checkbox";
    chk.checked = !!node.done;
    chk.title = "标记完成";
    chk.addEventListener("change", function () {
      patchNode(refresh, node.id, { done: chk.checked }, function () { chk.checked = !chk.checked; });
    });
    lead.appendChild(chk);
    row.appendChild(lead);

    /* 中：文字 / 分组 / 备注，三行都是可直接编辑的输入框 */
    var mid = el("div", "lmmid");
    var t = el("input", "lmt");
    t.type = "text";
    t.value = node.text || "";
    t.placeholder = "要学的东西";
    t.title = "节点文字";
    var g = el("input", "lmg");
    g.type = "text";
    g.value = node.group || "";
    g.placeholder = "分组（可空）";
    g.title = "分组名，同名的会归到一起";
    var nt = el("input", "lmnt");
    nt.type = "text";
    nt.value = node.note || "";
    nt.placeholder = "备注（可空）";
    nt.title = "备注，前台显示在节点下方";

    /* 失焦才保存，避免每敲一个字就打一次接口 */
    t.addEventListener("blur", function () {
      if (t.value.trim() === (node.text || "")) return;
      patchNode(refresh, node.id, { text: t.value });
    });
    g.addEventListener("blur", function () {
      if (g.value.trim() === (node.group || "")) return;
      patchNode(refresh, node.id, { group: g.value });
    });
    nt.addEventListener("blur", function () {
      if (nt.value.trim() === (node.note || "")) return;
      patchNode(refresh, node.id, { note: nt.value });
    });
    /* 回车即保存并失焦，符合「敲完就走」的习惯 */
    [t, g, nt].forEach(function (inp) {
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
    });

    mid.appendChild(t);
    mid.appendChild(g);
    mid.appendChild(nt);
    row.appendChild(mid);

    /* 右：上移 / 下移 / 插入下方 / 删除 */
    var ops = el("div", "lmops");
    var up = el("button", null, "↑");
    up.type = "button"; up.title = "上移";
    up.disabled = idx === 0;
    up.addEventListener("click", function () { moveNode(refresh, nodes, idx, idx - 1); });
    var dn = el("button", null, "↓");
    dn.type = "button"; dn.title = "下移";
    dn.disabled = idx === nodes.length - 1;
    dn.addEventListener("click", function () { moveNode(refresh, nodes, idx, idx + 1); });
    var add = el("button", null, "＋");
    add.type = "button"; add.title = "在下面插一个（继承本行分组）";
    add.addEventListener("click", function () { insertAfter(refresh, nodes, idx); });
    var del = el("button", null, "✕");
    del.type = "button"; del.title = "删掉这个节点";
    del.addEventListener("click", function () {
      if (!confirm("删掉「" + (node.text || "这个节点") + "」？")) return;
      patchNode(refresh, null, null, null);   /* 占位，见下 */
    });
    /* 删除走独立分支：不用 nodeId 定位的 patch，而是 removeNode */
    del.onclick = function () {
      if (!confirm("删掉「" + (node.text || "这个节点") + "」？删了就找不回来了。")) return;
      busy(del, true);
      api("learn?action=removeNode", { method: "POST", body: { id: mapId, nodeId: node.id } })
        .then(function () { say("app", "已删除"); return refresh(); })
        .catch(function (e) { say("app", e.message, "err"); busy(del, false); });
    };
    ops.appendChild(up); ops.appendChild(dn); ops.appendChild(add); ops.appendChild(del);
    row.appendChild(ops);
    return row;
  }

  /* 统一改一个节点的某个字段；失败就回调（用于把复选框翻回去） */
  function patchNode(refresh, nodeId, patch, onFail) {
    return api("learn?action=updateNode", { method: "POST", body: { id: mapId, nodeId: nodeId, patch: patch } })
      .then(function () { return refresh(); })
      .catch(function (e) { say("app", e.message, "err"); if (onFail) onFail(); });
  }

  /* 把 nodes[i] 移到 i2，并整体写回（顺序就是前台显示顺序） */
  function moveNode(refresh, nodes, i, i2) {
    if (i2 < 0 || i2 >= nodes.length) return;
    var copy = nodes.slice();
    var moved = copy.splice(i, 1)[0];
    copy.splice(i2, 0, moved);
    api("learn?action=setNodes", { method: "POST", body: { id: mapId, nodes: copy } })
      .then(function () { return refresh(); })
      .catch(function (e) { say("app", e.message, "err"); });
  }

  /* 在第 i 行下面插一个空节点，默认继承它的分组 */
  function insertAfter(refresh, nodes, i) {
    var g = (nodes[i] && nodes[i].group) || "";
    api("learn?action=addNode", { method: "POST", body: { id: mapId, node: { text: "新节点", group: g } } })
      .then(function () { return refresh(); })
      .catch(function (e) { say("app", e.message, "err"); });
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
  }

  /* 当前正在编辑哪张地图（给上面几个节点操作函数用） */
  var mapId = null;

  /* 渲染一张地图的编辑面板：地图信息 + 分组后的节点列表 */
  function renderMapEditor(map, onBack) {
    var wrap = el("div", "lmedit");
    var nodes = (map.data && map.data.nodes) || [];
    mapId = map.id;

    /* 顶部：返回 + 标题 */
    var bar = el("div", "cf-actions");
    var back = el("button", "btn ghost sm", "← 返回地图列表");
    back.type = "button";
    back.addEventListener("click", onBack);
    bar.appendChild(back);
    wrap.appendChild(bar);

    /* 地图信息 */
    var info = el("div", "card");
    var h = el("h2");
    h.appendChild(el("span", null, "🗺️ " + (map.data.title || "(未命名地图)")));
    h.appendChild(el("span", "cnt", nodes.length + " 个节点"));
    info.appendChild(h);
    if (map.data.desc) info.appendChild(el("p", "lmdsc", map.data.desc));

    var infoOps = el("div", "cf-actions");
    var eTitle = el("button", "btn ghost sm", "改标题 / 说明 / 状态");
    eTitle.type = "button";
    eTitle.addEventListener("click", function () { editMapInfo(map, onBack); });
    infoOps.appendChild(eTitle);
    info.appendChild(infoOps);
    wrap.appendChild(info);

    /* 节点区 */
    var card = el("div", "card");
    var nh = el("h2");
    nh.appendChild(el("span", null, "📋 节点"));
    nh.appendChild(el("span", "cnt", nodes.length));
    card.appendChild(nh);

    var hint = el("p", "hintline");
    hint.textContent = "文字 / 分组 / 备注 直接改，点开别处就自动存。↑↓ 调顺序，＋ 在下面插一个，✕ 删掉。";
    card.appendChild(hint);

    if (!nodes.length) {
      card.appendChild(el("div", "empty", "这张地图还没有节点。点下面的按钮加一个，或者让 AI 助手帮你拆。"));
    } else {
      var current = null;
      nodes.forEach(function (n, i) {
        var g = (n && n.group) || "";
        if (g !== current) {
          current = g;
          var gh = el("div", "lmgrp-h", g || "未分组");
          card.appendChild(gh);
        }
        card.appendChild(nodeRow(n, nodes, i, function () { return reloadEditor(onBack); }));
      });
    }

    var addBar = el("div", "cf-actions");
    var addNode = el("button", "btn", "＋ 新增节点");
    addNode.type = "button";
    addNode.addEventListener("click", function () {
      var last = nodes.length ? (nodes[nodes.length - 1].group || "") : "";
      api("learn?action=addNode", { method: "POST", body: { id: mapId, node: { text: "新节点", group: last } } })
        .then(function () { return reloadEditor(onBack); })
        .catch(function (e) { say("app", e.message, "err"); });
    });
    addBar.appendChild(addNode);
    card.appendChild(addBar);
    wrap.appendChild(card);

    return wrap;
  }

  /* 重新读当前地图并重画编辑面板 */
  var editorHost = null, editorBack = null;
  function reloadEditor(onBack) {
    editorBack = onBack || editorBack;
    return api("learn?id=" + encodeURIComponent(mapId)).then(function (j) {
      if (!editorHost || !j.item) return;
      editorHost.innerHTML = "";
      var fresh = { id: j.item.id, data: j.item.data || {} };
      editorHost.appendChild(renderMapEditor(fresh, editorBack));
    });
  }

  /* 改地图本身的信息，复用通用表单 + /api/learn 的 PATCH */
  function editMapInfo(map, onBack) {
    var form = buildForm("learn_map", function (data, unlock) {
      api("learn", { method: "PATCH", body: { id: map.id, title: data.title, desc: data.desc, status: data.status } })
        .then(function () { closeForm(); return reloadEditor(onBack); })
        .then(function () { say("app", "已保存"); })
        .catch(function (e) { say("app", e.message, "err"); unlock(); });
    }, closeForm);
    form.fill(map.data || null);
    openForm("编辑学习地图", form);
  }

  /* 学习地图的主渲染：先列地图，点进去进编辑面板 */
  function renderLearn(hostId) {
    var host = $(hostId);
    host.innerHTML = "";
    editorHost = el("div");
    mapId = null;

    function listView() {
      host.innerHTML = "";
      host.appendChild(editorHost);
      editorHost.innerHTML = "";
      mapId = null;
      return api("learn").then(function (j) {
        var items = (j && j.items) || [];

        var bar = el("div", "cf-actions");
        var add = el("button", "btn", "＋ 新建学习地图");
        add.type = "button";
        add.addEventListener("click", function () { newMap(listView); });
        bar.appendChild(add);
        editorHost.appendChild(bar);

        if (!items.length) {
          var empty = el("div", "empty");
          empty.appendChild(el("div", null, "还没有学习地图。"));
          var tips = el("p", "hintline");
          tips.textContent = "点上面的按钮新建一张，或者让 AI 助手通过 /api/learn 帮你建、帮你查漏补缺。";
          empty.appendChild(tips);
          editorHost.appendChild(empty);
          return;
        }

        var card = el("div", "card");
        items.forEach(function (m) {
          var row = el("div", "item");
          var main = el("div", "main");
          main.appendChild(el("div", "t", m.title || "(未命名地图)"));
          var sub = el("div", "sub");
          var st = { active: "在学", done: "学完", archived: "归档" }[m.status] || m.status;
          sub.appendChild(el("span", "pill", st));
          var p = m.progress || { done: 0, total: 0 };
          sub.appendChild(el("span", "pill", "完成 " + (p.done || 0) + " / " + (p.total || 0)));
          if (p.percent != null) sub.appendChild(el("span", "pill", p.percent + "%"));
          main.appendChild(sub);
          if (m.desc) main.appendChild(el("div", "note", m.desc));
          row.appendChild(main);

          var ops = el("div", "ops");
          var open = el("button", null, "✎");
          open.title = "打开编辑节点";
          open.addEventListener("click", function () { openMap(m.id, listView); });
          var del = el("button", null, "✕");
          del.title = "删掉整张地图";
          del.addEventListener("click", function () {
            if (!confirm("删掉整张「" + (m.title || "未命名地图") + "」？里面的节点会一起没。")) return;
            api("learn?id=" + encodeURIComponent(m.id), { method: "DELETE" })
              .then(function () { say("app", "已删除"); return listView(); })
              .catch(function (e) { say("app", e.message, "err"); });
          });
          ops.appendChild(open); ops.appendChild(del);
          row.appendChild(ops);
          card.appendChild(row);
        });
        editorHost.appendChild(card);
      });
    }

    return listView().catch(function (e) { say("app", e.message, "err"); });
  }

  /* 打开某张地图的编辑面板 */
  function openMap(id, onBack) {
    mapId = id;
    return api("learn?id=" + encodeURIComponent(id)).then(function (j) {
      if (!editorHost) return;
      editorHost.innerHTML = "";
      editorHost.appendChild(renderMapEditor({ id: j.item.id, data: j.item.data || {} }, onBack));
      window.scrollTo(0, 0);
    }).catch(function (e) { say("app", e.message, "err"); });
  }

  /* 新建地图 */
  function newMap(onDone) {
    var form = buildForm("learn_map", function (data, unlock) {
      api("learn", { method: "POST", body: { title: data.title, desc: data.desc, status: data.status } })
        .then(function (j) { closeForm(); return j; })
        .then(function (j) {
          say("app", "已新建，开始加节点吧");
          return onDone().then(function () { return openMap(j.item.id, onDone); });
        })
        .catch(function (e) { say("app", e.message, "err"); unlock(); });
    }, closeForm);
    form.fill({ status: "active" });
    openForm("新建学习地图", form);
  }
  /* ===== LEARN-NODES-END ===== */

  var RENDERERS = {
    nav: function () { return loadNav().then(renderNav); },
    post: function () {
      return reload("post").then(function () {
        var postOpts = {
          title: function (i) { return i.data.title; },
          meta: function (i) {
            var m = ["/" + i.data.slug];
            if (i.data.published === false) m.push("草稿");
            (i.data.tags || []).forEach(function (t) { m.push(t); });
            return m;
          },
          note: function (i) {
            return i.data.summary || (md ? md.plain(i.data.content, 80) : "");
          },
          /* 一键发布 / 转草稿：不用打开表单改复选框 */
          ops: function (i) {
            var out = [];
            var pub = i.data.published !== false;
            var b = el("button", null, pub ? "转草稿" : "发布");
            b.title = pub ? "转成草稿，前台立刻不显示" : "公开发布，前台立即可见";
            b.addEventListener("click", function () {
              if (!confirm(pub ? "把《" + i.data.title + "》转成草稿？前台会立刻不显示。"
                               : "发布《" + i.data.title + "》？前台立刻可见。")) return;
              b.disabled = true;
              api("content", { method: "PATCH", body: { id: i.id, data: { published: !pub } } })
                .then(function () { return reload("post"); })
                .then(function () {
                  renderList("post", "postHost", postOpts);
                  say("app", pub ? "已转为草稿" : "已发布");
                })
                .catch(function (e) { say("app", e.message, "err"); b.disabled = false; });
            });
            out.push(b);
            return out;
          }
        };
        renderList("post", "postHost", postOpts);
      });
    },
    page: function () {
      return reload("page").then(function () {
        renderList("page", "pageHost", {
          title: function (i) { return i.data.title + "（" + i.data.key + "）"; },
          meta: function () { return []; },
          note: function (i) { return md ? md.plain(i.data.content, 80) : ""; }
        });
      });
    },
    media: function () {
      return reload("media").then(function () {
        renderList("media", "mediaHost", {
          title: function (i) { return i.data.name || "(未命名)"; },
          meta: function (i) {
            var m = [];
            m.push(i.data.category === "comic" ? "漫画" : "追番");
            var st = { wish: "想看", watching: "在看", finished: "看完", paused: "搁置" }[i.data.status];
            if (st) m.push(st);
            if (i.data.score != null && i.data.score !== "") m.push(i.data.score + " 分");
            if (i.data.date) m.push(i.data.date);
            return m;
          },
          note: function (i) { return i.data.note || ""; }
        });
      });
    },
    learn_map: function () { return renderLearn("learnHost"); }
  };

  function render(tab) {
    if (!RENDERERS[tab]) return Promise.resolve();
    return RENDERERS[tab]().catch(function (e) { say("app", e.message, "err"); });
  }

  global.ContentAdmin = {
    init: function (opts) {
      api = opts.api; say = opts.say; md = global.MD || null;
    },
    render: render,
    types: Object.keys(SCHEMA)
  };
})(window);
