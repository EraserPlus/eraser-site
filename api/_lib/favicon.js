/* ===========================================================================
   favicon 抓取的纯逻辑：SSRF 防护 + 图片类型识别（无 IO，可单测）
   =========================================================================== */

/* 内网 / 保留段 IPv4（WHATWG URL 会把 127.1 / 0x7f000001 这类简写规范化成点分，
   所以这里拿到的 hostname 已经是规范化后的形式） */
function isPrivateIPv4(h){
  var m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  var a = +m[1], b = +m[2], c = +m[3], d = +m[4];
  if ([a, b, c, d].some(function(n){ return n > 255; })) return true; // 畸形一律挡掉
  if (a === 0) return true;                           // 0.0.0.0/8
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 运营商级 NAT
  if (a === 127) return true;                         // 127.0.0.0/8 回环
  if (a === 169 && b === 254) return true;            // 169.254.0.0/16 链路本地/云元数据
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true;   // 192.0.0.0/24
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 224) return true;                          // 组播 / 保留 / 广播
  return false;
}

function isPrivateIPv6(h){
  var s = h.replace(/^\[|\]$/g, "").toLowerCase();
  if (!s) return true;
  if (s === "::" || s === "::1") return true;
  if (s.indexOf("::ffff:") === 0){
    var rest = s.slice(7);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return isPrivateIPv4(rest);
    return true;                                      // 映射的十六进制形态一律挡掉
  }
  if (/^fe[89ab]/.test(s)) return true;               // fe80::/10 链路本地
  if (/^f[cd]/.test(s)) return true;                  // fc00::/7 唯一本地
  return false;
}

/* 校验并规范化一个"允许服务端去抓"的公网 http(s) 网址。
   挡掉：非 http(s) 协议、带账号密码、非 80/443 端口、内网/回环/元数据地址。
   已知残留风险（可接受）：指向公网域名但 DNS 解析到内网的 rebinding 类攻击——
   个人站自用场景，抓的是 Icon，不是用户可控的敏感目标。 */
export function assertPublicHttpUrl(raw){
  var s = String(raw == null ? "" : raw).trim();
  if (!s){ var e0 = new Error("缺少要抓取的网址"); throw e0; }
  var u;
  try { u = new URL(s); } catch (e){ var e1 = new Error("网址格式不对"); throw e1; }
  if (u.protocol !== "http:" && u.protocol !== "https:"){
    var e2 = new Error("只支持 http/https 网址"); throw e2;
  }
  if (u.username || u.password){
    var e3 = new Error("网址不能带账号密码"); throw e3;
  }
  if (u.port && u.port !== "80" && u.port !== "443"){
    var e4 = new Error("只支持 80/443 端口"); throw e4;
  }
  var host = u.hostname;
  if (!host){ var e5 = new Error("网址缺少主机名"); throw e5; }
  var h = host.toLowerCase();
  if (h === "localhost" || h.slice(-10) === ".localhost" ||
      h.slice(-6) === ".local" || h.slice(-9) === ".internal"){
    var e6 = new Error("不允许访问内网地址"); throw e6;
  }
  /* 公网域名必带点；无点主机名（intranet、printer、http:///path 规范化出的 path）一律挡掉 */
  if (h.charAt(0) !== "[" && h.indexOf(".") === -1){
    var e6b = new Error("主机名不合法"); throw e6b;
  }
  if (h.charAt(0) === "["){
    if (isPrivateIPv6(h)){ var e7 = new Error("不允许访问内网地址"); throw e7; }
  } else if (isPrivateIPv4(h)){
    var e8 = new Error("不允许访问内网地址"); throw e8;
  }
  return u.toString();
}

/* 判断一段字节是不是图片：先看服务端 Content-Type，再看文件魔数。
   很多站点的 /favicon.ico 返回 application/octet-stream，魔数兜底才抓得到。 */
export function guessImageType(buf, serverType){
  if (buf && buf.length >= 4 && /^image\//i.test(String(serverType || ""))){
    return String(serverType).split(";")[0].trim().toLowerCase();
  }
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return "image/x-icon";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  var head = buf.slice(0, 256).toString("utf8").replace(/^\uFEFF/, "").trim().toLowerCase();
  if (head.indexOf("<svg") === 0 || head.indexOf("<?xml") === 0 || head.indexOf("<!doctype svg") === 0) return "image/svg+xml";
  return null;
}
