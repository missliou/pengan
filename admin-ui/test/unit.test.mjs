// admin-ui 主机测试（Node 内置 test runner，无需浏览器/设备/后端）。
// 覆盖：纯逻辑模块（分页/筛选/CSV/趋势图/来源标签/存储白名单）+ 全部 ES 模块可加载性。
// 运行：node --test test/
// 注意：界面级点击流在 Windows 本机用 serve.mjs + 浏览器人工核对，另见交接文档。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { paginate, filterRows, filterByValidity, filterByRange, toCsv } from '../src/lib/pagination.js';
import { renderTrendSvg } from '../src/lib/trend.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- paginate ----------
test('paginate 边界：空列表、越界页回夹、尾半页', () => {
  assert.deepEqual(paginate([], 1, 20), { rows: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 });
  const rows = Array.from({ length: 45 }, (_, i) => i);
  const p = paginate(rows, 99, 20);
  assert.equal(p.page, 3); assert.equal(p.pageCount, 3); assert.equal(p.rows.length, 5);
  const p0 = paginate(rows, 0, 20); assert.equal(p0.page, 1);
});

// ---------- filter ----------
test('filterRows 不区分大小写包含', () => {
  const rows = [{ n: 'DeepSeek' }, { n: 'other' }];
  assert.equal(filterRows(rows, 'deep', (r) => r.n).length, 1);
  assert.equal(filterRows(rows, '   ', (r) => r.n).length, 2);
});

test('filterByValidity 三态', () => {
  const rows = [{ ok: true }, { ok: false }];
  const validOf = (r) => r.ok;
  assert.equal(filterByValidity(rows, 'valid', validOf).length, 1);
  assert.equal(filterByValidity(rows, 'unknown', validOf).length, 1);
  assert.equal(filterByValidity(rows, 'all', validOf).length, 2);
});

test('filterByRange：时间未知的行仅在无范围限制时保留', () => {
  const rows = [{ t: 1000 }, { t: 0 }, { t: null }];
  const timeOf = (r) => r.t;
  assert.equal(filterByRange(rows, null, null, timeOf).length, 3);
  assert.equal(filterByRange(rows, 500, 2000, timeOf).length, 1);
});

// ---------- CSV：未知留空，绝不填 0 ----------
test('toCsv 未知值留空且正确转义', () => {
  const csv = toCsv(
    [{ header: '温度C', value: (o) => o.temp }, { header: '备注', value: (o) => o.note }],
    [{ temp: null, note: 'a,b' }, { temp: 25.6, note: '他说"好"' }]);
  assert.match(csv, /^温度C,备注\r\n/);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], ',"a,b"');
  assert.equal(lines[2], '25.6,"他说""好"""');
  const empty = toCsv([{ header: 'x', value: () => '' }], []);
  assert.equal(empty, 'x\r\n');
});

// ---------- trend：缺口断开、无有效点返回 null ----------
test('renderTrendSvg 缺口不连线，返回绘制数与缺口数', () => {
  // [有效, 缺口, 有效, 有效] → 第一段单点画圆、第二段两点画线，绝不跨缺口连线
  const points = [{ t: 1, v: 10 }, { t: 2, v: null }, { t: 3, v: 12 }, { t: 4, v: 13 }];
  const out = renderTrendSvg(points);
  assert.equal(out.plotted, 3); assert.equal(out.gaps, 1);
  const polylines = out.svg.match(/<polyline/g) || [];
  assert.equal(polylines.length, 1, '缺口后仅剩余连续段连线');
  const circles = out.svg.match(/<circle/g) || [];
  assert.ok(circles.length >= 2, '离散点各自成点');
  // 反向验证：任何 polyline 的 points 属性都不允许同时含 t=1 与 t=3 两侧的点
  const seg = out.svg.match(/<polyline points="([^"]+)"/)[1].split(' ');
  assert.equal(seg.length, 2);
});

test('renderTrendSvg 全无效时不产出 svg', () => {
  const out = renderTrendSvg([{ t: 1, v: null }, { t: 2, v: null }]);
  assert.equal(out.svg, null); assert.equal(out.plotted, 0);
});

test('renderTrendSvg 单点画圆点不画线', () => {
  const out = renderTrendSvg([{ t: 5, v: 20 }]);
  assert.doesNotMatch(out.svg, /<polyline/);
  assert.match(out.svg, /<circle/);
});

// ---------- 来源标签：绝不把 unknown 误标成串口（本项目历史缺陷回归） ----------
test('fmtSource 四值显式映射，未知不伪装串口', async () => {
  const { fmtSource, sourceKind } = await import('../src/lib/format.js');
  assert.equal(fmtSource('serial'), '串口');
  assert.equal(fmtSource('http'), '局域网HTTP');
  assert.equal(fmtSource('unknown'), '未知来源');
  assert.equal(fmtSource('dayu-direct'), 'DAYU200直采');
  assert.equal(fmtSource(undefined), '未知来源');
  assert.equal(fmtSource('ble'), '未知来源（ble）');
  assert.equal(sourceKind('unknown'), 'unknown');
  assert.equal(sourceKind('serial'), 'info');
});

