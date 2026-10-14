/* ===========================================================================
   admin/content.js · 内容管理（导航 / 博客 / 文件 / 页面）
   ---------------------------------------------------------------------------
   由 admin/index.html 加载，复用它的 api() 和 say()。
   四种内容共用「字段定义 → 通用表单 / 通用列表」的写法，避免重复代码。
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
        { k: "tags", l: "标签（逗号分隔）", t: "tags", ph: "代码, 英文" }
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
    file: {
      name: "文件",
      fields: [
        { k: "name", l: "文件名", t: "text", ph: "比如：demo.zip", req: true },
        { k: "url", l: "文件地址", t: "text", ph: "files/demo.zip 或完整网址", req: true },
        { k: "desc", l: "说明（可空）", t: "text", ph: "一句话说明" }
      ]
    },
    page: {
      name: "页面",
      fields: [
        { k: "key", l: "页面标识", t: "text", ph: "about / home", req: true },
        { k: "title", l: "标题", t: "text", req: true },
        { k: "content", l: "正文（Markdown）", t: "md", req: true }
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
        wrap.appendChild(ta);
        inputs[f.k] = ta;
        var prev = el("div", "mdprev hide");
        var btn = el("button", "btn ghost sm mdprevbtn", "预览");
        btn.type = "button";
        btn.addEventListener("click", function () {
          var on = prev.classList.toggle("hide");
          btn.textContent = on ? "预览" : "收起预览";
          if (!on) prev.innerHTML = md ? md.render(ta.value) : "";
        });
        wrap.appendChild(btn);
        wrap.appendChild(prev);
      } else if (f.t === "bool") {
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = true;
        var line = el("div", "cf-bool");
        line.appendChild(cb);
        line.appendChild(el("span", null, "打勾则在前台显示"));
        wrap.appendChild(line);
        inputs[f.k] = cb;
      } else {
        var inp = el("input");
        inp.type = "text";
        if (f.ph) inp.placeholder = f.ph;
        if (f.t === "tags") inp.autocomplete = "off";

        /* 文件类型：url 输入框旁加「上传」按钮，直传 Vercel Blob，成功后回填 url */
        if (type === "file" && f.k === "url") {
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
    box.fill = function (data) {
      spec.fields.forEach(function (f) {
        var v = data ? data[f.k] : "";
        if (f.t === "bool") inputs[f.k].checked = data ? (v !== false) : true;
        else if (f.t === "tags") inputs[f.k].value = tagsToText(v);
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
                            data: { name: l.name, url: l.url, desc: l.desc, tags: l.tags || [] } }
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
      row.appendChild(o);
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  function editItem(type, item, hostId, opts) {
    var form = buildForm(type, function (data, unlock) {
      var p = item ? update(item.id, data, unlock) : create(type, data, null, unlock);
      p.then(function () { closeForm(); return reload(type); })
       .then(function () { renderList(type, hostId, opts); say("app", item ? "已保存" : "已添加"); });
    }, closeForm);
    form.fill(item ? item.data : null);
    openForm(item ? "编辑" + SCHEMA[type].name : "新增" + SCHEMA[type].name, form);
  }

  var cache = { post: [], file: [], page: [] };
  function reload(type) {
    return api("content?type=" + type).then(function (j) { cache[type] = j.items || []; });
  }

  var RENDERERS = {
    nav: function () { return loadNav().then(renderNav); },
    post: function () {
      return reload("post").then(function () {
        renderList("post", "postHost", {
          title: function (i) { return i.data.title; },
          meta: function (i) {
            var m = ["/" + i.data.slug];
            if (i.data.published === false) m.push("草稿");
            (i.data.tags || []).forEach(function (t) { m.push(t); });
            return m;
          },
          note: function (i) {
            return i.data.summary || (md ? md.plain(i.data.content, 80) : "");
          }
        });
      });
    },
    file: function () {
      return reload("file").then(function () {
        renderList("file", "fileHost", {
          title: function (i) { return i.data.name; },
          meta: function (i) { return [i.data.url]; },
          note: function (i) { return i.data.desc; }
        });
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
    }
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
