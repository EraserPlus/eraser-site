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
        { k: "episodes", l: "总集数（可空）", t: "text", ph: "比如：28。「按名字自动填充」会帮你填" },
        { k: "progress", l: "看到第几集（可空）", t: "text", ph: "比如：12。填了才显示进度条" },
        { k: "note", l: "备注（可空）", t: "text", ph: "一句话，比如：周五更新 · B站有删减" },
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

  /* ===== MEDIA-TOOLS-START ===== */
  /* 追更（media）的批量导入 + 自动填充 + 列表工具。
     这一块存在的理由：站长反馈「每次进后台找、改、加都很麻烦，想大量导入」。
     三件事：
       1) 批量导入：粘一份清单（CSV / TSV / 纯文本 / JSON）→ 预览 → 一次提交
       2) 自动填充：打个名字去 AniList 查，封面/评分/话数/年份/链接自动带回来
       3) 列表工具：搜索 + 栏目/状态筛选 + 排序 + 行内改状态（不必进表单）
     全部用 createElement/textContent 构建，不拼 innerHTML（防注入，pages_audit 有守卫）。 */

  /* ---------- 小工具 ---------- */
  function mediaStatusLabel(s) {
    return { wish: "想看", watching: "在看", finished: "看完", paused: "搁置" }[s] || s || "";
  }
  function mediaCatLabel(c) { return c === "comic" ? "漫画" : "追番"; }

  /* 把「栏目/状态」的各种写法统一到内部值，容错中文、英文、简写 */
  function normCategory(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    if (/comic|漫画|漫|manga/.test(s)) return "comic";
    if (/anime|追番|番|动画|tv/.test(s)) return "anime";
    return "";
  }
  function normStatus(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    if (/finish|done|看完|读完|complete|完成/.test(s)) return "finished";
    if (/watch|reading|在看|在读|进行|追/.test(s)) return "watching";
    if (/pause|hold|搁置|弃|缓/.test(s)) return "paused";
    if (/wish|want|plan|想看|想读|待看|计划/.test(s)) return "wish";
    return "";
  }

  /* 集数 / 进度这类数字：从「28 话」「第 12 集」「12」里抠出数字。
     抠不到就留空——宁可让用户自己补，也不瞎猜一个数出来。 */
  function normCount(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var mm = s.match(/\d+/);
    return mm ? String(Number(mm[0])) : "";
  }

  /* 一行文本按分隔符切成格子。支持 Tab / 逗号（中英） / 竖线 / 多个空格 */
  function splitRow(line) {
    if (line.indexOf("\t") >= 0) return line.split("\t").map(function (x) { return x.trim(); });
    if (/[|｜]/.test(line)) return line.split(/[|｜]/).map(function (x) { return x.trim(); });
    if (/[,，]/.test(line)) return line.split(/[,，]/).map(function (x) { return x.trim(); });
    return line.split(/\s{2,}/).map(function (x) { return x.trim(); });
  }

  /* 表头识别：把首行文字映射成字段名 */
  var HEAD_ALIAS = {
    name: ["名称", "名字", "标题", "番名", "name", "title"],
    category: ["栏目", "分类", "类型", "category", "type", "kind"],
    status: ["状态", "status"],
    score: ["评分", "分数", "打分", "score", "rating"],
    episodes: ["总集数", "集数", "话数", "总话数", "episodes", "eps", "total"],
    progress: ["进度", "看到", "看到第几集", "已看", "progress", "current"],
    note: ["备注", "说明", "note", "remark", "desc"],
    date: ["日期", "时间", "date"],
    url: ["链接", "网址", "地址", "url", "link"],
    cover: ["封面", "封面图", "图片", "cover", "image", "poster"],
  };
  function headField(cell) {
    var s = String(cell == null ? "" : cell).trim().toLowerCase().replace(/[\s（(].*$/, "");
    for (var k in HEAD_ALIAS) {
      if (HEAD_ALIAS[k].some(function (a) { return a === s; })) return k;
    }
    return null;
  }

  /* 解析粘进来的文本 → 候选条目数组。
     判断有没有表头：首行每一格都能被识别成字段名，就当作表头。 */
  function parseRows(text) {
    var lines = String(text || "").split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return { items: [], groups: [], hasHead: false };

    var first = splitRow(lines[0]);
    var headFields = first.map(headField);
    var hasHead = headFields.filter(Boolean).length >= 2 &&
                  headFields.filter(Boolean).length >= Math.ceil(first.length * 0.6);

    var body = hasHead ? lines.slice(1) : lines;
    var items = [];
    var errors = [];

    body.forEach(function (line, idx) {
      var cells = splitRow(line);
      var o = {};
      if (hasHead) {
        headFields.forEach(function (f, i) { if (f) o[f] = cells[i]; });
      } else {
        /* 无表头：约定 名称[, 栏目][, 状态][, 评分][, 备注][, 链接]
           但只靠位置猜容易错，所以这里只吃「名称 + 可能的栏目/状态」，
           其余留给用户在预览里自己补。 */
        o.name = cells[0];
        if (cells[1]) {
          var c = normCategory(cells[1]);
          var s = normStatus(cells[1]);
          if (c) o.category = c;
          else if (s) o.status = s;
        }
        if (cells[2]) { var s2 = normStatus(cells[2]); if (s2) o.status = s2; }
      }

      var name = String(o.name == null ? "" : o.name).trim();
      if (!name) { errors.push(idx + 1); return; }

      var it = {
        category: normCategory(o.category) || "anime",
        name: name,
        status: normStatus(o.status) || "watching",
        score: "",
        episodes: normCount(o.episodes),
        progress: normCount(o.progress),
        note: String(o.note == null ? "" : o.note).trim(),
        date: String(o.date == null ? "" : o.date).trim(),
        url: String(o.url == null ? "" : o.url).trim(),
        cover: String(o.cover == null ? "" : o.cover).trim(),
      };
      if (o.score != null && String(o.score).trim() !== "") {
        /* 先取出数字（含负号），越界（<0 或 >10）一律丢掉，绝不「猜」成正数 */
        var raw = String(o.score).trim();
        var mm = raw.match(/-?\d+(?:\.\d+)?/);
        if (mm) {
          var n = Number(mm[0]);
          if (Number.isFinite(n) && n >= 0 && n <= 10) it.score = String(Math.round(n * 10) / 10);
        }
      }
      items.push(it);
    });
    return { items: items, errors: errors, hasHead: hasHead };
  }

  /* 解析 JSON：既接受 [{…}] 也接受 {items:[…]}，还接受 {type,data} 包装 */
  function parseJsonItems(text) {
    var j = JSON.parse(text);
    var arr = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : null);
    if (!arr) throw new Error("JSON 要是一个数组，或 {items:[…]}");
    return arr.map(function (x) {
      var d = (x && x.data) ? x.data : (x || {});
      return {
        category: normCategory(d.category) || "anime",
        name: String(d.name == null ? "" : d.name).trim(),
        status: normStatus(d.status) || "watching",
        score: (d.score == null || d.score === "") ? "" : String(d.score),
        episodes: normCount(d.episodes),
        progress: normCount(d.progress),
        note: String(d.note == null ? "" : d.note).trim(),
        date: String(d.date == null ? "" : d.date).trim(),
        url: String(d.url == null ? "" : d.url).trim(),
        cover: String(d.cover == null ? "" : d.cover).trim(),
      };
    }).filter(function (x) { return x.name; });
  }

  function parseImport(text) {
    var t = String(text || "").trim();
    if (!t) return { items: [], errors: [], hasHead: false, json: false };
    if (t[0] === "[" || t[0] === "{") {
      var items = parseJsonItems(t);
      return { items: items, errors: [], hasHead: false, json: true };
    }
    return parseRows(t);
  }
  /* ===== MEDIA-TOOLS-END ===== */

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

  /* ==================== 追更：批量导入 + 筛选 + 行内改状态 ==================== */

  /* 列表的筛选状态（切标签不丢，存在内存里） */
  var mediaView = { q: "", cat: "all", status: "all", sort: "default" };

  function mediaFiltered() {
    var list = (cache.media || []).slice();
    var q = mediaView.q.trim().toLowerCase();
    list = list.filter(function (i) {
      var d = i.data || {};
      if (mediaView.cat !== "all" && (d.category || "anime") !== mediaView.cat) return false;
      if (mediaView.status !== "all" && d.status !== mediaView.status) return false;
      if (q) {
        var hay = [d.name, d.note, d.date, d.url].filter(Boolean).join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var rank = { watching: 0, wish: 1, paused: 2, finished: 3 };
    if (mediaView.sort === "name") {
      list.sort(function (a, b) { return String(a.data.name || "").localeCompare(String(b.data.name || ""), "zh"); });
    } else if (mediaView.sort === "score") {
      list.sort(function (a, b) { return (Number(b.data.score) || -1) - (Number(a.data.score) || -1); });
    } else if (mediaView.sort === "status") {
      list.sort(function (a, b) { return (rank[a.data.status] || 9) - (rank[b.data.status] || 9); });
    }
    return list;
  }

  function renderMedia(hostId) {
    var host = $(hostId);
    host.innerHTML = "";
    var all = cache.media || [];

    /* --- 顶部操作条 --- */
    var bar = el("div", "cf-actions");
    var bAdd = el("button", "btn", "＋ 新增追更");
    bAdd.type = "button";
    bAdd.addEventListener("click", function () { editItem("media", null, hostId, mediaListOpts(hostId)); });
    bar.appendChild(bAdd);

    var bImport = el("button", "btn", "📥 批量导入");
    bImport.type = "button";
    bImport.addEventListener("click", function () { openImport(); });
    bar.appendChild(bImport);

    var bFill = el("button", "btn", "✨ 按名字自动填充");
    bFill.type = "button";
    bFill.addEventListener("click", function () { openLookup(); });
    bar.appendChild(bFill);

    host.appendChild(bar);

    if (!all.length) {
      host.appendChild(el("div", "empty", "还没有追更记录。点「＋ 新增追更」加一个，或「📥 批量导入」一次贴一批。"));
      return;
    }

    /* --- 搜索 / 筛选 / 排序 --- */
    var tools = el("div", "mtools");

    var qi = el("input", "minput");
    qi.type = "search";
    qi.placeholder = "搜名字 / 备注 / 日期…";
    qi.value = mediaView.q;
    qi.addEventListener("input", function () { mediaView.q = qi.value; paintList(); });
    tools.appendChild(qi);

    var selCat = el("select", "mselect");
    [["all", "全部栏目"], ["anime", "追番"], ["comic", "漫画"]].forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      selCat.appendChild(op);
    });
    selCat.value = mediaView.cat;
    selCat.addEventListener("change", function () { mediaView.cat = selCat.value; paintList(); });
    tools.appendChild(selCat);

    var selSt = el("select", "mselect");
    [["all", "全部状态"], ["watching", "在看"], ["wish", "想看"], ["paused", "搁置"], ["finished", "看完"]].forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      selSt.appendChild(op);
    });
    selSt.value = mediaView.status;
    selSt.addEventListener("change", function () { mediaView.status = selSt.value; paintList(); });
    tools.appendChild(selSt);

    var selSort = el("select", "mselect");
    [["default", "默认顺序"], ["name", "按名字"], ["score", "按评分高→低"], ["status", "按状态分组"]].forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      selSort.appendChild(op);
    });
    selSort.value = mediaView.sort;
    selSort.addEventListener("change", function () { mediaView.sort = selSort.value; paintList(); });
    tools.appendChild(selSort);

    host.appendChild(tools);

    var countLine = el("div", "mcount");
    host.appendChild(countLine);

    var listHost = el("div");
    host.appendChild(listHost);

    function paintList() {
      var list = mediaFiltered();
      countLine.textContent = "共 " + all.length + " 条" +
        (list.length !== all.length ? "，当前筛出 " + list.length + " 条" : "");
      listHost.innerHTML = "";
      if (!list.length) {
        listHost.appendChild(el("div", "empty", "没有符合条件的记录。"));
        return;
      }
      var card = el("div", "card");
      list.forEach(function (it) { card.appendChild(mediaRow(it, hostId, paintList)); });
      listHost.appendChild(card);
    }
    paintList();

    /* 导出当前筛选结果，方便备份 / 换设备 */
    var exp = el("button", "btn ghost", "⤓ 导出清单（TSV）");
    exp.type = "button";
    exp.addEventListener("click", function () { exportMedia(); });
    host.appendChild(exp);
  }

  /* 单行渲染：行内可改状态（在看/想看/搁置/看完 一键切，不必进表单） */
  function mediaRow(it, hostId, refresh) {
    var d = it.data || {};
    var row = el("div", "item mrow");

    /* 封面缩略图 */
    var thumb = el("div", "mthumb");
    if (d.cover) {
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = d.cover;
      img.addEventListener("error", function () { thumb.classList.add("empty-thumb"); img.remove(); });
      thumb.appendChild(img);
    } else {
      thumb.classList.add("empty-thumb");
      thumb.textContent = String(d.name || "?").slice(0, 1);
    }
    row.appendChild(thumb);

    var main = el("div", "main");
    main.appendChild(el("div", "t", d.name || "(未命名)"));

    var sub = el("div", "sub");
    sub.appendChild(el("span", "pill", mediaCatLabel(d.category)));
    if (d.score != null && d.score !== "") sub.appendChild(el("span", "pill", d.score + " 分"));
    /* 进度：两个都有就 12 / 28，只有一个就按有的那个显示 */
    if (d.progress != null && d.progress !== "" && d.episodes != null && d.episodes !== "") {
      sub.appendChild(el("span", "pill", d.progress + " / " + d.episodes + " 话"));
    } else if (d.episodes != null && d.episodes !== "") {
      sub.appendChild(el("span", "pill", "共 " + d.episodes + " 话"));
    } else if (d.progress != null && d.progress !== "") {
      sub.appendChild(el("span", "pill", "看到 " + d.progress + " 话"));
    }
    if (d.date) sub.appendChild(el("span", "pill", d.date));
    if (d.url) {
      var a = document.createElement("a");
      a.href = d.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "链接";
      a.className = "pill link";
      sub.appendChild(a);
    }
    main.appendChild(sub);
    if (d.note) main.appendChild(el("div", "note", d.note));

    /* 行内状态切换 */
    var stWrap = el("div", "mstatus");
    [["watching", "在看"], ["wish", "想看"], ["paused", "搁置"], ["finished", "看完"]].forEach(function (o) {
      var b = el("button", "stbtn" + (d.status === o[0] ? " on" : ""), o[1]);
      b.type = "button";
      b.title = "改成「" + o[1] + "」";
      b.addEventListener("click", function () {
        if (d.status === o[0]) return;
        update(it.id, { status: o[0] }, function () {
          return reload("media").then(function () { say("app", "已改成「" + o[1] + "」"); refresh(); });
        });
      });
      stWrap.appendChild(b);
    });
    main.appendChild(stWrap);
    row.appendChild(main);

    var o = el("div", "ops");
    /* 一键 +1 话：追更最高频的动作，不用开表单。只在「在看」时出现 */
    if (d.status === "watching") {
      var e0 = el("button", null, "＋1");
      e0.title = "看到下一话（进度 +1）";
      e0.addEventListener("click", function () {
        var next = Number(d.progress || 0) + 1;
        update(it.id, { progress: next }, function () {
          return reload("media").then(function () { say("app", "进度 → 第 " + next + " 话"); refresh(); });
        });
      });
      o.appendChild(e0);
    }
    var e1 = el("button", null, "✎");
    e1.title = "编辑";
    e1.addEventListener("click", function () { editItem("media", it, hostId, mediaListOpts(hostId)); });
    var e2 = el("button", null, "✕");
    e2.title = "删除";
    e2.addEventListener("click", function () {
      remove(it.id, "追更", function () { return reload("media").then(function () { refresh(); }); });
    });
    o.appendChild(e1); o.appendChild(e2);
    row.appendChild(o);
    return row;
  }

  function mediaListOpts(hostId) {
    return {
      title: function (i) { return i.data.name || "(未命名)"; },
      meta: function (i) {
        var m = [mediaCatLabel(i.data.category)];
        var st = mediaStatusLabel(i.data.status);
        if (st) m.push(st);
        if (i.data.score != null && i.data.score !== "") m.push(i.data.score + " 分");
        if (i.data.date) m.push(i.data.date);
        return m;
      },
      note: function (i) { return i.data.note || ""; },
      afterSave: function () { renderMedia(hostId); }
    };
  }

  /* ---------- 导出 TSV（当前全部，方便备份或搬到别处） ---------- */
  function exportMedia() {
    var rows = ["名称\t栏目\t状态\t评分\t备注\t日期\t链接\t封面"];
    (cache.media || []).forEach(function (i) {
      var d = i.data || {};
      rows.push([d.name, d.category, d.status, d.score, d.note, d.date, d.url, d.cover]
        .map(function (x) { return String(x == null ? "" : x).replace(/[\t\r\n]/g, " "); }).join("\t"));
    });
    var text = rows.join("\n");
    var blob = new Blob([text], { type: "text/tab-separated-values;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "eraser-media-" + new Date().toISOString().slice(0, 10) + ".tsv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    say("app", "已导出 " + (cache.media || []).length + " 条");
  }

  /* ---------- 批量导入面板 ---------- */
  function openImport() {
    var box = el("div", "cform");

    var p = el("p", "hintline");
    p.textContent = "粘一份清单，一次全部导进去。支持：从表格复制的（Tab 分隔）/ 逗号分隔 / 每行一个名字 / JSON。";
    box.appendChild(p);

    var fmt = el("p", "hintline small");
    fmt.textContent = "有表头会按表头认列（名称 / 栏目 / 状态 / 评分 / 备注 / 日期 / 链接 / 封面）；没有表头就按顺序认「名称」。";
    box.appendChild(fmt);

    var ta = el("textarea", "mta");
    ta.rows = 10;
    ta.placeholder = "名称\t栏目\t状态\t评分\t备注\n葬送的芙莉莲\t追番\t在看\t9.1\t2023 年 · 共 28 话\n迷宫饭\t漫画\t想看\t\t";
    box.appendChild(ta);

    var rowCat = el("div", "mfilters");
    var dcat = el("select", "mselect");
    [["anime", "默认：追番"], ["comic", "默认：漫画"]].forEach(function (o) {
      var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; dcat.appendChild(op);
    });
    var dst = el("select", "mselect");
    [["watching", "默认状态：在看"], ["wish", "默认状态：想看"], ["paused", "默认：搁置"], ["finished", "默认：看完"]].forEach(function (o) {
      var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; dst.appendChild(op);
    });
    rowCat.appendChild(dcat);
    rowCat.appendChild(dst);
    rowCat.appendChild(el("span", "hintline small", "（清单里没写栏目/状态时用这个）"));
    box.appendChild(rowCat);

    var preview = el("div", "mpreview");
    box.appendChild(preview);

    var actions = el("div", "mfilters");
    var bParse = el("button", "btn ghost", "预览");
    bParse.type = "button";
    var bGo = el("button", "btn", "导入");
    bGo.type = "button";
    bGo.disabled = true;
    actions.appendChild(bParse);
    actions.appendChild(bGo);
    box.appendChild(actions);

    var parsed = { items: [] };

    function runParse() {
      var r;
      try {
        r = parseImport(ta.value);
      } catch (e) {
        preview.innerHTML = "";
        preview.appendChild(el("div", "empty", "解析失败：" + e.message));
        bGo.disabled = true;
        return;
      }
      parsed.items = r.items.map(function (it) {
        if (!it.category) it.category = dcat.value;
        if (!it.status) it.status = dst.value;
        return it;
      });
      preview.innerHTML = "";
      if (!parsed.items.length) {
        preview.appendChild(el("div", "empty", "没解析出内容。检查一下格式，或先点「预览」。"));
        bGo.disabled = true;
        return;
      }
      var head = el("div", "mcount");
      head.textContent = "解析出 " + parsed.items.length + " 条" + (r.hasHead ? "（识别到表头）" : "") +
        (r.errors && r.errors.length ? "；跳过 " + r.errors.length + " 行空名称" : "");
      preview.appendChild(head);

      var t = el("div", "mprevlist");
      parsed.items.slice(0, 30).forEach(function (it, i) {
        var line = el("div", "mprevrow");
        var n = el("span", "idx", String(i + 1));
        var c = el("select", "mselect tiny");
        [["anime", "追番"], ["comic", "漫画"]].forEach(function (o) {
          var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; c.appendChild(op);
        });
        c.value = it.category;
        c.addEventListener("change", function () { it.category = c.value; });

        var s = el("select", "mselect tiny");
        [["watching", "在看"], ["wish", "想看"], ["paused", "搁置"], ["finished", "看完"]].forEach(function (o) {
          var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; s.appendChild(op);
        });
        s.value = it.status;
        s.addEventListener("change", function () { it.status = s.value; });

        line.appendChild(n);
        line.appendChild(el("span", "nm", it.name));
        line.appendChild(c);
        line.appendChild(s);
        if (it.score) line.appendChild(el("span", "pill", it.score + " 分"));
        /* 进度：两个都有就显示 12 / 28，只有一个就按有的那个显示 */
        if (it.progress && it.episodes) line.appendChild(el("span", "pill", it.progress + " / " + it.episodes + " 话"));
        else if (it.episodes) line.appendChild(el("span", "pill", "共 " + it.episodes + " 话"));
        else if (it.progress) line.appendChild(el("span", "pill", "看到 " + it.progress + " 话"));
        t.appendChild(line);
      });
      if (parsed.items.length > 30) {
        t.appendChild(el("div", "hintline small", "…只预览前 30 条，导入时会全部写入"));
      }
      preview.appendChild(t);
      bGo.disabled = false;
    }

    bParse.addEventListener("click", runParse);
    ta.addEventListener("input", function () { bGo.disabled = true; });

    bGo.addEventListener("click", function () {
      if (!parsed.items.length) return;
      bGo.disabled = true;
      var payload = parsed.items.map(function (it) {
        return { type: "media", data: it };
      });
      api("content?batch=1", { method: "POST", body: { items: payload } })
        .then(function (j) {
          if (j.failed) {
            var lines = (j.items || []).filter(function (x) { return !x.ok; })
              .slice(0, 5).map(function (x) { return "第 " + (x.index + 1) + " 条：" + x.error; });
            say("app", "导入 " + j.created + " 条，失败 " + j.failed + " 条。\n" + lines.join("\n"), "err");
          } else {
            say("app", "成功导入 " + j.created + " 条");
          }
          closeForm();
          return reload("media").then(function () { renderMedia("mediaHost"); });
        })
        .catch(function (e) { bGo.disabled = false; say("app", e.message, "err"); });
    });

    openForm("📥 批量导入追更", box);
    ta.focus();
  }

  /* ---------- 按名字自动填充（查 AniList） ---------- */
  function openLookup() {
    var box = el("div", "cform");
    var p = el("p", "hintline");
    p.textContent = "打个名字，自动带出封面 / 评分 / 话数 / 年份 / 链接。用英文名或日文原名最准（中文名往往搜不到）。";
    box.appendChild(p);

    var row = el("div", "mfilters");
    var qi = el("input", "minput grow");
    qi.type = "text";
    qi.placeholder = "比如：Frieren / Berserk / 呪術廻戦";
    var kind = el("select", "mselect");
    [["anime", "追番"], ["comic", "漫画"]].forEach(function (o) {
      var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; kind.appendChild(op);
    });
    var bGo = el("button", "btn", "查一下");
    bGo.type = "button";
    row.appendChild(qi); row.appendChild(kind); row.appendChild(bGo);
    box.appendChild(row);

    var out = el("div", "mpreview");
    box.appendChild(out);

    function search() {
      var q = qi.value.trim();
      if (!q) { qi.focus(); return; }
      bGo.disabled = true;
      out.innerHTML = "";
      out.appendChild(el("div", "hintline", "查询中…"));
      api("content?action=lookup&q=" + encodeURIComponent(q) + "&kind=" + encodeURIComponent(kind.value))
        .then(function (j) {
          out.innerHTML = "";
          if (!j.results || !j.results.length) {
            out.appendChild(el("div", "empty", j.hint || "没找到，换个名字试试。"));
            return;
          }
          j.results.forEach(function (r) {
            var card = el("div", "lkcand");
            var thumb = el("div", "mthumb");
            if (r.cover) {
              var img = document.createElement("img");
              img.alt = ""; img.loading = "lazy"; img.src = r.cover;
              thumb.appendChild(img);
            } else {
              thumb.classList.add("empty-thumb");
              thumb.textContent = String(r.name || "?").slice(0, 1);
            }
            card.appendChild(thumb);

            var info = el("div", "lkinfo");
            info.appendChild(el("div", "t", r.name));
            var meta = el("div", "sub");
            if (r.score != null) meta.appendChild(el("span", "pill", r.score + " 分"));
            if (r.year) meta.appendChild(el("span", "pill", r.year + " 年"));
            if (r.episodes) meta.appendChild(el("span", "pill", r.episodes + " 话"));
            if (r.altName && r.altName !== r.name) meta.appendChild(el("span", "hintline small", r.altName));
            info.appendChild(meta);
            card.appendChild(info);

            var use = el("button", "btn", "填入新记录");
            use.type = "button";
            use.addEventListener("click", function () {
              var data = {
                category: kind.value === "comic" ? "comic" : "anime",
                name: r.name,
                status: "watching",
                score: r.score == null ? "" : String(r.score),
                episodes: r.episodes == null ? "" : String(r.episodes),
                note: r.note || "",
                date: "",
                url: r.url || "",
                cover: r.cover || "",
              };
              closeForm();
              var form = buildForm("media", function (d, unlock) {
                create("media", d, null, unlock).then(function () {
                  closeForm();
                  return reload("media");
                }).then(function () { renderMedia("mediaHost"); say("app", "已添加：" + d.name); });
              }, closeForm);
              form.fill(data);
            });
            card.appendChild(use);
            out.appendChild(card);
          });
        })
        .catch(function (e) {
          out.innerHTML = "";
          out.appendChild(el("div", "empty", e.message || "查询失败"));
        })
        .then(function () { bGo.disabled = false; });
    }

    bGo.addEventListener("click", search);
    qi.addEventListener("keydown", function (e) { if (e.key === "Enter") search(); });

    openForm("✨ 按名字自动填充", box);
    qi.focus();
  }

  function editItem(type, item, hostId, opts) {
    opts = opts || {};
    var form = buildForm(type, function (data, unlock) {
      var p = item ? update(item.id, data, unlock) : create(type, data, null, unlock);
      p.then(function () {
        if (form.clearDraft) form.clearDraft();
        closeForm();
        return reload(type);
      })
       .then(function () {
         /* 追更自己有更丰富的列表视图（带缩略图 / 行内改状态），
            所以走 afterSave 交回给它自己重绘，而不是通用 renderList。 */
         if (opts.afterSave) opts.afterSave();
         else renderList(type, hostId, opts);
         say("app", item ? "已保存" : "已添加");
       });
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
        renderMedia("mediaHost");
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
    types: Object.keys(SCHEMA),
    /* 追更批量导入的解析逻辑（纯函数，供测试直接调，避免「写一套测另一套」） */
    parseImport: parseImport,
    parseRows: parseRows,
    parseJsonItems: parseJsonItems,
    normCategory: normCategory,
    normStatus: normStatus,
    normCount: normCount,
  };
})(window);
