/* 临时脚本：验证 learn/index.html 里的 parseOutline 解析逻辑
   直接从页面源码里抽出函数体来跑，避免「写了一套、跑的是另一套」。 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const html = fs.readFileSync(path.join(REPO, 'learn', 'index.html'), 'utf8');

/* 抽出 parseOutline 与 previewGroups 两个函数 */
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到 ' + name);
  /* 从函数开头的 { 开始做花括号配平 */
  let j = html.indexOf('{', i), depth = 0, k = j;
  for (; k < html.length; k++) {
    const c = html[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return html.slice(i, k);
}

const src = grab('parseOutline') + '\n' + grab('previewGroups') + '\nreturn { parseOutline, previewGroups };';
const { parseOutline, previewGroups } = new Function(src)();

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* 1. 简单缩进大纲 */
{
  const r = parseOutline(`基础
    - HTML 标签
    - CSS 选择器
进阶：JavaScript
    - 变量与作用域
    - 异步 / Promise`);
  const gs = previewGroups(r);
  check('缩进大纲能解析', r.length === 6, JSON.stringify(r));
  check('顶层行成为分组名', gs.map(g => g.name).join('|') === '未分组|基础|进阶', gs.map(g => g.name).join('|'));
  check('「名称：说明」左半当分组并有自己的节点', gs.some(g => g.name === '进阶' && g.items.indexOf('JavaScript') >= 0),
        JSON.stringify(gs));
}

/* 2. Markdown 无序 / 有序 / 标题都能认 */
{
  const r = parseOutline(`- 第一步
* 第二步
1. 第三步
## 第四步`);
  check('四种 Markdown 标记都能去掉', r.map(x => x.text).join('|') === '第一步|第二步|第三步|第四步', r.map(x => x.text).join('|'));
}

/* 3. 空 / 坏输入不炸 */
{
  check('空字符串不炸', parseOutline('').length === 0);
  check('null 不炸', parseOutline(null).length === 0);
  check('全是空行不炸', parseOutline('\n\n   \n\t\n').length === 0);
}

/* 4. Tab 缩进等价 2 空格 */
{
  const a = parseOutline('组\n\t- 甲');
  const b = parseOutline('组\n  - 甲');
  check('Tab 与 2 空格结果一致', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  check('缩进行归到分组', a.length === 2 && a[1].group === '组' && a[1].text === '甲', JSON.stringify(a));
}

/* 5. 三层缩进：最近的上一层当分组 */
{
  const r = parseOutline(`第一层
    第二层
        第三层`);
  check('三层缩进不炸且归组正确', r.length === 3 && r[2].text === '第三层', JSON.stringify(r));
}

/* 6. CRLF */
{
  const r = parseOutline('组\r\n  - 甲\r\n  - 乙');
  check('CRLF 能处理', r.length === 3, JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
