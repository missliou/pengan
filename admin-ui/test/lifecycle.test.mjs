import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageScope, MutationGate } from '../src/lib/session.js';
import { LiveObservations } from '../src/lib/freshness.js';
import { createDataSource } from '../src/lib/data-source.js';
import { ModelEditor } from '../src/lib/model-editor.js';
import { hspSnapshot } from '../../gateway/hsp-telemetry.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function observation(age = 0, climate = 0, gas = 0, receivedAt = 100000) {
  const hardware = hspSnapshot({ transport: 'http', receivedAt, frame: {
    schemaVersion: 1, deviceId: 'hh-hsp101-001', simulated: false, controlSupported: false,
    coValid: false, co2Valid: false, coPpm: null, co2Ppm: null,
    uptime_ms: 100, th_ok: true, gas_ok: true, temperature10: 256, humidity10: 638,
    gas_raw: 1234, gas_mv: 3210, th_sample_age_ms: climate, gas_sample_age_ms: gas,
  } }, receivedAt + age);
  return { schemaVersion: 1, mode: 'hardware', simulated: false, hardware };
}
function source(api, extra = {}) {
  return createDataSource({ scope: new PageScope(), gate: new MutationGate(), live: new LiveObservations(), api, ...extra });
}

test('current readings expire at 10000ms, retain source, and snapshots are independent', () => {
  let now = 0; const live = new LiveObservations(() => now);
  live.ingest(observation(), now); now = 9999;
  assert.equal(live.current().hardware.values.temperatureC, 25.6);
  const copy = live.current(); copy.hardware.values.temperatureC = 999;
  assert.equal(live.current().hardware.values.temperatureC, 25.6);
  now = 10000; const h = live.current().hardware;
  assert.equal(h.deviceOnline, false); assert.equal(h.reason, 'telemetry_stale');
  assert.equal(h.source, 'http'); assert.ok(Object.values(h.values).every(x => x === null));
  assert.ok(Object.values(h.quality).every(x => x === false));
});

test('request duration and channel sample ages count toward expiry', () => {
  let now = 2999; const live = new LiveObservations(() => now);
  const result = live.ingest(observation(0, 7000, 7001), 0).hardware;
  assert.equal(result.quality.temperatureValid, true); assert.equal(result.quality.gasValid, false);
  now++; assert.equal(live.current().hardware.quality.temperatureValid, false);
  assert.equal(live.current().hardware.deviceOnline, true);
});

test('repeated receivedAt cannot renew the initial receive or channel expiry', () => {
  let now = 0; const live = new LiveObservations(() => now);
  live.ingest(observation(8000, 1000, 0), now);
  now = 1000; live.ingest(observation(), now); // frozen frame with regressed server ages
  assert.equal(live.current().hardware.quality.temperatureValid, false);
  assert.equal(live.current().hardware.deviceOnline, true);
  now = 2000; assert.equal(live.current().hardware.deviceOnline, false);
});

test('failed reads do not renew a repeated frame; new frame can recover', () => {
  let now = 0; const live = new LiveObservations(() => now);
  live.ingest(observation(), 0); now = 9000; live.invalidate(); assert.equal(live.current(), null);
  live.ingest(observation(), now); now = 10000;
  assert.equal(live.current().hardware.deviceOnline, false);
  live.ingest(observation(0, 0, 0, 100001), now);
  assert.equal(live.current().hardware.deviceOnline, true);
  now = 9999; assert.equal(live.current().hardware.reason, 'invalid_receive_time');
});

test('invalid protocols/ranges never enter the current-data cache', () => {
  for (const change of [d => d.simulated = true, d => d.hardware.source = 'demo',
    d => d.hardware.values.temperatureC = 100, d => d.hardware.quality.coValid = true,
    d => d.hardware.climateAgeMs = null, d => d.hardware.sampleAgeMs = -1]) {
    const live = new LiveObservations(() => 0), data = observation(); change(data);
    assert.throws(() => live.ingest(data, 0)); assert.equal(live.current(), null);
  }
  const live = new LiveObservations(() => 0), data = observation();
  data.hardware.deviceOnline = false; data.hardware.reason = 'hardware_not_connected';
  const h = live.ingest(data, 0).hardware;
  assert.equal(h.reason, 'hardware_not_connected'); assert.ok(Object.values(h.values).every(x => x === null));
});

test('demo mode reads only samples and forbids all real writes and admin queries', async () => {
  let calls = 0; const api = new Proxy({}, { get: () => () => { calls++; throw Error('unexpected real API'); } });
  const ds = source(api, { demoMode: true });
  const values = await Promise.all([ds.getHealth(), ds.getObservations(), ds.getModelStatus(), ds.getModelConfig(), ds.getHardwareHistory(), ds.getAnalysisHistory()]);
  assert.equal(values[0]._demo, true); assert.equal(values[3].csrfToken, '');
  for (const action of [() => ds.saveModelConfig({}, 'token'), () => ds.testModelConnection(), () => ds.getRealReport(), () => ds.listDevices(), () => ds.getAuditEvents()])
    await assert.rejects(action(), e => e.kind === 'demo_read_only');
  assert.equal(calls, 0);
});

