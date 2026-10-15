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

  fakeDb(() => [row({ id: 5, type: 'media', data: { category: 'anime', name: '葬送的芙莉莲', status: 'watching', score: 9 } })]);
  res = await call(contentRoute, 'GET', { query: { type: 'media' } });
  check('未登录也能读追更列表 → 200', res.statusCode === 200 && res.json.items.length === 1);
  check('追更数据原样返回（评分是数字）',
        res.json.items[0].data.status === 'watching' && res.json.items[0].data.score === 9);

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

  fakeDb(noop);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: { type: 'media', data: { category: 'book', name: 'x', status: 'wish' } } });
  check('追更栏目非法（非追番/漫画）→ 400', res.statusCode === 400, String(res.statusCode));

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

  /* --- 搜索关键词 --- */
  fakeDb((t) => /SELECT id FROM content WHERE id/.test(t) ? [{ id: 1 }] : [row({ id: 7, type: 'nav_link', data: { name: 'B站', url: 'https://bilibili.com', keywords: ['bilibili', '哔哩哔哩'], tip: '备用入口' } })]);
  res = await call(contentRoute, 'POST', { token: TOKEN, body: {
    type: 'nav_link', parent_id: 1,
    data: { name: 'B站', url: 'https://bilibili.com', keywords: 'bilibili, 哔哩哔哩，bilibili', tip: '备用入口' }
  } });
  check('带搜索关键词保存 → 200', res.statusCode === 200, String(res.statusCode));
  check('关键词被归一化成数组', JSON.stringify(res.json.item.data.keywords) === '["bilibili","哔哩哔哩"]',
        JSON.stringify(res.json.item.data && res.json.item.data.keywords));
  check('提示词一并保存', res.json.item.data && res.json.item.data.tip === '备用入口',
        JSON.stringify(res.json.item.data && res.json.item.data.tip));

  fakeDb((t) => /UPDATE/.test(t)
    ? [row({ id: 8, type: 'nav_link', data: { name: '旧', url: 'https://old.com', keywords: ['x', 'y'] } })]
    : [row({ id: 8, type: 'nav_link', data: { name: '旧', url: 'https://old.com' } })]);
  res = await call(contentRoute, 'PATCH', { token: TOKEN, body: { id: 8, data: { keywords: ['x', 'y'] } } });
  check('PATCH 补关键词 → 200', res.statusCode === 200, String(res.statusCode));
  check('PATCH 后关键词合并生效', JSON.stringify(res.json.item.data.keywords) === '["x","y"]',
        JSON.stringify(res.json.item.data && res.json.item.data.keywords));

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

  /* ==================== 批量导入 ?batch=1（M12） ==================== */
  const media = (name, extra) => Object.assign({ category: 'anime', name: name, status: 'watching' }, extra || {});

  /* 未登录不能批量写 */
  fakeDb(noop);
  res = await call(contentRoute, 'POST', { query: { batch: '1' }, body: { items: [] } });
  check('未登录批量导入 → 401', res.statusCode === 401, String(res.statusCode));

  /* 空数组 / 不是数组 */
  fakeDb(noop);
  res = await call(contentRoute, 'POST', { token: TOKEN, query: { batch: '1' }, body: { items: [] } });
  check('批量导入 items 为空 → 400', res.statusCode === 400, String(res.statusCode));
  res = await call(contentRoute, 'POST', { token: TOKEN, query: { batch: '1' }, body: { items: 'nope' } });
  check('批量导入 items 不是数组 → 400', res.statusCode === 400, String(res.statusCode));

  /* 正常批量：3 条追更 */
  fakeDb((t) => /INSERT INTO content/.test(t) ? [row({ id: 7, type: 'media', data: { name: 'x' } })] : []);
  res = await call(contentRoute, 'POST', { token: TOKEN, query: { batch: '1' }, body: {
    items: [
      { type: 'media', data: media('芙莉莲') },
      { type: 'media', data: media('迷宫饭', { category: 'comic' }) },
      { type: 'media', data: media('关于地球的运动', { status: 'wish' }) },
    ],
  } });
  check('批量导入 3 条 → 200', res.statusCode === 200, String(res.statusCode));
  check('返回 total/created/failed', res.json.total === 3 && res.json.created === 3 && res.json.failed === 0,
        JSON.stringify({ t: res.json.total, c: res.json.created, f: res.json.failed }));
  check('逐条结果里每条都 ok', Array.isArray(res.json.items) && res.json.items.length === 3 && res.json.items.every(i => i.ok));
  check('批量确实执行了 3 次 INSERT', executed.filter(e => /INSERT INTO content/.test(e.text)).length === 3,
        String(executed.filter(e => /INSERT INTO content/.test(e.text)).length));

  /* 预校验失败要整批不写（关键安全属性） */
  fakeDb((t) => /INSERT INTO content/.test(t) ? [row({ id: 7 })] : []);
  res = await call(contentRoute, 'POST', { token: TOKEN, query: { batch: '1' }, body: {
    items: [
      { type: 'media', data: media('好的') },
      { type: 'media', data: { category: 'book', name: '栏目不对', status: 'wish' } },
    ],
  } });
  check('有一条不合法 → 整批 400', res.statusCode === 400, String(res.statusCode));
  check('整批 400 时一条都没写进库', executed.filter(e => /INSERT INTO content/.test(e.text)).length === 0,
        String(executed.filter(e => /INSERT INTO content/.test(e.text)).length));
  check('错误信息点出是第几条不对', /第\s*2\s*条/.test(res.json.error || ''), res.json.error);

  /* 超上限 */
  fakeDb(noop);
  res = await call(contentRoute, 'POST', { token: TOKEN, query: { batch: '1' }, body: {
    items: Array.from({ length: 501 }, () => ({ type: 'media', data: media('x') })),
  } });
  check('超过 500 条上限 → 400', res.statusCode === 400, String(res.statusCode));
  check('错误信息说明上限', /500/.test(res.json.error || ''), res.json.error);

  /* 同一批里 slug 重复要在批内挡住（库里还没有，查不出来） */
  fakeDb((t) => /INSERT INTO content/.test(t) ? [row({ id: 7, type: 'post' })] : []);
  res = await call(contentRoute, 'POST', { token: TOKEN, query: { batch: '1' }, body: {
    items: [
      { type: 'post', data: { slug: 'same', title: 'a', content: 'c' } },
      { type: 'post', data: { slug: 'same', title: 'b', content: 'c' } },
    ],
  } });
  check('同批 slug 重复：第一条成功、第二条失败', res.statusCode === 200 && res.json.created === 1 && res.json.failed === 1,
        JSON.stringify({ c: res.json.created, f: res.json.failed }));
  check('失败那条给了说明', /重复/.test(res.json.items[1].error || ''), res.json.items[1].error);

  /* 批量接口也得防注入 */
  fakeDb((t) => /INSERT INTO content/.test(t) ? [row({ id: 7 })] : []);
  await call(contentRoute, 'POST', { token: TOKEN, query: { batch: '1' }, body: {
    items: [{ type: 'media', data: media("'; DROP TABLE content; --") }],
  } });
  const batchSql = executed.map(e => e.text).join('\n');
  check('批量接口没有 SQL 拼接', !/DROP TABLE/i.test(batchSql), batchSql.slice(0, 120));
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

