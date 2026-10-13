import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..');
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
};

const PW = 'a-strong-personal-password-2026';
process.env.ADMIN_PASSWORD = PW;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const T = await load('api/_lib/token.js');
const H = await load('api/_lib/http.js');

console.log('=== 令牌签发与校验 ===');
{
  const t = T.issueToken();
  check('令牌由两段组成（body.sig）', t.token.split('.').length === 2, t.token);
  check('令牌只含 URL 安全字符', /^[A-Za-z0-9._-]+$/.test(t.token));
  check('返回了过期时间', typeof t.exp === 'number' && t.exp > Date.now());

  const v = T.verifyToken(t.token);
  check('刚签发的令牌能通过校验', !!v);
  check('校验结果带版本号', v && v.v === 1);
  check('校验结果带过期时间', v && v.exp === t.exp);

  check('两次签发的令牌不同（含随机数）', T.issueToken().token !== T.issueToken().token);
}

console.log('\n=== 令牌被篡改 ===');
{
  const { token } = T.issueToken();
  const [body, sig] = token.split('.');

  check('签名被改一个字符 → 拒绝', T.verifyToken(body + '.' + sig.slice(0, -1) + (sig.slice(-1) === 'A' ? 'B' : 'A')) === null);

  const fakeBody = Buffer.from(JSON.stringify({ v: 1, exp: Date.now() + 9e9 })).toString('base64url');
  check('换掉 body 保留原签名 → 拒绝（不能伪造长期令牌）', T.verifyToken(fakeBody + '.' + sig) === null);

  check('把 exp 改成很远的未来也没用', (() => {
    const evil = Buffer.from(JSON.stringify({ v: 1, exp: Date.now() + 1e12 })).toString('base64url');
    return T.verifyToken(evil + '.' + sig) === null;
  })());

  check('空令牌 → 拒绝', T.verifyToken('') === null);
  check('null → 拒绝', T.verifyToken(null) === null);
  check('undefined → 拒绝', T.verifyToken(undefined) === null);
  check('随便一串字符 → 拒绝', T.verifyToken('hello.world') === null);
  check('只有一段 → 拒绝', T.verifyToken('abc') === null);
  check('三段 → 拒绝', T.verifyToken('a.b.c') === null);
  check('空 body → 拒绝', T.verifyToken('.sig') === null);
  check('空签名 → 拒绝', T.verifyToken('body.') === null);
  check('body 不是合法 JSON → 拒绝', T.verifyToken(Buffer.from('notjson').toString('base64url') + '.' + sig) === null);
  check('版本号不对 → 拒绝', (() => {
    const b = Buffer.from(JSON.stringify({ v: 2, exp: Date.now() + 9e9 })).toString('base64url');
    const s = createHmac('sha256', T.signingKey()).update(b).digest('base64url');
    return T.verifyToken(b + '.' + s) === null;
  })());
}

console.log('\n=== 令牌过期 ===');
{
  const t = T.issueToken();
  check('刚签发时有效', T.verifyToken(t.token) !== null);
  check('过了 exp 之后失效', T.verifyToken(t.token, t.exp + 1) === null);
  check('恰好在 exp 当刻失效', T.verifyToken(t.token, t.exp) === null);
  check('exp 前一毫秒仍有效', T.verifyToken(t.token, t.exp - 1) !== null);
}

console.log('\n=== 换密码后旧令牌失效 ===');
{
  const old = T.issueToken().token;
  process.env.ADMIN_PASSWORD = 'a-completely-different-password';
  check('改掉 ADMIN_PASSWORD 后，旧令牌立刻失效', T.verifyToken(old) === null);
  const fresh = T.issueToken().token;
  check('新密码签发的令牌有效', T.verifyToken(fresh) !== null);
  process.env.ADMIN_PASSWORD = PW;
  check('换回原密码后，新令牌失效、旧令牌复活', T.verifyToken(fresh) === null && T.verifyToken(old) !== null);
}

console.log('\n=== 令牌不含密码 ===');
{
  const { token } = T.issueToken();
  const raw = Buffer.from(token, 'base64url').toString('utf8');
  check('令牌里看不到密码明文', !raw.includes(PW) && !token.includes(PW));
  const key = T.signingKey().toString('hex');
  check('签名密钥不等于密码本身', key !== PW && !key.includes(Buffer.from(PW).toString('hex')));
}

