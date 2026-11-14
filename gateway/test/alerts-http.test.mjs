// 告警中心 HTTP 集成回归（ALERT-CENTER-20261103，执行者 alert-gateway）。
// 覆盖：401/403、CSRF/Origin、设备隔离、真实采集帧触发生产者钩子、GET 同步派生、
//       游标分页、确认/备注幂等与版本冲突、错误码 507/503/409/404 状态映射。
// 复用 cloud-server 真实鉴权栈（Cookie/scrypt/CSRF/角色），不 mock 安全层。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startCloudServer} from '../cloud-server.mjs';
import {CloudSecurity} from '../cloud-security.mjs';

// 测试专用一次性口令/设备令牌，非真实凭据；不写入日志或交接。
const PASSWORD = 'test-only-alert-login-12345';
const deviceToken = gatewayId => 'test-only-alert-device-' + gatewayId + '-padding';
const sha256 = value => createHash('sha256').update(value).digest('hex');

// 一台 HH-HSP101 的正常帧；patch 覆盖单个字段即可构造故障。
let uptime = 1_000;
const frame = (patch = {}) => ({
  schemaVersion: 1, deviceId: 'hh-hsp101-001', simulated: false, controlSupported: false,
  coValid: false, co2Valid: false, coPpm: null, co2Ppm: null,
  uptime_ms: (uptime += 10), th_ok: true, gas_ok: true, th_sample_age_ms: 500, gas_sample_age_ms: 500,
  temperature10: 251, humidity10: 600, gas_raw: 1_200, gas_mv: 900, ...patch,
});

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pengan-alert-http-'));
  const passwordHash = await CloudSecurity.hashPassword(PASSWORD);
  const options = {
    dataDir: dir,
    publicOrigin: 'http://127.0.0.1:0',
    users: [{username: 'admin', role: 'admin', passwordHash}, {username: 'reader', role: 'viewer', passwordHash}],
    devices: ['dayu-a', 'dayu-b'].map(gatewayId => ({gatewayId, tokenSha256: sha256(deviceToken(gatewayId))})),
    fetchFn: async () => { throw Error('no_real_model'); },
  };
  let runtime;
  const start = async () => { runtime = await startCloudServer(options); };
  await start();
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });

  async function request(route, {body, headers = {}, method, skipCsrf = false} = {}) {
    const final = {origin: runtime.publicOrigin, 'content-type': 'application/json', ...headers};
    if (skipCsrf) delete final['x-pengan-csrf'];
    return fetch(runtime.publicOrigin + route, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: final,
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
  }
  async function login(name = 'admin') {
    const response = await request('/admin-api/session/login', {body: {username: name, password: PASSWORD}});
    assert.equal(response.status, 200);
    const data = await response.json();
    return {cookie: response.headers.get('set-cookie').split(';')[0], 'x-pengan-csrf': data.csrfToken};
  }
  // 真实设备上报：Origin 必须缺省（设备面拒绝浏览器来源），令牌走 Bearer。
  async function telemetry(gatewayId = 'dayu-a', patch = {}, sessionBootId = 'boot-http-1') {
    const response = await fetch(runtime.publicOrigin + '/api/v1/telemetry/current', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: 'Bearer ' + deviceToken(gatewayId),
        'x-pengan-gateway-id': gatewayId, 'x-pengan-sent-at': String(Date.now()),
      },
      body: JSON.stringify({schemaVersion: 1, gatewayId, sessionBootId, sampleAgeMs: 1_000, frame: frame(patch)}),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  // 直接以真实 AlertCenter 落一条告警（等价 human-review 测试的 seedTask 造数）。
  async function seedAlert({gatewayId = 'dayu-a', device}) {
    await runtime.alertCenter.reconcile({gatewayId, inputs: {devices: [device], tasks: []}, actor: 'seed'});
  }
  const device = ({ageMs = 1_000, online = true, reason = 'read_only_hardware', quality = {}} = {}) => {
    const now = Date.now();
    return {gatewayId: 'dayu-a', hasSession: true, lastAcceptedAt: now - ageMs,
      snapshot: {deviceOnline: online, reason, receivedAt: now - ageMs, quality: {temperatureValid: true, humidityValid: true, gasValid: true, ...quality}}};
  };
  const alertRows = async () => (await runtime.history.query({kind: 'audit', limit: 200})).items.filter(row => row.data?.event === 'alert_state' && row.data?.scope === 'alert');
  return {request, login, telemetry, seedAlert, device, alertRows, start, runtime: () => runtime,
    restart: async () => { await runtime.close(); await start(); }};
}

test('未认证读取告警列表返回 401', async t => {
  const h = await fixture(t);
  assert.equal((await h.request('/admin-api/alerts?gatewayId=dayu-a')).status, 401);
});

test('viewer 可读列表与详情，但确认/备注被 403 拒绝', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: h.device({ageMs: 20_000})});
  const reader = await h.login('reader');
  const list = await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: reader});
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].type, 'telemetry_stale');
  assert.equal((await h.request('/admin-api/alerts/' + data.items[0].alertId + '?gatewayId=dayu-a', {headers: reader})).status, 200);
  const ack = await h.request('/admin-api/alerts/' + data.items[0].alertId + '/ack?gatewayId=dayu-a', {body: {expectedRevision: 1}, headers: reader});
  assert.equal(ack.status, 403);
  assert.equal((await ack.json()).error, 'admin_forbidden');
  const note = await h.request('/admin-api/alerts/' + data.items[0].alertId + '/note?gatewayId=dayu-a', {body: {expectedRevision: 1, text: '现场已核查'}, headers: reader});
  assert.equal(note.status, 403);
});