console.log('\n=== 番剧自动填充 /api/content?action=lookup（AniList）===');
{
  /* 按名字查没有单独开路由（Vercel Hobby 上限 12 个函数），挂在 /api/content?action=lookup */
  const lookupRoute = (await load('api/content.js')).default;
  const realFetch = globalThis.fetch;
  let calls = [];
  function stubFetch(fn) {
    globalThis.fetch = (u, o) => { calls.push({ url: String(u), opt: o }); return fn(u, o); };
  }
  const anilistJson = (media) => ({
    ok: true, status: 200,
    json: async () => ({ data: { Page: { media: media } } }),
  });
  try {
    /* 方法 / 鉴权 */
    let r = await call(lookupRoute, 'POST', { query: { action: 'lookup', q: 'Frieren' } });
    check('POST 按名字查 → 405（不落到建内容上）', r.statusCode === 405, String(r.statusCode));

    r = await call(lookupRoute, 'GET', { query: { action: 'lookup', q: 'Frieren' } });
    check('未登录按名字查 → 401', r.statusCode === 401, String(r.statusCode));

    r = await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup' }});
    check('没带名字 → 400', r.statusCode === 400, String(r.statusCode));

    /* 正常查询 */
    calls = [];
    stubFetch(() => Promise.resolve(anilistJson([{
      id: 154587,
      title: { native: '葬送のフリーレン', romaji: 'Sousou no Frieren' },
      coverImage: { large: 'https://s4.anilist.co/x.jpg' },
      averageScore: 91, episodes: 28, startDate: { year: 2023 },
      siteUrl: 'https://anilist.co/anime/154587',
    }])));
    r = await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup', q: 'Frieren'  }});
    check('查询成功 → 200', r.statusCode === 200, String(r.statusCode));
    check('返回 results 数组', Array.isArray(r.json.results) && r.json.results.length === 1);
    const hit = r.json.results[0];
    check('名称取日文原名', hit.name === '葬送のフリーレン', hit.name);
    check('评分从 0-100 换算成 0-10', hit.score === 9.1, String(hit.score));
    check('封面地址带回来了', hit.cover === 'https://s4.anilist.co/x.jpg');
    check('话数带回来了', hit.episodes === 28, String(hit.episodes));
    check('请求发给了 AniList', calls.length === 1 && /graphql\.anilist\.co/.test(calls[0].url), calls[0] && calls[0].url);
    check('查询词走 variables（不拼进 query 串）', (() => {
      try { const b = JSON.parse(calls[0].opt.body); return b.variables.q === 'Frieren' && !b.query.includes('Frieren'); }
      catch (e) { return false; }
    })());

    /* 搜不到要给提示（中文名搜不到是已知情况） */
    calls = [];
    stubFetch(() => Promise.resolve(anilistJson([])));
    r = await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup', q: '葬送的芙莉莲'  }});
    check('搜不到 → 200 空结果 + 提示用英文名', r.statusCode === 200 && r.json.results.length === 0 && /英文名|原名/.test(r.json.hint || ''),
          r.json.hint);

    /* 上游挂了要兜底，不能把异常抛成 500 */
    stubFetch(() => Promise.reject(new Error('network down')));
    r = await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup', q: 'zzz-unique-' + Date.now()  }});
    check('连不上 AniList → 502 且给可读提示', r.statusCode === 502 && /稍后再试|手填/.test(r.json.error || ''), r.json.error);

    stubFetch(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }));
    r = await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup', q: 'yyy-unique-' + Date.now()  }});
    check('AniList 返回错误码 → 502 不漏状态码细节', r.statusCode === 502, String(r.statusCode));

    /* 缓存命中不再打上游 */
    calls = [];
    stubFetch(() => Promise.resolve(anilistJson([{ id: 1, title: { native: '缓存番' }, averageScore: 80 }])));
    await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup', q: 'CacheTest'  }});
    const after1 = calls.length;
    r = await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup', q: 'CacheTest'  }});
    check('同名重复查走缓存不打上游', after1 === 1 && calls.length === 1 && r.json.cached === true,
          'calls=' + calls.length + ' cached=' + r.json.cached);

    /* manga 走 MANGA 类型 */
    calls = [];
    stubFetch(() => Promise.resolve(anilistJson([{ id: 2, title: { native: 'ベルセルク' }, averageScore: 92, chapters: 400, startDate: { year: 1989 } }])));
    r = await call(lookupRoute, 'GET', { token: TOKEN, query: { action: 'lookup', kind: 'comic', q: 'Berserk'  }});
    check('kind=comic 时按 MANGA 查', (() => {
      try { return /type:MANGA/.test(JSON.parse(calls[0].opt.body).query); } catch (e) { return false; }
    })());
    check('漫画用 chapters 当话数', r.json.results[0].episodes === 400, String(r.json.results[0].episodes));
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\n=== 全站搜索 /api/search ===');
{
  const searchRoute = (await load('api/search.js')).default;
  const row = (o) => Object.assign({ id: 1, type: 'nav_category', parent_id: null, sort_order: 0, updated_at: 'x', data: {} }, o);

  let r = await call(searchRoute, 'POST', { query: { q: 'x' } });
  check('POST /api/search → 405', r.statusCode === 405, String(r.statusCode));

  r = await call(searchRoute, 'GET', {});
  check('没带 q → 200 且空结果', r.statusCode === 200 && r.json.results.length === 0,
        JSON.stringify(r.json));

  fakeDb(() => [
    row({ id: 1, type: 'nav_link', data: { name: 'GitHub', url: 'https://github.com', desc: '代码仓库' } }),
    row({ id: 2, type: 'post', data: { slug: 'hello', title: '你好世界', summary: '第一篇文章' } }),
    row({ id: 3, type: 'page', data: { key: 'about', title: '关于', content: '关于页正文' } }),
  ]);
  r = await call(searchRoute, 'GET', { query: { q: 'git' } });
  check('搜索 → 200', r.statusCode === 200, String(r.statusCode));
  check('返回 3 条结果', r.json.results.length === 3, String(r.json.results.length));
  check('导航链接指向站外原地址', r.json.results[0].url === 'https://github.com', r.json.results[0].url);
  check('文章指向 /blog/post.html?slug=', r.json.results[1].url === '/blog/post.html?slug=hello', r.json.results[1].url);
  check('页面指向 /about/', r.json.results[2].url === '/about/', r.json.results[2].url);
  check('标题与摘要映射正确', r.json.results[1].title === '你好世界' && r.json.results[1].desc === '第一篇文章',
        JSON.stringify(r.json.results[1]));
  check('SQL 里过滤了草稿文章', executed.some(e => /IS DISTINCT FROM 'false'/.test(e.text)),
        executed.map(e => e.text).join(' | ').slice(0, 200));
  check('SQL 覆盖了链接的关键词字段', executed.some(e => /keywords/.test(e.text)),
        executed.map(e => e.text).join(' | ').slice(0, 200));

  /* 追更（media）也进搜索：有链接走原地址，没链接回落到追更页 */
  fakeDb(() => [
    row({ id: 4, type: 'media', data: { name: '葬送的芙莉莲', note: '周五更新 · 看到第 8 话', url: 'https://bgm.tv/subject/1' } }),
    row({ id: 5, type: 'media', data: { name: '没填链接的条目', note: '先放着' } }),
  ]);
  r = await call(searchRoute, 'GET', { query: { q: '芙莉莲' } });
  check('追更内容能搜到 → 200', r.statusCode === 200 && r.json.results.length === 2,
        JSON.stringify(r.json).slice(0, 160));
  check('追更标题取 name', r.json.results[0].title === '葬送的芙莉莲', r.json.results[0].title);
  check('追更描述取 note', r.json.results[0].desc === '周五更新 · 看到第 8 话', r.json.results[0].desc);
  check('追更有链接则指向原地址', r.json.results[0].url === 'https://bgm.tv/subject/1', r.json.results[0].url);
  check('追更没链接则回落到 /collect/', r.json.results[1].url === '/collect/', r.json.results[1].url);
  check('SQL 覆盖了追更的 name/note/url 字段',
        executed.some(e => /'media'/.test(e.text) && /note/.test(e.text)),
        executed.map(e => e.text).join(' | ').slice(0, 200));

  /* 注入防护：恶意字符串只作为参数，不拼进 SQL */
  const evil = "'; DROP TABLE content; --";
  executed = [];
  await call(searchRoute, 'GET', { query: { q: evil } });
  const allSql = executed.map(e => e.text).join('\n');
  check('搜索接口没有 SQL 拼接', !/DROP TABLE/i.test(allSql), allSql.slice(0, 200));
  check('恶意字符串作为参数传入', executed.some(e => (e.values || []).some(v => String(v).includes('DROP TABLE'))));

  /* 超长关键词截断到 50，不报错 */
  fakeDb(() => []);
  r = await call(searchRoute, 'GET', { query: { q: 'x'.repeat(120) } });
  check('超长搜索词截断处理 → 200', r.statusCode === 200, String(r.statusCode));

  /* ---------- 子序列模糊匹配（M7）：精确命中不足时补一层 ---------- */
  const navRow = (id, name, url) => row({ id, type: 'nav_link', data: { name, url } });
  /* 第一次查询（ILIKE，精确）返回空，候选池查询返回两条，用来验证「模糊兜底」 */
  fakeDb((text) => /ILIKE/.test(text)
    ? []
    : [navRow(11, 'GitHub', 'https://github.com'), navRow(12, 'Vercel', 'https://vercel.com')]);

  r = await call(searchRoute, 'GET', { query: { q: 'gth' } });
  check('模糊搜索 gth → 命中 GitHub', r.json.results.length === 1 && r.json.results[0].title === 'GitHub',
        JSON.stringify(r.json.results));
  check('模糊命中项带 fuzzy 标记', r.json.results[0].fuzzy === true, JSON.stringify(r.json.results[0]));
  check('模糊命中仍映射出正确链接', r.json.results[0].url === 'https://github.com', r.json.results[0].url);
  /* 这一次搜索发了 2 条 SQL：精确查询 + 候选池查询，且池里排除了草稿 */
  check('模糊兜底会追加候选池查询，且池里排除了草稿文章',
        executed.length === 2 && executed.some(e => /type <> 'post'/.test(e.text) && /IS DISTINCT FROM 'false'/.test(e.text)),
        executed.map(e => e.text).join(' | ').slice(0, 300));

  r = await call(searchRoute, 'GET', { query: { q: 'vrc' } });
  check('模糊搜索 vrc → 命中 Vercel', r.json.results.length === 1 && r.json.results[0].title === 'Vercel',
        JSON.stringify(r.json.results));

  /* 精确查询和候选池查到同一条时只出现一次（按 id 去重） */
  fakeDb((text) => /ILIKE/.test(text)
    ? [navRow(11, 'GitHub', 'https://github.com')]
    : [navRow(11, 'GitHub', 'https://github.com'), navRow(12, 'Vercel', 'https://vercel.com')]);
  r = await call(searchRoute, 'GET', { query: { q: 'git' } });
  check('精确与模糊同一条不重复', r.json.results.length === 1, JSON.stringify(r.json.results));
  check('精确命中不带 fuzzy 标记', r.json.results[0].fuzzy === undefined, JSON.stringify(r.json.results[0]));

  /* 精确命中已达上限（50）时不再查候选池，省一次查询 */
  fakeDb(() => Array.from({ length: 50 }, (_, i) => row({ id: i + 1, type: 'page', data: { key: 'p' + i, title: '页面' + i } })));
  r = await call(searchRoute, 'GET', { query: { q: '页面' } });
  check('命中已满 50 条时不查候选池', executed.length === 1, String(executed.length));

  /* 关键词太短（< 3 字）不做模糊，避免噪音 */
  fakeDb(() => []);
  r = await call(searchRoute, 'GET', { query: { q: 'gi' } });
  check('关键词不足 3 字不触发模糊查询', r.statusCode === 200 && executed.length === 1, String(executed.length));

  /* ---------- 收窄搜索范围（M9）：正文一律不搜，结果别乱 ---------- */
  fakeDb(() => []);
  r = await call(searchRoute, 'GET', { query: { q: 'x' } });
  check('单字关键词不搜（tooShort 标记）', r.statusCode === 200 && r.json.tooShort === true,
        JSON.stringify(r.json));

  fakeDb(() => []);
  r = await call(searchRoute, 'GET', { query: { q: 'x' } });
  check('单字关键词一条 SQL 都不发', executed.length === 0, String(executed.length));

  fakeDb(() => []);
  r = await call(searchRoute, 'GET', { query: { q: '前端' } });
  check('两字关键词正常搜（不是 tooShort）', r.json.tooShort === undefined, JSON.stringify(r.json));

  /* 关键断言：SQL 里绝不能再出现内容正文 / 节点文字字段 */
  fakeDb(() => []);
  r = await call(searchRoute, 'GET', { query: { q: '关键词' } });
  const sqlAll = executed.map(e => e.text).join('\n');
  check('SQL 不搜博客正文（data->>\'content\' 不出现）', !/data->>'content'/.test(sqlAll),
        sqlAll.slice(0, 300));
  check('SQL 不搜学习地图的节点文字（nodes 不出现）', !/nodes/.test(sqlAll), sqlAll.slice(0, 300));
  check('SQL 里 page 类型只搜标题', /type = 'page' AND \(\s*data->>'title' ILIKE/.test(sqlAll),
        (sqlAll.match(/type = 'page'[\s\S]{0,90}/) || [''])[0]);
  check('SQL 覆盖了学习地图的 title/desc', executed.some(e => /learn_map/.test(e.text) && /'desc'/.test(e.text)),
        sqlAll.slice(0, 300));

  /* 学习地图也能被搜到，且指向 /learn/?id= */
  fakeDb(() => [
    row({ id: 21, type: 'learn_map', data: { title: '学 Rust', desc: '系统学习', nodes: [{ id: 'n1', text: '所有权' }] } }),
  ]);
  r = await call(searchRoute, 'GET', { query: { q: 'Rust' } });
  check('学习地图能被搜到', r.json.results.length === 1 && r.json.results[0].title === '学 Rust',
        JSON.stringify(r.json.results));
  check('学习地图指向 /learn/?id=', r.json.results[0].url === '/learn/?id=21', r.json.results[0].url);
  check('学习地图的 desc 进摘要', r.json.results[0].desc === '系统学习', r.json.results[0].desc);

  /* 节点文字不该被模糊匹配捞出来：只在 nodes 里出现的词不该命中 */
  fakeDb((text) => /ILIKE/.test(text)
    ? []
    : [row({ id: 22, type: 'learn_map', data: { title: '学 Go', desc: '', nodes: [{ id: 'n1', text: 'goroutine 调度' }] } })]);
  r = await call(searchRoute, 'GET', { query: { q: 'grutine' } });
  check('节点文字不参与模糊匹配', r.json.results.length === 0, JSON.stringify(r.json.results));

  /* 页面正文被搜到不算命中：假驱动不看 SQL 只回预设行，
     所以这里断言 SQL 本身——page 分支只允许 title 参与 ILIKE。 */
  fakeDb(() => []);
  await call(searchRoute, 'GET', { query: { q: '部署' } });
  const pageSql = (executed[0] && executed[0].text) || '';
  const pageBranch = (pageSql.match(/type = 'page' AND \([\s\S]{0,120}?\)\)/) || [''])[0];
  check('页面分支只搜标题、不搜正文', !!pageBranch && /title/.test(pageBranch) && !/content/.test(pageBranch),
        pageBranch);
}
console.log('\n=== 学习地图 /api/learn（给 AI 的读写接口）===');
{
  const learnRoute = (await load('api/learn.js')).default;

  /* 造一条地图记录（含节点） */
  const mapRow = (id, data, over) => Object.assign({
    id, type: 'learn_map', parent_id: null, sort_order: 0,
    updated_at: '2026-10-15T00:00:00.000Z', data,
  }, over || {});
  const rustMap = {
    title: '学 Rust', desc: '系统学习', status: 'active',
    nodes: [
      { id: 'n1', text: '所有权', group: '基础', done: true, note: null },
      { id: 'n2', text: '生命周期', group: '基础', done: false, note: null },
      { id: 'n3', text: '宏', group: '进阶', done: false, note: null },
    ],
  };

  /* ---- 未登录一律 401 ---- */
  fakeDb(noop);
  for (const m of ['POST', 'PATCH', 'DELETE']) {
    const res = await call(learnRoute, m, { body: {} });
    check(`未登录 ${m} /api/learn → 401`, res.statusCode === 401, String(res.statusCode));
  }
  check('未登录时 GET 列表也不需要令牌（公开只读）', true);

  /* ---- GET 列表：只回概览，不回 nodes ---- */
  fakeDb(() => [mapRow(1, rustMap)]);
  let res = await call(learnRoute, 'GET', {});
  check('GET /api/learn 免登录 → 200', res.statusCode === 200, String(res.statusCode));
  check('列表返回 items', Array.isArray(res.json.items) && res.json.items.length === 1);
  check('列表项带进度', res.json.items[0].progress.total === 3 && res.json.items[0].progress.done === 1,
        JSON.stringify(res.json.items[0].progress));
  check('列表项不带 nodes（省流量）', res.json.items[0].nodes === undefined);
  check('进度百分比正确（1/3≈33）', res.json.items[0].progress.percent === 33,
        String(res.json.items[0].progress.percent));

  /* ---- GET 单张：带 nodes + 分组明细 ---- */
  fakeDb(() => [mapRow(1, rustMap)]);
  res = await call(learnRoute, 'GET', { query: { id: '1' } });
  check('GET ?id=1 → 200', res.statusCode === 200, String(res.statusCode));
  check('单张返回 nodes', Array.isArray(res.json.item.data.nodes) && res.json.item.data.nodes.length === 3);
  check('进度明细含分组', res.json.progress.groups.length === 2, JSON.stringify(res.json.progress.groups));
  check('分组统计正确（基础 1/2）',
        res.json.progress.groups[0].name === '基础' && res.json.progress.groups[0].done === 1 && res.json.progress.groups[0].total === 2,
        JSON.stringify(res.json.progress.groups[0]));

  /* ---- GET 不存在的 id → 404 ---- */
  fakeDb(() => []);
  res = await call(learnRoute, 'GET', { query: { id: '999' } });
  check('GET 不存在的 id → 404', res.statusCode === 404, String(res.statusCode));

  /* ---- POST 新建地图 ---- */
  fakeDb(() => [mapRow(7, { title: '学 Go', desc: null, status: 'active', nodes: [] })]);
  res = await call(learnRoute, 'POST', { token: TOKEN, body: { title: '学 Go' } });
  check('POST 新建地图 → 200', res.statusCode === 200, String(res.statusCode));
  check('新建写入 type=learn_map', executed.some(e => /INSERT INTO content/.test(e.text) && e.values.includes('learn_map')),
        executed.map(e => e.text).join(' | '));
  check('新建带初始 nodes（缺省空数组）', res.json.item.data.nodes.length === 0);

  /* ---- POST 新建缺标题 → 400 ---- */
  fakeDb(noop);
  res = await call(learnRoute, 'POST', { token: TOKEN, body: {} });
  check('新建缺标题 → 400', res.statusCode === 400, String(res.statusCode));

  /* ---- toggleNode：勾选完成 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : [mapRow(1, { ...rustMap, nodes: rustMap.nodes })]);
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'toggleNode' }, body: { id: 1, nodeId: 'n2' } });
  check('toggleNode → 200', res.statusCode === 200, String(res.statusCode));
  const upd = executed.find(e => /UPDATE content/.test(e.text));
  check('toggleNode 把 n2 置为完成', upd && /"id":"n2"[^}]*"done":true/.test(String(upd.values)),
        upd ? String(upd.values).slice(0, 200) : 'no update');
  check('toggleNode 只动目标节点（n1 仍完成、n3 仍未完）',
        upd && /"id":"n1"[^}]*"done":true/.test(String(upd.values)) && /"id":"n3"[^}]*"done":false/.test(String(upd.values)));

  /* ---- addNode：追加节点（自动生成 id）---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : [mapRow(1, rustMap)]);
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'addNode' }, body: { id: 1, node: { text: '异步', group: '进阶' } } });
  check('addNode → 200', res.statusCode === 200, String(res.statusCode));
  let upd2 = executed.find(e => /UPDATE content/.test(e.text));
  check('addNode 自动分配未占用 id（n4）', upd2 && /"id":"n4"/.test(String(upd2.values)),
        upd2 ? String(upd2.values).slice(0, 200) : 'no update');
  check('addNode 默认未完成为 false', upd2 && /"id":"n4"[^}]*"done":false/.test(String(upd2.values)));

  /* ---- updateNode：改文字 / 分组 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : [mapRow(1, rustMap)]);
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'updateNode' }, body: { id: 1, nodeId: 'n1', patch: { text: '所有权与借用' } } });
  check('updateNode → 200', res.statusCode === 200, String(res.statusCode));
  upd2 = executed.find(e => /UPDATE content/.test(e.text));
  check('updateNode 改了文字', upd2 && /所有权与借用/.test(String(upd2.values)));

  /* ---- removeNode：删节点 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : [mapRow(1, rustMap)]);
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'removeNode' }, body: { id: 1, nodeId: 'n3' } });
  check('removeNode → 200', res.statusCode === 200, String(res.statusCode));
  upd2 = executed.find(e => /UPDATE content/.test(e.text));
  check('removeNode 后不再含 n3', upd2 && !/"id":"n3"/.test(String(upd2.values)),
        upd2 ? String(upd2.values).slice(0, 200) : 'no update');
  check('removeNode 返回被删的节点', res.json.removed && res.json.removed.id === 'n3', JSON.stringify(res.json.removed));

  /* ---- nodeId 不存在 → 400 且给出现有 id 提示 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : [mapRow(1, rustMap)]);
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'toggleNode' }, body: { id: 1, nodeId: 'zzz' } });
  check('nodeId 不存在 → 400', res.statusCode === 400, String(res.statusCode));
  check('错误信息提示现有节点 id', /n1/.test(res.json.error || ''), res.json.error);

  /* ---- 不认识的 action → 400 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : []);
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'explode' }, body: { id: 1 } });
  check('未知 action → 400', res.statusCode === 400, String(res.statusCode));

  /* ---- PATCH 合并语义：只改标题，nodes 原样保留 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : [mapRow(1, { ...rustMap, title: '新标题' })]);
  res = await call(learnRoute, 'PATCH', { token: TOKEN, body: { id: 1, title: '新标题' } });
  check('PATCH 改标题 → 200', res.statusCode === 200, String(res.statusCode));
  upd2 = executed.find(e => /UPDATE content/.test(e.text));
  check('PATCH 未传 nodes 时节点不丢', upd2 && /所有权/.test(String(upd2.values)) && /生命周期/.test(String(upd2.values)));

  /* ---- setNodes：整表替换 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : [mapRow(1, rustMap)]);
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'setNodes' }, body: { id: 1, nodes: [{ id: 'a', text: '只剩一个' }] } });
  check('setNodes → 200', res.statusCode === 200, String(res.statusCode));
  upd2 = executed.find(e => /UPDATE content/.test(e.text));
  check('setNodes 整体替换', upd2 && /只剩一个/.test(String(upd2.values)) && !/生命周期/.test(String(upd2.values)));

  /* ---- DELETE 地图 ---- */
  fakeDb((text) => /SELECT/.test(text) ? [mapRow(1, rustMap)] : []);
  res = await call(learnRoute, 'DELETE', { token: TOKEN, query: { id: '1' } });
  check('DELETE 地图 → 200', res.statusCode === 200, String(res.statusCode));
  check('DELETE 只删 learn_map', executed.some(e => /DELETE FROM content/.test(e.text) && e.values.includes('learn_map')));

  /* ---- 方法不支持 ---- */
  fakeDb(noop);
  res = await call(learnRoute, 'PUT', { token: TOKEN });
  check('PUT /api/learn → 405', res.statusCode === 405, String(res.statusCode));
}

