/* ===========================================================================
   workbench.js   追更工作台的数据逻辑（M20）
   ---------------------------------------------------------------------------
   这里只做纯计算，不碰 DOM：
     - 本地星期换算（周一=1 … 周日=7）
     - 「继续看」该收哪些条目、怎么排
     - 「本周放送」按天筛选、按更新时间排序
     - 进度 / 剩余时间 / 下一话的文案
   渲染由 collect/index.html 的内联脚本负责；tests/workbench_test.mjs 直接测这里。
   =========================================================================== */
(function (global) {
  "use strict";

  var DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  function int(v) {
    var n = Number(v);
    return Number.isFinite(n) && Number.isInteger(n) ? n : null;
  }
  function nonNeg(v) {
    var n = int(v);
    return n != null && n >= 0 ? n : null;
  }
  function posInt(v) {
    var n = int(v);
    return n != null && n > 0 ? n : null;
  }

  /* JS 的 getDay()：周日=0；这里统一成 ISO 习惯：周一=1 … 周日=7。
     用 getDay 能力判断而不是 instanceof Date——跨 iframe / vm 的 Date 也能认。 */
  function dayOf(date) {
    var d = date && typeof date.getDay === "function" ? date : new Date();
    return ((d.getDay() + 6) % 7) + 1;
  }

  function dayLabel(n) {
    var i = int(n);
    return i != null && i >= 1 && i <= 7 ? DAYS[i - 1] : "";
  }

  function dateText(date) {
    var d = date && typeof date.getDate === "function" ? date : new Date();
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + DAYS[dayOf(d) - 1];
  }

  function greeting(hour) {
    var h = int(hour);
    if (h == null) h = new Date().getHours();
    if (h >= 5 && h < 11) return "早上好";
    if (h >= 11 && h < 13) return "中午好";
    if (h >= 13 && h < 18) return "下午好";
    if (h >= 18 && h < 23) return "晚上好";
    return "夜深了";
  }

  function airdayOf(d) {
    var n = int(d && d.airday);
    return n != null && n >= 1 && n <= 7 ? n : null;
  }

  /* 参与放送的条目：完结和搁置不打扰 */
  function airing(d) {
    return !!d && d.status !== "finished" && d.status !== "paused";
  }

  /* "20:00" → 1200；没填或格式不对 → 排在最后 */
  function minutesOf(t) {
    var m = String(t == null ? "" : t).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 24 * 60 + 1;
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return 24 * 60 + 1;
    return h * 60 + mi;
  }

  function byUpdatedDesc(a, b) {
    return String((b && b.updated_at) || "").localeCompare(String((a && a.updated_at) || ""));
  }

  /* 继续看：在追的，或已经有进度 / 续播点的；完结、搁置不算 */
  function continueList(items) {
    return (items || []).filter(function (it) {
      var d = it && it.data;
      if (!airing(d)) return false;
      if (d.status === "watching") return true;
      return nonNeg(d.position) > 0 || nonNeg(d.progress) > 0;
    }).sort(byUpdatedDesc);
  }

  function scheduleFor(items, day) {
    var want = int(day);
    if (want == null || want < 1 || want > 7) return [];
    return (items || []).filter(function (it) {
      var d = it && it.data;
      return airing(d) && airdayOf(d) === want;
    }).sort(function (a, b) {
      var ma = minutesOf(a.data.airtime), mb = minutesOf(b.data.airtime);
      if (ma !== mb) return ma - mb;
      return byUpdatedDesc(a, b);
    });
  }

  /* 返回下标 1–7 的计数数组；下标 0 留空，方便直接拿 day 当索引 */
  function dayCounts(items) {
    var out = [0, 0, 0, 0, 0, 0, 0, 0];
    (items || []).forEach(function (it) {
      var d = it && it.data;
      if (!airing(d)) return;
      var n = airdayOf(d);
      if (n) out[n]++;
    });
    return out;
  }

  function epPct(d) {
    var cur = nonNeg(d && d.progress);
    var tot = posInt(d && d.episodes);
    if (cur == null || tot == null) return null;
    return Math.max(0, Math.min(100, Math.round(cur / tot * 100)));
  }

  function watchedText(d) {
    var cur = nonNeg(d && d.progress);
    var tot = posInt(d && d.episodes);
    if (cur != null && tot != null) return "看到 " + cur + " / " + tot + " 话";
    if (cur != null) return "看到第 " + cur + " 话";
    if (tot != null) return "共 " + tot + " 话";
    return "还没开始";
  }

  function nextEpText(d) {
    var cur = nonNeg(d && d.progress);
    var tot = posInt(d && d.episodes);
    if (tot != null && cur != null && cur >= tot) return "已追平 · 共 " + tot + " 话";
    if (cur != null) return "下一话 第 " + (cur + 1) + " 话";
    if (tot != null) return "共 " + tot + " 话";
    return "待开看";
  }

  function remainingText(d) {
    var pos = nonNeg(d && d.position) || 0;
    var dur = nonNeg(d && d.duration) || 0;
    if (pos > 0 && dur > pos) {
      var left = dur - pos;
      if (left < 60) return "还剩不到 1 分钟";
      return "还剩约 " + Math.ceil(left / 60) + " 分钟";
    }
    if (dur > 0) return "全长约 " + Math.ceil(dur / 60) + " 分钟";
    return "";
  }

  global.Workbench = {
    days: DAYS.slice(),
    dayOf: dayOf,
    dayLabel: dayLabel,
    dateText: dateText,
    greeting: greeting,
    airdayOf: airdayOf,
    minutesOf: minutesOf,
    continueList: continueList,
    scheduleFor: scheduleFor,
    dayCounts: dayCounts,
    epPct: epPct,
    watchedText: watchedText,
    nextEpText: nextEpText,
    remainingText: remainingText,
  };
})(window);
