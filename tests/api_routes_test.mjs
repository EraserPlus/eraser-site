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
const uploadRoute = (await load('api/upload.js')).default;

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
    async *[Symbol.asyncIterator]() { for (const c of (opts.chunks || [])) yield c; },
  };
}
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    json: null,
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) {
      /* XML（RSS）这类非 JSON 响应只留 body；JSON 响应仍然解析进 json */
      this.body = s == null ? null : String(s);
      this.json = null;
      if (s) { try { this.json = JSON.parse(s); } catch (e) { /* 非 JSON，只用 body */ } }
    },
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

console.log('\n=== 文件上传 /api/upload（Vercel Blob）===');
{
  /* 假 blob：只记录调用参数并返回预设结果，不真的连 Blob */
  const recorded = [];
  globalThis.__FAKE_BLOB__ = {
    handler: (pathname, body, options) => {
      recorded.push({ pathname, size: body.length, options });
      return Promise.resolve({ url: 'https://fake.blob.test/' + pathname, pathname });
    },
  };
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';

  fakeDb(noop);
  let res = await call(uploadRoute, 'POST', { chunks: [Buffer.from('x')] });
  check('未登录 POST /api/upload → 401', res.statusCode === 401, String(res.statusCode));
  check('未登录不会调用假 blob', recorded.length === 0, String(recorded.length));

  res = await call(uploadRoute, 'GET', { token: TOKEN });
  check('GET /api/upload（带令牌）→ 405', res.statusCode === 405, String(res.statusCode));

  const savedBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  res = await call(uploadRoute, 'POST', { token: TOKEN, chunks: [Buffer.from('x')] });
  check('没配 BLOB_READ_WRITE_TOKEN → 503', res.statusCode === 503, String(res.statusCode));
  check('错误信息说明缺 BLOB_READ_WRITE_TOKEN', /BLOB_READ_WRITE_TOKEN/.test(res.json.error || ''), res.json.error);
  process.env.BLOB_READ_WRITE_TOKEN = savedBlobToken;

  res = await call(uploadRoute, 'POST', { token: TOKEN, chunks: [Buffer.alloc(4 * 1024 * 1024 + 1)] });
  check('body 超 4MB → 400', res.statusCode === 400, String(res.statusCode));
  check('错误信息提示文件太大', /太大/.test(res.json.error || ''), res.json.error);
  check('超限时不会调用假 blob', recorded.length === 0, String(recorded.length));

  res = await call(uploadRoute, 'POST', { token: TOKEN, chunks: [] });
  check('body 为空 → 400', res.statusCode === 400, String(res.statusCode));

  /* 正常上传：中文名 + 空格 */
  recorded.length = 0;
  res = await call(uploadRoute, 'POST', {
    token: TOKEN, query: { name: '测试 文件.txt' }, chunks: [Buffer.from('hello-blob')],
  });
  check('正常上传 → 200', res.statusCode === 200, String(res.statusCode));
  check('假 blob 被调用 1 次', recorded.length === 1, String(recorded.length));
  check('pathname 以 files/ 开头', recorded[0] && recorded[0].pathname.startsWith('files/'),
        recorded[0] && recorded[0].pathname);
  check('文件名清洗：只保留一层，不含路径分隔符',
        recorded[0] && !/[\/\\]/.test(recorded[0].pathname.slice('files/'.length)),
        recorded[0] && recorded[0].pathname);
  check('文件内容原样传给 blob（大小正确）', recorded[0] && recorded[0].size === Buffer.byteLength('hello-blob'),
        String(recorded[0] && recorded[0].size));
  check('access 为 public', recorded[0] && recorded[0].options.access === 'public',
        JSON.stringify(recorded[0] && recorded[0].options));
  check('addRandomSuffix 为 true', recorded[0] && recorded[0].options.addRandomSuffix === true,
        JSON.stringify(recorded[0] && recorded[0].options));
  check('响应 data.url 是假 blob 返回的 url',
        res.json.data && res.json.data.url === 'https://fake.blob.test/' + recorded[0].pathname,
        JSON.stringify(res.json.data));

  /* 路径穿越：../ 必须被洗掉 */
  recorded.length = 0;
  res = await call(uploadRoute, 'POST', { token: TOKEN, query: { name: '../evil.txt' }, chunks: [Buffer.from('evil')] });
  check('带 ../ 的文件名也能上传 → 200', res.statusCode === 200, String(res.statusCode));
  check('清洗后不含 .. 也不含多余 /（只有 files/ 一层）',
        recorded[0] && recorded[0].pathname.startsWith('files/') &&
        !recorded[0].pathname.includes('..') &&
        !recorded[0].pathname.slice('files/'.length).includes('/'),
        recorded[0] && recorded[0].pathname);

  /* 文件名缺省 → files/file */
  recorded.length = 0;
  res = await call(uploadRoute, 'POST', { token: TOKEN, query: {}, chunks: [Buffer.from('x')] });
  check('文件名缺省 → pathname 为 files/file', recorded[0] && recorded[0].pathname === 'files/file',
        recorded[0] && recorded[0].pathname);
}