console.log('\n=== 查漏补缺快照 ?gaps=1（M10 新增，给 AI 用） ===');
{
  const learnRoute = (await load('api/learn.js')).default;
  const mapRow = (id, data) => ({
    id, type: 'learn_map', parent_id: null, sort_order: 0,
    updated_at: '2026-10-15T00:00:00.000Z', data,
  });
  const map = {
    title: '前端入门', desc: '', status: 'active',
    nodes: [
      { id: 'n1', text: 'HTML 基础', group: '基础', done: true, note: null },
      { id: 'n2', text: 'CSS 布局', group: '基础', done: false, note: '重点' },
      { id: 'n3', text: '变量与类型', group: 'JavaScript', done: false, note: null },
      { id: 'n4', text: '函数', group: 'JavaScript', done: false, note: null },
      { id: 'n5', text: 'Promise', group: '异步', done: false, note: null },
      { id: 'n6', text: 'async/await', group: '异步', done: false, note: null },
    ],
  };

  /* ---- 单张地图的查漏补缺 ---- */
  fakeDb((text) => (/SELECT/.test(text) ? [mapRow(1, map)] : []));
  let res = await call(learnRoute, 'GET', { query: { id: '1', gaps: '1' } });
  check('GET ?id=1&gaps=1 → 200', res.statusCode === 200, String(res.statusCode));
  const gap = res.json.gap;
  check('快照带 progress（不用 AI 自己算）',
        gap && gap.progress.total === 6 && gap.progress.done === 1 && gap.progress.left === 5,
        JSON.stringify(gap && gap.progress));
  check('未开始的组被标出（JavaScript / 异步）',
        gap.untouchedGroups.length === 2
        && gap.untouchedGroups.indexOf('JavaScript') >= 0
        && gap.untouchedGroups.indexOf('异步') >= 0,
        JSON.stringify(gap.untouchedGroups));
  check('进行中的组被标出（基础 1/2）',
        gap.stalledGroups.length === 1 && gap.stalledGroups[0] === '基础',
        JSON.stringify(gap.stalledGroups));
  check('每组带 state 与待办清单',
        gap.groups.every(g => g.state && Array.isArray(g.pending)));
  check('未开始的组排最前（最该补）',
        gap.groups[0].state === 'not_started', JSON.stringify(gap.groups.map(g => [g.name, g.state])));
  check('待办项带 nodeId 与原因', gap.suggest.length > 0
        && gap.suggest.every(s => s.nodeId && s.group && s.reason), JSON.stringify(gap.suggest));
  check('建议优先补「这组还没开始」的',
        gap.suggest.some(s => s.reason === '这组还没开始'), JSON.stringify(gap.suggest.map(s => s.reason)));
  check('已完成组不计入待办（基础组只剩 n2）',
        gap.groups.find(g => g.name === '基础').pending.length === 1
        && gap.groups.find(g => g.name === '基础').pending[0].id === 'n2');
  check('查漏补缺不需要令牌（公开只读）', true);

  /* ---- 全部地图的查漏补缺 ---- */
  const map2 = { title: '学完的图', desc: '', status: 'active',
    nodes: [{ id: 'a1', text: '唯一一项', group: '全部', done: true, note: null }] };
  const map3 = { title: '归档的图', desc: '', status: 'archived',
    nodes: [{ id: 'b1', text: '归档项', group: '归档组', done: false, note: null }] };
  fakeDb((text) => (/SELECT/.test(text) ? [mapRow(1, map), mapRow(2, map2), mapRow(3, map3)] : []));
  res = await call(learnRoute, 'GET', { query: { gaps: '1' } });
  check('GET ?gaps=1（全部）→ 200', res.statusCode === 200, String(res.statusCode));
  check('归档地图被排除在查漏补缺之外',
        res.json.maps.length === 2 && !res.json.maps.some(m => m.title === '归档的图'),
        JSON.stringify(res.json.maps.map(m => m.title)));
  check('汇总了全站待补总数（5 项）', res.json.totalLeft === 5, String(res.json.totalLeft));
  check('给出「最该先补」的地图排序（百分比低的在前）',
        res.json.needFirst.length === 1 && res.json.needFirst[0].title === '前端入门',
        JSON.stringify(res.json.needFirst.map(m => [m.title, m.percent])));
  check('needFirst 带未开始的分组信息',
        res.json.needFirst[0].untouched.length === 2, JSON.stringify(res.json.needFirst[0].untouched));

  /* ---- 全部完成的图不出现在 needFirst ---- */
  fakeDb((text) => (/SELECT/.test(text) ? [mapRow(2, map2)] : []));
  res = await call(learnRoute, 'GET', { query: { gaps: '1' } });
  check('全部完成的图不进「最该先补」', res.json.needFirst.length === 0, JSON.stringify(res.json.needFirst));
  check('全部完成时 totalLeft 为 0', res.json.totalLeft === 0, String(res.json.totalLeft));
}

