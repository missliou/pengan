#!/usr/bin/env node
// 棚安管理平台 · 本地开发服务器（Windows 直接可用，不需要云服务器）。
// 职责：
//  1) 静态服务 admin-ui/；
//  2) 把 /api/* 反向代理到本机已启动的网关服务（默认 http://127.0.0.1:5187），
//     校验浏览器同源后转发Origin、Cookie和CSRF；
//  3) /admin-api/*同样代理真实会话后端，不再伪造登录或占位成功；
//  4) 绝不记录任何请求体内容（其中可能含密钥），只记录方法与路径。
// 生产部署 Ubuntu：静态目录交给 nginx，同样用 nginx 反代 /api（见 README）。

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };

const PORT = Number(argOf('--port', process.env.ADMIN_UI_PORT || 5199));
const HOST = argOf('--host', process.env.ADMIN_UI_HOST || '127.0.0.1');
const UPSTREAM = argOf('--upstream', process.env.ADMIN_UI_UPSTREAM || 'http://127.0.0.1:5187');
const UP = new URL(UPSTREAM);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Frame-Options': 'DENY',
};

function send(res, code, headers, body) {
  res.writeHead(code, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

async function readBody(req, limit = 3 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > limit) throw new Error('body_too_large'); chunks.push(part); }
  return Buffer.concat(chunks, size);
}

async function proxyApi(req, res, pathname, search) {
  const method = req.method || 'GET';
  const target = UP.origin + pathname + (search || '');
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  // 浏览器带过来的 Origin 是开发服务器端口，网关只认它自己的地址；重写为上游同源。
  const expectedOrigin = 'http://' + req.headers.host;
  if (req.headers.origin && req.headers.origin !== expectedOrigin) { send(res,403,{'Content-Type':'application/json'},JSON.stringify({error:'origin_denied'})); return; }
  if (req.headers.origin) headers.origin = UP.origin;
  if(req.headers.cookie) headers.cookie = req.headers.cookie;
  if(req.headers['x-pengan-csrf']) headers['x-pengan-csrf'] = req.headers['x-pengan-csrf'];
  const csrf = req.headers['x-pengan-config-token'];
  if (csrf) headers['x-pengan-config-token'] = csrf;

  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    try { body = await readBody(req); }
    catch { send(res, 413, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'body_too_large' })); return; }
  }
  const started = Date.now();
  try {
    const response = await fetch(target, {
      method, headers, body, redirect: 'error',
      signal: AbortSignal.timeout(method === 'GET' ? 8000 : 40000),
    });
    const isImage = ['image/jpeg','image/png'].includes(response.headers.get('content-type'));
    const text = isImage ? Buffer.from(await response.arrayBuffer()) : await response.text();
    console.log(`[proxy] ${method} ${pathname} -> ${response.status} (${Date.now() - started}ms)`);
    const cookies = response.headers.getSetCookie();
    send(res, response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8', ...(cookies.length ? {'Set-Cookie':cookies} : {}) }, text);
  } catch (error) {
    // 上游未启动/不可达：明确告知"未连接"，不伪造任何数据。
    console.log(`[proxy] ${method} ${pathname} -> upstream_unreachable (${error.message})`);
    send(res, 502, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'upstream_unreachable', detail: '后端网关未启动或不可达（' + UP.origin + '）。请先启动服务或确认云端地址。' }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); }
  catch { send(res, 400, { 'Content-Type': 'text/plain' }, 'bad path'); return; }

  if (pathname.startsWith('/admin-api/') || pathname.startsWith('/api/') || pathname === '/api') { await proxyApi(req, res, pathname, url.search); return; }

  // 静态文件
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(HERE, '.' + pathname);
  if (!file.startsWith(HERE + path.sep) && file !== path.join(HERE, 'index.html')) { send(res, 403, { 'Content-Type': 'text/plain' }, 'forbidden'); return; }
  try {
    const info = await stat(file);
    if (info.isDirectory()) throw Object.assign(new Error('is_dir'), { code: 'EISDIR' });
    if (info.size > 4 * 1024 * 1024) throw Object.assign(new Error('too_big'), { code: 'ETOOBIG' });
    const data = await readFile(file);
    send(res, 200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }, data);
  } catch (error) {
    if (error.code === 'ETOOBIG') { send(res, 413, { 'Content-Type': 'text/plain' }, 'too large'); return; }
    // SPA 兜底：未知非资源路径返回 index.html
    if (!path.extname(pathname)) {
      try { send(res, 200, { 'Content-Type': MIME['.html'] }, await readFile(path.join(HERE, 'index.html'))); return; } catch { /* fallthrough */ }
    }
    send(res, 404, { 'Content-Type': 'text/plain' }, 'not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log('棚安管理平台 · 本地开发服务器');
  console.log(`  控制台  http://${HOST}:${PORT}`);
  console.log(`  /api 反代 -> ${UP.origin}（网关未启动时页面显示"后端未连接"，属预期行为）`);
  console.log('  Ctrl+C 停止本服务器（只结束本进程，不影响其它服务）');
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${PORT} 已被占用；换端口：node serve.mjs --port 5200`);
  else console.error('服务器错误：', error.message);
  process.exitCode = 1;
});
