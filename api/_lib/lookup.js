/* ===========================================================================
   番剧 / 漫画「自动填充」的纯逻辑（无 IO，可单测）
   ---------------------------------------------------------------------------
   数据源：AniList 的公开 GraphQL（https://graphql.anilist.co），无需 API Key。
   这里只做两件事：
     1. 拼查询语句 + 校验用户输入（纯函数，好测）
     2. 把 AniList 的返回归一化成站点自己的字段形状
   真正的网络请求在 api/content.js 的 lookupMedia() 里（?action=lookup），
   方便测试时把 globalThis.fetch 换掉单独 mock。
   =========================================================================== */

/* AniList 的 averageScore 是 0-100 的整数，站点评分是 0-10 一位小数 */
export function scoreToTen(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / 10) * 10) / 10;
}

/* 输入校验：关键词非空、不太长；媒体类型只认 anime / manga */
export function normalizeQuery(raw) {
  const q = String(raw == null ? '' : raw).trim();
  if (!q) {
    const e = new Error('请先填一个名字（英文名或日文原名最准）');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (q.length > 80) {
    const e = new Error('名字太长了，最多 80 个字');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return q;
}

export function normalizeKind(raw) {
  const k = String(raw == null ? '' : raw).trim().toLowerCase();
  if (k === 'manga' || k === 'comic') return 'MANGA';
  return 'ANIME';   // 默认番剧
}

/* 拼 AniList 的搜索查询。variables 走参数，不拼字符串（防注入那套思路） */
export function buildQuery(kind, q, perPage = 6) {
  const type = kind === 'MANGA' ? 'MANGA' : 'ANIME';
  const n = Math.max(1, Math.min(20, Number(perPage) || 6));
  return {
    query:
      'query($q:String,$perPage:Int){Page(perPage:$perPage){media(search:$q,type:' + type + '){' +
      'id title{romaji native english} coverImage{large} averageScore episodes chapters ' +
      'startDate{year} siteUrl format}}}',
    variables: { q: q, perPage: n },
  };
}

/* 把一条 AniList 记录转成站点能直接用的候选 */
export function shapeMedia(m) {
  if (!m || typeof m !== 'object') return null;
  const title = m.title || {};
  const name = title.native || title.romaji || title.english || '';
  if (!name) return null;

  const cover = (m.coverImage && m.coverImage.large) || null;
  const score = scoreToTen(m.averageScore);
  const year = (m.startDate && m.startDate.year) || null;

  /* 话数：番剧看 episodes，漫画看 chapters */
  const eps = m.episodes || m.chapters || null;

  /* 备注先把年份和话数拼好，用户可改 */
  const parts = [];
  if (year) parts.push(year + ' 年');
  if (eps) parts.push('共 ' + eps + ' 话');

  return {
    source: 'anilist',
    sourceId: m.id || null,
    name: String(name).slice(0, 120),
    altName: String(title.romaji || title.english || '').slice(0, 120) || null,
    cover: cover,
    score: score,
    year: year,
    episodes: eps,
    note: parts.join(' · ').slice(0, 200) || null,
    url: m.siteUrl || (m.id ? 'https://anilist.co/anime/' + m.id : null),
  };
}

/* 归一化整个返回：去空、截断到上限 */
export function shapeResponse(json, limit = 6) {
  const media = json && json.data && json.data.Page && json.data.Page.media;
  if (!Array.isArray(media)) return [];
  const out = [];
  for (const m of media) {
    const s = shapeMedia(m);
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
