// 设备管理与诊断页回归（QWEN-ADMIN-UI-SESSION-20261102）。
// 只覆盖 devices.js 的新行为，不修改既有测试文件。
// 数据形状严格对齐 gateway/dayu-ingest.mjs current() 与 hsp-telemetry.mjs hspSnapshot() 的真实返回。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, button, find, flush } from './helpers/dom.mjs';
import renderDevices from '../src/pages/devices.js';
import { PageScope, MutationGate } from '../src/lib/session.js';
import { LiveObservations } from '../src/lib/freshness.js';
import { ApiError } from '../src/lib/api.js';

// 与 devices.js 的 LIST_REFRESH_MS 保持一致：列表刷新节流间隔。
const LIST_REFRESH_STEP = 5000;

function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

function context(t, dataSource, extra = {}) {
  const scope = new PageScope(); t.after(() => scope.dispose());
  return { scope, gate: new MutationGate(), state: { gatewayId: 'dayu-a' }, dataSource, demoMode: false,
    live: new LiveObservations(), markStatus() {}, setConnection() {}, notify() {}, navigate() {}, ...extra };
}

// 真实 online 快照：dayu-direct 来源、温湿度与气体均有效。
const onlineHardware = {
  schemaVersion: 1, deviceId: 'hh-hsp101-001', source: 'dayu-direct', simulated: false,
  deviceOnline: true, reason: 'read_only_hardware', receivedAt: 100000, sampleAgeMs: 1200,
  uptimeMs: 3600000, climateAgeMs: 1500, gasAgeMs: 1700,
  values: { temperatureC: 25.6, humidityPct: 48.2, gasRaw: 812, gasMv: 640, coPpm: null, co2Ppm: null },
  quality: { temperatureValid: true, humidityValid: true, gasValid: true, coValid: false, co2Valid: false },
  actuationAvailable: false, controlSupported: false,
  // 后端在线帧由 hsp-telemetry.mjs 的 unknown() 展开且未覆盖 admission，
  // 故健康在线设备的 admission 真实值也是 'unknown_denied'（该字段语义可疑，前端已不渲染）。
  admission: 'unknown_denied',
};
// 真实 offline 快照：设备未连接，所有读数为 null、质量位全 false。
const offlineHardware = {
  schemaVersion: 1, deviceId: 'hh-hsp101-001', source: 'unknown', simulated: false,
  deviceOnline: false, reason: 'hardware_not_connected', receivedAt: null, sampleAgeMs: null,
  values: { temperatureC: null, humidityPct: null, gasRaw: null, gasMv: null, coPpm: null, co2Ppm: null },
  quality: { temperatureValid: false, humidityValid: false, gasValid: false, coValid: false, co2Valid: false },
  actuationAvailable: false, controlSupported: false, admission: 'unknown_denied',
};
const deviceRow = (gatewayId, hardware) => ({ schemaVersion: 1, gatewayId, mode: 'hardware', simulated: false, hardware });
const obsOf = (hardware) => ({ schemaVersion: 1, gatewayId: 'dayu-a', mode: 'hardware', simulated: false, hardware });

test('devices: renders every registered device with real snapshot fields and count', async t => {
  installDom(t); let now = 100000, tick;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; }); t.mock.method(globalThis, 'clearInterval', () => {});
  let listCalls = 0;
  const ctx = context(t, {
    listDevices: async () => { listCalls++; return { items: [deviceRow('dayu-a', onlineHardware), deviceRow('dayu-b', offlineHardware)] }; },
    getObservations: async () => obsOf(onlineHardware),
  });
  const root = await renderDevices(ctx); await flush();
  // 两台设备都出现，数量来自服务端而非估算
  assert.match(root.textContent, /dayu-a/); assert.match(root.textContent, /dayu-b/);
  assert.match(root.textContent, /共 2 台已登记设备/);
  // 新鲜设备的真实读数与来源被渲染（时钟与 receivedAt 一致，未过 TTL）
  assert.match(root.textContent, /25\.6 ℃/); assert.match(root.textContent, /48\.2 %/);
  assert.match(root.textContent, /DAYU200直采/); assert.match(root.textContent, /未知来源/);
  assert.match(root.textContent, /只读真实采集/); assert.match(root.textContent, /设备未连接/);
  // 当前设备被标记
  assert.ok(find(root, n => n.className === 'row-current'));
  assert.equal(listCalls, 1);
  // 设备静默超过 TTL 后，列表本地老化：旧读数不再显示为可信
  now += 10000; tick();
  assert.doesNotMatch(root.textContent, /25\.6 ℃/);
  assert.match(root.textContent, /遥测过期/);
});

