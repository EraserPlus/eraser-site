/* ===========================================================================
   站点内容的类型定义与校验
   ---------------------------------------------------------------------------
   六种类型共用一张 content 表，各自的字段放在 data(jsonb) 里。
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
  media: {
    public: true,
    needsParent: false,
    fields: ['category', 'name', 'status', 'score', 'note', 'date', 'url', 'cover'],
  },
  learn_map: {
    public: true,
    needsParent: false,
    // 学习地图：一张地图内含若干节点（nodes 是内嵌数组，不占额外表）
    fields: ['title', 'desc', 'status', 'nodes'],
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

/* ---------------- 学习地图的节点 ----------------
   节点内嵌在地图的 data.nodes 里，每个节点结构固定：
   { id, text, group, done, note }
   - id   客户端生成的短标识（用于 AI 精确定位某个节点），必填、地图内唯一
   - text 节点文字（要学的东西），必填
   - group 分组名（如「基础」「进阶」），可空
   - done 是否完成，布尔
   - note 备注，可空
*/
const NODE_MAX = 500;        // 单张地图节点数上限
const NODE_ID_MAX = 40;      // 节点 id 长度
const GROUP_MAX = 40;        // 分组名长度

function nodeId(v, idx) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    // id 缺失时按位置兜底生成，保证 AI 能定位；不因为旧数据没 id 就报错
    return 'n' + (idx + 1);
  }
  if (s.length > NODE_ID_MAX) throw bad(`节点 id（第 ${idx + 1} 个）最多 ${NODE_ID_MAX} 个字符`);
  // 只允许安全字符，避免注入到 URL / 选择器里出问题
  const clean = s.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) throw bad(`节点 id（第 ${idx + 1} 个）只能用小写字母、数字、下划线或连字符`);
  return clean;
}

function nodes(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw bad('节点要是一个数组');
  if (v.length > NODE_MAX) throw bad(`一张地图最多 ${NODE_MAX} 个节点，当前 ${v.length} 个`);
  const seen = {};
  const out = [];
  v.forEach(function (raw, idx) {
    const n = (raw && typeof raw === 'object') ? raw : {};
    const id = nodeId(n.id, idx);
    if (seen[id]) throw bad(`节点 id「${id}」重复了，同一张地图里不能重复`);
    seen[id] = true;
    const text = str(n.text, `第 ${idx + 1} 个节点的内容`, { max: 200 });
    out.push({
      id: id,
      text: text,
      group: str(n.group, `第 ${idx + 1} 个节点的分组`, { max: GROUP_MAX, required: false }),
      done: !!n.done,
      note: str(n.note, `第 ${idx + 1} 个节点的备注`, { max: 300, required: false }),
    });
  });
  return out;
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
  } else if (type === 'media') {
    /* 追更：追番 / 漫画的留档记录 */
    const cat = str(d.category, '栏目', { max: 20 });
    if (cat !== 'anime' && cat !== 'comic') throw bad('栏目只能是 anime（追番）或 comic（漫画）');
    out.category = cat;
    out.name = str(d.name, '名称', { max: 120 });
    const st = str(d.status, '状态', { max: 20 });
    if (st !== 'wish' && st !== 'watching' && st !== 'finished' && st !== 'paused') {
      throw bad('状态只能是 wish / watching / finished / paused');
    }
    out.status = st;
    const sc = d.score;
    if (sc == null || sc === '') {
      out.score = null;
    } else {
      const n = Number(sc);
      if (!Number.isFinite(n) || n < 0 || n > 10) throw bad('评分要填 0 到 10 之间的数字，留空表示不评分');
      out.score = Math.round(n * 10) / 10;   // 最多一位小数
    }
    out.note = str(d.note, '备注', { max: 200, required: false });
    out.date = str(d.date, '日期', { max: 20, required: false });
    out.url = str(d.url, '链接', { max: 2000, required: false });
    out.cover = str(d.cover, '封面图地址', { max: 2000, required: false });
  } else if (type === 'learn_map') {
    /* 学习地图：一张地图 + 内嵌节点 */
    out.title = str(d.title, '地图标题', { max: 120 });
    out.desc = str(d.desc, '地图说明', { max: 500, required: false });
    const st = str(d.status, '状态', { max: 20, required: false }) || 'active';
    if (st !== 'active' && st !== 'done' && st !== 'archived') {
      throw bad('地图状态只能是 active（在学）/ done（学完）/ archived（归档）');
    }
    out.status = st;
    out.nodes = nodes(d.nodes);
  }

  return out;
}

export function typeList() {
  return Object.keys(TYPES);
}
