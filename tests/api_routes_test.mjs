import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

const PW = 'test-password-1234';
process.env.ADMIN_PASSWORD = PW;
process.env.DATABASE_URL = 'postgres://fake/db';

const T = await load('api/_lib/token.js');
const authRoute = (await load('api/auth.js')).default;
const todosRoute = (await load('api/todos.js')).default;
const eventsRoute = (await load('api/events.js')).default;

/* ---------- 假数据库 ---------- */
let executed = [];
function fakeDb(handler) {
  executed = [];
  globalThis.__FAKE_DB__ = {
    handler: (text, values) => {
      executed.push({ text: text.replace(/\s+/g, ' ').trim(), values });
      return handler(text, values);
    },
  };
}
const noop = () => [];

/* ---------- 假 req / res ---------- */
function mockReq(method, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  return {
    method,
    headers,
    query: opts.query || {},
    body: opts.body,
    socket: { remoteAddress: opts.ip || '1.2.3.4' },
    async *[Symbol.asyncIterator]() {},
  };
}
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    json: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.json = s ? JSON.parse(s) : null; },
  };
}
async function call(handler, method, opts = {}) {
  const res = mockRes();
  await handler(mockReq(method, opts), res);
  return res;
}

const TOKEN = T.issueToken().token;

console.log('=== 所有接口都必须登录才能访问 ===');
{
  fakeDb(noop);
  const routes = [['todos', todosRoute], ['events', eventsRoute]];

  for (const [name, handler] of routes) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const res = await call(handler, method, { body: {} });
      check(`未登录 ${method} /api/${name} → 401`, res.statusCode === 401, String(res.statusCode));
      check(`未登录 ${method} /api/${name} 不碰数据库`, executed.length === 0, executed.map(e => e.text).join(' | '));
    }
  }

  const res = await call(todosRoute, 'GET', { token: 'aaa.bbb' });
  check('伪造令牌 → 401', res.statusCode === 401, String(res.statusCode));

  const expired = T.issueToken(Date.now() - T.TOKEN_TTL_MS - 1000).token;
  const res2 = await call(todosRoute, 'GET', { token: expired });
  check('过期令牌 → 401', res2.statusCode === 401, String(res2.statusCode));
}

console.log('\n=== 带令牌的正常流程 ===');
{
  fakeDb((text) => {
    if (/SELECT .* FROM todos/.test(text)) {
      return [{ id: 1, title: '买菜', note: null, done: false, due_date: '2026-10-20', created_at: 'x', done_at: null }];
    }
    return [];
  });
  const res = await call(todosRoute, 'GET', { token: TOKEN });
  check('GET /api/todos → 200', res.statusCode === 200, String(res.statusCode));
  check('返回 items 数组', Array.isArray(res.json.items) && res.json.items.length === 1);
  check('返回的标题正确', res.json.items[0].title === '买菜');

  fakeDb(() => [{ id: 9, title: '写文档', note: null, done: false, due_date: null, created_at: 'x', done_at: null }]);
  const res2 = await call(todosRoute, 'POST', { token: TOKEN, body: { title: '写文档' } });
  check('POST /api/todos → 200', res2.statusCode === 200, String(res2.statusCode));
  check('返回新建的条目', res2.json.item.id === 9);

  fakeDb(() => [{ id: 1 }]);
  const res3 = await call(todosRoute, 'DELETE', { token: TOKEN, query: { id: '1' } });
  check('DELETE /api/todos?id=1 → 200', res3.statusCode === 200, String(res3.statusCode));

  fakeDb(() => [{ id: 5, title: '改过的', note: null, done: true, due_date: null, created_at: 'x', done_at: 'y' }]);
  const res4 = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 5, title: '改过的', done: true } });
  check('PATCH /api/todos → 200', res4.statusCode === 200, String(res4.statusCode));
}

