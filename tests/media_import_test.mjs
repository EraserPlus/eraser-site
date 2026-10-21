/* ===========================================================================
   追更「批量导入」解析逻辑的测试（M12）
   ---------------------------------------------------------------------------
   直接从 admin/content.js 里把 parseImport / parseRows / normCategory /
   normStatus 抽出来跑，避免「页面里写一套、测试里测另一套」。
   沿用 learn 那边的做法：在 vm 沙箱里把 IIFE 跑起来，拿 global.ContentAdmin。
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const code = fs.readFileSync(path.join(REPO, 'admin', 'content.js'), 'utf8');

/* 造一个最小的浏览器环境：内容脚本是 IIFE，会挂到 window.ContentAdmin */
const sandbox = {
  document: {
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {} },
      appendChild() {}, addEventListener() {}, setAttribute() {},
      remove() {},
    }),
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const CA = sandbox.window.ContentAdmin;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

console.log('=== 导出 ===');
check('ContentAdmin 暴露了 parseImport', typeof CA.parseImport === 'function');
check('ContentAdmin 暴露了 normCategory / normStatus',
  typeof CA.normCategory === 'function' && typeof CA.normStatus === 'function');

console.log('\n=== 表头识别 ===');
{
  const tsv = '名称\t栏目\t状态\t评分\t备注\n葬送的芙莉莲\t追番\t在看\t9.1\t2023 年 · 共 28 话\n迷宫饭\t漫画\t想看\t\t';
  const r = CA.parseImport(tsv);
  check('TSV：解析出 2 条', r.items.length === 2, String(r.items.length));
  check('TSV：识别到表头', r.hasHead === true);
  check('TSV：栏目映射 anime / comic',
    r.items[0].category === 'anime' && r.items[1].category === 'comic',
    r.items[0].category + '/' + r.items[1].category);
  check('TSV：状态映射 watching / wish',
    r.items[0].status === 'watching' && r.items[1].status === 'wish',
    r.items[0].status + '/' + r.items[1].status);
  check('TSV：评分保留', r.items[0].score === '9.1', r.items[0].score);
  check('TSV：备注保留', /28/.test(r.items[0].note), r.items[0].note);

  const cn = CA.parseImport('名称,状态,评分\n进击的巨人,看完,9.5');
  check('中文逗号表头也能认',
    cn.items.length === 1 && cn.items[0].status === 'finished' && cn.items[0].score === '9.5',
    JSON.stringify(cn.items[0]));

  const en = CA.parseImport('name,status\nFrieren,finished');
  check('英文表头也能认', en.items.length === 1 && en.items[0].status === 'finished', String(en.items.length));
}

console.log('\n=== 无表头 ===');
{
  const r = CA.parseImport('进击的巨人\n鬼灭之刃\n咒术回战');
  check('每行一个名字 → 3 条', r.items.length === 3, String(r.items.length));
  check('第一条名字正确', r.items[0].name === '进击的巨人', r.items[0].name);
  check('无表头时默认栏目为 anime（上层可覆盖）', r.items[0].category === 'anime', r.items[0].category);

  const r2 = CA.parseImport('进击的巨人,看完\n鬼灭之刃,在看');
  check('第二格是状态也能认出',
    r2.items[0].status === 'finished' && r2.items[1].status === 'watching',
    r2.items[0].status + '/' + r2.items[1].status);

  const r3 = CA.parseImport('名称|栏目|状态\n葬送的芙莉莲|追番|在看');
  check('竖线分隔也支持', r3.items.length === 1 && r3.items[0].name === '葬送的芙莉莲', String(r3.items.length));
}

