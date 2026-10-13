export default function handler(request, response) {
  const name = request.query.name || '世界';
  response.status(200).json({
    message: `你好，${name}！这是来自 Vercel 后端的问候。`,
    time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  });
}
