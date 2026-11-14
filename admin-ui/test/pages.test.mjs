import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, button, input, flush } from './helpers/dom.mjs';
import renderModel from '../src/pages/model.js';
import renderRecords from '../src/pages/records.js';
import renderOverview from '../src/pages/overview.js';
import renderDevices from '../src/pages/devices.js';
import renderSystem from '../src/pages/system.js';
import { PageScope, MutationGate } from '../src/lib/session.js';
import { LiveObservations } from '../src/lib/freshness.js';
import { demoObservations, DEMO } from '../src/demo.js';

function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function context(t, dataSource, extra = {}) {
  const scope = new PageScope(); t.after(() => scope.dispose());
  return { scope, gate: new MutationGate(), state: {}, dataSource, demoMode: false, live: new LiveObservations(), markStatus() {}, setConnection() {}, notify() {}, ...extra };
}
const config = { provider: 'deepseek', model: 'deepseek-chat', keySaved: true, configured: true, csrfToken: 'test-only' };
const modelSource = extra => ({ getModelConfig: async () => ({ ...config }), getModelStatus: async () => ({ ...config }), ...extra });

test('model page: actual clear click ignores dirty fields, clears typed key and serializes', async t => {
  installDom(t); const pending = deferred(), calls = [];
  const ctx = context(t, modelSource({ saveModelConfig: (...args) => { calls.push(args); return pending.promise; } }));
  const root = await renderModel(ctx);
  input(root, 'f-provider').value = 'qwen'; input(root, 'f-model').value = 'dirty'; input(root, 'f-key').value = 'test-only-unsent';
  const action = button(root, '清除密钥').click();
  assert.equal(input(root, 'f-key').value, ''); assert.equal(button(root, '保存配置').disabled, true);
  await button(root, '保存配置').click(); assert.equal(calls.length, 1);
  pending.resolve({ configured: false, keySaved: false }); await action;
  assert.deepEqual(calls[0][0], { provider: 'deepseek', model: 'deepseek-chat', clearKey: true });
  assert.match(root.textContent, /服务器已确认清除密钥/);
});

test('model page: demo controls disabled and disposal clears a typed key', async t => {
  installDom(t); let calls = 0;
  const root = await renderModel(context(t, modelSource({ saveModelConfig: () => calls++ }), { demoMode: true }));
  for (const label of ['保存配置', '清除密钥', '手动连接测试']) { assert.equal(button(root, label).disabled, true); await button(root, label).click(); }
  assert.equal(calls, 0);
  const ctx = context(t, modelSource()); const real = await renderModel(ctx);
  input(real, 'f-key').value = 'test-only-unsent'; ctx.scope.dispose(); assert.equal(input(real, 'f-key').value, '');
});

test('model page: lost write does not show success and disables further writes pending refresh', async t => {
  installDom(t);
  const root = await renderModel(context(t, modelSource({ saveModelConfig: async () => { throw Error('transport failed'); } })));
  await button(root, '保存配置').click();
  assert.match(root.textContent, /操作未确认/); assert.doesNotMatch(root.textContent, /服务器已确认保存/);
  assert.equal(button(root, '保存配置').disabled, true);
  await button(root, '刷新配置').click(); assert.equal(button(root, '保存配置').disabled, false);
});

test('records page: late hardware result cannot append to AI tab or disposed page', async t => {
  installDom(t); const pending = deferred();
  const ctx = context(t, { getHardwareHistory: () => pending.promise, getAnalysisHistory: async () => ({ items: [] }) });
  const root = await renderRecords(ctx);
  await button(root, 'AI 分析历史').click(); await flush();
  pending.resolve({ items: [], storage: {} }); await flush();
  assert.match(root.textContent, /AI 文字分析历史/); assert.doesNotMatch(root.textContent, /真实采集历史/);
  const later = deferred(), ctx2 = context(t, { getHardwareHistory: () => later.promise });
  const disposed = await renderRecords(ctx2); ctx2.scope.dispose(); later.resolve({ items: [] }); await flush();
  assert.doesNotMatch(disposed.textContent, /真实采集历史/);
});

test('overview: visible readings and navigation age out without receiving another response', async t => {
  installDom(t); let now = 100000; t.mock.method(Date, 'now', () => now);
  const obs = demoObservations(now); obs.hardware.source = 'http'; obs.hardware.receivedAt = now; obs.hardware.sampleAgeMs = 0;
  let tick; t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; }); t.mock.method(globalThis, 'clearInterval', () => {});
  const live = new LiveObservations(() => now); live.ingest(obs, now);
  const hanging = deferred(); let calls = 0, marks = 0;
  const ctx = context(t, { getHealth: async () => ({ mode: 'hardware' }), getObservations: () => ++calls === 1 ? Promise.resolve(live.current()) : hanging.promise,
    getModelStatus: async () => DEMO.modelStatus(), getHardwareHistory: async () => ({ items: [] }) }, { live, markStatus: () => marks++ });
  const root = await renderOverview(ctx); await flush(); assert.match(root.textContent, /25.6/); assert.equal(ctx.state.hardwareOnline, true);
  now += 10000; tick(); assert.doesNotMatch(root.textContent, /25.6/); assert.equal(ctx.state.hardwareOnline, false); assert.ok(marks >= 2);
  const before = root.textContent; ctx.scope.dispose(); hanging.resolve(obs); await flush(); assert.equal(root.textContent, before);
});

for (const [name, render] of [['devices', renderDevices], ['system', renderSystem]]) test(`${name}: expiry updates status during a blocked read, then dispose stops polling`, async t => {
  installDom(t); let now = 100000, tick, cleared = 0, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => cleared++);
  const live = new LiveObservations(() => now), obs = demoObservations(now); obs.hardware.source = 'http'; obs.hardware.receivedAt = now; obs.hardware.sampleAgeMs = 0;
  live.ingest(obs, now); const hanging = deferred();
  const ctx = context(t, { getObservations: () => ++calls === 1 ? Promise.resolve(live.current()) : hanging.promise,
    getHealth: async () => ({ ok: true, mode: 'hardware' }), getAnalysisHistory: async () => ({ items: [] }) }, { live });
  const root = await render(ctx); assert.equal(ctx.state.hardwareOnline, true);
  now += 10000; tick(); assert.equal(ctx.state.hardwareOnline, false); assert.match(root.textContent, /离线\/过期/);
  tick(); assert.equal(calls, 2); // no overlap while transport is pending
  const before = root.textContent; ctx.scope.dispose(); assert.equal(cleared, 1);
  hanging.resolve(obs); await flush(); tick(); assert.equal(calls, 2); assert.equal(root.textContent, before);
});

test('overview offline render does not leak a null placeholder', async t => {
  installDom(t); let tick;
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; }); t.mock.method(globalThis, 'clearInterval', () => {});
  const failed = async () => { throw Error('unavailable'); };
  const root = await renderOverview(context(t, { getHealth: failed, getObservations: failed, getModelStatus: failed, getHardwareHistory: failed }));
  await flush(); assert.doesNotMatch(root.textContent, /null/); assert.match(root.textContent, /后端未连接/);
});
