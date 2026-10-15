/* ===========================================================================
   番剧自动填充的纯逻辑测试（M12）
   ---------------------------------------------------------------------------
   测 api/_lib/lookup.js：查询拼装、归一化、评分换算、返回整形。
   网络那部分在 tests/api_routes_test.mjs 里用 stub fetch 覆盖。
   =========================================================================== */

import { normalizeQuery, normalizeKind, buildQuery, shapeMedia, shapeResponse, scoreToTen } from '../api/_lib/lookup.js';

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

console.log('=== 评分换算（0-100 → 0-10） ===');
check('91 → 9.1', scoreToTen(91) === 9.1, String(scoreToTen(91)));
check('85 → 8.5', scoreToTen(85) === 8.5, String(scoreToTen(85)));
check('100 → 10', scoreToTen(100) === 10, String(scoreToTen(100)));
check('0 / null / undefined → null', scoreToTen(0) === null && scoreToTen(null) === null && scoreToTen(undefined) === null);
check('非数字 → null', scoreToTen('abc') === null);
check('一位小数（77 → 7.7）', scoreToTen(77) === 7.7, String(scoreToTen(77)));

console.log('\n=== 输入归一化 ===');
check('kind=comic → MANGA', normalizeKind('comic') === 'MANGA');
check('kind=manga → MANGA', normalizeKind('manga') === 'MANGA');
check('kind 空 → ANIME', normalizeKind('') === 'ANIME');
check('kind 乱写 → ANIME（默认番剧）', normalizeKind('zzz') === 'ANIME');
{
  let threw = false;
  try { normalizeQuery('   '); } catch (e) { threw = true; }
  check('空关键词要报错', threw);
  let threw2 = false;
  try { normalizeQuery('x'.repeat(81)); } catch (e) { threw2 = true; }
  check('关键词太长要报错', threw2);
  check('正常关键词去除首尾空格', normalizeQuery('  Frieren  ') === 'Frieren');
}

console.log('\n=== 查询拼装 ===');
{
  const bq = buildQuery('ANIME', 'Frieren');
  check('带 type:ANIME', /type:ANIME/.test(bq.query));
  check('关键词走 variables（不拼进 query 串）', bq.variables.q === 'Frieren' && bq.query.indexOf('Frieren') < 0, bq.query.slice(0, 60));
  check('请求封面字段', /coverImage/.test(bq.query));

  const mq = buildQuery('MANGA', 'Berserk');
  check('MANGA 走 type:MANGA', /type:MANGA/.test(mq.query));
  check('漫画请求 chapters 字段', /chapters/.test(mq.query));

  check('perPage 有上限保护', buildQuery('ANIME', 'x', 999).variables.perPage <= 20, String(buildQuery('ANIME', 'x', 999).variables.perPage));
  check('perPage 有下限保护', buildQuery('ANIME', 'x', 0).variables.perPage >= 1);
}

console.log('\n=== 返回整形 ===');
{
  const s = shapeMedia({
    id: 154587,
    title: { native: '葬送のフリーレン', romaji: 'Sousou no Frieren' },
    coverImage: { large: 'https://s4.anilist.co/x.jpg' },
    averageScore: 91, episodes: 28, startDate: { year: 2023 },
    siteUrl: 'https://anilist.co/anime/154587',
  });
  check('名称优先取 native（日文原名）', s.name === '葬送のフリーレン', s.name);
  check('备用名取 romaji', s.altName === 'Sousou no Frieren', s.altName);
  check('评分换算成 9.1', s.score === 9.1, String(s.score));
  check('封面地址保留', s.cover === 'https://s4.anilist.co/x.jpg');
  check('话数保留', s.episodes === 28, String(s.episodes));
  check('年份保留', s.year === 2023, String(s.year));
  check('备注拼出「年份 · 话数」', /2023/.test(s.note) && /28/.test(s.note), s.note);
  check('链接保留', /anilist/.test(s.url), s.url);

  const m = shapeMedia({ id: 30002, title: { native: 'ベルセルク' }, averageScore: 92, chapters: 400, startDate: { year: 1989 } });
  check('漫画用 chapters 当话数', m.episodes === 400, String(m.episodes));

  check('只有 romaji 时用它当名称', shapeMedia({ title: { romaji: 'Only Romaji' } }).name === 'Only Romaji');
  check('没有标题 → null', shapeMedia({ id: 1, title: {} }) === null);
  check('null → null', shapeMedia(null) === null);
  check('没有评分时不硬编 0', shapeMedia({ title: { native: 'X' } }).score === null);
}

console.log('\n=== 列表整形 ===');
{
  const r = shapeResponse({
    data: { Page: { media: [
      { id: 1, title: { native: 'A' }, averageScore: 90 },
      { id: 2, title: { romaji: 'B' }, averageScore: 80 },
      null,
      { id: 3, title: {} },
    ] } },
  }, 6);
  check('过滤掉空/无标题项', r.length === 2, String(r.length));
  check('保持原顺序', r[0].name === 'A' && r[1].name === 'B', r.map(x => x.name).join(','));

  const capped = shapeResponse({ data: { Page: { media: Array.from({ length: 10 }, (_, i) => ({ id: i, title: { native: 'n' + i } })) } } }, 3);
  check('受 limit 限制', capped.length === 3, String(capped.length));

  check('没有 media 字段 → 空数组', shapeResponse({}).length === 0);
  check('data 为 null → 空数组', shapeResponse(null).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
