/* ===========================================================================
   追更工作台（M20）的纯逻辑测试
   ---------------------------------------------------------------------------
   测 workbench.js：星期换算、继续看的取舍与排序、本周放送、进度文案。
   这一层不碰 DOM，所以直接在 vm 沙箱里跑，不需要浏览器。
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const code = fs.readFileSync(path.join(REPO, 'workbench.js'), 'utf8');

const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const W = sandbox.window.Workbench;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

/* 造一条 media 记录：data 里只放关心的字段 */
const item = (id, data, updatedAt) => ({
  id,
  updated_at: updatedAt || '2026-10-20T10:00:00.000Z',
  data: Object.assign({ category: 'anime', name: id, status: 'watching' }, data),
});

console.log('=== 导出 ===');
check('Workbench 挂在 window 上', !!W);
check('七个星期标签', Array.isArray(W.days) && W.days.length === 7 && W.days[2] === '周三', String(W.days));

console.log('\n=== 星期换算 ===');
{
  check('2026-10-21 是周三', W.dayOf(new Date(2026, 9, 21, 12)) === 3, String(W.dayOf(new Date(2026, 9, 21, 12))));
  check('2026-10-25 是周日 → 7', W.dayOf(new Date(2026, 9, 25, 12)) === 7, String(W.dayOf(new Date(2026, 9, 25, 12))));
  check('周一 → 1', W.dayOf(new Date(2026, 9, 19, 12)) === 1, String(W.dayOf(new Date(2026, 9, 19, 12))));
  check('dayLabel(3) = 周三', W.dayLabel(3) === '周三');
  check('dayLabel 越界给空串', W.dayLabel(0) === '' && W.dayLabel(8) === '' && W.dayLabel('x') === '');
  check('dateText 带月和星期', W.dateText(new Date(2026, 9, 21, 8)) === '10月21日 · 周三',
    W.dateText(new Date(2026, 9, 21, 8)));
}

console.log('\n=== 问候语 ===');
{
  check('5 点 → 早上好', W.greeting(5) === '早上好');
  check('10 点 → 早上好', W.greeting(10) === '早上好');
  check('11 点 → 中午好', W.greeting(11) === '中午好');
  check('13 点 → 下午好', W.greeting(13) === '下午好');
  check('18 点 → 晚上好', W.greeting(18) === '晚上好');
  check('23 点 → 夜深了', W.greeting(23) === '夜深了');
  check('凌晨 3 点 → 夜深了', W.greeting(3) === '夜深了');
}

console.log('\n=== 更新日 / 时间解析 ===');
{
  check('airday 3 → 3', W.airdayOf({ airday: 3 }) === 3);
  check('airday "7" → 7', W.airdayOf({ airday: '7' }) === 7);
  check('airday 0 → null', W.airdayOf({ airday: 0 }) === null);
  check('airday 8 → null', W.airdayOf({ airday: 8 }) === null);
  check('airday 空 → null', W.airdayOf({}) === null && W.airdayOf(null) === null);

  check('20:00 → 1200 分钟', W.minutesOf('20:00') === 1200, String(W.minutesOf('20:00')));
  check('8:05 → 485 分钟', W.minutesOf('8:05') === 485, String(W.minutesOf('8:05')));
  check('没填时间排最后', W.minutesOf('') === 1441 && W.minutesOf(null) === 1441);
  check('坏时间排最后', W.minutesOf('25:00') === 1441 && W.minutesOf('abc') === 1441);
}

console.log('\n=== 接着看：收谁 ===');
{
  const list = W.continueList([
    item('a', { status: 'watching' }),
    item('b', { status: 'wish', progress: 3 }),
    item('c', { status: 'wish', position: 120 }),
    item('d', { status: 'wish' }),
    item('e', { status: 'finished', progress: 28 }),
    item('f', { status: 'paused', progress: 5 }),
    item('g', { status: 'watching', progress: 5, finished: true }),
  ]);
  const ids = list.map(x => x.id).join(',');
  check('在看的、有进度的进来；想看没进度、完结、搁置不进来', ids === 'a,b,c,g', ids);
  check('上游完结但自己没看完的仍在接着追', list.some(x => x.id === 'g'));
  check('null 输入不炸', W.continueList(null).length === 0);
}

console.log('\n=== 接着看：排序 ===');
{
  const list = W.continueList([
    item('old', { status: 'watching' }, '2026-10-01T00:00:00.000Z'),
    item('new', { status: 'watching' }, '2026-10-20T00:00:00.000Z'),
    item('mid', { status: 'watching' }, '2026-10-10T00:00:00.000Z'),
  ]);
  check('最近改过的排前面', list.map(x => x.id).join(',') === 'new,mid,old', list.map(x => x.id).join(','));
}