console.log('\n=== 入参校验与不存在的记录 ===');
{
  fakeDb(noop);
  const t = (method, body, query) => call(todosRoute, method, { token: TOKEN, body, query });

  let r = await t('POST', { title: '' });
  check('标题为空 → 400', r.statusCode === 400, String(r.statusCode));
  check('错误信息可读', /标题/.test(r.json.error || ''), r.json.error);

  r = await t('POST', { title: 'x'.repeat(201) });
  check('标题超长 → 400', r.statusCode === 400, String(r.statusCode));

  r = await t('POST', { title: '正常', due_date: '2026/10/13' });
  check('日期格式不对 → 400', r.statusCode === 400, String(r.statusCode));

  r = await t('PATCH', { title: '没给 id' });
  check('PATCH 缺 id → 400', r.statusCode === 400, String(r.statusCode));

  r = await t('DELETE', {});
  check('DELETE 缺 id → 400', r.statusCode === 400, String(r.statusCode));

  r = await t('DELETE', {}, { id: 'abc' });
  check('DELETE id 不是数字 → 400', r.statusCode === 400, String(r.statusCode));

  fakeDb(() => []);
  r = await t('DELETE', {}, { id: '999' });
  check('删不存在的记录 → 404', r.statusCode === 404, String(r.statusCode));

  r = await t('PATCH', { id: 999, title: 'x' });
  check('改不存在的记录 → 404', r.statusCode === 404, String(r.statusCode));

  fakeDb(noop);
  r = await call(todosRoute, 'PUT', { token: TOKEN, body: {} });
  check('不支持的方法 → 405', r.statusCode === 405, String(r.statusCode));

  /* 日程的入参校验 */
  fakeDb(noop);
  r = await call(eventsRoute, 'POST', { token: TOKEN, body: { title: '会议' } });
  check('日程缺开始时间 → 400', r.statusCode === 400, String(r.statusCode));
  r = await call(eventsRoute, 'POST', { token: TOKEN, body: { title: '会议', start_at: '不是时间' } });
  check('日程开始时间非法 → 400', r.statusCode === 400, String(r.statusCode));
}

console.log('\n=== 待办优先级 ===');
{
  const grab = () => executed.find(e => /INSERT INTO todos/.test(e.text));
  const post = (priority) => call(todosRoute, 'POST', { token: TOKEN, body: { title: '测试', priority } });

  fakeDb(() => [{ id: 1 }]);
  await post(undefined);
  check('不给 priority 时默认 1（中）', grab().values[3] === 1, String(grab().values[3]));

  fakeDb(() => [{ id: 1 }]);
  await post(2);
  check('priority=2 通过', grab().values[3] === 2, String(grab().values[3]));

  fakeDb(() => [{ id: 1 }]);
  await post(0);
  check('priority=0 通过', grab().values[3] === 0, String(grab().values[3]));

  fakeDb(() => [{ id: 1 }]);
  await post('2');
  check('priority 传字符串 "2" 也能转成数字', grab().values[3] === 2, String(grab().values[3]));

  for (const bad of [3, -1, 99, 'abc', '高']) {
    fakeDb(noop);
    const res = await post(bad);
    check(`priority=${JSON.stringify(bad)} → 400`, res.statusCode === 400, String(res.statusCode));
  }

  fakeDb(noop);
  let res = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1, title: 'x', priority: 5 } });
  check('PATCH 传非法优先级 → 400', res.statusCode === 400, String(res.statusCode));

  fakeDb(() => [{ id: 1, priority: 2 }]);
  res = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1, title: 'x', priority: 2 } });
  check('PATCH 传合法优先级 → 200', res.statusCode === 200, String(res.statusCode));

  /* 读取时要带上 priority，否则前端拿不到 */
  fakeDb(() => []);
  await call(todosRoute, 'GET', { token: TOKEN });
  const sel = executed.find(e => /SELECT .* FROM todos/.test(e.text));
  check('SELECT 里包含 priority 字段', sel && /priority/.test(sel.text), sel ? sel.text : 'none');
  check('排序按「未完成 → 优先级高在前 → 截止日期」',
        sel && /ORDER BY done ASC, priority DESC/.test(sel.text), sel ? sel.text : 'none');
}