test('devices: null readings and invalid quality bits never become zero', async t => {
  installDom(t);
  t.mock.method(globalThis, 'setInterval', fn => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  const ctx = context(t, {
    listDevices: async () => ({ items: [deviceRow('dayu-a', offlineHardware)] }),
    getObservations: async () => obsOf(offlineHardware),
  });
  const root = await renderDevices(ctx); await flush();
  assert.doesNotMatch(root.textContent, /0\.0 ℃/);
  assert.doesNotMatch(root.textContent, /null/);
  assert.match(root.textContent, /无效/);       // 质量位 false → "无效"
  assert.match(root.textContent, /未知/);       // 缺失数值 → "未知"
  assert.match(root.textContent, /从未接收/);   // receivedAt null
});

test('devices: CO/CO2 stay unconnected and gas stays raw ADC, never a concentration', async t => {
  installDom(t); let now = 100000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  const live = new LiveObservations(() => now);
  live.ingest(obsOf(onlineHardware), now);
  const ctx = context(t, {
    listDevices: async () => ({ items: [deviceRow('dayu-a', onlineHardware)] }),
    getObservations: async () => live.current(),
  }, { live });
  const root = await renderDevices(ctx); await flush();
  assert.match(root.textContent, /传感器未接入，无浓度数据/);
  assert.match(root.textContent, /MQ-2 ADC 原始值，不换算为浓度/);
  assert.match(root.textContent, /812/);   // 原始 ADC 值
  assert.match(root.textContent, /640 mV/);
  assert.doesNotMatch(root.textContent, /ppm/);
});

test('devices: diagnosis panel shows real per-channel ages and readings while fresh', async t => {
  installDom(t); let now = 100000, tick;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; }); t.mock.method(globalThis, 'clearInterval', () => {});
  const live = new LiveObservations(() => now);
  live.ingest(obsOf(onlineHardware), now);
  const ctx = context(t, {
    listDevices: async () => ({ items: [deviceRow('dayu-a', onlineHardware)] }),
    getObservations: async () => live.current(),
  }, { live });
  const root = await renderDevices(ctx); await flush();
  assert.match(root.textContent, /25\.6 ℃/); assert.match(root.textContent, /48\.2 %/);
  assert.match(root.textContent, /1\.5 秒/);  // climateAgeMs 1500
  assert.match(root.textContent, /1\.7 秒/);  // gasAgeMs 1700
  assert.match(root.textContent, /在线/);
  // 超过后端 10 秒时效后本地老化：读数与在线状态一起失效，不残留旧值
  now += 10000; tick();
  assert.match(root.textContent, /离线\/过期/);
  assert.doesNotMatch(root.textContent, /25\.6/);
});

