/* ===========================================================================
   请求 / 响应小工具
   =========================================================================== */

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function ok(res, body = {}) { send(res, 200, body); }
export function bad(res, message, status = 400) { send(res, status, { error: message }); }

/* 把内部异常翻译成用户看得懂的话，不泄露服务器细节 */
export function fail(res, err) {
  const code = err && err.code;
  if (code === 'UNAUTHORIZED') return bad(res, err.message, 401);
  if (code === 'LOCKED' || code === 'RATE_LIMIT') return bad(res, err.message, 429);
  if (code === 'NO_DATABASE' || code === 'NO_PASSWORD') return bad(res, err.message, 503);
  if (code === 'DUP') return bad(res, err.message, 409);
  if (code === 'BAD_INPUT') return bad(res, err.message, 400);
  console.error('[api]', err);
  return bad(res, '服务器出错了，请稍后再试', 500);
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('x');
    return parsed;
  } catch {
    const e = new Error('请求体不是合法的 JSON');
    e.code = 'BAD_INPUT';
    throw e;
  }
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* ---------- 入参校验 ---------- */

export function needText(value, name, max = 500) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    const e = new Error(`${name}不能为空`);
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (s.length > max) {
    const e = new Error(`${name}最多 ${max} 个字`);
    e.code = 'BAD_INPUT';
    throw e;
  }
  return s;
}

export function optionalText(value, max = 2000) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function needId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const e = new Error('缺少有效的 id');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return n;
}

/* 只接受 YYYY-MM-DD */
export function optionalDate(value, name) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const e = new Error(`${name}格式不对，应该是 YYYY-MM-DD`);
    e.code = 'BAD_INPUT';
    throw e;
  }
  return s;
}

/* 接受 ISO 字符串或 Date，返回 ISO 字符串 */
export function needTimestamp(value, name) {
  const s = String(value == null ? '' : value).trim();
  if (!s) {
    const e = new Error(`${name}不能为空`);
    e.code = 'BAD_INPUT';
    throw e;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const e = new Error(`${name}不是有效的时间`);
    e.code = 'BAD_INPUT';
    throw e;
  }
  return d.toISOString();
}

/* ---------- 读取原始 body（二进制安全，带大小上限，超限即抛 BAD_INPUT） ---------- */
export async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (maxBytes && size > maxBytes) {
      const e = new Error(`文件太大，上限 ${Math.floor(maxBytes / 1024 / 1024)}MB`);
      e.code = 'BAD_INPUT';
      throw e;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
