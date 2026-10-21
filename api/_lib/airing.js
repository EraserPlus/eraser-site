/* ===========================================================================
   番剧放送表：从 B 站公开番剧资料里认出「周几 / 几点更新」（纯逻辑，无 IO）
   ---------------------------------------------------------------------------
   数据源：api.bilibili.com/pgc/view/web/season（公开、免 key）。只要条目链接是
   B 站番剧页（/bangumi/play/ss…、/bangumi/play/ep…、/bangumi/media/md…），
   就能查到官方写的更新说明，例如 new_ep.desc = "6月13日起 每周六11:00"。

   两条来源，按可信度排：
     1. new_ep.desc 里的「每周X HH:MM」——官方追番日历文案，最准
     2. 最近一集正片的发布时间 → 换算成北京时间（UTC+8）的星期与时刻
   B 站没有公开的漫画更新日历，漫画仍由站主手填 airday / airtime。

   这里不做网络请求，方便单测；请求在 api/content.js 的 ?action=airing 里。
   =========================================================================== */

const DAY_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/* 从链接认 B 站番剧页。只接受 bilibili.com 域名和数字 id，
   接口随后只会拼固定的 B 站地址，避免把用户输入的 URL 直接拿去请求（SSRF）。 */
export function biliRef(raw) {
  let u;
  try { u = new URL(String(raw == null ? '' : raw)); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase();
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) return null;

  const play = u.pathname.match(/\/bangumi\/play\/(ss|ep)(\d+)/i);
  if (play) {
    const id = Number(play[2]);
    if (!id) return null;
    return play[1].toLowerCase() === 'ss'
      ? { kind: 'season', id: id }
      : { kind: 'episode', id: id };
  }

  const media = u.pathname.match(/\/bangumi\/media\/md(\d+)/i);
  if (media) return { kind: 'media', id: Number(media[1]) || null };

  const seasonId = Number(u.searchParams.get('season_id'));
  if (Number.isInteger(seasonId) && seasonId > 0) return { kind: 'season', id: seasonId };
  const epId = Number(u.searchParams.get('ep_id'));
  if (Number.isInteger(epId) && epId > 0) return { kind: 'episode', id: epId };
  return null;
}

/* 固定的 B 站资料地址（不把原始 URL 传下去） */
export function seasonApiUrl(ref) {
  if (!ref || !ref.id) return null;
  const base = 'https://api.bilibili.com/pgc/view/web/season?';
  if (ref.kind === 'season') return base + 'season_id=' + ref.id;
  if (ref.kind === 'episode') return base + 'ep_id=' + ref.id;
  if (ref.kind === 'media') return base + 'media_id=' + ref.id;
  return null;
}

/* 从「每周六11:00」「6月13日起 每周六 11:00」「每週日 23:30」这类文案里取星期。
   没有明确星期（每日更新 / 只写了日期）→ null。 */
export function parseWeekday(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, '');
  if (!s) return null;
  if (/每日|每天|天天/.test(s)) return null;
  const m = s.match(/(?:每)?(?:周|週|星期)([一二三四五六日天1-7])/);
  if (!m) return null;
  if (m[1] >= '1' && m[1] <= '7') return Number(m[1]);
  return DAY_CN[m[1]] || null;
}