test('devices: empty registration shows an explicit empty state, not invented devices', async t => {
  installDom(t);
  t.mock.method(globalThis, 'setInterval', fn => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  const ctx = context(t, { listDevices: async () => ({ items: [] }), getObservations: async () => obsOf(offlineHardware) });
  const root = await renderDevices(ctx); await flush();
  assert.match(root.textContent, /尚无已登记设备/);
  assert.doesNotMatch(root.textContent, /共 \d+ 台/);
});

test('devices: failure kinds are reported distinctly without fake data', async t => {
  installDom(t);
  t.mock.method(globalThis, 'setInterval', fn => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  const cases = [
    [new ApiError('后端不可达', { kind: 'offline' }), /后端未连接：无法读取设备登记列表/],
    [new ApiError('请求失败（admin_forbidden）', { kind: 'forbidden', status: 403 }), /没有权限或管理会话已失效/],
    [new ApiError('响应格式无效', { kind: 'parse' }), /响应格式无效，未显示任何推测数据/],
  ];
  for (const [error, expected] of cases) {
    const ctx = context(t, { listDevices: async () => { throw error; }, getObservations: async () => { throw error; } });
    const root = await renderDevices(ctx); await flush();
    assert.match(root.textContent, expected);
    assert.doesNotMatch(root.textContent, /dayu-/);
  }
});

test('devices: demo mode reads no real registration and invents no device count', async t => {
  installDom(t); let calls = 0;
  t.mock.method(globalThis, 'setInterval', fn => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  const ctx = context(t, {
    listDevices: async () => { calls++; return { items: [deviceRow('dayu-a', onlineHardware)] }; },
    getObservations: async () => obsOf(onlineHardware),
  }, { demoMode: true });
  const root = await renderDevices(ctx); await flush();
  assert.equal(calls, 0);
  assert.match(root.textContent, /演示模式不读取真实设备登记/);
  assert.equal(button(root, '立即刷新设备列表').disabled, true);
});

test('devices: clicking another row switches the selected gateway and asks the shell to re-render', async t => {
  installDom(t); const navigated = [];
  t.mock.method(globalThis, 'setInterval', fn => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  const ctx = context(t, {
    listDevices: async () => ({ items: [deviceRow('dayu-a', onlineHardware), deviceRow('dayu-b', onlineHardware)] }),
    getObservations: async () => obsOf(onlineHardware),
  }, { navigate: (id) => navigated.push(id) });
  const root = await renderDevices(ctx); await flush();
  const rows = []; (function walk(n) { if (n.dataset?.gatewayId) rows.push(n); n.childNodes.forEach(walk); })(root);
  // 先验证守卫：点击当前已选设备不触发重渲染
  const current = rows.find(r => r.dataset.gatewayId === 'dayu-a');
  await current.click();
  assert.equal(ctx.state.gatewayId, 'dayu-a'); assert.deepEqual(navigated, []);
  // 再验证切换：点击另一台设备更新选中并请求外壳重渲染
  const other = rows.find(r => r.dataset.gatewayId === 'dayu-b');
  assert.ok(other, '应能定位到第二台设备的行');
  await other.click();
  assert.equal(ctx.state.gatewayId, 'dayu-b');
  assert.deepEqual(navigated, ['devices']);
});

test('devices: list refresh is throttled onto the existing poll and stops after dispose', async t => {
  installDom(t); let now = 100000, tick;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; }); t.mock.method(globalThis, 'clearInterval', () => {});
  let listCalls = 0;
  const ctx = context(t, {
    listDevices: async () => { listCalls++; return { items: [deviceRow('dayu-a', onlineHardware)] }; },
    getObservations: async () => obsOf(onlineHardware),
  });
  const root = await renderDevices(ctx); await flush();
  assert.equal(listCalls, 1);
  // 未达刷新间隔：多次节拍不重复拉列表
  for (let i = 0; i < 4; i++) { now += 500; tick(); } await flush();
  assert.equal(listCalls, 1);
  // 达到间隔：恰好再拉一次
  now += LIST_REFRESH_STEP; tick(); await flush();
  assert.equal(listCalls, 2);
  // 卸载后不再拉取
  const before = listCalls; ctx.scope.dispose(); now += LIST_REFRESH_STEP; tick(); await flush();
  assert.equal(listCalls, before);
  assert.doesNotMatch(root.textContent, /null/);
});

test('devices: when the detail read fails, the list still ages out locally and stops after dispose', async t => {
  installDom(t); let now = 100000, tick, cleared = 0, listCalls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => cleared++);
  const ctx = context(t, {
    listDevices: async () => { listCalls++; return { items: [deviceRow('dayu-a', onlineHardware)] }; },
    getObservations: async () => { throw new ApiError('后端不可达', { kind: 'offline' }); },
  });
  const root = await renderDevices(ctx); await flush();
  // 详情面板如实报错，列表仍显示新鲜读数
  assert.match(root.textContent, /后端未连接：无法读取当前设备状态/);
  assert.match(root.textContent, /25\.6 ℃/);
  assert.equal(listCalls, 1);
  // 关键回归：详情失败时 watchHardware 未挂载，列表必须靠自身定时器本地老化，
  // 否则设备静默后列表会一直冻结显示"在线 + 旧读数"。
  now += 10000; tick(); await flush();
  assert.doesNotMatch(root.textContent, /25\.6 ℃/);
  assert.match(root.textContent, /遥测过期/);
  // 详情失败不再关闭整个页面的重试；列表按既定间隔重读。
  assert.equal(listCalls, 2);
  // 卸载后清理定时器且不再变化
  ctx.scope.dispose(); assert.ok(cleared >= 1);
  const before = root.textContent; now += 10000; tick(); await flush();
  assert.equal(root.textContent, before);
  assert.doesNotMatch(root.textContent, /null/);
});

function clockHost(t, start = 100000) {
  installDom(t); let now = start, tick;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  return { advance(ms) { now += ms; tick(); }, now: () => now };
}
function listTable(root) { return find(root, n => n.className === 'device-grid'); }

test('devices: server clock offset does not expire a fresh frame; channel ages expire independently', async t => {
  const clock = clockHost(t, 9000000);
  const hardware = structuredClone(onlineHardware);
  hardware.receivedAt = 1; hardware.climateAgeMs = 9500; hardware.gasAgeMs = 1200;
  const ctx = context(t, {
    listDevices: async () => ({ items: [deviceRow('dayu-a', hardware)] }),
    getObservations: async () => { throw new ApiError('offline', { kind: 'offline' }); },
  });
  const root = await renderDevices(ctx);
  assert.match(listTable(root).textContent, /25\.6/);
  clock.advance(500);
  assert.doesNotMatch(listTable(root).textContent, /25\.6/);
  assert.match(listTable(root).textContent, /812/);
  assert.match(listTable(root).textContent, /在线/);
  clock.advance(8300); await flush();
  assert.doesNotMatch(listTable(root).textContent, /812/);
  assert.match(listTable(root).textContent, /遥测过期/);
});

test('devices: future server timestamp cannot keep a frame online beyond its remaining age', async t => {
  const clock = clockHost(t);
  const hardware = { ...structuredClone(onlineHardware), receivedAt: 9999999999, sampleAgeMs: 9500, climateAgeMs: 9500, gasAgeMs: 9500 };
  const ctx = context(t, { listDevices: async () => ({ items: [deviceRow('dayu-a', hardware)] }),
    getObservations: async () => { throw Error('offline'); } });
  const root = await renderDevices(ctx); clock.advance(500);
  assert.match(listTable(root).textContent, /遥测过期/);
  assert.doesNotMatch(listTable(root).textContent, /25\.6/);
});

test('devices: repeated frame with decreasing ages never renews the channel deadline', async t => {
  const clock = clockHost(t); let calls = 0;
  const ctx = context(t, { listDevices: async () => {
    const hardware = structuredClone(onlineHardware); hardware.climateAgeMs = calls++ ? 0 : 4000;
    return { items: [deviceRow('dayu-a', hardware)] };
  }, getObservations: async () => { throw Error('offline'); } });
  const root = await renderDevices(ctx);
  clock.advance(5000); await flush();
  assert.match(listTable(root).textContent, /25\.6/);
  clock.advance(1000);
  assert.doesNotMatch(listTable(root).textContent, /25\.6/);
  assert.match(listTable(root).textContent, /812/);
});

test('devices: invalid gas quality never renders finite raw values', async t => {
  clockHost(t);
  const hardware = structuredClone(onlineHardware); hardware.quality.gasValid = false;
  const ctx = context(t, { listDevices: async () => ({ items: [deviceRow('dayu-a', hardware)] }), getObservations: async () => obsOf(hardware) });
  const root = await renderDevices(ctx);
  assert.doesNotMatch(root.textContent, /812|640 mV/);
});

test('devices: malformed, duplicate or invalid device lists are protocol errors, not empty registration', async t => {
  clockHost(t);
  for (const response of [{}, { items: null }, { items: [deviceRow('dayu-a', {})] },
    { items: [deviceRow('dayu-a', onlineHardware), deviceRow('dayu-a', onlineHardware)] }]) {
    const ctx = context(t, { listDevices: async () => response, getObservations: async () => { throw Error('offline'); } });
    const root = await renderDevices(ctx);
    assert.match(root.textContent, /设备登记列表响应格式无效/);
    assert.doesNotMatch(root.textContent, /尚无已登记设备/);
    ctx.scope.dispose();
  }
});

test('devices: initial failures recover automatically and update the device identity', async t => {
  const clock = clockHost(t); let reads = 0, lists = 0;
  const live = new LiveObservations(clock.now);
  const ctx = context(t, { listDevices: async () => {
    if (++lists === 1) throw Error('offline');
    return { items: [deviceRow('dayu-a', onlineHardware)] };
  }, getObservations: async () => {
    if (++reads === 1) throw new ApiError('offline', { kind: 'offline' });
    return live.ingest(obsOf(onlineHardware), clock.now());
  } }, { live });
  const root = await renderDevices(ctx);
  assert.match(root.textContent, /后端未连接：无法读取当前设备状态/);
  clock.advance(2000); await flush();
  assert.doesNotMatch(root.textContent, /后端未连接：无法读取当前设备状态/);
  assert.match(root.textContent, /hh-hsp101-001/);
  assert.match(root.textContent, /25\.6/);
  clock.advance(3000); await flush();
  assert.equal(lists, 2); assert.ok(listTable(root));
  ctx.scope.dispose(); const before = reads; clock.advance(10000); await flush(); assert.equal(reads, before);
});

test('devices: list response latency counts toward expiry', async t => {
  const clock = clockHost(t); const pending = deferred();
  const ctx = context(t, { listDevices: () => pending.promise, getObservations: async () => { throw Error('offline'); } });
  const rendering = renderDevices(ctx);
  // No interval yet: move the request clock without invoking a timer.
  t.mock.method(Date, 'now', () => 110000);
  pending.resolve({ items: [deviceRow('dayu-a', onlineHardware)] });
  const root = await rendering;
  assert.match(listTable(root).textContent, /遥测过期/);
  assert.doesNotMatch(listTable(root).textContent, /25\.6/);
});