console.log('\n=== 密码校验 ===');
{
  check('正确密码 → true', T.checkPassword(PW) === true);
  check('错误密码 → false', T.checkPassword('wrong') === false);
  check('空密码 → false', T.checkPassword('') === false);
  check('null → false', T.checkPassword(null) === false);
  check('undefined → false', T.checkPassword(undefined) === false);
  check('密码前后加空格 → false（不做 trim 容错）', T.checkPassword(' ' + PW) === false);
  check('密码是密码的前缀 → false', T.checkPassword(PW.slice(0, 10)) === false);

  delete process.env.ADMIN_PASSWORD;
  check('没配密码时 checkPassword 返回 false 而不是抛错', T.checkPassword('anything') === false);
  let threw = null;
  try { T.adminPassword(); } catch (e) { threw = e.code; }
  check('没配密码时 adminPassword 抛 NO_PASSWORD', threw === 'NO_PASSWORD', String(threw));

  process.env.ADMIN_PASSWORD = 'short';
  threw = null;
  try { T.adminPassword(); } catch (e) { threw = e.code; }
  check('密码短于 8 位同样抛 NO_PASSWORD', threw === 'NO_PASSWORD', String(threw));

  process.env.ADMIN_PASSWORD = '12345678';
  check('恰好 8 位可以通过', T.checkPassword('12345678') === true);
  process.env.ADMIN_PASSWORD = PW;
}

console.log('\n=== safeEqual ===');
{
  check('相同字符串 → true', T.safeEqual('abc', 'abc') === true);
  check('不同字符串 → false', T.safeEqual('abc', 'abd') === false);
  check('长度不同 → false（不抛错）', T.safeEqual('abc', 'abcd') === false);
  check('空与空 → true', T.safeEqual('', '') === true);
  check('null 与空串 → true（都归一成空串）', T.safeEqual(null, '') === true);
  check('中文密码可比较', T.safeEqual('中文密码测试', '中文密码测试') === true);
  check('中文密码不同则 false', T.safeEqual('中文密码测试', '中文密码测式') === false);
}

console.log('\n=== requireAuth ===');
{
  const { token } = T.issueToken();
  check('合法 Bearer → 通过', !!T.requireAuth({ headers: { authorization: 'Bearer ' + token } }));
  check('bearer 小写也认', !!T.requireAuth({ headers: { authorization: 'bearer ' + token } }));
  check('多个空格也认', !!T.requireAuth({ headers: { authorization: 'Bearer   ' + token } }));

  const bad = (h) => { try { T.requireAuth({ headers: h }); return null; } catch (e) { return e.code; } };
  check('没有 Authorization 头 → UNAUTHORIZED', bad({}) === 'UNAUTHORIZED');
  check('只有 Bearer 没有令牌 → UNAUTHORIZED', bad({ authorization: 'Bearer' }) === 'UNAUTHORIZED');
  check('令牌是伪造的 → UNAUTHORIZED', bad({ authorization: 'Bearer aaa.bbb' }) === 'UNAUTHORIZED');
  check('用了 Basic 认证 → UNAUTHORIZED', bad({ authorization: 'Basic ' + token }) === 'UNAUTHORIZED');
  check('Authorization 是数组时也能处理', bad({ authorization: ['Bearer ' + token] }) === null);
}

console.log('\n=== 配置自检 ===');
{
  let c = T.configStatus();
  check('没配数据库 → hasDatabase false', c.hasDatabase === false);
  check('配了密码 → hasPassword true', c.hasPassword === true);

  process.env.DATABASE_URL = 'postgres://x';
  check('配了 DATABASE_URL → hasDatabase true', T.configStatus().hasDatabase === true);

  delete process.env.DATABASE_URL;
  process.env.POSTGRES_URL = 'postgres://y';
  check('旧变量名 POSTGRES_URL 也认', T.configStatus().hasDatabase === true);
  delete process.env.POSTGRES_URL;

  process.env.ADMIN_PASSWORD = 'short';
  check('密码太短算没配', T.configStatus().hasPassword === false);
  process.env.ADMIN_PASSWORD = PW;
}