/* 从文案里取第一个 HH:MM（全角冒号也认）。日期里的「6月13日」不会被误认。 */
export function parseTime(text) {
  const s = String(text == null ? '' : text);
  const m = s.match(/(\d{1,2})[：:](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return pad2(h) + ':' + pad2(mi);
}

export function parseAirDesc(desc) {
  const text = String(desc == null ? '' : desc).trim();
  if (!text) return { airday: null, airtime: null };
  return { airday: parseWeekday(text), airtime: parseTime(text) };
}

/* Unix 秒 → 北京时间（UTC+8，无夏令时）的星期 / 时刻 */
export function chinaParts(epoch) {
  const n = Number(epoch);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date((Math.floor(n) + 8 * 3600) * 1000);
  const day = d.getUTCDay();                 // 0 = 周日
  return {
    airday: day === 0 ? 7 : day,
    airtime: pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()),
  };
}

function isPreview(ep) {
  const badge = String((ep && ep.badge) || '') + ' ' +
    String((ep && ep.badge_info && ep.badge_info.text) || '');
  const title = String((ep && ep.share_copy) || '') + ' ' +
    String((ep && ep.show_title) || '') + ' ' +
    String((ep && ep.long_title) || '');
  return /预告|預告|PV|花絮/.test(badge + ' ' + title);
}

/* 最近一集「正片」：排除预告 / PV，避免把提前 15 分钟放出的预告当成更新时间 */
export function latestMainEpisode(result) {
  const eps = result && Array.isArray(result.episodes) ? result.episodes : [];
  let best = null;
  for (const ep of eps) {
    const t = Number(ep && ep.pub_time);
    if (!Number.isFinite(t) || t <= 0 || isPreview(ep)) continue;
    if (!best || t > Number(best.pub_time)) best = ep;
  }
  return best;
}

/* B 站把集数放在 title（通常是 "196"）里，show_title 是「第196话 标题」。
   只认明确的整数，不从小标题里瞎猜（比如「2.5 话」「第3话总集篇」宁可留空）。 */
export function episodeNumber(ep) {
  const fields = [ep && ep.title, ep && ep.show_title, ep && ep.index_show];
  for (const raw of fields) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) continue;
    let m = s.match(/^(\d{1,5})$/);
    if (!m) m = s.match(/第\s*(\d{1,5})\s*[话話集]/);
    if (!m) m = s.match(/^(\d{1,5})\s*[话話集]/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > 0) return n;
  }
  return null;
}

/* 最新一集正片的集数。episodes 列表拿不到时，退而用官方 new_ep 的标题。 */
export function latestEpisodeNumber(result) {
  const fromEp = episodeNumber(latestMainEpisode(result));
  if (fromEp != null) return fromEp;
  const ne = result && result.new_ep;
  return episodeNumber({ title: ne && ne.title, index_show: ne && ne.index_show });
}

/* 把 B 站 season 返回归一化成站点能直接用的字段。
   完结番不再给放送时间（避免「本周放送」里出现已经完结的条目）。 */
export function shapeSeason(result) {
  if (!result || typeof result !== 'object') return null;
  const desc = result.new_ep && result.new_ep.desc ? String(result.new_ep.desc) : '';
  const parsed = parseAirDesc(desc);
  const finished = !!(result.publish && Number(result.publish.is_finish) === 1);
  const started = !!(result.publish && Number(result.publish.is_started) === 1);

  let airday = parsed.airday;
  let airtime = parsed.airtime;
  let derived = (airday != null || airtime != null) ? 'desc' : null;

  if (!finished && (airday == null || airtime == null)) {
    const ep = latestMainEpisode(result);
    const fromEp = ep ? chinaParts(ep.pub_time) : null;
    if (fromEp) {
      if (airday == null) airday = fromEp.airday;
      if (airtime == null) airtime = fromEp.airtime;
      derived = derived ? derived + '+episode' : 'episode';
    }
  }

  const rating = Number(result.rating && result.rating.score);
  const total = Number(result.total);
  const latest = latestEpisodeNumber(result);
  /* 连载中的 total 常是 0；完结番的 total 也可能是 0，
     这时最新一集的序号就是最终话数，拿它兜底比留空有用。 */
  const episodes = Number.isInteger(total) && total > 0
    ? total
    : (finished && latest ? latest : null);
  const title = String(result.title || result.season_title || '').slice(0, 120);

  return {
    source: 'bilibili',
    seasonId: Number(result.season_id) || null,
    mediaId: Number(result.media_id) || null,
    title: title || null,
    cover: typeof result.cover === 'string' && /^https?:\/\//i.test(result.cover) ? result.cover : null,
    score: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
    episodes: episodes,
    latest: latest,
    finished: finished,
    started: started,
    newEp: result.new_ep && result.new_ep.title ? String(result.new_ep.title).slice(0, 40) : null,
    desc: desc ? desc.slice(0, 120) : null,
    airday: finished ? null : airday,
    airtime: finished ? null : airtime,
    matched: !finished && airday != null,
    derived: finished ? null : derived,
  };
}