console.log('\n=== 响应头 ===');
{
  fakeDb(() => []);
  const res = await call(todosRoute, 'GET', { token: TOKEN });
  check('接口响应禁止缓存（no-store）', /no-store/.test(res.headers['Cache-Control'] || ''), res.headers['Cache-Control']);
  check('响应是 UTF-8 JSON', /application\/json/.test(res.headers['Content-Type'] || ''));
}

console.log('\n=== RSS 订阅源 /api/rss（公开免登录） ===');
{
  const rssRoute = (await load('api/rss.js')).default;
  const HOST = 'eraser.example.com';
  const postRow = (o) => Object.assign({ id: 1, updated_at: '2026-10-13T10:00:00.000Z', data: {} }, o);

  /* 假驱动不会执行 WHERE，这里按真实 SQL 的条件手动模拟一遍，
     保证「草稿被过滤」的断言反映线上行为（另外还会单独检查 SQL 文本） */
  const posts = [
    postRow({ id: 3, updated_at: '2026-10-13T10:00:00.000Z',
              data: { slug: 'hello', title: '第一篇文章', summary: '这是摘要', content: '正文一', tags: ['测试'], published: true } }),
    postRow({ id: 2, updated_at: '2026-10-12T10:00:00.000Z',
              data: { slug: 'secret-draft', title: '不该出现的草稿', content: '草稿正文', published: false } }),
    postRow({ id: 1, updated_at: '2026-10-11T10:00:00.000Z',
              data: { slug: 'older', title: '更老的一篇', summary: '', content: '第二篇正文', tags: [], published: true } }),
  ];

  fakeDb((text) => {
    if (/SELECT .* FROM content/.test(text)) {
      return posts.filter(r => r.data.published !== false);
    }
    return [];
  });
  let res = await call(rssRoute, 'GET', { headers: { host: HOST } });
  check('未登录也能读 RSS（订阅器不带令牌）→ 200', res.statusCode === 200, String(res.statusCode));
  check('Content-Type 是 application/rss+xml', /application\/rss\+xml/.test(res.headers['Content-Type'] || ''),
        res.headers['Content-Type']);
  check('响应体是 XML（以 <?xml 开头）', /^<\?xml/.test(res.body || ''), String(res.body).slice(0, 40));
  check('包含 <rss version="2.0">', (res.body || '').includes('<rss version="2.0">'));
  check('包含 <channel>', (res.body || '').includes('<channel>'));
  check('草稿被过滤，只剩 2 个 <item>', (res.body.match(/<item>/g) || []).length === 2,
        String((res.body.match(/<item>/g) || []).length));
  check('草稿标题不出现在订阅源里', !(res.body || '').includes('不该出现的草稿'));
  check('文章标题正确', (res.body || '').includes('<title>第一篇文章</title>'));
  check('链接用 Host 头拼绝对地址', (res.body || '').includes('https://' + HOST + '/blog/post.html?slug=hello'));
  check('slug 做了 URL 编码', (res.body || '').includes('slug=older'));
  check('没有 summary 时用正文截断兜底', (res.body || '').includes('第二篇正文'));
  check('guid 与链接一致', (res.body || '').includes('<guid>https://' + HOST + '/blog/post.html?slug=hello</guid>'));

  const sel = executed.find(e => /SELECT .* FROM content/.test(e.text));
  check('SQL 里带 published 过滤（缺省视为公开）',
        sel && /COALESCE\(data->>'published', 'true'\) <> 'false'/.test(sel.text), sel ? sel.text : 'none');
  check('SQL 按更新时间倒序取 20 条',
        sel && /ORDER BY updated_at DESC, id DESC/.test(sel.text) && /LIMIT 20/.test(sel.text),
        sel ? sel.text : 'none');

  /* --- pubDate --- */
  check('pubDate 存在且是 UTC 字符串格式',
        /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/.test(res.body || ''),
        (/pubDate>([^<]*)</.exec(res.body || '') || [])[1] || 'none');

  /* --- XML 转义 --- */
  fakeDb((text) => {
    if (/SELECT .* FROM content/.test(text)) {
      return [postRow({ id: 9, data: { slug: 'x', title: '标题<b>&"引号"', content: '正文' } })];
    }
    return [];
  });
  res = await call(rssRoute, 'GET', { headers: { host: HOST } });
  check('XML 特殊字符被转义（<>&"）',
        (res.body || '').includes('标题&lt;b&gt;&amp;&quot;引号&quot;'),
        (/<title>([^<]*)<\/title>/.exec(res.body || '') || [])[1] || 'none');
  check('转义后的标题仍是合法 XML（没有裸 < 落在标签外）', !/<title>[^<]*<b>/.test(res.body || ''));

  /* --- 空库 --- */
  fakeDb(() => []);
  res = await call(rssRoute, 'GET', { headers: { host: HOST } });
  check('空库也返回 200', res.statusCode === 200, String(res.statusCode));
  check('空库返回合法空 channel', (res.body || '').includes('<channel>') && !(res.body || '').includes('<item>'));
  check('空库也是完整 XML', /^<\?xml[\s\S]*<\/rss>\s*$/.test(res.body || ''));

  /* --- 方法限制 --- */
  fakeDb(noop);
  res = await call(rssRoute, 'POST', { body: {} });
  check('POST /api/rss → 405', res.statusCode === 405, String(res.statusCode));

  /* --- Host 头缺省时的兜底域名（空库时校验 channel 级链接） --- */
  fakeDb(() => []);
  res = await call(rssRoute, 'GET', {});
  check('没有 Host 头时用兜底域名', (res.body || '').includes('<link>https://eraser.de5.net</link>'),
        (/<link>([^<]*)<\/link>/.exec(res.body || '') || [])[1] || 'none');
}