console.log('\n=== PATCH 合并语义：只更新请求体里出现的字段 ===');
{
  /* 参数顺序：[hasTitle, title, hasNote, note, hasDue, due, hasPri, pri,
     hasDone, done, hasDone, done, hasDone, done, id]
     （done_at 的 CASE 里 hasDone / done 各出现两次，共 15 个参数；
       所以「done 键是否出现」看 values[8]，「传入的 done 值」看 values[9]） */
  const grabTodos = () => executed.find(e => /UPDATE todos/.test(e.text));

  fakeDb(() => [{ id: 1, title: 'x', note: null, done: true, due_date: null, created_at: 'x', done_at: 'y' }]);
  let r = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1, done: true } });
  check('PATCH 只传 done:true → 200', r.statusCode === 200, String(r.statusCode));
  let up = grabTodos();
  check('SQL 用静态 CASE 且维护 done_at', up && /CASE/.test(up.text) && /done_at/.test(up.text),
        up ? up.text.slice(0, 160) : 'none');
  check('title/note/due/priority 四个标志位为 false、done 标志位为 true',
        up && up.values[0] === false && up.values[2] === false && up.values[4] === false &&
        up.values[6] === false && up.values[8] === true,
        up ? JSON.stringify(up.values) : 'none');

  fakeDb(() => [{ id: 1, title: 'x', note: null, done: false, due_date: null, created_at: 'x', done_at: null }]);
  r = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1, done: false } });
  check('PATCH 只传 done:false → 200', r.statusCode === 200, String(r.statusCode));
  up = grabTodos();
  /* done 键出现了（values[8]=hasDone 为 true），但值为 false（values[9]） */
  check('done 标志位为 true 且传入的 done 值为 false',
        up && up.values[8] === true && up.values[9] === false, up ? JSON.stringify(up.values) : 'none');

  fakeDb(() => [{ id: 1, title: '新标题', note: null, done: false, due_date: null, created_at: 'x', done_at: null }]);
  r = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1, title: '新标题' } });
  check('PATCH 只传 title → 200', r.statusCode === 200, String(r.statusCode));
  up = grabTodos();
  check('title 标志位为 true，其余四个标志位为 false',
        up && up.values[0] === true && up.values[2] === false && up.values[4] === false &&
        up.values[6] === false && up.values[8] === false,
        up ? JSON.stringify(up.values) : 'none');

  /* done_at 由服务端维护，夹带传入也必须被忽略 */
  fakeDb(() => [{ id: 1, title: 'x', note: null, done: true, due_date: null, created_at: 'x', done_at: 'server-side' }]);
  r = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1, done: true, done_at: 'HACKED' } });
  check('PATCH 夹带 done_at → 200（字段被忽略）', r.statusCode === 200, String(r.statusCode));
  up = grabTodos();
  check('done_at 没有作为参数传入（永不接受前端传入）',
        up && !up.values.some(v => v === 'HACKED'), up ? JSON.stringify(up.values) : 'none');

  fakeDb(noop);
  r = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1 } });
  check('PATCH 只有 id → 400', r.statusCode === 400, String(r.statusCode));
  check('错误信息提示至少传一个字段', /至少传一个/.test(r.json.error || ''), r.json.error);

  /* 回归：旧前端全量传参仍然 200（全传 = 全量更新） */
  fakeDb(() => [{ id: 1, title: '全量', note: 'n', done: true, due_date: '2026-10-20', priority: 2, created_at: 'x', done_at: 'y' }]);
  r = await call(todosRoute, 'PATCH', { token: TOKEN, body: { id: 1, title: '全量', note: 'n', due_date: '2026-10-20', priority: 2, done: true } });
  check('PATCH 全量传参（兼容旧行为）→ 200', r.statusCode === 200, String(r.statusCode));
  up = grabTodos();
  check('全量时五个标志位全为 true',
        up && up.values[0] === true && up.values[2] === true && up.values[4] === true &&
        up.values[6] === true && up.values[8] === true,
        up ? JSON.stringify(up.values) : 'none');

  /* 日程：参数顺序 [hasTitle, title, hasNote, note, hasStart, start, hasEnd, end, hasAllDay, allDay, id] */
  const grabEvents = () => executed.find(e => /UPDATE events/.test(e.text));

  fakeDb(() => [{ id: 1, title: 'x', note: null, start_at: 's', end_at: null, all_day: false, created_at: 'x' }]);
  r = await call(eventsRoute, 'PATCH', { token: TOKEN, body: { id: 1, start_at: '2026-10-20T09:00:00.000Z' } });
  check('日程 PATCH 只传 start_at → 200', r.statusCode === 200, String(r.statusCode));
  up = grabEvents();
  check('start 标志位为 true，title/note/end/all_day 标志位为 false',
        up && up.values[0] === false && up.values[2] === false && up.values[4] === true &&
        up.values[6] === false && up.values[8] === false,
        up ? JSON.stringify(up.values) : 'none');

  fakeDb(() => [{ id: 1, title: '改标题', note: null, start_at: 's', end_at: null, all_day: false, created_at: 'x' }]);
  r = await call(eventsRoute, 'PATCH', { token: TOKEN, body: { id: 1, title: '改标题' } });
  check('日程 PATCH 只传 title → 200', r.statusCode === 200, String(r.statusCode));
  up = grabEvents();
  check('title 标志位为 true，其余标志位为 false',
        up && up.values[0] === true && up.values[2] === false && up.values[4] === false &&
        up.values[6] === false && up.values[8] === false,
        up ? JSON.stringify(up.values) : 'none');

  fakeDb(noop);
  r = await call(eventsRoute, 'PATCH', { token: TOKEN, body: { id: 1 } });
  check('日程 PATCH 只有 id → 400', r.statusCode === 400, String(r.statusCode));
  check('错误信息提示至少传一个字段', /至少传一个/.test(r.json.error || ''), r.json.error);
}