test('缺少 CSRF 的写请求被拒绝，Origin 不匹配同样被拒绝', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: h.device({ageMs: 20_000})});
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  const url = '/admin-api/alerts/' + list.items[0].alertId + '/ack?gatewayId=dayu-a';
  const noCsrf = await h.request(url, {body: {expectedRevision: 1}, headers: admin, skipCsrf: true});
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).error, 'csrf_required');
  const badOrigin = await h.request(url, {body: {expectedRevision: 1}, headers: {...admin, origin: 'http://evil.example'}});
  assert.equal(badOrigin.status, 403);
  assert.equal((await badOrigin.json()).error, 'origin_denied');
});

test('真实采集帧触发生产者钩子：gas 通道失效立即产生告警', async t => {
  const h = await fixture(t);
  const result = await h.telemetry('dayu-a', {gas_ok: false});
  assert.equal(result.accepted, true);
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].type, 'sensor_channel_invalid');
  assert.equal(list.items[0].subject, 'gas');
  assert.equal(list.items[0].severity, 'medium');
  assert.equal(list.items[0].state, 'open');
  assert.equal(list.items[0].executed, false);
  assert.equal(list.items[0].hardwareControl, false);
  assert.equal(list.source.connected, true);
  assert.equal(list.counts.open, 1);
  assert.equal(list.countBasis.all, '该设备全部告警（含已恢复）');
  assert.equal((await h.alertRows()).length, 1);
});

test('无任何上报的设备不产生告警', async t => {
  const h = await fixture(t);
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-b', {headers: admin})).json();
  assert.deepEqual(list.items, []);
  assert.equal(list.counts.all, 0);
  assert.equal(list.source.connected, false);
  assert.equal((await h.alertRows()).length, 0);
});

test('GET 同步派生离线告警，且重复读取不累加 occurrences', async t => {
  const h = await fixture(t);
  await h.telemetry('dayu-a');
  const state = h.runtime().ingresses.get('dayu-a').state;
  Object.assign(state, {acceptedAt: Date.now() - 70_000, receivedAt: Date.now() - 70_000});
  const admin = await h.login();
  const first = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  assert.deepEqual(first.items.map(item => item.type), ['device_offline']);
  assert.equal(first.items[0].occurrences, 1);
  assert.equal(first.items[0].revision, 1);
  assert.equal(first.counts.open, 1);
  const second = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  assert.equal(second.items[0].occurrences, 1, 'GET 派生只做状态迁移，不得累加 occurrences');
  assert.equal(second.items[0].revision, 1, 'GET 派生不得推进 revision');
  assert.equal((await h.alertRows()).length, 1);
});