test('fmtValue/fmtReason 缺值口径', async () => {
  const { fmtValue, fmtReason, fmtAiError } = await import('../src/lib/format.js');
  assert.equal(fmtValue(null, '℃'), '未知');
  assert.equal(fmtReason('telemetry_stale'), '遥测过期');
  assert.equal(fmtReason('brand_new_code'), 'brand_new_code'); // 未知码原样透出，不编造翻译
  assert.equal(fmtAiError('ai_provider_http_418'), '模型服务 HTTP 418');
});

// ---------- 存储白名单：密钥类键必须被拒 ----------
test('store 只允许白名单键，拒绝疑似敏感键', async () => {
  // 无 localStorage 环境（Node）→ 自动走内存兜底，接口行为一致。
  const { getPref, setPref } = await import('../src/lib/store.js');
  setPref('ui.pageSize', 20);
  assert.equal(getPref('ui.pageSize'), 20);
  assert.throws(() => setPref('ai.key', 'secret'), /非白名单存储键被拒绝/);
  assert.throws(() => getPref('admin.token'), /非白名单存储键被拒绝/);
  assert.throws(() => getPref('ui.unknown-key'), /非白名单存储键被拒绝/); // 读写都走白名单
  assert.equal(getPref('ui.pageSize', 'fallback'), 20);
});

// ---------- API 适配层：待实现接口必须 reject，不 resolve 假数据 ----------
test('notImplemented 接口一律 reject 且 kind=not_implemented', async () => {
  globalThis.fetch = () => Promise.reject(new Error('测试环境无网络')); // 即便有网也不该被调用
  const api = await import('../src/lib/api.js');
  for (const fn of [api.queryRecords, api.getAgentTasks, api.getSystemStatus]) {
    await assert.rejects(fn(), (e) => e.kind === 'not_implemented');
  }
});

test('后端不可达时 getHealth 抛 kind=offline', async () => {
  globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));
  globalThis.window = { __PENGAN_ENV__: { API_BASE: '/api' } };
  const api = await import('../src/lib/api.js');
  await assert.rejects(api.getHealth(), (e) => e.kind === 'offline');
});

test('网关 502（开发服务器代理上游失联）映射为 offline 语义由界面处理', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 502, async text() { return JSON.stringify({ error: 'upstream_unreachable' }); } });
  const api = await import('../src/lib/api.js');
  await assert.rejects(api.getHealth(), (e) => e.kind === 'http' && e.code === 'upstream_unreachable');
});

test('src 下所有页面与库模块可被解析导入', async () => {
  globalThis.window = globalThis.window || { __PENGAN_ENV__: {} };
  const files = [
    'src/lib/env.js', 'src/lib/api.js', 'src/lib/dom.js', 'src/lib/format.js',
    'src/lib/pagination.js', 'src/lib/store.js', 'src/lib/trend.js',
    'src/demo.js', 'src/pages/overview.js', 'src/pages/model.js', 'src/pages/records.js',
    'src/pages/devices.js', 'src/pages/tasks.js', 'src/pages/system.js',
  ];
  for (const f of files) {
    await import(pathToFileURL(path.join(HERE, '..', f)).href); // 语法错误/顶层副作用崩溃会在此抛出
  }
});

test('serve.mjs 与 build.mjs 语法有效（node --check）', () => {
  for (const f of ['serve.mjs', 'build.mjs']) {
    const r = spawnSync(process.execPath, ['--check', path.join(HERE, '..', f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, f + ' 语法检查失败：' + r.stderr);
  }
});

test('CSP 护栏：src 下所有 JS 模块零内联 style 属性（兼容 style-src self）', async () => {
  const jsFiles = [
    'src/app.js', 'src/demo.js', 'src/demo-pipeline.js',
    'src/lib/env.js', 'src/lib/api.js', 'src/lib/dom.js', 'src/lib/format.js',
    'src/lib/pagination.js', 'src/lib/store.js', 'src/lib/trend.js',
    'src/lib/session.js', 'src/lib/freshness.js', 'src/lib/data-source.js',
    'src/lib/model-editor.js', 'src/lib/live-hardware.js', 'src/lib/history-cursor.js', 'src/lib/timeline.js',
    'src/pages/overview.js', 'src/pages/model.js', 'src/pages/records.js',
    'src/pages/devices.js', 'src/pages/tasks.js', 'src/pages/system.js',
    'src/pages/alerts.js', 'src/pages/review.js', 'src/pages/agent-flow.js', 'src/pages/knowledge.js',
  ];
  for (const rel of jsFiles) {
    const code = await readFile(path.join(HERE, '..', rel), 'utf8');
    assert.doesNotMatch(code, /\bstyle\s*:\s*['"`]/, rel + ' 不得包含违反 CSP style-src self 的内联 style 属性');
  }
});
