/* ===========================================================================
   md.js · 极简 Markdown 渲染器（公开页面用）
   ---------------------------------------------------------------------------
   安全策略：先把所有内容转义，再只插入我们自己生成的标签。
   链接只允许 http/https/mailto，挡掉 javascript: 之类的伪协议。
   图片只允许 http/https 或站内路径（/、# 开头），其余按普通文本显示。
   支持：标题、粗体、斜体、行内代码、代码块、链接、图片、有序/无序列表、引用、分割线。
   =========================================================================== */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* 行内格式。注意顺序：先处理行内代码，免得代码里的星号被当成粗体 */
  function inline(text) {
    var codes = [];
    var s = text.replace(/`([^`\n]+)`/g, function (_, code) {
      codes.push(code);
      return "\u0000C" + (codes.length - 1) + "\u0000";
    });

    /* 图片：必须在链接正则之前处理，否则 ![alt](url) 会被链接正则吃掉前半截。
       注意三铁律：进到这里文本已被 render() 整体 esc() 过，alt 和 src 都来自已转义文本，
       **不能再 esc()**（再转一次 & 会变成 &amp;amp;）——与链接 label/href 同等待遇。 */
    var imgs = [];
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, function (_, alt, src) {
      var safe = /^(https?:\/\/|\/|#)/i.test(src) ? src : null;
      if (!safe) return _;              // 白名单外：原样留下（已转义，当普通文本显示，安全）
      imgs.push({ alt: alt, src: safe });
      return "\u0000I" + (imgs.length - 1) + "\u0000";
    });

    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      var safe = /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : "#";
      var ext = /^https?:\/\//i.test(safe) ? ' target="_blank" rel="noopener noreferrer"' : "";
      /* 注意：这里的 href 和 label 都来自已经转义过的文本，不能再 esc 一次，
         否则链接里的 & 会变成 &amp;amp;，query string 直接失效。
         因为原文已转义，里面不可能有裸引号，所以拼进属性是安全的。 */
      return '<a href="' + safe + '"' + ext + ">" + label + "</a>";
    });

    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

    return s.replace(/\u0000I(\d+)\u0000/g, function (_, i) {
      var im = imgs[Number(i)];
      return '<img src="' + im.src + '" alt="' + im.alt + '" loading="lazy">';
    }).replace(/\u0000C(\d+)\u0000/g, function (_, i) {
      return "<code>" + codes[Number(i)] + "</code>";
    });
  }

  function render(src) {
    if (!src) return "";
    var text = String(src).replace(/\r\n?/g, "\n");

    /* 先把代码块抽出来，避免里面的内容被当成 Markdown 解析。
       注意：抽出来的内容也要转义——代码块里写 <script> 同样是危险的。 */
    var blocks = [];
    text = text.replace(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      blocks.push({ lang: lang, code: esc(code.replace(/\n$/, "")) });
      return "\u0000B" + (blocks.length - 1) + "\u0000";
    });

    text = esc(text);

    var lines = text.split("\n");
    var out = [];
    var para = [];
    var list = null;      // { tag: "ul"|"ol", items: [] }
    var quote = [];

    function flushPara() {
      if (!para.length) return;
      out.push("<p>" + inline(para.join("<br>")) + "</p>");
      para = [];
    }
    function flushList() {
      if (!list) return;
      out.push("<" + list.tag + ">" + list.items.map(function (i) {
        return "<li>" + inline(i) + "</li>";
      }).join("") + "</" + list.tag + ">");
      list = null;
    }
    function flushQuote() {
      if (!quote.length) return;
      out.push("<blockquote>" + inline(quote.join("<br>")) + "</blockquote>");
      quote = [];
    }
    function flushAll() { flushPara(); flushList(); flushQuote(); }

    lines.forEach(function (line) {
      var t = line.trim();

      var m = t.match(/^\u0000B(\d+)\u0000$/);
      if (m) {
        flushAll();
        var b = blocks[Number(m[1])];
        var cls = b.lang ? ' class="lang-' + esc(b.lang) + '"' : "";
        out.push("<pre><code" + cls + ">" + b.code + "</code></pre>");
        return;
      }

      if (!t) { flushAll(); return; }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushAll(); out.push("<hr>"); return; }

      m = t.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        flushAll();
        var lv = m[1].length;
        out.push("<h" + lv + ">" + inline(m[2]) + "</h" + lv + ">");
        return;
      }

      /* 此时文本已经转义过，所以行首的 ">" 已经变成 "&gt;" */
      m = t.match(/^&gt;\s?(.*)$/);
      if (m) { flushPara(); flushList(); quote.push(m[1]); return; }
      flushQuote();

      m = t.match(/^[-*+]\s+(.*)$/);
      if (m) {
        flushPara();
        if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
        list.items.push(m[1]);
        return;
      }
      m = t.match(/^\d+[.)]\s+(.*)$/);
      if (m) {
        flushPara();
        if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
        list.items.push(m[1]);
        return;
      }
      flushList();

      para.push(t);
    });

    flushAll();
    return out.join("\n");
  }

  /* 阅读统计：中文按 400 字/分钟、英文按 220 词/分钟估算。
     先走 plain()，代码块因此不计入（读代码远比读正文慢，算进时长会把「约 3 分钟」估成 10 分钟）。 */
  function stats(src) {
    var text = plain(src);
    var cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    var words = (text.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) || []).length;
    var chars = text.replace(/\s+/g, "").length;
    return {
      minutes: Math.max(1, Math.round(cjk / 400 + words / 220)),
      chars: chars, cjk: cjk, words: words
    };
  }

  /* 摘要：去掉 Markdown 记号，截断到 n 个字 */
  function plain(src, n) {
    var s = String(src == null ? "" : src)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^[>#\-\*+\d.)\s]+/gm, "")
      .replace(/[*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (n && s.length > n) s = s.slice(0, n) + "…";
    return s;
  }

  global.MD = { render: render, plain: plain, stats: stats, esc: esc };
})(window);
