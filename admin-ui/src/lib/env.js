// 读取 index.html 里由 env.js 注入的运行时配置。
// 缺省时回落到本地开发默认值，保证没有 env.js 也能跑。
const DEFAULTS = {
  API_BASE: '/api',
  ADMIN_API_BASE: '/admin-api',
  DEMO_MODE_DEFAULT: false,
  BUILD: 'local-dev',
  ALLOW_LOCAL_DEBUG: false,
};

export function getEnv() {
  const injected = (typeof window !== 'undefined' && window.__PENGAN_ENV__) || {};
  return { ...DEFAULTS, ...injected };
}

export function isProductionBuild() {
  return getEnv().BUILD !== 'local-dev';
}