console.log('\n=== JSON ===');
{
  const r = CA.parseImport(JSON.stringify([
    { category: 'anime', name: 'A', status: 'watching', score: 8 },
    { type: 'media', data: { category: 'comic', name: 'B', status: 'finished' } },
  ]));
  check('JSON 数组：2 条', r.items.length === 2 && r.json === true, String(r.items.length));
  check('{type,data} 包装也能解', r.items[1].name === 'B' && r.items[1].category === 'comic', JSON.stringify(r.items[1]));

  const r2 = CA.parseImport(JSON.stringify({ items: [{ name: 'X' }] }));
  check('{items:[…]} 也能解', r2.items.length === 1 && r2.items[0].name === 'X');

  const r3 = CA.parseImport(JSON.stringify([{ name: '' }, { name: 'ok' }]));
  check('没名字的条目被丢掉', r3.items.length === 1 && r3.items[0].name === 'ok', String(r3.items.length));

  let threw = false;
  try { CA.parseImport('[{bad json'); } catch (e) { threw = true; }
  check('坏 JSON 抛错（UI 能提示）', threw);
}

console.log('\n=== 归一化容错 ===');
{
  check('normCategory「漫画」→ comic', CA.normCategory('漫画') === 'comic');
  check('normCategory「追番」→ anime', CA.normCategory('追番') === 'anime');
  check('normCategory 认不出返回空', CA.normCategory('乱写') === '');
  check('normStatus「看完」→ finished', CA.normStatus('看完') === 'finished');
  check('normStatus「在看」→ watching', CA.normStatus('在看') === 'watching');
  check('normStatus「想看」→ wish', CA.normStatus('想看') === 'wish');
  check('normStatus「搁置」→ paused', CA.normStatus('搁置') === 'paused');
}

console.log('\n=== 评分处理（越界不能瞎猜） ===');
{
  const r = CA.parseImport('名称,评分\nA,99\nB,-3\nC,8.4\nD,abc');
  check('99 越界 → 丢掉', r.items[0].score === '', '[' + r.items[0].score + ']');
  check('-3 越界 → 丢掉（不能翻成正数）', r.items[1].score === '', '[' + r.items[1].score + ']');
  check('8.4 正常保留', r.items[2].score === '8.4', r.items[2].score);
  check('非数字 → 丢掉', r.items[3].score === '', '[' + r.items[3].score + ']');
}

console.log('\n=== 总集数 / 进度列（M13）===');
{
  check('ContentAdmin 暴露了 normCount', typeof CA.normCount === 'function');

  const tsv = '名称\t总集数\t进度\n葬送的芙莉莲\t28\t12\n迷宫饭\t\t3';
  const r = CA.parseImport(tsv);
  check('TSV：识别「总集数 / 进度」表头', r.hasHead === true && r.items.length === 2, String(r.items.length));
  check('TSV：总集数 / 进度各自归位',
    r.items[0].episodes === '28' && r.items[0].progress === '12',
    r.items[0].episodes + '/' + r.items[0].progress);
  check('TSV：总集数留空不报错', r.items[1].episodes === '', '[' + r.items[1].episodes + ']');
  check('TSV：只有进度也能读', r.items[1].progress === '3', r.items[1].progress);

  const alias = CA.parseImport('名称\t集数\t看到\nA\t24 话\t第 5 集');
  check('别名「集数 / 看到」也认，且从文字里抠数字',
    alias.items[0].episodes === '24' && alias.items[0].progress === '5',
    alias.items[0].episodes + '/' + alias.items[0].progress);

  const en = CA.parseImport('name\tepisodes\tprogress\nB\t12\t4');
  check('英文表头 episodes / progress 也认',
    en.items[0].episodes === '12' && en.items[0].progress === '4',
    en.items[0].episodes + '/' + en.items[0].progress);

  const js = CA.parseImport(JSON.stringify([{ name: 'C', episodes: 26, progress: 7 }]));
  check('JSON 里的 episodes / progress 保留',
    js.items[0].episodes === '26' && js.items[0].progress === '7',
    js.items[0].episodes + '/' + js.items[0].progress);

  /* normCount：抠不到数字宁可留空，也不瞎猜 */
  check('normCount 抠「第 12 集」→ 12', CA.normCount('第 12 集') === '12', CA.normCount('第 12 集'));
  check('normCount 抠「28 话」→ 28', CA.normCount('28 话') === '28', CA.normCount('28 话'));
  check('normCount 纯数字原样', CA.normCount('7') === '7', CA.normCount('7'));
  check('normCount 没数字 → 空', CA.normCount('不知道') === '', '[' + CA.normCount('不知道') + ']');
  check('normCount 空 → 空', CA.normCount('') === '' && CA.normCount(null) === '');
}

