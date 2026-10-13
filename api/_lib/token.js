/* ===========================================================================
   令牌与密码校验（纯逻辑，不依赖数据库，可单独测试）
   ---------------------------------------------------------------------------
   设计取舍（个人站，单用户）：
   - 不做用户表、不做注册。密码放在 Vercel 环境变量 ADMIN_PASSWORD 里。
   - 登录成功换一个 HMAC 签名令牌，前端存 localStorage，写操作都带上它。
   - 令牌签名密钥由 ADMIN_PASSWORD 派生，省掉一个要额外配置的环境变量。
   =========================================================================== */

import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 天
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

/* 由密码派生签名密钥。攻击者拿到密码就等于拿到一切，所以不需要额外的秘密。 */
export function signingKey() {
  return createHash('sha256')
    .update('eraser-admin-token-v1::' + adminPassword())
    .digest();
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
  const sig = b64u(createHmac('sha256', signingKey()).update(body).digest());
  return { token: body + '.' + sig, exp: payload.exp };
}

export function verifyToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;

  let expected;
  try {
    expected = b64u(createHmac('sha256', signingKey()).update(body).digest());
  } catch {
    return null;
  }
  if (!safeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.v !== 1) return null;
    /* 规范要求「当前时间必须早于 exp」，所以恰好在 exp 当刻就算过期 */
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
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
