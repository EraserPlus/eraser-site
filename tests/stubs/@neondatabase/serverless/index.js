/* 测试用的假驱动：只记录 SQL 并返回预设结果，不真的连数据库。
   真实项目里这个包由 npm install 从 npm 源装，不会是这个文件。 */
function cfg() {
  const c = globalThis.__FAKE_DB__;
  if (!c || typeof c.handler !== 'function') throw new Error('fake db 没有配置 handler');
  return c;
}
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

export function neon(_url) {
  const sql = (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join(' ? ') : String(strings);
    return Promise.resolve(cfg().handler(flat(text), values));
  };
  sql.query = (text, params) => Promise.resolve(cfg().handler(flat(text), params || []));
  sql.transaction = (fn) => fn(sql);
  return sql;
}
export default { neon };
