/* ===========================================================================
   令牌与密码校验（纯逻辑，不依赖数据库，可单独测试）
   ---------------------------------------------------------------------------
   设计取舍（个人站，单用户）：
   - 不做用户表、不做注册。密码放在 Vercel 环境变量 ADMIN_PASSWORD 里。
   - 登录成功换一个 HMAC 签名令牌，前端存 localStorage，写操作都带上它。
   - 令牌签名密钥由 ADMIN_PASSWORD 派生，省掉一个要额外配置的环境变量。

   两种令牌（M10 新增第二种）：
     kind 缺省 / 'admin'  后台登录令牌，30 天。能改全站任何东西。
     kind 'ai'            给外部 AI 助手用的长期令牌（默认 365 天）。
                          签名字符串多掺一段前缀，所以两种令牌互不通用——
                          给了 AI 的令牌泄了也登不进后台。
   为什么要分开：站长要把令牌贴给 AI 助手，那可是长期暴露在外面。
   要是直接复用后台登录令牌，一来 30 天就断，二来这把钥匙能改博客 / 待办 / 导航，
   权限给太大了。AI 令牌只在管理学习地图这类场景里够用即可。
   =========================================================================== */

import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;         // 后台登录 30 天
export const AI_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;     // AI 令牌 365 天
export const MIN_PASSWORD_LEN = 8;

export function adminPassword() {
  const p = process.env.ADMIN_PASSWORD;
  if (!p || p.length < MIN_PASSWORD_LEN) {
    const err = new Error(`服务器没有配置管理密码，或密码短于 ${MIN_PASSWORD_LEN} 位。请在 Vercel 环境变量里设置 ADMIN_PASSWORD。`);
    err.code = 'NO_PASSWORD';
    throw err;
  }
  return p;
}

/* 由密码派生签名密钥。攻击者拿到密码就等于拿到一切，所以不需要额外的秘密。
   两种令牌用不同的前缀派生，保证互不通用。 */
export function signingKey(kind = 'admin') {
  const tag = kind === 'ai' ? 'eraser-ai-token-v1::' : 'eraser-admin-token-v1::';
  return createHash('sha256').update(tag + adminPassword()).digest();
}

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

/* 定长比较，避免通过响应时间推测密码 */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);   // 长度不同也走一次比较，不提前返回
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function issueToken(now = Date.now()) {
  const payload = { v: 1, exp: now + TOKEN_TTL_MS, n: b64u(randomBytes(8)) };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(createHmac('sha256', signingKey('admin')).update(body).digest());
  return { token: body + '.' + sig, exp: payload.exp };
}

/* 发一条 AI 令牌。epoch 是「吊销世代」：换了世代，之前发出去的全废
   （校验时比对 epoch，见 verifyToken 的 opt.epoch）。 */
export function issueAiToken(now = Date.now(), epoch = 0) {
  const payload = { v: 1, kind: 'ai', exp: now + AI_TOKEN_TTL_MS, ep: Number(epoch) || 0, n: b64u(randomBytes(8)) };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(createHmac('sha256', signingKey('ai')).update(body).digest());
  return { token: body + '.' + sig, exp: payload.exp, epoch: payload.ep };
}

/* 校验令牌。
   opt.kind 指定只接受哪种（'admin' / 'ai'）；不传则两种都收（兼容旧调用）。
   opt.epoch 传当前 AI 世代：AI 令牌的 ep 不等于它就算失效（用于「一键吊销」）。 */
export function verifyToken(token, now = Date.now(), opt = {}) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;

  /* 先解 payload，判断是哪种令牌，再用对应的密钥验签 */
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || payload.v !== 1) return null;
  const kind = payload.kind === 'ai' ? 'ai' : 'admin';

  /* opt.kind 给了就要求匹配 */
  if (opt.kind && opt.kind !== kind) return null;

  let expected;
  try {
    expected = b64u(createHmac('sha256', signingKey(kind)).update(body).digest());
  } catch {
    return null;
  }
  if (!safeEqual(sig, expected)) return null;

  /* 规范要求「当前时间必须早于 exp」，所以恰好在 exp 当刻就算过期 */
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;

  /* AI 令牌额外校验世代：对不上就是已被吊销 */
  if (kind === 'ai' && opt.epoch !== undefined && opt.epoch !== null) {
    if (Number(payload.ep) !== Number(opt.epoch)) return null;
  }

  payload.kind = kind;
  return payload;
}

export function requireAuth(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(h) ? h[0] : h);
  const payload = verifyToken(m ? m[1].trim() : null);
  if (!payload) {
    const err = new Error('未登录或登录已过期，请重新登录');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return payload;
}

/* 只要后台登录令牌（AI 令牌不算数）。用于「只有站长本人能做」的操作：
   发 / 吊销 AI 令牌、还原备份等。 */
export function requireAdmin(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(h) ? h[0] : h);
  const payload = verifyToken(m ? m[1].trim() : null, Date.now(), { kind: 'admin' });
  if (!payload) {
    const err = new Error('需要后台登录令牌（AI 令牌不能做这个操作）');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return payload;
}

/* 接受后台登录令牌，或（带正确世代）的 AI 令牌。
   传 epoch 是为了让 AI 令牌在「已吊销」时立刻失效。 */
export function requireAny(req, epoch) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(h) ? h[0] : h);
  const raw = m ? m[1].trim() : null;
  const payload = verifyToken(raw, Date.now(), epoch === undefined ? {} : { epoch: epoch });
  if (!payload) {
    const err = new Error('未登录或登录已过期，请重新登录');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return payload;
}

export function checkPassword(input) {
  try {
    return safeEqual(input, adminPassword());
  } catch {
    return false;
  }
}

export function configStatus() {
  return {
    hasDatabase: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    hasPassword: !!(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= MIN_PASSWORD_LEN),
  };
}