test('确认只追加 acks 并 revision+1，精确重试返回 duplicate 且不再改版本', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: h.device({ageMs: 20_000})});
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  const alertId = list.items[0].alertId;
  const url = '/admin-api/alerts/' + alertId + '/ack?gatewayId=dayu-a';
  const ack = await h.request(url, {body: {expectedRevision: 1, note: '已通知运维'}, headers: admin});
  assert.equal(ack.status, 200);
  const body = await ack.json();
  assert.equal(body.duplicate, false);
  assert.equal(body.executed, false);
  assert.equal(body.hardwareControl, false);
  assert.equal(body.alert.state, 'acknowledged');
  assert.equal(body.alert.acknowledged, true);
  assert.equal(body.alert.revision, 2);
  assert.equal(body.alert.acks.length, 1);
  assert.equal(body.alert.acks[0].note, '已通知运维');
  const retry = await (await h.request(url, {body: {expectedRevision: 1, note: '已通知运维'}, headers: admin})).json();
  assert.equal(retry.duplicate, true);
  assert.equal(retry.alert.revision, 2);
  assert.equal(retry.alert.acks.length, 1);
  const conflict = await h.request(url, {body: {expectedRevision: 99}, headers: admin});
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'alert_revision_conflict');
});

test('备注只追加 notes，不改变是否仍在发生', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: h.device({ageMs: 20_000})});
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  const alertId = list.items[0].alertId;
  const note = await h.request('/admin-api/alerts/' + alertId + '/note?gatewayId=dayu-a', {body: {expectedRevision: 1, text: '现场复核中'}, headers: admin});
  assert.equal(note.status, 200);
  const body = await note.json();
  assert.equal(body.alert.state, 'open');
  assert.equal(body.alert.acknowledged, false);
  assert.equal(body.alert.notes.length, 1);
  assert.equal(body.alert.notes[0].text, '现场复核中');
  assert.equal(body.alert.revision, 2);
  const invalid = await h.request('/admin-api/alerts/' + alertId + '/note?gatewayId=dayu-a', {body: {expectedRevision: 2, text: ''}, headers: admin});
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_alert_note');
});

test('设备隔离：跨设备读取与写入一律 404，不泄露存在性', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: h.device({ageMs: 20_000})});
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  const alertId = list.items[0].alertId;
  const detail = await h.request('/admin-api/alerts/' + alertId + '?gatewayId=dayu-b', {headers: admin});
  assert.equal(detail.status, 404);
  assert.equal((await detail.json()).error, 'alert_not_found');
  const ack = await h.request('/admin-api/alerts/' + alertId + '/ack?gatewayId=dayu-b', {body: {expectedRevision: 1}, headers: admin});
  assert.equal(ack.status, 404);
  assert.equal((await h.request('/admin-api/alerts/' + alertId + '?gatewayId=dayu-b', {headers: admin})).status, 404);
});

