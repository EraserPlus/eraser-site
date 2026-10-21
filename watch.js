/* ===========================================================================
   watch.js   站内播放器（追更页用）
   ---------------------------------------------------------------------------
   只做三件事：
     ① 认链接：把 B 站 / YouTube / Vimeo 的视频页解析成「官方播放器地址」
     ② 开弹层：在站内用官方 iframe 播放；直链 mp4/webm/ogv 用 <video>
     ③ 记续播点：能读到时间的来源（YouTube / Vimeo / 直链）每 15 秒
        和关闭时 PATCH 一次 position/duration；B 站不开放时间，只记集数

   安全边界（重要）：
     - 只接受白名单来源，iframe 地址由解析出的 ID 重新拼，绝不直接用用户填的 URL
     - 漫画站、盗版站、DRM 站一律不嵌入，继续走站外链接
     - 不代理、不下载、不破解，播放器始终是官方页面
   =========================================================================== */
(function (global) {
  "use strict";

  var SAVE_EVERY = 15000;   /* 播放中最多每 15 秒写一次 */
  var MIN_DELTA = 8;        /* 位置变化不足 8 秒不写，省请求 */
  var YT_ORIGINS = ["https://www.youtube.com", "https://www.youtube-nocookie.com"];
  var VIMEO_ORIGIN = "https://player.vimeo.com";

  function text(v) { return String(v == null ? "" : v).trim(); }

  /* 把 t=90 / t=1h2m3s / #t=90s 统一成秒 */
  function toSeconds(v) {
    var s = text(v);
    if (!s) return 0;
    if (/^\d+$/.test(s)) return Math.min(86400 * 7, parseInt(s, 10));
    var m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m) return 0;
    var n = (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
    return Math.min(86400 * 7, n);
  }

  function hashStart(u) {
    var h = String(u.hash || "").replace(/^#/, "");
    var m = h.match(/(?:^|&)t=([^&]+)/);
    return m ? toSeconds(decodeURIComponent(m[1])) : 0;
  }

  function queryStart(u) {
    return toSeconds(u.searchParams.get("t") || u.searchParams.get("start"));
  }

  function baseHost(host) {
    return host.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  }

  /* ------------------------------------------------------------------ 解析 */
  /* 返回 null 表示「没有可嵌入的官方播放器」，调用方继续用站外链接 */
  function parse(raw) {
    var s = text(raw);
    if (!/^https?:\/\//i.test(s)) return null;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    var host = baseHost(u.hostname);
    var path = u.pathname || "/";

    /* YouTube：watch / youtu.be / shorts / live / embed */
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
      var id = "";
      if (host === "youtu.be") {
        id = path.split("/").filter(Boolean)[0] || "";
      } else if (path === "/watch") {
        id = u.searchParams.get("v") || "";
      } else {
        var ym = path.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,20})(?:\/|$)/);
        if (ym) id = ym[1];
      }
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
      return {
        provider: "youtube", label: "YouTube", id: id,
        start: queryStart(u) || hashStart(u), timeSync: true, url: s,
      };
    }

    /* Vimeo：vimeo.com/123456789[/unlistedHash] 或 player.vimeo.com/video/... */
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      var vm = path.match(/\/(?:video\/)?(\d{5,12})(?:\/([A-Za-z0-9]+))?/);
      if (!vm) return null;
      var hash = vm[2] || u.searchParams.get("h") || "";
      return {
        provider: "vimeo", label: "Vimeo", id: vm[1], hash: hash,
        start: queryStart(u) || hashStart(u), timeSync: true, url: s,
      };
    }

    /* B 站：普通视频 / 番剧。b23.tv 短链解析不出 ID，不硬猜 */
    if (host === "bilibili.com" || host === "player.bilibili.com") {
      var bvid = (path.match(/\/video\/(BV[0-9A-Za-z]{10})/) || [])[1] || u.searchParams.get("bvid") || "";
      var aid = (path.match(/\/video\/av(\d+)/i) || [])[1] || u.searchParams.get("aid") || "";
      var ep = (path.match(/\/bangumi\/play\/ep(\d+)/) || [])[1] || u.searchParams.get("episodeId") || "";
      var ss = (path.match(/\/bangumi\/play\/ss(\d+)/) || [])[1] || u.searchParams.get("seasonId") || "";
      if (!bvid && !aid && !ep && !ss) return null;
      var page = parseInt(u.searchParams.get("p") || u.searchParams.get("page") || "1", 10);
      return {
        provider: "bilibili", label: "B 站",
        bvid: bvid, aid: aid, episodeId: ep, seasonId: ss,
        page: page > 0 ? page : 1,
        start: queryStart(u) || hashStart(u), timeSync: false, url: s,
      };
    }

    /* 直链视频：只认常见容器扩展名，避免把网页当视频塞进 <video> */
    if (/\.(mp4|m4v|webm|ogv|ogg)(?:$|[?#])/i.test(path + (u.search || "") + (u.hash || ""))) {
      return {
        provider: "video", label: "直链视频", src: s,
        start: queryStart(u) || hashStart(u), timeSync: true, url: s,
      };
    }

    return null;
  }

  /* -------------------------------------------------------------- 播放地址 */
  /* origin 只用于 YouTube 的 enablejsapi 校验；测试时可显式传入 */
  function embedUrl(info, opts) {
    opts = opts || {};
    /* 不传 start 时沿用链接里的 t；传 0 才是明确的「从头播」 */
    var rawStart = opts.start != null ? opts.start : info.start;
    var start = Math.max(0, Math.floor(Number(rawStart) || 0));

    if (info.provider === "video") return info.src;

    if (info.provider === "youtube") {
      var q = [
        "autoplay=1",
        "enablejsapi=1",
        "rel=0",
        "playsinline=1",
        "modestbranding=1",
      ];
      if (start > 0) q.push("start=" + start);
      var origin = opts.origin || (global.location && global.location.origin) || "";
      if (origin && origin !== "null") q.push("origin=" + encodeURIComponent(origin));
      return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(info.id) + "?" + q.join("&");
    }

    if (info.provider === "vimeo") {
      var vq = ["autoplay=1", "api=1", "playsinline=1"];
      if (info.hash) vq.push("h=" + encodeURIComponent(info.hash));
      return "https://player.vimeo.com/video/" + encodeURIComponent(info.id) + "?" + vq.join("&")
        + (start > 0 ? "#t=" + start + "s" : "");
    }

    if (info.provider === "bilibili") {
      var bq = ["autoplay=1", "high_quality=1", "danmaku=1", "as_wide=1"];
      if (info.bvid) bq.push("bvid=" + encodeURIComponent(info.bvid));
      if (info.aid) bq.push("aid=" + encodeURIComponent(info.aid));
      if (info.episodeId) bq.push("episodeId=" + encodeURIComponent(info.episodeId));
      if (info.seasonId) bq.push("seasonId=" + encodeURIComponent(info.seasonId));
      if (info.page > 1) bq.push("page=" + info.page);
      if (start > 0) bq.push("t=" + start);
      return "https://player.bilibili.com/player.html?" + bq.join("&");
    }

    return "";
  }

  /* ------------------------------------------------------------------ 小工具 */
  function el(tag, cls, str) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (str != null) e.textContent = str;
    return e;
  }

  function fmt(sec) {
    var n = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
    function two(v) { return v < 10 ? "0" + v : String(v); }
    return h ? h + ":" + two(m) + ":" + two(s) : m + ":" + two(s);
  }

  function safeUrl(u) {
    u = text(u);
    return /^https?:\/\//i.test(u) ? u : "";
  }

  /* ------------------------------------------------------------------ 弹层 */
  var current = null;   /* 同时只开一个 */

  function open(item, opts) {
    if (!item) return false;
    opts = opts || {};
    var d = item.data || item;
    var info = parse(d.url);
    if (!info) return false;
    if (current) current.close();

    var canEdit = !!opts.canEdit;
    var canSave = canEdit && typeof opts.save === "function";
    var url = safeUrl(d.url);
    var resume = 0;
    var stored = Number(d.position);
    /* 已看完的条目再看一遍时从头开始，不跳到上次的片尾 */
    if (d.status !== "finished" && Number.isFinite(stored) && stored >= 5) resume = Math.floor(stored);
    if (!resume && info.start > 0) resume = info.start;
    var storedDuration = Number(d.duration);
    if (resume && Number.isFinite(storedDuration) && storedDuration > 0 && resume > storedDuration - 5) {
      resume = 0;   /* 上次已经看到结尾，下次从头开始 */
    }

    var prevFocus = document.activeElement;
    var prevOverflow = document.body.style.overflow;
    var mask = el("div", "watch-mask");
    mask.id = "watchMask";
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    mask.setAttribute("aria-labelledby", "watchTitle");

    var panel = el("div", "watch-panel");
    var head = el("div", "watch-head");
    var title = el("h3", null, d.name || "播放");
    title.id = "watchTitle";
    head.appendChild(title);
    var xBtn = el("button", "watch-x", "✕");
    xBtn.type = "button";
    xBtn.title = "关闭";
    xBtn.setAttribute("aria-label", "关闭播放器");
    head.appendChild(xBtn);
    panel.appendChild(head);

    var stage = el("div", "watch-stage");
    panel.appendChild(stage);

    var foot = el("div", "watch-foot");
    var meta = el("div", "watch-meta");
    meta.setAttribute("aria-live", "polite");
    foot.appendChild(meta);
    var acts = el("div", "watch-acts");

    var plusBtn = null;
    if (canEdit && typeof opts.plus === "function") {
      plusBtn = el("button", "watch-btn watch-plus", "＋1 话");
      plusBtn.type = "button";
      plusBtn.title = "把观看进度记到下一话";
      acts.appendChild(plusBtn);
    }

    var ext = null;
    if (url) {
      ext = el("a", "watch-btn", "站外打开");
      ext.href = url;
      ext.target = "_blank";
      ext.rel = "noopener noreferrer";
      acts.appendChild(ext);
    }

    var closeBtn = el("button", "watch-btn primary", "关闭");
    closeBtn.type = "button";
    acts.appendChild(closeBtn);
    foot.appendChild(acts);
    panel.appendChild(foot);
    mask.appendChild(panel);
    document.body.appendChild(mask);
    document.body.style.overflow = "hidden";

    /* ------------------------------ 播放器本体 ------------------------------ */
    var frame = null;
    var video = null;
    var frameId = "watchFrame" + Date.now();
    var curTime = null;
    var curDur = null;
    var hot = false;
    var episodeAdvanced = false;   /* 点过「＋1 话」后，本集不再写续播点 */
    var noSignalTimer = null;

    function setMeta(str) { meta.textContent = str; }

    function epText() {
      var n = Number(d.progress);
      if (!Number.isFinite(n) || n < 0) return "";
      return "看到第 " + n + " 话";
    }

    function renderMeta() {
      var ep = epText();
      if (info.provider === "bilibili") {
        setMeta((ep ? ep + " · " : "") + "B 站官方播放器不开放画面进度，这里只记集数");
        return;
      }
      if (episodeAdvanced) {
        setMeta((ep ? ep + " · " : "") + "本集续播点已重置");
        return;
      }
      if (curTime == null) {
        var tip;
        if (!canSave) tip = "当前不记录播放位置";
        else if (resume > 0) tip = "将从 " + fmt(resume) + " 继续";
        else tip = "播放后自动记录续播点";
        setMeta((ep ? ep + " · " : "") + tip);
        return;
      }
      var line = fmt(curTime) + (curDur ? " / " + fmt(curDur) : "");
      if (ep) line = ep + " · " + line;
      if (canSave) line += " · 已自动记录";
      setMeta(line);
    }

    /* ------------------------------ 续播点读写 ------------------------------ */
    var lastPos = resume > 0 ? resume : -1;
    var lastDur = Number.isFinite(storedDuration) && storedDuration > 0 ? Math.floor(storedDuration) : -1;
    var lastAt = 0;
    var saving = false;
    var saveErrorShown = false;

    function flush(keepalive) {
      if (!canSave || curTime == null || saving) return;
      var pos = Math.round(curTime);
      if (pos < 0) return;
      var dur = (Number.isFinite(curDur) && curDur > 0) ? Math.round(curDur) : 0;
      if (pos === lastPos && (!dur || dur === lastDur)) return;
      if (lastPos >= 0 && Math.abs(pos - lastPos) < 2) return;
      var patch = { position: pos };
      if (dur) patch.duration = dur;
      lastPos = pos;
      if (dur) lastDur = dur;
      lastAt = Date.now();
      saving = true;
      var p;
      try {
        p = opts.save(patch, { keepalive: !!keepalive });
      } catch (e) {
        saving = false;
        return;
      }
      if (p && typeof p.then === "function") {
        p.then(function () {
          saving = false;
          if (typeof opts.onSaved === "function") opts.onSaved(patch);
        }).catch(function (err) {
          saving = false;
          if (saveErrorShown) return;
          saveErrorShown = true;
          if (typeof opts.toast === "function") {
            opts.toast("续播点没记上：" + ((err && err.message) || "网络错误"), "err");
          }
        });
      } else {
        saving = false;
        if (typeof opts.onSaved === "function") opts.onSaved(patch);
      }
    }

    function noteTime(t, dur) {
      if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return;
      if (noSignalTimer) { clearTimeout(noSignalTimer); noSignalTimer = null; }
      curTime = t;
      if (typeof dur === "number" && Number.isFinite(dur) && dur > 0) curDur = dur;
      if (!hot && curDur && curTime / curDur >= 0.95) {
        hot = true;
        if (plusBtn) {
          plusBtn.classList.add("hot");
          plusBtn.textContent = "看完了？＋1 话";
        }
      }
      renderMeta();
      if (!canSave) return;
      var now = Date.now();
      if (now - lastAt < SAVE_EVERY) return;
      if (lastPos >= 0 && Math.abs(Math.round(curTime) - lastPos) < MIN_DELTA) return;
      flush(false);
    }

    /* ------------------------------ 官方 iframe ------------------------------ */
    function ytListen() {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({
          event: "listening", id: frameId, channel: "widget",
        }), "*");
      } catch (e) {}
    }

    function vimeoListen(eventName) {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({
          method: "addEventListener", value: eventName,
        }), "*");
      } catch (e) {}
    }

    function onMessage(e) {
      if (!frame || e.source !== frame.contentWindow) return;
      var isYt = YT_ORIGINS.indexOf(e.origin) !== -1;
      var isVimeo = e.origin === VIMEO_ORIGIN;
      if (!isYt && !isVimeo) return;
      var data = e.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch (x) { return; }
      }
      if (!data || typeof data !== "object") return;

      if (isYt && data.event === "infoDelivery" && data.info) {
        var i = data.info;
        /* 播放中 / 暂停 / 结束都会推 infoDelivery，暂停与结束立即落盘 */
        if (typeof i.currentTime === "number") noteTime(i.currentTime, i.duration);
        if (i.playerState === 0 || i.playerState === 2) flush(false);
        return;
      }
      if (isYt && data.event === "onStateChange") {
        if (data.info === 0 || data.info === 2) flush(false);
        return;
      }
      if (isVimeo && data.event === "ready") {
        vimeoListen("timeupdate");
        vimeoListen("ended");
        return;
      }
      if (isVimeo && data.event === "timeupdate" && data.data) {
        if (typeof data.data.seconds === "number") noteTime(data.data.seconds, data.data.duration);
        return;
      }
      if (isVimeo && data.event === "ended") flush(false);
    }

    if (info.provider === "video") {
      video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      video.title = d.name || "视频";
      video.addEventListener("loadedmetadata", function () {
        if (resume > 0 && Number.isFinite(video.duration) && resume < video.duration - 3) {
          try { video.currentTime = resume; } catch (e) {}
        }
      });
      video.addEventListener("timeupdate", function () {
        noteTime(video.currentTime, video.duration);
      });
      video.addEventListener("pause", function () { flush(false); });
      video.addEventListener("ended", function () { flush(false); });
      video.addEventListener("error", function () {
        var err = el("div", "watch-error");
        err.appendChild(el("p", null, "这个直链没能播放，可能是格式不支持、需要登录或对方限制了跨站播放。"));
        if (url) {
          var a = el("a", "watch-btn primary", "去原站打开");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          err.appendChild(a);
        }
        stage.appendChild(err);
      });
      video.src = info.src;
      stage.appendChild(video);
    } else {
      frame = document.createElement("iframe");
      frame.id = frameId;
      frame.title = (d.name || "视频") + " · " + info.label;
      frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture; encrypted-media");
      frame.setAttribute("allowfullscreen", "");
      frame.setAttribute("frameborder", "0");
      frame.src = embedUrl(info, { start: resume });
      if (info.provider === "youtube") {
        frame.addEventListener("load", function () {
          ytListen();
          setTimeout(ytListen, 700);
        });
      } else if (info.provider === "vimeo") {
        frame.addEventListener("load", function () {
          vimeoListen("ready");
          vimeoListen("timeupdate");
          vimeoListen("ended");
        });
      }
      stage.appendChild(frame);
      window.addEventListener("message", onMessage);
    }

    renderMeta();

    /* YouTube / Vimeo 被网络挡住时，iframe 只会是一片黑，没有任何提示。
       8 秒还没收到任何时间消息就补一句人话，免得误以为是站点坏了。 */
    if (info.provider === "youtube" || info.provider === "vimeo") {
      noSignalTimer = setTimeout(function () {
        noSignalTimer = null;
        if (curTime != null || episodeAdvanced) return;
        setMeta(meta.textContent + " · 若一直黑屏，可能是网络无法访问 " + info.label + "，可点「站外打开」");
      }, 8000);
    }

    /* ------------------------------ 交互 ------------------------------ */
    if (plusBtn) {
      plusBtn.addEventListener("click", function () {
        plusBtn.disabled = true;
        var old = plusBtn.textContent;
        plusBtn.textContent = "记录中…";
        opts.plus(function (next) {
          d.progress = next;
          hot = false;
          episodeAdvanced = true;
          /* 新一集从零开始：停掉本集的续播点写入，避免把上一集的时间盖回去 */
          canSave = false;
          curTime = null;
          curDur = null;
          resume = 0;
          lastPos = 0;
          lastDur = -1;
          plusBtn.classList.remove("hot");
          plusBtn.textContent = "已记到第 " + next + " 话";
          renderMeta();
          if (typeof opts.toast === "function") opts.toast("进度已记到第 " + next + " 话", "ok");
          setTimeout(function () {
            plusBtn.textContent = "＋1 话";
            plusBtn.disabled = false;
          }, 1800);
        }, function (msg) {
          plusBtn.textContent = old;
          plusBtn.disabled = false;
          if (typeof opts.toast === "function") opts.toast(msg || "没记上，稍后再试", "err");
        });
      });
    }

    function close() {
      flush(false);
      if (noSignalTimer) { clearTimeout(noSignalTimer); noSignalTimer = null; }
      if (video) {
        try { video.pause(); } catch (e) {}
        video.removeAttribute("src");
        try { video.load(); } catch (e) {}
      }
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("keydown", onKey, true);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.body.style.overflow = prevOverflow;
      current = null;
      if (prevFocus && prevFocus.focus) {
        try { prevFocus.focus(); } catch (e) {}
      }
      if (typeof opts.onClose === "function") opts.onClose();
    }

    function onHide() { flush(true); }
    function onVisible() {
      if (document.visibilityState === "hidden") flush(true);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      var nodes = panel.querySelectorAll("button:not([disabled]), a[href]");
      if (!nodes.length) return;
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }

    xBtn.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    mask.addEventListener("mousedown", function (e) { if (e.target === mask) close(); });
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisible);

    current = { close: close };
    closeBtn.focus();

    return {
      close: close,
      provider: info.provider,
      embed: frame ? frame.src : info.src,
      resume: resume,
    };
  }

  global.Watch = {
    parse: parse,
    embedUrl: embedUrl,
    open: open,
    fmt: fmt,
    toSeconds: toSeconds,
    providers: ["bilibili", "youtube", "vimeo", "video"],
  };
})(window);
