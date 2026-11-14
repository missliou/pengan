// 运行时环境配置（浏览器加载的第一份脚本，早于应用模块）。
// 同一套前端代码通过这里区分环境：本地开发用默认同源 /api；
// 构建部署 Ubuntu 时 build.mjs 会注入本文件的生产变体（API_BASE 可指向反代路径）。
// 注意：这里只允许放非敏感的公开配置。密钥永远不进前端、不进构建变量、不进浏览器存储。
window.__PENGAN_ENV__ = {
  API_BASE: '/api',
  ADMIN_API_BASE: '/admin-api',
  // 真实模式默认。演示数据必须在界面显式开启并与真实数据隔离。
  DEMO_MODE_DEFAULT: false,
  BUILD: 'local-dev'
};