console.log('\n=== 更新日 / 更新时间列（M20）===');
{
  check('ContentAdmin 暴露了 normDay / normTime',
    typeof CA.normDay === 'function' && typeof CA.normTime === 'function');

  check('normDay「周三」→ 3', CA.normDay('周三') === '3', CA.normDay('周三'));
  check('normDay「星期三」→ 3', CA.normDay('星期三') === '3', CA.normDay('星期三'));
  check('normDay「周日」→ 7', CA.normDay('周日') === '7', CA.normDay('周日'));
  check('normDay「周天」→ 7', CA.normDay('周天') === '7', CA.normDay('周天'));
  check('normDay 数字字符串原样', CA.normDay('3') === '3');
  check('normDay 混着时间也先认星期词', CA.normDay('周五 20:00') === '5', CA.normDay('周五 20:00'));
  check('normDay 认不出 → 空', CA.normDay('乱写') === '' && CA.normDay('') === '' && CA.normDay(null) === '');

  check('normTime「20:00」原样', CA.normTime('20:00') === '20:00');
  check('normTime「8:05」补零', CA.normTime('8:05') === '08:05', CA.normTime('8:05'));
  check('normTime 全角冒号', CA.normTime('20：30') === '20:30', CA.normTime('20：30'));
  check('normTime「20点」→ 20:00', CA.normTime('20点') === '20:00');
  check('normTime「20点30」→ 20:30', CA.normTime('20点30') === '20:30');
  check('normTime「2000」→ 20:00', CA.normTime('2000') === '20:00', CA.normTime('2000'));
  check('normTime 越界 → 空', CA.normTime('25:00') === '' && CA.normTime('20:60') === '');
  check('normTime 认不出 → 空', CA.normTime('晚上') === '' && CA.normTime(null) === '');

  const tsv = '名称\t更新日\t更新时间\n葬送的芙莉莲\t周三\t20:00\n迷宫饭\t星期五\t8:30';
  const r = CA.parseImport(tsv);
  check('TSV：识别「更新日 / 更新时间」表头', r.hasHead === true && r.items.length === 2, String(r.items.length));
  check('TSV：更新日 / 更新时间各自归位',
    r.items[0].airday === '3' && r.items[0].airtime === '20:00',
    r.items[0].airday + '/' + r.items[0].airtime);
  check('TSV：中文星期和单数字时间也能归一',
    r.items[1].airday === '5' && r.items[1].airtime === '08:30',
    r.items[1].airday + '/' + r.items[1].airtime);

  const alias = CA.parseImport('名称\t放送日\t放送时间\nA\t周二\t晚上 20 点');
  check('别名「放送日 / 放送时间」也认', alias.items[0].airday === '2', alias.items[0].airday);
  check('时间从文字里抠数字', alias.items[0].airtime === '20:00', alias.items[0].airtime);

  const en = CA.parseImport('name\tweekday\tairtime\nB\tSun\t21:00');
  check('英文表头 weekday / airtime 也认',
    en.items[0].airday === '7' && en.items[0].airtime === '21:00',
    en.items[0].airday + '/' + en.items[0].airtime);

  const js = CA.parseImport(JSON.stringify([{ name: 'C', airday: 4, airtime: '19:30' }]));
  check('JSON 里的 airday / airtime 保留',
    js.items[0].airday === '4' && js.items[0].airtime === '19:30',
    js.items[0].airday + '/' + js.items[0].airtime);
}

console.log('\n=== 脏数据 ===');
{
  const r = CA.parseImport('名称\t状态\n\t在看\n好的\t看完');
  check('空名称行被跳过并计数', r.items.length === 1 && r.errors.length === 1,
    'items=' + r.items.length + ' errors=' + r.errors.length);

  const empty = CA.parseImport('');
  check('空输入 → 0 条不报错', empty.items.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
