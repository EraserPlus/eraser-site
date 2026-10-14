/* ===========================================================================
   站点内容的类型定义与校验
   ---------------------------------------------------------------------------
   五种类型共用一张 content 表，各自的字段放在 data(jsonb) 里。
   这里负责：每个类型允许哪些字段、怎么校验、怎么归一化。
   =========================================================================== */

const TYPES = {
  nav_category: {
    public: true,
    needsParent: false,
    fields: ['name'],
  },
  nav_link: {
    public: true,
    needsParent: true,          // 必须属于某个分类
    fields: ['name', 'url', 'desc', 'tip', 'tags', 'keywords'],
  },
  post: {
    public: true,
    needsParent: false,
    fields: ['slug', 'title', 'summary', 'content', 'tags', 'published'],
  },
  file: {
    public: true,
    needsParent: false,
    fields: ['name', 'url', 'desc'],
  },
  page: {
    public: true,
    needsParent: false,
    fields: ['key', 'title', 'content'],
  },
};

export function knownType(type) {
  return Object.prototype.hasOwnProperty.call(TYPES, type);
}

export function needsParent(type) {
  return !!(TYPES[type] && TYPES[type].needsParent);
}

function bad(msg) {
  const e = new Error(msg);
  e.code = 'BAD_INPUT';
  return e;
}

function str(v, name, { max = 200, required = true } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (required) throw bad(`${name}不能为空`);
    return null;
  }
  if (s.length > max) throw bad(`${name}最多 ${max} 个字`);
  return s;
}

function url(v, name) {
  const s = str(v, name, { max: 2000 });
  if (!/^https?:\/\//i.test(s)) throw bad(`${name}要以 http:// 或 https:// 开头`);
  try { new URL(s); } catch { throw bad(`${name}不是有效的网址`); }
  return s;
}

/* 标签：数组或逗号分隔的字符串都能接受，统一成去重后的数组 */
function tags(v) {
  let list;
  if (v == null) list = [];
  else if (Array.isArray(v)) list = v;
  else list = String(v).split(/[,，]/);
  const out = [];
  list.forEach(function (t) {
    const s = String(t == null ? '' : t).trim().slice(0, 30);
    if (s && out.indexOf(s) === -1) out.push(s);
  });
  return out.slice(0, 20);
}

/* slug 只允许小写字母、数字和连字符，避免出现奇怪的 URL */
function slug(v) {
  let s = str(v, '短链接', { max: 80 });
  s = s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) throw bad('短链接不能为空');
  return s.slice(0, 80);
}

/* 校验并归一化 data，返回一个干净的、只含白名单字段的对象 */
export function normalize(type, raw) {
  const spec = TYPES[type];
  if (!spec) throw bad('未知的内容类型：' + type);
  const d = (raw && typeof raw === 'object') ? raw : {};
  const out = {};

  if (type === 'nav_category') {
    out.name = str(d.name, '分类名', { max: 50 });
  } else if (type === 'nav_link') {
    out.name = str(d.name, '名称', { max: 80 });
    out.url = url(d.url, '网址');
    out.desc = str(d.desc, '说明', { max: 200, required: false });
    out.tip = str(d.tip, '提示词', { max: 200, required: false });
    out.tags = tags(d.tags);
    out.keywords = tags(d.keywords);   // 搜索关键词：数组/逗号串都吃，同一套归一化
  } else if (type === 'post') {
    out.slug = slug(d.slug);
    out.title = str(d.title, '标题', { max: 200 });
    out.summary = str(d.summary, '摘要', { max: 300, required: false });
    out.content = str(d.content, '正文', { max: 100000 });
    out.tags = tags(d.tags);
    out.published = d.published === undefined ? true : !!d.published;
  } else if (type === 'file') {
    out.name = str(d.name, '文件名', { max: 200 });
    out.url = str(d.url, '文件地址', { max: 2000 });
    out.desc = str(d.desc, '说明', { max: 200, required: false });
  } else if (type === 'page') {
    out.key = str(d.key, '页面标识', { max: 50 }).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!out.key) throw bad('页面标识只能用小写字母、数字、下划线和连字符');
    out.title = str(d.title, '标题', { max: 200 });
    out.content = str(d.content, '正文', { max: 100000 });
  }

  return out;
}

export function typeList() {
  return Object.keys(TYPES);
}