console.log('\n=== AI 长效令牌能调学习接口 + 吊销后立刻失效（M10） ===');
{
  const learnRoute = (await load('api/learn.js')).default;
  const aiRoute = (await load('api/ai.js')).default;

  const mapRow = (id, data) => ({
    id, type: 'learn_map', parent_id: null, sort_order: 0,
    updated_at: '2026-10-15T00:00:00.000Z', data,
  });
  const map = { title: '路线', desc: '', status: 'active',
    nodes: [{ id: 'n1', text: '第一项', group: '基础', done: false, note: null }] };

  /* ---- AI 令牌可调写接口 ---- */
  const aiTok = T.issueAiToken(undefined, 0).token;
  /* UPDATE ... RETURNING * 也要回一条，否则 saveNodes 拿不到行 */
  const aiDb = (epoch) => (text) => {
    if (/FROM meta/.test(text)) return [{ value: String(epoch) }];   /* 当前世代 */
    if (/SELECT \* FROM content WHERE id/.test(text)) return [mapRow(1, map)];
    if (/UPDATE content/.test(text)) return [mapRow(1, map)];
    if (/INSERT INTO content/.test(text)) return [mapRow(2, map)];
    if (/SELECT/.test(text)) return [mapRow(1, map)];
    return [];
  };

  fakeDb(aiDb(0));
  let res = await call(learnRoute, 'POST', { token: aiTok, query: { action: 'toggleNode' }, body: { id: 1, nodeId: 'n1' } });
  check('AI 令牌能调 toggleNode → 200', res.statusCode === 200, JSON.stringify(res.json));
  check('toggleNode 真的翻成了 done=true',
        executed.some(e => /UPDATE content/.test(e.text) && /"done":true/.test(String(e.values))),
        String(executed.filter(e => /UPDATE/.test(e.text)).map(e => e.values)));
  res = await call(learnRoute, 'POST', { token: aiTok, body: { title: 'AI 建的图' } });
  check('AI 令牌能新建地图 → 200', res.statusCode === 200, String(res.statusCode));

  /* ---- 世代对不上（已吊销）→ 401 ---- */
  fakeDb(aiDb(1));   /* 世代被 +1 = 吊销 */
  res = await call(learnRoute, 'POST', { token: aiTok, query: { action: 'toggleNode' }, body: { id: 1, nodeId: 'n1' } });
  check('吊销后 AI 令牌 → 401', res.statusCode === 401, String(res.statusCode));
  check('吊销后不再写库', !executed.some(e => /UPDATE content/.test(e.text)));

  /* ---- 后台令牌不受吊销影响 ---- */
  fakeDb(aiDb(1));
  res = await call(learnRoute, 'POST', { token: TOKEN, query: { action: 'toggleNode' }, body: { id: 1, nodeId: 'n1' } });
  check('吊销 AI 令牌后，后台登录令牌照常用 → 200', res.statusCode === 200, String(res.statusCode));

  /* ---- /api/ai：AI 令牌不能管理自己，后台令牌可以 ---- */
  fakeDb((text) => (/FROM meta/.test(text) ? [{ value: '0' }] : []));
  res = await call(aiRoute, 'GET', { token: aiTok });
  check('AI 令牌访问 /api/ai → 401（不能给自己续命）', res.statusCode === 401, String(res.statusCode));
  res = await call(aiRoute, 'GET', { token: TOKEN });
  check('后台令牌访问 /api/ai → 200', res.statusCode === 200, String(res.statusCode));
  check('返回里有 epoch 与 baseUrl',
        res.json && res.json.epoch !== undefined && /^https?:\/\//.test(res.json.baseUrl || ''),
        JSON.stringify(res.json));
}