test('scope disposal aborts reads, rejects late completions and prevents new requests', async () => {
  const pending = deferred(), scope = new PageScope(); let calls = 0, signal;
  const ds = source({ getHealth(options) { calls++; signal = options.signal; return pending.promise; } }, { scope });
  const request = ds.getHealth(); scope.dispose(); assert.equal(signal.aborted, true);
  pending.resolve({ ok: true }); await assert.rejects(request, e => e.kind === 'stale');
  await assert.rejects(ds.getHealth(), e => e.kind === 'stale'); assert.equal(calls, 1);
  let disposed = 0; scope.onDispose(() => disposed++); scope.dispose(); assert.equal(disposed, 1);
});

test('write gate persists across navigation until physical request settles', async () => {
  const pending = deferred(), gate = new MutationGate(), scope = new PageScope(); let calls = 0;
  const api = { saveModelConfig: () => { calls++; return pending.promise; }, testModelConnection: () => { calls++; return {}; } };
  const oldPage = source(api, { gate, scope }), newPage = source(api, { gate });
  const request = oldPage.saveModelConfig({}, 'token'); scope.dispose();
  await assert.rejects(newPage.testModelConnection(), e => e.kind === 'busy'); assert.equal(calls, 1);
  pending.resolve({ configured: true }); await assert.rejects(request, e => e.kind === 'stale');
  assert.equal(gate.busy, false); await newPage.testModelConnection(); assert.equal(calls, 2);
});

function modelHarness(extra = {}) {
  const calls = [];
  const config = { provider: 'deepseek', model: 'deepseek-chat', keySaved: true, configured: true, csrfToken: 'test-csrf' };
  const dataSource = {
    getModelConfig: async () => ({ ...config }), getModelStatus: async () => ({ ...config }),
    saveModelConfig: async (...args) => { calls.push(args); return { configured: false, keySaved: false }; },
    ...extra,
  };
  return { calls, config, dataSource, editor: new ModelEditor({ scope: new PageScope(), dataSource }) };
}

test('clear key uses saved configuration even with an unsaved provider/model draft', async () => {
  const { editor, calls } = modelHarness(); await editor.load();
  const result = await editor.perform('clear', { provider: 'qwen', model: 'dirty', key: 'unsent' });
  assert.deepEqual(calls, [[{ provider: 'deepseek', model: 'deepseek-chat', clearKey: true }, 'test-csrf']]);
  assert.equal(result.refreshed, true);
});

test('provider changes require a new key; failed validation sends nothing', async () => {
  const { editor, calls } = modelHarness(); await editor.load();
  await assert.rejects(editor.perform('save', { provider: 'qwen', model: 'qwen-plus' }), /密钥/);
  assert.equal(calls.length, 0); assert.equal(editor.busy, false);
});

test('save supports retained same-provider key and treats failed reload as unconfirmed state', async () => {
  const { editor, calls, dataSource } = modelHarness(); await editor.load();
  dataSource.getModelConfig = async () => { throw Error('read failed'); };
  const result = await editor.perform('save', { provider: 'deepseek', model: 'deepseek-reasoner', key: '' });
  assert.deepEqual(calls[0][0], { provider: 'deepseek', model: 'deepseek-reasoner' });
  assert.equal(result.refreshed, false); assert.equal(editor.config, null);
});

test('transport failures and malformed success cannot appear as successful save/test', async () => {
  for (const run of [
    { saveModelConfig: async () => { throw Error('lost response'); } },
    { saveModelConfig: async () => ({ ok: true }) },
  ]) {
    const { editor } = modelHarness(run); await editor.load();
    await assert.rejects(editor.perform('clear')); assert.equal(editor.config, null); assert.equal(editor.status, null);
  }
  const { editor } = modelHarness({ testModelConnection: async () => ({ ok: true }) }); await editor.load();
  await assert.rejects(editor.perform('test'), /未确认/);
});

test('synthetic model proof is required and duplicate operations are not sent', async () => {
  const pending = deferred(); let calls = 0;
  const { editor } = modelHarness({ testModelConnection: () => { calls++; return pending.promise; } });
  await editor.load(); const request = editor.perform('test');
  await assert.rejects(editor.perform('test'), /进行中/);
  pending.resolve({ kind: 'model_connection_check', ok: true, provider: 'deepseek', model: 'deepseek-chat', checkedAt: 1000, roundTripMs: 2, fieldDataSent: false, imageSent: false, executed: false });
  assert.equal((await request).refreshed, true); assert.equal(calls, 1);
});
