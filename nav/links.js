/* ===========================================================================
   Eraser 小站 · 网址导航数据
   ===========================================================================

   怎么加链接：
     1. 找到下面合适的分类（没有就自己加一个，照抄格式）
     2. 复制一整行 { ... }，粘到上一个链接的后面（注意行尾要有英文逗号）
     3. 改掉 name / url / desc / tags
     4. Commit，等 1~2 分钟

   字段说明：
     name  显示的名称（必填）
     url   网址，要以 https:// 开头（必填）
     desc  一句话说明，显示在名称下面（可省略）
     tags  标签数组，一个链接可以挂多个（可省略）
           标签是自由填的，导航页会自动把所有标签收集起来做成筛选条

   排序：链接按你写的顺序显示，所以把最常用的写在前面就行。
   =========================================================================== */

window.NAV_DATA = {
  categories: [
    {
      id: "common",
      name: "常用",
      links: [
        { name: "百度", url: "https://www.baidu.com", desc: "中文搜索", tags: ["搜索", "中文"] },
        { name: "必应", url: "https://www.bing.com", desc: "英文搜索更准", tags: ["搜索"] },
        { name: "谷歌", url: "https://www.google.com", desc: "搜英文资料用", tags: ["搜索", "英文"] }
      ]
    },
    {
      id: "dev",
      name: "开发",
      links: [
        { name: "GitHub", url: "https://github.com", desc: "代码仓库，本站也在这", tags: ["代码", "英文"] },
        { name: "MDN Web 文档", url: "https://developer.mozilla.org/zh-CN/", desc: "前端最权威的中文文档", tags: ["文档", "中文"] },
        { name: "Stack Overflow", url: "https://stackoverflow.com", desc: "报错就去这里搜", tags: ["问答", "英文"] },
        { name: "npm", url: "https://www.npmjs.com", desc: "JS 包仓库", tags: ["包管理"] },
        { name: "Can I use", url: "https://caniuse.com", desc: "查浏览器兼容性", tags: ["兼容性"] }
      ]
    },
    {
      id: "ai",
      name: "AI",
      links: [
        { name: "DeepSeek", url: "https://chat.deepseek.com", desc: "中文好用", tags: ["对话", "中文"] },
        { name: "ChatGPT", url: "https://chatgpt.com", desc: "综合能力最强", tags: ["对话", "英文"] },
        { name: "Claude", url: "https://claude.ai", desc: "写代码和长文不错", tags: ["对话", "英文"] },
        { name: "Kimi", url: "https://kimi.moonshot.cn", desc: "长文档总结", tags: ["对话", "中文"] }
      ]
    },
    {
      id: "learn",
      name: "学习",
      links: [
        { name: "菜鸟教程", url: "https://www.runoob.com", desc: "入门速查", tags: ["教程", "中文"] },
        { name: "阮一峰的网络日志", url: "https://www.ruanyifeng.com/blog/", desc: "技术随笔和周刊", tags: ["博客", "中文"] },
        { name: "廖雪峰的官方网站", url: "https://liaoxuefeng.com", desc: "体系化教程", tags: ["教程", "中文"] }
      ]
    },
    {
      id: "design",
      name: "设计",
      links: [
        { name: "Iconify", url: "https://icon-sets.iconify.design", desc: "海量开源图标", tags: ["图标", "免费"] },
        { name: "Coolors", url: "https://coolors.co", desc: "配色方案生成", tags: ["配色", "免费"] },
        { name: "Unsplash", url: "https://unsplash.com", desc: "免费高清图片", tags: ["图片", "免费"] }
      ]
    },
    {
      id: "news",
      name: "资讯",
      links: [
        { name: "少数派", url: "https://sspai.com", desc: "效率与数码", tags: ["科技", "中文"] },
        { name: "V2EX", url: "https://www.v2ex.com", desc: "程序员社区", tags: ["社区", "中文"] },
        { name: "掘金", url: "https://juejin.cn", desc: "中文技术文章", tags: ["社区", "中文"] }
      ]
    },
    {
      id: "media",
      name: "媒体",
      links: [
        { name: "哔哩哔哩", url: "https://www.bilibili.com", desc: "视频", tags: ["视频", "中文"] },
        { name: "YouTube", url: "https://www.youtube.com", desc: "视频", tags: ["视频", "英文"] },
        { name: "网易云音乐", url: "https://music.163.com", desc: "听歌", tags: ["音乐"] }
      ]
    },
    {
      id: "tools",
      name: "效率",
      links: [
        { name: "语雀", url: "https://www.yuque.com", desc: "笔记和文档", tags: ["笔记", "中文"] },
        { name: "Notion", url: "https://www.notion.so", desc: "笔记和数据库", tags: ["笔记", "英文"] },
        { name: "坚果云", url: "https://www.jianguoyun.com", desc: "网盘同步", tags: ["网盘", "中文"] }
      ]
    },
    {
      id: "life",
      name: "生活",
      links: [
        { name: "淘宝", url: "https://www.taobao.com", desc: "买东西", tags: ["购物"] },
        { name: "京东", url: "https://www.jd.com", desc: "买东西，送货快", tags: ["购物"] },
        { name: "12306", url: "https://www.12306.cn", desc: "买火车票", tags: ["出行"] }
      ]
    },
    {
      id: "fun",
      name: "娱乐",
      links: [
        { name: "知乎", url: "https://www.zhihu.com", desc: "问答", tags: ["问答", "中文"] },
        { name: "豆瓣", url: "https://www.douban.com", desc: "书影音评分", tags: ["书影音"] }
      ]
    },
    {
      id: "mine",
      name: "我的",
      links: [
        { name: "Eraser 小站", url: "https://eraser.de5.net", desc: "本站首页", tags: ["我的"] },
        { name: "站点仓库", url: "https://github.com/EraserPlus/eraser-site", desc: "改站就来这", tags: ["我的", "代码"] }
      ]
    }
  ]
};