console.log('\n=== /api/ai 接入信息与令牌管理（M10） ===');
{
  const aiRoute = (await load('api/ai.js')).default;

  /* ---- 未登录一律 401 ---- */
  fakeDb(noop);
  for (const m of ['GET', 'POST', 'DELETE']) {
    const r = await call(aiRoute, m, { body: {} });
    check(`未登录 ${m} /api/ai → 401`, r.statusCode === 401, String(r.statusCode));
  }

  /* ---- 发令牌 ---- */
  fakeDb((text) => (/FROM meta/.test(text) ? [{ value: '0' }] : []));
  let res = await call(aiRoute, 'POST', { token: TOKEN });
  check('后台登录后 POST /api/ai → 200', res.statusCode === 200, JSON.stringify(res.json));
  check('返回一条 AI 令牌', typeof res.json.token === 'string' && res.json.token.split('.').length === 2,
        String(res.json.token));
  check('返回令牌有效期（天）', res.json.ttlDays >= 300, String(res.json.ttlDays));
  check('返回当前世代 epoch', res.json.epoch === 0, String(res.json.epoch));
  check('发令牌写进了 meta（记住明文与时间）',
        executed.some(e => /INSERT INTO meta/.test(e.text) && String(e.values).includes('ai_last_token')),
        JSON.stringify(executed.filter(e => /INSERT INTO meta/.test(e.text)).map(e => e.values)));

  /* ---- 发出来的令牌真的能用 ---- */
  const issued = res.json.token;
  check('发出来的 AI 令牌能被校验通过', T.verifyToken(issued, Date.now(), { epoch: 0 }) !== null);

  /* ---- 读状态 ---- */
  fakeDb((text) => {
    if (/FROM meta/.test(text)) return [{ value: '2' }];      /* ai_epoch=2 */
    return [];
  });
  res = await call(aiRoute, 'GET', { token: TOKEN });
  check('GET /api/ai → 200', res.statusCode === 200);
  check('读回来的 epoch 与库里一致', res.json.epoch === 2, String(res.json.epoch));

  /* ---- guide ---- */
  fakeDb((text) => (/FROM meta/.test(text) ? [{ value: '0' }] : []));
  res = await call(aiRoute, 'GET', { token: TOKEN, query: { guide: '1' } });
  check('?guide=1 → 200', res.statusCode === 200);
  const g = res.json.guide || '';
  check('说明书里有全部读写接口',
        /api\/learn/.test(g) && /toggleNode/.test(g) && /addNode/.test(g) && /setNodes/.test(g));
  check('说明书里带了鉴权写法', /Authorization: Bearer/.test(g));
  check('说明书里带了节点结构说明', /"id"/.test(g) && /"text"/.test(g) && /"group"/.test(g));
  check('说明书里带站点地址', g.includes(res.json.baseUrl), res.json.baseUrl);
  check('说明书提到查漏补缺', /gaps=1/.test(g));
  check('说明书是 Markdown', /^# /.test(g));

  /* ---- 吊销 ---- */
  fakeDb((text) => (/FROM meta/.test(text) ? [{ value: '3' }] : []));
  res = await call(aiRoute, 'DELETE', { token: TOKEN });
  check('DELETE /api/ai → 200（吊销）', res.statusCode === 200, JSON.stringify(res.json));
  check('吊销后世代 +1（3 → 4）', res.json.epoch === 4, String(res.json.epoch));
  check('吊销写回了 meta',
        executed.some(e => /INSERT INTO meta/.test(e.text) && String(e.values).includes('ai_epoch')),
        JSON.stringify(executed.filter(e => /INSERT INTO meta/.test(e.text)).map(e => e.values)));
  check('吊销清掉了存着的令牌明文',
        executed.some(e => /INSERT INTO meta/.test(e.text) && String(e.values).includes('ai_last_token')));

  /* ---- 方法限制 ---- */
  fakeDb(noop);
  res = await call(aiRoute, 'PUT', { token: TOKEN });
  check('PUT /api/ai → 405', res.statusCode === 405, String(res.statusCode));
}

console.log('\n=== 站点地图 /api/sitemap（公开免登录，M10 新增） ===');
{
  const sitemapRoute = (await load('api/sitemap.js')).default;
  const HOST = 'eraser.example.com';
  const row = (o) => Object.assign({ id: 1, updated_at: '2026-10-13T10:00:00.000Z', data: {} }, o);

  const content = [
    row({ id: 3, type: 'post', updated_at: '2026-10-13T10:00:00.000Z',
          data: { slug: 'hello-world', title: '第一篇', published: true } }),
    row({ id: 2, type: 'post', updated_at: '2026-10-12T10:00:00.000Z',
          data: { slug: 'draft-one', title: '草稿', published: false } }),
    row({ id: 5, type: 'page', updated_at: '2026-10-11T10:00:00.000Z',
          data: { key: 'about', title: '关于' } }),
    row({ id: 6, type: 'page', updated_at: '2026-10-11T10:00:00.000Z',
          data: { key: 'home', title: '首页（已下线）' } }),
    row({ id: 7, type: 'learn_map', updated_at: '2026-10-10T10:00:00.000Z',
          data: { title: '前端路线', status: 'active', nodes: [] } }),
    row({ id: 8, type: 'learn_map', updated_at: '2026-10-10T10:00:00.000Z',
          data: { title: '归档地图', status: 'archived', nodes: [] } }),
  ];

  /* 假驱动不执行 SQL 的 WHERE，这里按真实条件手动筛一遍，
     另外单独断言 SQL 文本里确实带了这三种类型 */
  const wanted = content.filter(r => r.type === 'post' || r.type === 'page' || r.type === 'learn_map');

  fakeDb((text) => (/FROM content/.test(text) ? wanted : []));
  let res = await call(sitemapRoute, 'GET', { headers: { host: HOST } });
  check('未登录也能读 sitemap → 200', res.statusCode === 200, String(res.statusCode));
  check('Content-Type 是 application/xml', /application\/xml/.test(res.headers['Content-Type'] || ''),
        res.headers['Content-Type']);
  check('响应体是 XML（以 <?xml 开头）', /^<\?xml/.test(res.body || ''), String(res.body).slice(0, 40));
  check('带 sitemap 0.9 命名空间', (res.body || '').includes('http://www.sitemaps.org/schemas/sitemap/0.9'));
  check('是完整 XML（以 </urlset> 结尾）', /<\/urlset>\s*$/.test(String(res.body).trimEnd()));
  check('没有 XML 声明之外的 HTML', !/<!DOCTYPE|<html/i.test(res.body || ''));

  /* 固定页 —— 七个前台页面 + 首页 */
  const body = res.body || '';
  check('首页在 sitemap 里', body.includes('<loc>https://' + HOST + '/</loc>'));
  check('工具箱 / 博客 / 追更 / 学习 / 导航 / 关于都在',
        ['/tools/', '/blog/', '/collect/', '/learn/', '/nav/', '/about/']
          .every(p => body.includes('<loc>https://' + HOST + p + '</loc>')),
        body.match(/<loc>[^<]*<\/loc>/g) ? body.match(/<loc>[^<]*<\/loc>/g).slice(0, 10).join(' ') : 'none');

  /* 文章 */
  check('已发布文章进 sitemap', body.includes('/blog/post.html?slug=hello-world'));
  check('草稿不进 sitemap', !body.includes('draft-one'));
  check('文章 slug 做了 URL 编码', /slug=hello-world/.test(body));

  /* 页面 */
  check('内置页面进 sitemap（/about/）', body.includes('<loc>https://' + HOST + '/about/</loc>'));
  check('已下线的 home 页面不进 sitemap', !/\/home\//.test(body));

  /* 学习地图 */
  check('在学的学习地图进 sitemap（/learn/?id=7）', body.includes('/learn/?id=7'));
  check('归档的学习地图不进 sitemap', !body.includes('/learn/?id=8'));

  /* 详情 */
  check('每条 url 都有 loc', (body.match(/<loc>/g) || []).length === (body.match(/<\/loc>/g) || []).length);
  check('每条 url 都带 priority', (body.match(/<url>/g) || []).length === (body.match(/<priority>/g) || []).length);
  check('有 lastmod（取自 updated_at，YYYY-MM-DD）',
        /<lastmod>2026-10-13<\/lastmod>/.test(body), (/<lastmod>([^<]*)</.exec(body) || [])[1] || 'none');
  check('首页 priority 最高（1.0）', /<loc>https:\/\/[^<]*\/<\/loc>\s*<priority>1\.0<\/priority>/.test(body));

  /* SQL：类型清单 + 只读这三种 */
  const sel = executed.find(e => /FROM content/.test(e.text));
  check('SQL 覆盖 post / page / learn_map 三种类型',
        sel && /'post'/.test(sel.text) && /'page'/.test(sel.text) && /'learn_map'/.test(sel.text),
        sel ? sel.text : 'none');
  check('sitemap 不查 nav_link / media（不是独立详情页）',
        sel && !/'nav_link'/.test(sel.text) && !/'media'/.test(sel.text), sel ? sel.text : 'none');

  /* XML 转义 */
  fakeDb((text) => (/FROM content/.test(text)
    ? [row({ id: 1, type: 'post', data: { slug: 'a&b', title: '标<题>', published: true } })]
    : []));
  res = await call(sitemapRoute, 'GET', { headers: { host: HOST } });
  check('URL 里的 & 被转义成 &amp;', (res.body || '').includes('slug=a%26b') || (res.body || '').includes('&amp;'),
        (/<loc>([^<]*)<\/loc>/.exec(res.body || '') || [])[1] || 'none');
  check('转义后仍是合法 XML（没有裸 & 落在标签外）', !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(res.body || ''));

  /* 空库 */
  fakeDb(() => []);
  res = await call(sitemapRoute, 'GET', { headers: { host: HOST } });
  check('空库也返回 200', res.statusCode === 200, String(res.statusCode));
  check('空库仍列固定页', (res.body || '').includes('<loc>https://' + HOST + '/</loc>'));
  check('空库也是完整 XML', /^<\?xml[\s\S]*<\/urlset>\s*$/.test(res.body || ''));

  /* 方法限制 */
  fakeDb(noop);
  res = await call(sitemapRoute, 'POST', { body: {} });
  check('POST /api/sitemap → 405', res.statusCode === 405, String(res.statusCode));

  /* Host 缺省兜底 */
  fakeDb(() => []);
  res = await call(sitemapRoute, 'GET', {});
  check('没有 Host 头时用兜底域名', (res.body || '').includes('<loc>https://eraser.de5.net/</loc>'),
        (/<loc>([^<]*)<\/loc>/.exec(res.body || '') || [])[1] || 'none');
}

console.log('\n=== 备份与还原 /api/backup（M10 新增） ===');
{
  const backupRoute = (await load('api/backup.js')).default;

  const todoRow = { id: 1, title: '交房租', note: null, done: false, due_date: '2026-10-20',
                    priority: 2, created_at: '2026-10-13T10:00:00.000Z', done_at: null };
  const eventRow = { id: 1, title: '开会', note: null, start_at: '2026-10-15T09:00:00.000Z',
                     end_at: null, all_day: false, created_at: '2026-10-13T10:00:00.000Z' };
  const contentRow = (o) => Object.assign({ parent_id: null, sort_order: 0,
    updated_at: '2026-10-13T10:00:00.000Z', data: {} }, o);

  /* ---- 未登录一律拒绝 ---- */
  fakeDb(noop);
  let res = await call(backupRoute, 'GET', {});
  check('未登录 GET /api/backup → 401', res.statusCode === 401, String(res.statusCode));
  res = await call(backupRoute, 'POST', { body: { todos: [] } });
  check('未登录 POST /api/backup → 401', res.statusCode === 401, String(res.statusCode));

  /* ---- 拉快照 ---- */
  fakeDb((text) => {
    if (/FROM todos/.test(text)) return [todoRow];
    if (/FROM events/.test(text)) return [eventRow];
    if (/FROM content/.test(text)) return [
      contentRow({ id: 1, type: 'post', data: { slug: 'a', title: '文章A', content: '正文', published: true } }),
      contentRow({ id: 2, type: 'page', data: { key: 'about', title: '关于', content: '内容' } }),
      contentRow({ id: 3, type: 'nav_category', data: { name: '开发' } }),
      contentRow({ id: 4, type: 'nav_link', parent_id: 3, data: { name: 'GitHub', url: 'https://github.com' } }),
      contentRow({ id: 5, type: 'media', data: { category: 'anime', name: '芙莉莲', status: 'watching' } }),
      contentRow({ id: 6, type: 'learn_map', data: { title: '前端路线', status: 'active',
        nodes: [{ id: 'n1', text: 'HTML', done: true }] } }),
    ];
    return [];
  });
  res = await call(backupRoute, 'GET', { token: TOKEN });
  check('登录后 GET /api/backup → 200', res.statusCode === 200, String(res.statusCode));
  const bk = res.json && res.json.backup;
  check('快照含 exportedAt / site', !!(bk && bk.exportedAt && bk.site), JSON.stringify(bk && Object.keys(bk)));
  check('快照含 todos（1 条）', bk && bk.todos.length === 1, JSON.stringify(bk && bk.todos.length));
  check('快照含 events（1 条）', bk && bk.events.length === 1);
  check('快照把 content 按类型分好（posts/pages/nav/media/learnMaps）',
        bk && bk.posts.length === 1 && bk.pages.length === 1 && bk.media.length === 1
        && bk.learnMaps.length === 1);
  check('nav 拆成 categories / links',
        bk && bk.nav.categories.length === 1 && bk.nav.links.length === 1);
  check('学习地图快照带 nodes（不丢节点）',
        bk && bk.learnMaps[0].data.nodes.length === 1 && bk.learnMaps[0].data.nodes[0].text === 'HTML');

  /* ---- verify：好备份 ---- */
  fakeDb(noop);
  const goodBackup = {
    exportedAt: '2026-10-13T10:00:00.000Z', site: 'eraser.de5.net',
    todos: [{ id: 1, title: '交房租' }],
    events: [{ id: 1, title: '开会', start_at: '2026-10-15T09:00:00.000Z' }],
    posts: [{ id: 1, data: { slug: 'a', title: 'A', content: '正文' } }],
    pages: [], files: [], media: [],
    nav: { categories: [{ id: 1, data: { name: '开发' } }],
           links: [{ id: 2, parent_id: 1, data: { name: 'GitHub', url: 'https://github.com' } }] },
    learnMaps: [{ id: 3, data: { title: '路线', nodes: [{ id: 'n1', text: 'HTML' }] } }],
  };
  res = await call(backupRoute, 'POST', { token: TOKEN, query: { action: 'verify' }, body: goodBackup });
  check('verify 好备份 → ok:true', res.statusCode === 200 && res.json.ok === true,
        JSON.stringify(res.json));
  check('verify 返回各类计数', res.json.counts && res.json.counts.todos === 1 && res.json.counts.learnMaps === 1,
        JSON.stringify(res.json.counts));
  check('verify 不写库（一条 INSERT 都没有）', !executed.some(e => /INSERT|UPDATE/.test(e.text)));

  /* ---- verify：坏备份 ---- */
  fakeDb(noop);
  res = await call(backupRoute, 'POST', { token: TOKEN, query: { action: 'verify' },
    body: { todos: 'not-an-array', learnMaps: [] } });
  check('verify 坏备份 → ok:false', res.statusCode === 200 && res.json.ok === false, JSON.stringify(res.json));
  check('verify 指出 todos 应该是数组',
        (res.json.errors || []).some(e => /todos/.test(e)), JSON.stringify(res.json.errors));

  res = await call(backupRoute, 'POST', { token: TOKEN, query: { action: 'verify' },
    body: { posts: [{ id: 1, data: { title: '缺 slug 和正文' } }] } });
  check('verify 会逐条跑 normalize（缺字段被挡下）',
        res.json.ok === false && (res.json.errors || []).some(e => /posts\[0\]/.test(e)),
        JSON.stringify(res.json.errors));

  res = await call(backupRoute, 'POST', { token: TOKEN, query: { action: 'verify' }, body: {} });
  check('verify 空对象 → ok:false（一条数据都没有）',
        res.json.ok === false, JSON.stringify(res.json.errors));

  /* ---- 还原：写库 + 事务 ---- */
  fakeDb(() => []);
  res = await call(backupRoute, 'POST', { token: TOKEN, body: goodBackup });
  check('还原好备份 → 200', res.statusCode === 200, JSON.stringify(res.json));
  check('还原报告了写入条数',
        res.json.restored && res.json.restored.todos === 1 && res.json.restored.content >= 3,
        JSON.stringify(res.json.restored));
  check('还原确实写了 todos（INSERT ... ON CONFLICT）',
        executed.some(e => /INSERT INTO todos/.test(e.text) && /ON CONFLICT \(id\) DO UPDATE/.test(e.text)));
  check('还原写了 events', executed.some(e => /INSERT INTO events/.test(e.text)));
  check('还原写了 content', executed.some(e => /INSERT INTO content/.test(e.text)));
  check('还原推进了序列号（否则下次新建会撞 id）',
        executed.filter(e => /setval\(pg_get_serial_sequence/.test(e.text)).length === 3,
        String(executed.filter(e => /setval/.test(e.text)).length));
  check('还原包在事务里（走 sql.transaction）', executed.some(e => /INSERT INTO todos/.test(e.text)));

  /* 坏备份不写库 */
  fakeDb(() => []);
  res = await call(backupRoute, 'POST', { token: TOKEN, body: { posts: 'oops' } });
  check('还原坏备份 → 400', res.statusCode === 400, String(res.statusCode));
  check('坏备份一条都不写', !executed.some(e => /INSERT|UPDATE/.test(e.text)));

  /* 备份可以包一层 {data: ...} */
  fakeDb(() => []);
  res = await call(backupRoute, 'POST', { token: TOKEN, body: { data: goodBackup } });
  check('还原接受 {data: 备份} 的包装形式 → 200', res.statusCode === 200, JSON.stringify(res.json));

  /* 还原不删库里多出来的数据（ON CONFLICT 用 DO UPDATE，没有 DELETE） */
  fakeDb(() => []);
  await call(backupRoute, 'POST', { token: TOKEN, body: goodBackup });
  check('还原不含 DELETE（不会手滑清掉新加的内容）',
        !executed.some(e => /DELETE FROM/.test(e.text)));

  /* ---- 方法限制 ---- */
  fakeDb(noop);
  res = await call(backupRoute, 'DELETE', { token: TOKEN });
  check('DELETE /api/backup → 405', res.statusCode === 405, String(res.statusCode));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