test('游标分页按 s<seq> 推进，两页不重叠', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: {...h.device({ageMs: 20_000}), gatewayId: 'dayu-a'}});
  await h.seedAlert({device: {...h.device({ageMs: 80_000, online: false, reason: 'telemetry_stale'}), gatewayId: 'dayu-a'}});
  await h.seedAlert({device: {...h.device({ageMs: 1_000, reason: 'hardware_read_failed'}), gatewayId: 'dayu-a'}});
  await h.seedAlert({device: h.device({ageMs: 1_000, quality: {gasValid: false}})});
  const admin = await h.login();
  const first = await (await h.request('/admin-api/alerts?gatewayId=dayu-a&limit=2', {headers: admin})).json();
  assert.equal(first.items.length, 2);
  assert.equal(first.truncated, true);
  assert.match(first.nextCursor, /^s\d{1,16}$/);
  assert.equal(first.counts.all, 4);
  const second = await (await h.request('/admin-api/alerts?gatewayId=dayu-a&limit=2&cursor=' + first.nextCursor, {headers: admin})).json();
  assert.equal(second.items.length, 2);
  assert.equal(second.truncated, false);
  assert.equal(second.nextCursor, null);
  const ids = new Set([...first.items, ...second.items].map(item => item.alertId));
  assert.equal(ids.size, 4);
  const filtered = await (await h.request('/admin-api/alerts?gatewayId=dayu-a&severity=high', {headers: admin})).json();
  assert.deepEqual(filtered.items.map(item => item.type).sort(), ['device_offline', 'telemetry_stale']);
  assert.equal(filtered.counts.high ?? filtered.counts.bySeverity.high, 2);
  const bad = await h.request('/admin-api/alerts?gatewayId=dayu-a&limit=0', {headers: admin});
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_alert_query');
});

test('重启后告警与 revision 从哈希链重放恢复，重放版本可直接用于确认', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: h.device({ageMs: 20_000})});
  let admin = await h.login();
  let list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  const alertId = list.items[0].alertId;
  assert.equal(list.items[0].revision, 1);
  await h.restart();
  admin = await h.login();
  list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].alertId, alertId);
  assert.equal(list.items[0].revision, 1);
  const ack = await h.request('/admin-api/alerts/' + alertId + '/ack?gatewayId=dayu-a', {body: {expectedRevision: 1}, headers: admin});
  assert.equal(ack.status, 200);
  assert.equal((await ack.json()).alert.revision, 2);
});

test('写失败如实返回 503/507，响应不含 saved 且旧记录保留', async t => {
  const h = await fixture(t);
  await h.seedAlert({device: h.device({ageMs: 20_000})});
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  const alertId = list.items[0].alertId;
  const before = (await h.alertRows()).length;
  const paths = [['alert_persist_failed', 503, 'ack'], ['alert_event_limit', 507, 'ack'], ['alert_store_full', 507, 'note']];
  for (const [code, status, action] of paths) {
    const center = h.runtime().alertCenter;
    const original = center.submit;
    center.submit = async () => { throw Error(code); };
    const response = await h.request('/admin-api/alerts/' + alertId + '/' + action + '?gatewayId=dayu-a', {body: action === 'ack' ? {expectedRevision: 1} : {expectedRevision: 1, text: '写失败验证'}, headers: admin});
    center.submit = original;
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error, code);
    assert.equal('saved' in body, false);
    assert.equal(body.alert, undefined);
    assert.equal((await h.alertRows()).length, before, '写失败不得产生新记录');
    const detail = await (await h.request('/admin-api/alerts/' + alertId + '?gatewayId=dayu-a', {headers: admin})).json();
    assert.equal(detail.revision, 1, '写失败后旧记录版本不变');
    assert.equal(detail.acks.length, 0);
  }
});

test('读路径派生失败如实报错，不返回空列表冒充正常', async t => {
  const h = await fixture(t);
  await h.telemetry('dayu-a');
  const admin = await h.login();
  const center = h.runtime().alertCenter;
  const original = center.reconcile;
  center.reconcile = async () => { throw Error('alert_persist_failed'); };
  const response = await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin});
  center.reconcile = original;
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'alert_persist_failed');
  assert.equal(body.items, undefined);
});

test('列表派生失败记录进入 source.lastReconcileError 且只含错误码', async t => {
  const h = await fixture(t);
  await h.telemetry('dayu-a');
  h.runtime().alertCenter.recordReconcileFailure(Error('alert_persist_failed'));
  const admin = await h.login();
  const list = await (await h.request('/admin-api/alerts?gatewayId=dayu-a', {headers: admin})).json();
  assert.equal(list.source.lastReconcileError, 'alert_persist_failed');
  assert.equal(list.source.evaluation, 'derived-on-read');
  assert.equal(typeof list.source.lastAcceptedAt, 'number');
});