console.log('\n=== /api/favicon 图标代理 ===');
{
  const faviconRoute = (await load('api/favicon.js')).default;
  const realFetch = globalThis.fetch;
  let fetchCalls = [];
  function stubFetch(fn){
    globalThis.fetch = (u, o) => { fetchCalls.push(String(u)); return fn(u, o); };
  }
  const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  function imgRes(type){
    return {
      ok: true, status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
      arrayBuffer: async () => pngBytes,
    };
  }
  const notFound = { ok: false, status: 404, headers: { get: () => null } };
  try {
    let r = await call(faviconRoute, 'POST', { query: { url: 'https://example.com/' } });
    check('POST /api/favicon → 405', r.statusCode === 405, String(r.statusCode));

    fetchCalls = [];
    stubFetch(() => { throw new Error('不该发出请求'); });
    r = await call(faviconRoute, 'GET', { query: { url: 'http://169.254.169.254/latest/meta-data/' } });
    check('云元数据地址 → 400', r.statusCode === 400, String(r.statusCode));
    check('内网地址根本不发请求', fetchCalls.length === 0, fetchCalls.join(','));

    r = await call(faviconRoute, 'GET', { query: { url: 'javascript:alert(1)' } });
    check('javascript: → 400', r.statusCode === 400, String(r.statusCode));
    r = await call(faviconRoute, 'GET', { query: {} });
    check('缺 url → 400', r.statusCode === 400, String(r.statusCode));
    r = await call(faviconRoute, 'GET', { query: { url: 'http://intranet/' } });
    check('无点主机名 → 400', r.statusCode === 400, String(r.statusCode));

    /* favicon.ico 直接命中 */
    fetchCalls = [];
    stubFetch((u) => u.indexOf('/favicon.ico') !== -1 ? imgRes('image/x-icon') : notFound);
    r = await call(faviconRoute, 'GET', { query: { url: 'https://favicon-ok.test/' } });
    check('抓到图标 → 200', r.statusCode === 200, String(r.statusCode));
    check('Content-Type 是 image/*', /^image\//.test(r.headers['Content-Type'] || ''), r.headers['Content-Type']);
    check('带 7 天浏览器缓存头', r.headers['Cache-Control'] === 'public, max-age=604800', r.headers['Cache-Control']);

    /* favicon.ico 是 octet-stream 但字节是 PNG → 魔数认出 */
    fetchCalls = [];
    stubFetch((u) => u.indexOf('/favicon.ico') !== -1 ? imgRes('application/octet-stream') : notFound);
    r = await call(faviconRoute, 'GET', { query: { url: 'https://favicon-sniff.test/' } });
    check('octet-stream + PNG 魔数 → 200 且识别成 image/png',
          r.statusCode === 200 && r.headers['Content-Type'] === 'image/png', r.headers['Content-Type']);

    /* 缓存命中：同一 url 第二次不再 fetch */
    const before = fetchCalls.length;
    r = await call(faviconRoute, 'GET', { query: { url: 'https://favicon-ok.test/' } });
    check('缓存命中不再发请求', fetchCalls.length === before && r.statusCode === 200,
          `${before} -> ${fetchCalls.length}`);

    /* 302 跳内网 → 挡掉（400，且不再继续） */
    fetchCalls = [];
    stubFetch(() => ({ status: 302, ok: false, headers: { get: (k) => (k.toLowerCase() === 'location' ? 'http://127.0.0.1/x' : null) } }));
    r = await call(faviconRoute, 'GET', { query: { url: 'https://redirect-evil.test/' } });
    check('302 跳内网 → 400', r.statusCode === 400, String(r.statusCode));

    /* favicon.ico 404，但首页 HTML 里声明了图标 → 扒出来 */
    fetchCalls = [];
    const htmlRes = {
      ok: true, status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: async () => '<html><head><link rel="shortcut icon" href="/static/logo.png"></head><body></body></html>',
    };
    stubFetch((u) => {
      if (u.indexOf('/favicon.ico') !== -1) return notFound;
      if (u === 'https://html-ok.test/') return Promise.resolve(htmlRes);
      if (u === 'https://html-ok.test/static/logo.png') return Promise.resolve(imgRes('image/png'));
      return Promise.resolve(notFound);
    });
    r = await call(faviconRoute, 'GET', { query: { url: 'https://html-ok.test/' } });
    check('favicon.ico 没有 → 扒首页声明的图标',
          r.statusCode === 200 && fetchCalls.indexOf('https://html-ok.test/static/logo.png') !== -1,
          fetchCalls.join(','));

    /* 首页里的图标指向内网 → 跳过，最终 404 */
    fetchCalls = [];
    stubFetch((u) => {
      if (u.indexOf('/favicon.ico') !== -1) return notFound;
      if (u === 'https://html-evil.test/') return Promise.resolve({
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => '<link rel="icon" href="http://192.168.1.1/steal.png">',
      });
      return Promise.resolve(notFound);
    });
    r = await call(faviconRoute, 'GET', { query: { url: 'https://html-evil.test/' } });
    check('首页图标指向内网 → 不当真，最终 404', r.statusCode === 404, String(r.statusCode));

    /* 什么都抓不到 → 404 */
    fetchCalls = [];
    stubFetch(() => notFound);
    r = await call(faviconRoute, 'GET', { query: { url: 'https://nothing.test/' } });
    check('抓不到 → 404', r.statusCode === 404, String(r.statusCode));
  } finally {
    globalThis.fetch = realFetch;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
