#!/usr/bin/env node
// 构建脚本：把 admin-ui/ 复制为 dist/，并注入 Ubuntu 生产环境的 env.js。
// 同一套前端源码；环境差异只体现在 env.js 与部署方式（nginx 反代 /api）。
// 用法：
//   node build.mjs                                  # 默认：同源 /api（nginx 反代路径）
//   node build.mjs --api-base https://cloud.example  # 显式云端地址（必须 https）
import { cp, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const args = process.argv.slice(2);
const apiBase = args.includes('--api-base') ? args[args.indexOf('--api-base') + 1] : '/api';

if (apiBase.startsWith('http://') && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(apiBase.replace(/^http:\/\//, ''))) {
  console.error('拒绝构建：公网 API 地址不允许 http（与项目"公网必须 HTTPS"的既有校验一致）。');
  process.exit(1);
}

// Only replace this known generated folder; never traverse a redirected output.
if (path.relative(HERE, DIST) !== 'dist') throw Error('invalid_dist_directory');
try { if ((await lstat(DIST)).isSymbolicLink()) throw Error('dist_must_not_be_symlink'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
for (const name of ['index.html', 'styles.css', 'src']) {
  await cp(path.join(HERE, name), path.join(DIST, name), { recursive: true });
}

const env = `window.__PENGAN_ENV__ = {
  API_BASE: ${JSON.stringify(apiBase)},
  ADMIN_API_BASE: '/admin-api',
  DEMO_MODE_DEFAULT: false,
  BUILD: 'ubuntu-production'
};
`;
await writeFile(path.join(DIST, 'env.js'), env, 'utf8');

console.log('构建完成：admin-ui/dist/');
console.log('  API_BASE =', apiBase);
console.log('  部署：把 dist/ 放到 Ubuntu（如 /srv/pengan-admin），nginx 静态服务并反代 /api 到云上网关；');
console.log('  /admin-api 必须反代到管理会话后端；未认证访问由后端拒绝。');
