/* ===========================================================================
   POST /api/auth   登录，用密码换令牌
   GET  /api/auth   检查令牌是否有效；未登录时返回服务器配置自检
   =========================================================================== */

import { issueToken, checkPassword, requireAuth, configStatus } from './_lib/token.js';
import { assertNotLocked, recordFail, clearFails, MAX_FAILS } from './_lib/ratelimit.js';
import { ok, send, fail, readJson, clientIp } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const cfg = configStatus();
      let loggedIn = false;
      try { requireAuth(req); loggedIn = true; } catch { /* 未登录是正常情况 */ }
      return ok(res, { ok: true, loggedIn, config: cfg });
    }

    if (req.method !== 'POST') return send(res, 405, { error: '不支持的请求方法' });

    const cfg = configStatus();
    if (!cfg.hasDatabase) return send(res, 503, { error: '服务器还没配好：缺少数据库连接。' });
    if (!cfg.hasPassword) return send(res, 503, { error: '服务器还没配好：缺少管理密码（至少 8 位）。' });

    const ip = clientIp(req);
    await assertNotLocked(ip);

    const body = await readJson(req);
    if (!checkPassword(body.password)) {
      const fails = await recordFail(ip);
      const left = Math.max(0, MAX_FAILS - fails);
      return send(res, 401, {
        error: left > 0 ? `密码不对，还可以试 ${left} 次` : '密码连续输错多次，已锁定 15 分钟',
      });
    }

    await clearFails(ip);
    const t = issueToken();
    return ok(res, { ok: true, token: t.token, exp: t.exp });
  } catch (e) {
    return fail(res, e);
  }
}