console.log('\n=== 入参校验 ===');
{
  const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

  check('needText 去首尾空格', H.needText('  hi  ', '标题') === 'hi');
  check('needText 空串报错', code(() => H.needText('', '标题')) === 'BAD_INPUT');
  check('needText 全是空格报错', code(() => H.needText('   ', '标题')) === 'BAD_INPUT');
  check('needText null 报错', code(() => H.needText(null, '标题')) === 'BAD_INPUT');
  check('needText 超长报错', code(() => H.needText('x'.repeat(201), '标题', 200)) === 'BAD_INPUT');
  check('needText 正好到上限可以通过', H.needText('x'.repeat(200), '标题', 200).length === 200);

  check('optionalText null → null', H.optionalText(null) === null);
  check('optionalText 空串 → null', H.optionalText('') === null);
  check('optionalText 全空格 → null', H.optionalText('   ') === null);
  check('optionalText 去空格', H.optionalText('  abc ') === 'abc');
  check('optionalText 超长截断而不是报错', H.optionalText('x'.repeat(3000)).length === 2000);

  check('optionalDate 合法日期通过', H.optionalDate('2026-10-13', '截止日期') === '2026-10-13');
  check('optionalDate 空串 → null', H.optionalDate('') === null);
  check('optionalDate null → null', H.optionalDate(null) === null);
  check('optionalDate 非法格式报错', code(() => H.optionalDate('2026/10/13', '截止日期')) === 'BAD_INPUT');
  check('optionalDate 只有年月报错', code(() => H.optionalDate('2026-10', '截止日期')) === 'BAD_INPUT');

  check('needTimestamp 接受 ISO', H.needTimestamp('2026-10-13T10:00:00Z', '开始时间') === '2026-10-13T10:00:00.000Z');
  check('needTimestamp 接受本地格式', !!H.needTimestamp('2026-10-13 10:00', '开始时间'));
  check('needTimestamp 空串报错', code(() => H.needTimestamp('', '开始时间')) === 'BAD_INPUT');
  check('needTimestamp 乱写报错', code(() => H.needTimestamp('不是时间', '开始时间')) === 'BAD_INPUT');

  check('needId 正常数字通过', H.needId(7) === 7);
  check('needId 数字字符串也通过', H.needId('7') === 7);
  check('needId 0 报错', code(() => H.needId(0)) === 'BAD_INPUT');
  check('needId 负数报错', code(() => H.needId(-3)) === 'BAD_INPUT');
  check('needId 小数报错', code(() => H.needId(1.5)) === 'BAD_INPUT');
  check('needId 非数字报错', code(() => H.needId('abc')) === 'BAD_INPUT');
  check('needId null 报错', code(() => H.needId(null)) === 'BAD_INPUT');
}

console.log('\n=== 取客户端 IP ===');
{
  check('取 x-forwarded-for 第一段', H.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }) === '1.2.3.4');
  check('单个 IP', H.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4' } }) === '1.2.3.4');
  check('数组形式也能取', H.clientIp({ headers: { 'x-forwarded-for': ['9.9.9.9', '8.8.8.8'] } }) === '9.9.9.9');
  check('都没有时回退到 unknown', H.clientIp({ headers: {}, socket: {} }) === 'unknown');
  check('有 remoteAddress 时用它', H.clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }) === '127.0.0.1');
}

console.log('\n=== 全部源文件语法检查 ===');
{
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(REPO, dir))) {
      const rel = path.posix.join(dir, f);
      const full = path.join(REPO, rel);
      if (fs.statSync(full).isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk('api');
  walk('admin');

  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    /* admin/ 下是浏览器脚本（依赖 window），只能用 new Function 查语法，不能 import */
    if (f.startsWith('admin/')) {
      try { new Function(src); check(`${f} 语法正确（浏览器脚本）`, true); }
      catch (e) { check(`${f} 语法正确（浏览器脚本）`, false, e.message); }
      continue;
    }
    try {
      await import(pathToFileURL(path.join(REPO, f)).href);
      check(`${f} 语法正确且可导入`, true);
    } catch (e) {
      // 依赖没装（@neondatabase/serverless）属于预期，只看是不是语法错
      const isMissingDep = /Cannot find package|Cannot find module/.test(e.message);
      check(`${f} 语法正确${isMissingDep ? '（依赖未安装，已跳过导入）' : ''}`,
            isMissingDep, e.message.split('\n')[0]);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
