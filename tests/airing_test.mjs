/* 放送表自动补全（api/_lib/airing.js）单测：URL 识别、中文星期 / 时间解析、
   北京时间换算、预告过滤、完结番处理。全部是纯函数，不发网络。 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.join(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const A = await load('api/_lib/airing.js');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== 认 B 站番剧链接 ===');
{
  const cases = [
    ['https://www.bilibili.com/bangumi/play/ss28747', { kind: 'season', id: 28747 }],
    ['https://www.bilibili.com/bangumi/play/ep3854820', { kind: 'episode', id: 3854820 }],
    ['https://m.bilibili.com/bangumi/play/ss28747?share=1', { kind: 'season', id: 28747 }],
    ['https://bilibili.com/bangumi/media/md28223043', { kind: 'media', id: 28223043 }],
    ['https://www.bilibili.com/bangumi/play/ss28747?season_id=999', { kind: 'season', id: 28747 }],
    ['https://www.bilibili.com/video/BV1xx?season_id=28747', { kind: 'season', id: 28747 }],
    ['https://www.bilibili.com/video/BV1xx?ep_id=3854820', { kind: 'episode', id: 3854820 }],
  ];
  for (const [url, want] of cases) {
    check('识别 ' + url.replace('https://www.', ''), eq(A.biliRef(url), want), JSON.stringify(A.biliRef(url)));
  }

  check('普通视频页（没有季 / 集信息）→ null', A.biliRef('https://www.bilibili.com/video/BV1xx') === null);
  check('非 B 站域名 → null', A.biliRef('https://example.com/bangumi/play/ss1') === null);
  check('伪造子域名 → null', A.biliRef('https://bilibili.com.evil.com/bangumi/play/ss1') === null);
  check('只认 http(s)', A.biliRef('javascript:alert(1)') === null && A.biliRef('ftp://bilibili.com/bangumi/play/ss1') === null);
  check('空值不炸', A.biliRef(null) === null && A.biliRef('') === null);
}

console.log('\n=== 拼固定的 B 站资料地址（不直接请求用户原 URL）===');
{
  check('season → season_id 参数',
        A.seasonApiUrl({ kind: 'season', id: 28747 }) === 'https://api.bilibili.com/pgc/view/web/season?season_id=28747');
  check('episode → ep_id 参数',
        A.seasonApiUrl({ kind: 'episode', id: 3854820 }) === 'https://api.bilibili.com/pgc/view/web/season?ep_id=3854820');
  check('media → media_id 参数',
        A.seasonApiUrl({ kind: 'media', id: 28223043 }) === 'https://api.bilibili.com/pgc/view/web/season?media_id=28223043');
  check('没 id → null', A.seasonApiUrl(null) === null && A.seasonApiUrl({ kind: 'season' }) === null);
}

console.log('\n=== 中文文案里的星期 ===');
{
  const cases = [
    ['6月13日起 每周六11:00', 6],
    ['每周五 12:00', 5],
    ['每週四 23:30', 4],
    ['星期日 10:00 更新', 7],
    ['周天晚上八点', 7],
    ['每周一', 1],
    ['每周2 11:00', 2],
    ['每周日10:00', 7],
  ];
  for (const [text, want] of cases) {
    check(`「${text}」→ 周${'一二三四五六日'[want - 1]}`, A.parseWeekday(text) === want, String(A.parseWeekday(text)));
  }
  check('每日更新不当作固定星期', A.parseWeekday('每日 10:00 更新') === null);
  check('只有日期没有星期 → null', A.parseWeekday('6月13日起播出') === null);
  check('空值 → null', A.parseWeekday('') === null && A.parseWeekday(null) === null);
}

console.log('\n=== 中文文案里的时间 ===');
{
  check('11:00', A.parseTime('每周六11:00') === '11:00');
  check('个位数小时补零（8:05 → 08:05）', A.parseTime('8:05') === '08:05');
  check('全角冒号（20：30 → 20:30）', A.parseTime('20：30') === '20:30');
  check('日期不会被当成时间', A.parseTime('6月13日起 每周六') === null);
  check('非法小时 → null', A.parseTime('25:00') === null);
  check('非法分钟 → null', A.parseTime('20:60') === null);
  check('空值 → null', A.parseTime(null) === null);
}

console.log('\n=== 北京时间换算（UTC+8，无夏令时）===');
{
  const thu = Date.UTC(2026, 9, 15, 0, 0, 0) / 1000;
  check('UTC 周四零点 = 北京 08:00（周四）',
        eq(A.chinaParts(thu), { airday: 4, airtime: '08:00' }), JSON.stringify(A.chinaParts(thu)));
  const mon = Date.UTC(2026, 9, 18, 16, 30, 0) / 1000;
  check('UTC 周日 16:30 = 北京周一 00:30（跨日不能算错）',
        eq(A.chinaParts(mon), { airday: 1, airtime: '00:30' }), JSON.stringify(A.chinaParts(mon)));
  check('样例正片 1792206000 = 北京时间周六 11:00',
        eq(A.chinaParts(1792206000), { airday: 6, airtime: '11:00' }), JSON.stringify(A.chinaParts(1792206000)));
  check('无效时间戳 → null', A.chinaParts(null) === null && A.chinaParts(-1) === null && A.chinaParts('x') === null);
}

console.log('\n=== 最近一集正片（跳过预告 / PV）===');
{
  const eps = [
    { pub_time: 100, title: '1', show_title: '第1话' },
    { pub_time: 200, title: '2', show_title: '第2话' },
    { pub_time: 300, title: '3', show_title: '第3话预告', badge: '预告' },
    { pub_time: 250, title: 'PV', show_title: '正式PV' },
    { pub_time: 0, title: '4', show_title: '未定' },
  ];
  const best = A.latestMainEpisode({ episodes: eps });
  check('预告 / PV / 未定档都不算', best && best.pub_time === 200, best && String(best.pub_time));
  check('没有正片 → null', A.latestMainEpisode({ episodes: [{ pub_time: 1, badge: '预告' }] }) === null);
  check('episodes 不是数组 → null', A.latestMainEpisode({}) === null && A.latestMainEpisode(null) === null);
}

console.log('\n=== season 归一化 ===');
{
  const base = {
    season_id: 28747,
    media_id: 28223043,
    title: '凡人修仙传',
    cover: 'https://i0.hdslb.com/bfs/bangumi/x.png',
    rating: { score: 9.7 },
    total: 0,
    new_ep: { desc: '6月13日起 每周六11:00', title: '196' },
    publish: { is_finish: 0, is_started: 1 },
    episodes: [
      { pub_time: 1792206000, title: '196', show_title: '第196话' },
      { pub_time: 1792206900, title: '197', show_title: '第197话预告', badge: '预告' },
    ],
  };
  const s = A.shapeSeason(base);
  check('文案优先：周六 11:00', s.airday === 6 && s.airtime === '11:00', JSON.stringify([s.airday, s.airtime]));
  check('来源标记为 desc', s.derived === 'desc', String(s.derived));
  check('标题 / 封面 / 评分带回来', s.title === '凡人修仙传' && /hdslb/.test(s.cover) && s.score === 9.7);
  check('连载中：matched = true', s.finished === false && s.matched === true);
  check('预告不影响结果（样例里预告比正片晚 15 分钟）', s.airtime === '11:00');

  const noDesc = A.shapeSeason(Object.assign({}, base, { new_ep: { desc: '', title: '196' } }));
  check('文案没写星期 → 用最近一集正片（周六 11:00）',
        noDesc.airday === 6 && noDesc.airtime === '11:00' && noDesc.derived === 'episode',
        JSON.stringify([noDesc.airday, noDesc.airtime, noDesc.derived]));

  const halfDesc = A.shapeSeason(Object.assign({}, base, { new_ep: { desc: '每周六更新', title: '196' } }));
  check('文案只有星期 → 时间从正片补',
        halfDesc.airday === 6 && halfDesc.airtime === '11:00' && halfDesc.derived === 'desc+episode',
        JSON.stringify([halfDesc.airday, halfDesc.airtime, halfDesc.derived]));

  const ended = A.shapeSeason(Object.assign({}, base, { publish: { is_finish: 1, is_started: 1 } }));
  check('完结番不再给放送时间', ended.finished === true && ended.airday === null && ended.airtime === null);

  const empty = A.shapeSeason({ season_id: 1, episodes: [] });
  check('没有任何可用信息 → matched = false', empty && empty.matched === false && empty.airday === null);
  check('非对象 → null', A.shapeSeason(null) === null && A.shapeSeason('x') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
