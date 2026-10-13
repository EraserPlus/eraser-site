/* 测试用的假 @vercel/blob：只记录调用并返回预设结果，不真的连 Blob。
   真实项目里这个包由 npm install 从 npm 源装，不会是这个文件。 */
function cfg() {
  const c = globalThis.__FAKE_BLOB__;
  if (!c || typeof c.handler !== 'function') throw new Error('fake blob 没有配置 handler');
  return c;
}
export async function put(pathname, body, options) {
  return cfg().handler(String(pathname), body, options || {});
}
export default { put };