console.log('\n=== 本周放送 ===');
{
  const items = [
    item('wed-late', { airday: 3, airtime: '22:00' }, '2026-10-01T00:00:00.000Z'),
    item('wed-early', { airday: 3, airtime: '09:30' }),
    item('wed-none', { airday: 3 }),
    item('wed-done', { airday: 3, status: 'finished' }),
    item('wed-paused', { airday: 3, status: 'paused' }),
    item('wed-upstream-done', { airday: 3, airtime: '21:00', finished: true }),
    item('fri', { airday: 5, airtime: '20:00' }),
    item('no-day', { status: 'watching' }),
  ];
  const wed = W.scheduleFor(items, 3);
  check('只收周三、排除完结/搁置/上游完结/没填更新日', wed.map(x => x.id).join(',') === 'wed-early,wed-late,wed-none',
    wed.map(x => x.id).join(','));
  check('按更新时间升序，没填时间的排最后', wed[2].id === 'wed-none', wed[2].id);
  check('周五各自归位', W.scheduleFor(items, 5).map(x => x.id).join(',') === 'fri');
  check('没有安排返回空数组', W.scheduleFor(items, 1).length === 0);
  check('非法星期返回空数组', W.scheduleFor(items, 8).length === 0 && W.scheduleFor(items, null).length === 0);

  const counts = W.dayCounts(items);
  check('计数数组下标 1–7 对应周一到周日', counts.length === 8 && counts[3] === 3 && counts[5] === 1,
    JSON.stringify(counts));
  check('完结/搁置/上游完结不计入放送数', counts[3] === 3, String(counts[3]));
}

console.log('\n=== 进度文案 ===');
{
  check('12 / 28 → 43%', W.epPct({ progress: 12, episodes: 28 }) === 43, String(W.epPct({ progress: 12, episodes: 28 })));
  check('28 / 28 → 100%', W.epPct({ progress: 28, episodes: 28 }) === 100);
  check('0 / 28 → 0%', W.epPct({ progress: 0, episodes: 28 }) === 0);
  check('缺进度 → null', W.epPct({ episodes: 28 }) === null);
  check('缺总数 → null', W.epPct({ progress: 3 }) === null);
  check('总集数为 0 → null', W.epPct({ progress: 0, episodes: 0 }) === null);
  check('只有最新集数也能画进度（8 / 12）', W.epPct({ progress: 8, latest: 12 }) === 67,
    String(W.epPct({ progress: 8, latest: 12 })));
  check('有总集数时优先用总集数（8 / 28）', W.epPct({ progress: 8, episodes: 28, latest: 12 }) === 29,
    String(W.epPct({ progress: 8, episodes: 28, latest: 12 })));
  check('总集数比最新集数还小 → 用最新集数兜底', W.epPct({ progress: 8, episodes: 12, latest: 20 }) === 40,
    String(W.epPct({ progress: 8, episodes: 12, latest: 20 })));

  check('新 4 话', W.freshCount({ progress: 8, latest: 12 }) === 4);
  check('追平后没有新集', W.freshCount({ progress: 12, latest: 12 }) === 0);
  check('没填进度不算欠账', W.freshCount({ latest: 12 }) === 0 && W.freshCount({ progress: 8 }) === 0);
  check('非法进度不炸', W.freshCount({ progress: -2, latest: 12 }) === 0 && W.freshCount(null) === 0);

  check('有进度有总数', W.watchedText({ progress: 12, episodes: 28 }) === '看到 12 / 28 话');
  check('只有进度', W.watchedText({ progress: 12 }) === '看到第 12 话');
  check('只有总数', W.watchedText({ episodes: 28 }) === '共 28 话');
  check('都没有', W.watchedText({}) === '还没开始');
  check('有最新集数时提示更新到哪', W.watchedText({ progress: 8, latest: 12 }) === '看到 8 / 更新至 12 话');
  check('追平最新一话', W.watchedText({ progress: 12, latest: 12 }) === '已追平 · 更新至 12 话');
  check('上游完结但没看完', W.watchedText({ progress: 8, latest: 12, finished: true }) === '看到 8 / 共 12 话');
  check('上游完结且追平', W.watchedText({ progress: 12, latest: 12, finished: true }) === '已追平 · 共 12 话');
  check('只有最新集数', W.watchedText({ latest: 12 }) === '更新至第 12 话');
  check('只有最新集数且已完结', W.watchedText({ latest: 12, finished: true }) === '共 12 话');

  check('下一话', W.nextEpText({ progress: 12, episodes: 28 }) === '下一话 第 13 话');
  check('追平了', W.nextEpText({ progress: 28, episodes: 28 }) === '已追平 · 共 28 话');
  check('只有总数时的下一话文案', W.nextEpText({ episodes: 28 }) === '共 28 话');
  check('没进度没总数', W.nextEpText({}) === '待开看');
  check('最新集数决定下一话', W.nextEpText({ progress: 8, episodes: 28, latest: 12 }) === '下一话 第 9 话');
  check('追平最新一话（总集数还没到）', W.nextEpText({ progress: 12, episodes: 28, latest: 12 }) === '已追平 · 更新至 12 话');
  check('上游完结且追平', W.nextEpText({ progress: 12, latest: 12, finished: true }) === '已追平 · 共 12 话');
  check('只有最新集数', W.nextEpText({ latest: 12 }) === '更新至第 12 话');

  check('续播剩余分钟（向上取整）', W.remainingText({ position: 100, duration: 700 }) === '还剩约 10 分钟',
    W.remainingText({ position: 100, duration: 700 }));
  check('不足 1 分钟', W.remainingText({ position: 40, duration: 50 }) === '还剩不到 1 分钟');
  check('没有续播点时显示全长', W.remainingText({ duration: 700 }) === '全长约 12 分钟');
  check('没有时长时留空', W.remainingText({ position: 40 }) === '');
  check('空数据留空', W.remainingText(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