console.log('\n=== SQL 注入防护 ===');
{
  const evil = "'; DROP TABLE todos; --";
  fakeDb(() => [{ id: 1, title: evil, note: null, done: false, due_date: null, created_at: 'x', done_at: null }]);
  await call(todosRoute, 'POST', { token: TOKEN, body: { title: evil, note: evil } });

  const allSql = executed.map(e => e.text).join('\n');
  check('恶意字符串没有拼进 SQL 语句', !/DROP TABLE/i.test(allSql), allSql.slice(0, 200));
  check('恶意字符串是作为参数传的', executed.some(e => (e.values || []).some(v => v === evil)));

  const insertStmt = executed.find(e => /INSERT INTO todos/.test(e.text));
  check('INSERT 用的是占位符 ?', insertStmt && insertStmt.text.includes(' ? '), insertStmt ? insertStmt.text : 'none');
  check('INSERT 的值全部走参数（title/note/due_date/priority 共 4 个）',
        insertStmt && insertStmt.values.length === 4, String(insertStmt && insertStmt.values.length));

  /* 删表这种破坏性语句，代码里根本不存在 */
  const srcFiles = ['api/todos.js', 'api/events.js', 'api/_lib/db.js', 'api/_lib/ratelimit.js'];
  const fs = await import('node:fs');
  const src = srcFiles.map(f => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n');
  check('源码里没有 DROP TABLE 语句', !/DROP\s+TABLE/i.test(src));
  check('源码里没有 TRUNCATE', !/TRUNCATE/i.test(src));
}

console.log('\n=== 登录接口 ===');
{
  fakeDb(() => []);

  let res = await call(authRoute, 'GET');
  check('未登录 GET /api/auth → 200 且 loggedIn false', res.statusCode === 200 && res.json.loggedIn === false);
  check('返回配置自检（数据库已配）', res.json.config && res.json.config.hasDatabase === true);
  check('返回配置自检（密码已配）', res.json.config && res.json.config.hasPassword === true);

  res = await call(authRoute, 'GET', { token: TOKEN });
  check('带有效令牌 → loggedIn true', res.json.loggedIn === true);

  fakeDb(() => []);
  res = await call(authRoute, 'POST', { body: { password: 'wrong-password' } });
  check('密码错误 → 401', res.statusCode === 401, String(res.statusCode));
  check('提示还剩几次机会', /还可以试/.test(res.json.error || ''), res.json.error);
  check('失败被记入数据库', executed.some(e => /INSERT INTO login_attempts/.test(e.text)));

  fakeDb(() => []);
  res = await call(authRoute, 'POST', { body: { password: PW } });
  check('密码正确 → 200', res.statusCode === 200, String(res.statusCode));
  check('返回了令牌', typeof res.json.token === 'string' && res.json.token.includes('.'));
  check('返回的令牌确实有效', T.verifyToken(res.json.token) !== null);
  check('登录成功清空失败计数', executed.some(e => /DELETE FROM login_attempts/.test(e.text)));

  fakeDb(() => []);
  res = await call(authRoute, 'POST', { body: {} });
  check('不给密码 → 401', res.statusCode === 401, String(res.statusCode));
}

console.log('\n=== 登录限流 ===');
{
  const until = new Date(Date.now() + 10 * 60000).toISOString();
  fakeDb(() => [{ fails: 0, locked_until: until }]);
  let res = await call(authRoute, 'POST', { body: { password: PW }, ip: '9.9.9.9' });
  check('处于锁定状态 → 429', res.statusCode === 429, String(res.statusCode));
  check('提示还要等多久', /分钟/.test(res.json.error || ''), res.json.error);

  fakeDb(() => [{ fails: 0, locked_until: new Date(Date.now() - 1000).toISOString() }]);
  res = await call(authRoute, 'POST', { body: { password: PW }, ip: '9.9.9.9' });
  check('锁定已过期 → 可以继续登录', res.statusCode === 200, String(res.statusCode));

  /* 第 5 次失败应当触发锁定 */
  fakeDb((text) => /INSERT INTO login_attempts/.test(text) ? [{ fails: 5 }] : []);
  res = await call(authRoute, 'POST', { body: { password: 'nope' }, ip: '8.8.8.8' });
  check('第 5 次失败 → 401 且提示已锁定', res.statusCode === 401 && /锁定/.test(res.json.error || ''), res.json.error);
  check('触发锁定后写入了 locked_until', executed.some(e => /locked_until/.test(e.text) && /UPDATE/.test(e.text)));
}

console.log('\n=== 服务器没配好时的表现 ===');
{
  const savedDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  fakeDb(noop);
  let res = await call(authRoute, 'POST', { body: { password: PW } });
  check('缺数据库 → 503 且说明原因', res.statusCode === 503 && /数据库/.test(res.json.error || ''), res.json.error);

  res = await call(authRoute, 'GET');
  check('GET 仍能返回配置状态供前端提示', res.statusCode === 200 && res.json.config.hasDatabase === false);
  process.env.DATABASE_URL = savedDb;

  const savedPw = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'short';
  fakeDb(noop);
  res = await call(authRoute, 'POST', { body: { password: 'short' } });
  check('密码太短 → 503 且说明原因', res.statusCode === 503 && /密码/.test(res.json.error || ''), res.json.error);
  process.env.ADMIN_PASSWORD = savedPw;
}

console.log('\n=== 内容接口 /api/content ===');
{
  const contentRoute = (await load('api/content.js')).default;
  const row = (o) => Object.assign({ id: 1, type: 'nav_category', parent_id: null, sort_order: 0, updated_at: 'x', data: {} }, o);

  /* --- 读取是公开的 --- */
  fakeDb(() => [row({ id: 1, type: 'nav_category', data: { name: '开发' } }),
                row({ id: 2, type: 'nav_link', parent_id: 1, data: { name: 'GitHub', url: 'https://github.com' } })]);
  let res = await call(contentRoute, 'GET', { query: { type: 'nav' } });
  check('未登录也能读导航（前台要读）→ 200', res.statusCode === 200, String(res.statusCode));
  check('返回 categories 与 links 两组', Array.isArray(res.json.categories) && Array.isArray(res.json.links));
  check('分类和链接被正确分开', res.json.categories.length === 1 && res.json.links.length === 1);
  check('data 被解析成对象', res.json.categories[0].data.name === '开发');

  fakeDb(() => [row({ type: 'post', data: { slug: 'a', title: 't', content: 'c' } })]);
  res = await call(contentRoute, 'GET', { query: { type: 'post' } });
  check('未登录也能读文章列表 → 200', res.statusCode === 200 && res.json.items.length === 1);

  fakeDb(noop);
  res = await call(contentRoute, 'GET', { query: { type: 'hack' } });
  check('未知类型 → 400', res.statusCode === 400, String(res.statusCode));

  res = await call(contentRoute, 'GET', { query: {} });
  check('不给 type → 400', res.statusCode === 400, String(res.statusCode));

  /* --- 写入需要登录 --- */
  for (const m of ['POST', 'PATCH', 'DELETE']) {
    fakeDb(noop);
    res = await call(contentRoute, m, { body: {}, query: { id: '1' } });
    check(`未登录 ${m} /api/content → 401`, res.statusCode === 401, String(res.statusCode));
  }

  /* --- 创建 --- */
  fakeDb((t) => /INSERT INTO content/.test(t) ? [row({ id: 9, data: { name: '新分类' } })] : []);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'nav_category', data: { name: '新分类' } } });
  check('创建分类 → 200', res.statusCode === 200, String(res.statusCode));
  check('返回新建的条目', res.json.item.id === 9);

  const ins = executed.find(e => /INSERT INTO content/.test(e.text));
  check('data 以 JSON 字符串传入并强转 jsonb', ins && ins.text.includes('::jsonb'), ins ? ins.text : 'none');
  check('type 走参数而不是拼进 SQL', ins && ins.values[0] === 'nav_category', String(ins && ins.values[0]));

  fakeDb(noop);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'nav_category', data: { name: '' } } });
  check('空名字 → 400', res.statusCode === 400, String(res.statusCode));

  /* --- nav_link 必须挂在已存在的分类下 --- */
  fakeDb(() => []);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'nav_link', data: { name: 'a', url: 'https://a.com' } } });
  check('nav_link 缺 parent_id → 400', res.statusCode === 400, String(res.statusCode));

  fakeDb(() => []);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'nav_link', parent_id: 999, data: { name: 'a', url: 'https://a.com' } } });
  check('parent_id 指向不存在的分类 → 400', res.statusCode === 400, String(res.statusCode));

  fakeDb((t) => /SELECT id FROM content WHERE id/.test(t) ? [{ id: 1 }] : [row({ id: 3, type: 'nav_link' })]);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'nav_link', parent_id: 1, data: { name: 'a', url: 'https://a.com' } } });
  check('parent_id 合法 → 200', res.statusCode === 200, String(res.statusCode));

  fakeDb((t) => /SELECT id FROM content WHERE id/.test(t) ? [{ id: 1 }] : []);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'nav_link', parent_id: 1, data: { name: 'a', url: 'javascript:alert(1)' } } });
  check('伪协议网址 → 400', res.statusCode === 400, String(res.statusCode));

  /* --- 唯一性 --- */
  fakeDb(() => [{ id: 5 }]);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'post', data: { slug: 'a', title: 't', content: 'c' } } });
  check('文章短链接重复 → 409', res.statusCode === 409, String(res.statusCode));
  check('重复时给出可读提示', /已经被别的文章用了/.test(res.json.error || ''), res.json.error);

  fakeDb(() => [{ id: 6 }]);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'page', data: { key: 'about', title: 't', content: 'c' } } });
  check('页面标识重复 → 409', res.statusCode === 409, String(res.statusCode));

  /* --- 更新 --- */
  fakeDb(() => []);
  res = await call(contentRoute, 'PATCH', { token: TOKEN, body: { id: 999, data: { name: 'x' } } });
  check('改不存在的条目 → 404', res.statusCode === 404, String(res.statusCode));

  fakeDb((t) => /SELECT \* FROM content WHERE id/.test(t)
    ? [row({ id: 2, type: 'nav_category', data: { name: '旧名' } })]
    : [row({ id: 2, type: 'nav_category', data: { name: '新名' } })]);
  res = await call(contentRoute, 'PATCH', { token: TOKEN, body: { id: 2, data: { name: '新名' } } });
  check('改分类名 → 200', res.statusCode === 200, String(res.statusCode));

  /* PATCH 是合并更新：只传部分字段，旧字段要保留 */
  fakeDb((t) => /SELECT \* FROM content WHERE id/.test(t)
    ? [row({ id: 2, type: 'nav_link', data: { name: '旧名', url: 'https://old.com', tags: ['x'] } })]
    : [row({ id: 2, type: 'nav_link', data: { name: '新名', url: 'https://old.com' } })]);
  await call(contentRoute, 'PATCH', { token: TOKEN, body: { id: 2, data: { name: '新名' } } });
  const upd = executed.find(e => /UPDATE content/.test(e.text));
  check('PATCH 合并旧字段而不是整体覆盖', upd && /old\.com/.test(upd.values[0]), upd ? String(upd.values[0]).slice(0, 80) : 'none');

  /* --- 删除 --- */
  fakeDb(() => []);
  res = await call(contentRoute, 'DELETE', { token: TOKEN, query: { id: '999' } });
  check('删不存在的条目 → 404', res.statusCode === 404, String(res.statusCode));

  fakeDb((t) => /SELECT type FROM content/.test(t) ? [{ type: 'post' }] : [{ id: 1 }]);
  res = await call(contentRoute, 'DELETE', { token: TOKEN, query: { id: '1' } });
  check('删普通条目 → 200', res.statusCode === 200, String(res.statusCode));

  /* 删分类要连它的链接一起删，避免孤儿数据 */
  fakeDb((t) => {
    if (/SELECT type FROM content/.test(t)) return [{ type: 'nav_category' }];
    if (/DELETE FROM content WHERE parent_id/.test(t)) return [{ id: 10 }, { id: 11 }];
    return [{ id: 1 }];
  });
  res = await call(contentRoute, 'DELETE', { token: TOKEN, query: { id: '1' } });
  check('删分类时一并删掉它的链接', res.statusCode === 200 && res.json.alsoDeletedLinks === 2,
        JSON.stringify(res.json));
  check('确实执行了删链接的语句', executed.some(e => /DELETE FROM content WHERE parent_id/.test(e.text)));

  /* --- SQL 注入 --- */
  fakeDb((t) => /INSERT INTO content/.test(t) ? [row({ id: 1 })] : []);
  const evil = "'; DROP TABLE content; --";
  await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'nav_category', data: { name: evil } } });
  const all = executed.map(e => e.text).join('\n');
  check('内容接口也没有 SQL 拼接', !/DROP TABLE/i.test(all), all.slice(0, 120));
  check('恶意内容作为参数传入', executed.some(e => (e.values || []).some(v => String(v).includes('DROP TABLE'))));
}

console.log('\n=== 响应头 ===');
{
  fakeDb(() => []);
  const res = await call(todosRoute, 'GET', { token: TOKEN });
  check('接口响应禁止缓存（no-store）', /no-store/.test(res.headers['Cache-Control'] || ''), res.headers['Cache-Control']);
  check('响应是 UTF-8 JSON', /application\/json/.test(res.headers['Content-Type'] || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
