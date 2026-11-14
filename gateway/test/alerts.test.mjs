// 告警中心回归（ALERT-CENTER-20261103，执行者 alert-gateway）。
// 覆盖：派生五类规则与 10s/60s 边界、未连接不产告警、同键合并、恢复后再发新建、
//       确认≠恢复、备注只追加、revision 冲突、精确重试幂等、重启重放、
//       容量与事件上限、写失败、列表筛选/游标/计数、设备隔离、非法入参。
// 使用真实 CloudHistory（哈希链 + 原子落盘），不 mock 持久化。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CloudHistory} from '../cloud-history.mjs';
import {AlertCenter, deriveFaults, ALERT_MERGE_WRITE_INTERVAL_MS} from '../alerts.mjs';

const NOW = 1_000_000;

// 一帧新鲜且设备在线的正常快照；各用例只覆盖自己关心的字段。
const device = (over = {}) => ({
  gatewayId: 'dayu-a',
  hasSession: true,
  lastAcceptedAt: NOW - 1_000,
  snapshot: {
    deviceOnline: true,
    reason: 'read_only_hardware',
    receivedAt: over.lastAcceptedAt ?? NOW - 1_000,
    sampleAgeMs: 1_000,
    quality: {temperatureValid: true, humidityValid: true, gasValid: true},
  },
  ...over,
});
const inputs = ({devices = [device()], tasks = []} = {}) => ({devices, tasks});
const types = faults => faults.map(f => f.type + ':' + f.subject).sort();

async function env({now = () => NOW, capacity, eventLimit, mergeWindowMs} = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pengan-alerts-'));
  const history = await new CloudHistory({file: path.join(dir, 'history.jsonl')}).open();
  const center = await new AlertCenter({history, now, capacity, eventLimit, mergeWindowMs}).open();
  const alertRows = () => history.rows.filter(row => row.kind === 'audit' && row.data?.event === 'alert_state');
  return {
    dir, history, center, alertRows,
    // 模拟服务重启：丢弃内存态，只从同一保留文件重建。
    async restart() {
      await history.flush();
      const reopened = await new CloudHistory({file: path.join(dir, 'history.jsonl')}).open();
      return {history: reopened, center: await new AlertCenter({history: reopened, now, capacity, eventLimit, mergeWindowMs}).open()};
    },
    async close() { await rm(dir, {recursive: true, force: true}); },
  };
}

// ---------- 派生规则（纯函数） ----------

test('规则1：从未收到数据（hasSession=false）不产生任何告警', () => {
  const faults = deriveFaults(inputs({devices: [device({hasSession: false, lastAcceptedAt: NOW - 300_000, snapshot: {deviceOnline: false, reason: 'invalid_hsp_sample', quality: {}}})]}), NOW);
  assert.deepEqual(faults, []);
});

test('规则2：10s/60s 边界——<10s 无告警，[10s,60s) 只出 stale，≥60s 只出 offline', () => {
  const at = age => deriveFaults(inputs({devices: [device({lastAcceptedAt: NOW - age})]}), NOW);
  assert.deepEqual(types(at(9_999)), []);
  assert.deepEqual(types(at(10_000)), ['telemetry_stale:session']);
  assert.deepEqual(types(at(59_999)), ['telemetry_stale:session']);
  // 边界上不得同时产出 stale，避免同一故障重复计两条。
  assert.deepEqual(types(at(60_000)), ['device_offline:session']);
  assert.deepEqual(types(at(600_000)), ['device_offline:session']);
  const offline = at(60_000)[0];
  assert.equal(offline.severity, 'high');
  assert.equal(offline.basis.code, 'offline_frames');
  assert.equal(offline.basis.ttlMs, 10_000);
});

test('规则3：采集异常集合产出 collection_error 且 subject=reason，read_only_hardware 与 telemetry_stale 不产出', () => {
  for (const reason of ['invalid_hsp_sample', 'hardware_read_failed', 'hardware_file_too_large', 'invalid_receive_time', 'unknown']) {
    const faults = deriveFaults(inputs({devices: [device({snapshot: {...device().snapshot, reason}})]}), NOW);
    assert.deepEqual(types(faults), ['collection_error:' + reason], reason);
    assert.equal(faults[0].severity, 'medium');
  }
  for (const reason of ['read_only_hardware', 'telemetry_stale']) {
    assert.deepEqual(deriveFaults(inputs({devices: [device({snapshot: {...device().snapshot, reason}})]}), NOW), [], reason);
  }
});

test('规则6：reason 不认识且无时间证据 → collection_error，basis.code=unknown_reason', () => {
  const faults = deriveFaults(inputs({devices: [{gatewayId: 'dayu-a', hasSession: true, lastAcceptedAt: null, snapshot: {reason: 'hardware_not_connected'}}]}), NOW);
  assert.equal(faults.length, 1);
  assert.equal(faults[0].type, 'collection_error');
  assert.equal(faults[0].subject, 'hardware_not_connected');
  assert.equal(faults[0].basis.code, 'unknown_reason');
  // 不允许瞎猜成离线或过期。
  assert.ok(!types(faults).some(t => t.startsWith('device_offline') || t.startsWith('telemetry_stale')));
});

test('规则4：在线且通道无效分 th/gas 两条；设备不在线时不出通道告警', () => {
  const both = deriveFaults(inputs({devices: [device({snapshot: {...device().snapshot, quality: {temperatureValid: false, humidityValid: true, gasValid: false}}})]}), NOW);
  assert.deepEqual(types(both), ['sensor_channel_invalid:gas', 'sensor_channel_invalid:th']);
  const humidity = deriveFaults(inputs({devices: [device({snapshot: {...device().snapshot, quality: {temperatureValid: true, humidityValid: false, gasValid: true}}})]}), NOW);
  assert.deepEqual(types(humidity), ['sensor_channel_invalid:th']);
  // 帧已过期 → 设备不算在线，质量字段无从谈起。
  const stale = deriveFaults(inputs({devices: [device({lastAcceptedAt: NOW - 20_000, snapshot: {...device().snapshot, deviceOnline: false, quality: {temperatureValid: false, humidityValid: false, gasValid: false}}})]}), NOW);
  assert.deepEqual(types(stale), ['telemetry_stale:session']);
});

test('规则5：模型失败只在非良性错误时产出；良性错误与安全拒止不算模型失败', () => {
  const failed = (error, extra = {}) => ({gatewayId: 'dayu-a', taskId: 'task-' + error, status: 'failed', error, startedAt: NOW - 5_000, finishedAt: NOW - 1_000, ...extra});
  assert.deepEqual(types(deriveFaults(inputs({tasks: [failed('pipeline_or_storage_failed')]}), NOW)), ['model_task_failed:pipeline']);
  for (const benign of ['ai_busy_try_later', 'invalid_prompt', 'device_session_changed', 'gateway_required', 'invalid_alert_query']) {
    assert.deepEqual(deriveFaults(inputs({tasks: [failed(benign)]}), NOW), [], benign);
  }
  // 安全规则正常拒止不是模型调用失败。
  for (const verdict of ['block', 'needs_human']) {
    assert.deepEqual(deriveFaults(inputs({tasks: [failed('pipeline_or_storage_failed', {verdict})]}), NOW), [], verdict);
  }
});

test('模型失败的恢复证据是同设备后续 completed 任务，无成功任务则保持未恢复', () => {
  const failed = {gatewayId: 'dayu-a', taskId: 'task-fail', status: 'failed', error: 'pipeline_or_storage_failed', startedAt: NOW - 9_000, finishedAt: NOW - 8_000};
  const done = at => ({gatewayId: 'dayu-a', taskId: 'task-ok-' + at, status: 'completed', verdict: 'allow', stages: ['decision','generate','verify'].map(stage=>({stage,state:'passed',error:null})), startedAt: at - 1_000, finishedAt: at});
  assert.deepEqual(types(deriveFaults(inputs({tasks: [failed]}), NOW)), ['model_task_failed:pipeline']);
  assert.deepEqual(types(deriveFaults(inputs({tasks: [failed, done(NOW - 9_000)]}), NOW)), ['model_task_failed:pipeline']);
  assert.deepEqual(deriveFaults(inputs({tasks: [failed, done(NOW - 7_000)]}), NOW), []);
});

test('派生结果不外泄密钥形态文本（basis.detail 落地前脱敏）', () => {
  const faults = deriveFaults(inputs({tasks: [{gatewayId: 'dayu-a', taskId: 'task-1', status: 'failed', error: 'upstream sk-abcdefgh12345678 rejected', finishedAt: NOW - 1_000}]}), NOW);
  assert.equal(faults.length, 1);
  assert.ok(!faults[0].basis.detail.includes('sk-abcdefgh12345678'));
  assert.ok(faults[0].basis.detail.includes('[redacted]'));
});

// ---------- 合并、恢复、生命周期 ----------

test('同合并键持续发生只累加 lastAt/occurrences，不新建 alertId', async () => {
  const ctx = await env();
  try {
    const stale = () => device({lastAcceptedAt: NOW - 20_000});
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const first = ctx.center.list({gatewayId: 'dayu-a'}).items[0];
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const items = ctx.center.list({gatewayId: 'dayu-a'}).items;
    assert.equal(items.length, 1);
    assert.equal(items[0].alertId, first.alertId);
    assert.equal(items[0].occurrences, 2);
    // 合并窗口内纯发生累加不占事件额度：保留文件里仍然只有一条告警行。
    assert.equal(ctx.alertRows().length, 1);
  } finally { await ctx.close(); }
});

test('合并窗口外的发生累加会落盘并推进 revision', async () => {
  let clock = NOW;
  const ctx = await env({now: () => clock});
  try {
    const stale = () => device({lastAcceptedAt: clock - 20_000});
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    clock += ALERT_MERGE_WRITE_INTERVAL_MS;
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const item = ctx.center.list({gatewayId: 'dayu-a'}).items[0];
    assert.equal(item.occurrences, 2);
    assert.equal(item.revision, 2);
    assert.equal(ctx.alertRows().length, 2);
  } finally { await ctx.close(); }
});

test('恢复后再发生新建 alertId，occurrences 从 1 重新计', async () => {
  const ctx = await env();
  try {
    const stale = () => device({lastAcceptedAt: NOW - 20_000});
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const first = ctx.center.list({gatewayId: 'dayu-a'}).items[0];
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs()});
    const recovered = ctx.center.detail({gatewayId: 'dayu-a', alertId: first.alertId});
    assert.equal(recovered.state, 'recovered');
    assert.equal(recovered.recoveredAt, NOW);
    assert.equal(recovered.recovery.code, 'fresh_frames');

    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const items = ctx.center.list({gatewayId: 'dayu-a'}).items;
    // 已恢复的旧单不消失，新单另起一条：一恢复一发生，共两条。
    assert.equal(items.length, 2);
    assert.notEqual(items[0].alertId, first.alertId);
    assert.equal(items[0].occurrences, 1);
    assert.equal(items[0].state, 'open');
    assert.equal(items[1].alertId, first.alertId);
    assert.equal(items[1].state, 'recovered');
    // 已恢复的记录仍然可查，不因新单而消失。
    assert.equal(ctx.center.detail({gatewayId: 'dayu-a', alertId: first.alertId}).state, 'recovered');
  } finally { await ctx.close(); }
});

test('确认与恢复正交：ack 只追加记录，故障仍在发生则继续合并且不回退为 open', async () => {
  const ctx = await env();
  try {
    const stale = () => device({lastAcceptedAt: NOW - 20_000});
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    const acked = await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'ack', expectedRevision: 1, note: '已知晓，等运维复位', actor: 'admin'});
    assert.equal(acked.alert.state, 'acknowledged');
    assert.equal(acked.alert.acknowledged, true);
    assert.equal(acked.alert.acks.length, 1);
    assert.equal(acked.alert.acks[0].actor, 'admin');
    assert.equal(acked.alert.acks[0].note, '已知晓，等运维复位');
    assert.equal(acked.alert.recoveredAt, null);
    assert.equal(acked.alert.occurrences, 1);

    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const after = ctx.center.detail({gatewayId: 'dayu-a', alertId});
    assert.equal(after.state, 'acknowledged');
    assert.equal(after.occurrences, 2);
    assert.equal(after.acks.length, 1);

    // 恢复不因确认而回退，确认也不因恢复而失效。
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs()});
    const recovered = ctx.center.detail({gatewayId: 'dayu-a', alertId});
    assert.equal(recovered.state, 'recovered');
    assert.equal(recovered.acknowledged, true);
    assert.equal(recovered.acks.length, 1);
  } finally { await ctx.close(); }
});

test('备注只追加：历史备注与确认记录不被覆盖', async () => {
  const ctx = await env();
  try {
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})});
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'ack', expectedRevision: 1, note: '接手', actor: 'admin'});
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 2, text: '已到现场检查接线', actor: 'admin'});
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 3, text: '更换传感器后恢复', actor: 'ops'});
    const alert = ctx.center.detail({gatewayId: 'dayu-a', alertId});
    assert.deepEqual(alert.notes.map(n => n.text), ['已到现场检查接线', '更换传感器后恢复']);
    assert.deepEqual(alert.notes.map(n => n.actor), ['admin', 'ops']);
    assert.equal(alert.acks.length, 1);
    assert.equal(alert.acks[0].note, '接手');
    assert.equal(alert.revision, 4);
    assert.equal(alert.state, 'acknowledged');
  } finally { await ctx.close(); }
});

test('并发 revision 冲突返回 alert_revision_conflict', async () => {
  const ctx = await env();
  try {
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})});
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 1, text: '第一个管理员', actor: 'admin'});
    await assert.rejects(
      ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 1, text: '第二个管理员', actor: 'ops'}),
      /alert_revision_conflict/,
    );
    assert.equal(ctx.center.detail({gatewayId: 'dayu-a', alertId}).notes.length, 1);
  } finally { await ctx.close(); }
});

test('精确重试幂等：同内容同 revision 重放返回 duplicate:true 且不新增记录', async () => {
  const ctx = await env();
  try {
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})});
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    const body = {gatewayId: 'dayu-a', alertId, action: 'ack', expectedRevision: 1, note: '确认过', actor: 'admin'};
    const first = await ctx.center.submit(body);
    assert.equal(first.duplicate, false);
    assert.equal(first.alert.revision, 2);
    // 重试时当前 revision 已经是 2，但幂等键必须先生效，不能返回 409。
    const second = await ctx.center.submit(body);
    assert.equal(second.duplicate, true);
    assert.equal(second.alert.revision, 2);
    assert.equal(second.alert.acks.length, 1);
    assert.equal(ctx.alertRows().length, 2);
  } finally { await ctx.close(); }
});

test('重启后从保留文件重放：状态、确认、备注、occurrences 完整恢复', async () => {
  const ctx = await env();
  try {
    // 新鲜帧 + 采集异常 reason：只派生一条 collection_error，便于核对单条记录的重放。
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'invalid_hsp_sample'}})]})});
    assert.equal(ctx.center.list({gatewayId: 'dayu-a'}).items.length, 1);
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'ack', expectedRevision: 1, note: '记录', actor: 'admin'});
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 2, text: '已处理一路', actor: 'admin'});

    const reopened = await ctx.restart();
    const alert = reopened.center.detail({gatewayId: 'dayu-a', alertId});
    assert.equal(alert.state, 'acknowledged');
    assert.equal(alert.acknowledged, true);
    assert.equal(alert.revision, 3);
    assert.equal(alert.acks[0].note, '记录');
    assert.deepEqual(alert.notes.map(n => n.text), ['已处理一路']);
    assert.equal(alert.occurrences, 1);
    // 重放后合并索引仍然有效：同一合并键不会新建第二条。
    await reopened.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'invalid_hsp_sample'}})]})});
    assert.equal(reopened.center.list({gatewayId: 'dayu-a'}).items.length, 1);
  } finally { await ctx.close(); }
});

// ---------- 容量与写失败 ----------

test('容量上限：超过 2000 条上限报 alert_store_full 且不淘汰任何旧记录', async () => {
  const ctx = await env({capacity: 2});
  try {
    const reasons = ['invalid_hsp_sample', 'hardware_read_failed', 'hardware_file_too_large'];
    for (const reason of reasons.slice(0, 2)) {
      await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason}})]})});
    }
    await assert.rejects(
      ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: reasons[2]}})]})}),
      /alert_store_full/,
    );
    const list = ctx.center.list({gatewayId: 'dayu-a'});
    assert.equal(list.items.length, 2);
    assert.equal(list.counts.all, 2);
    assert.deepEqual(list.items.map(i => i.subject).sort(), ['hardware_read_failed', 'invalid_hsp_sample']);
  } finally { await ctx.close(); }
});

test('单条告警事件上限：超限报 alert_event_limit 且不丢记录', async () => {
  let clock = NOW;
  const ctx = await env({now: () => clock, eventLimit: 3, mergeWindowMs: 0});
  try {
    const stale = () => device({lastAcceptedAt: clock - 20_000});
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const count = () => ctx.alertRows().length;
    for (let i = 0; i < 2; i += 1) { clock += 1_000; await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})}); }
    assert.equal(count(), 3);
    clock += 1_000;
    await assert.rejects(ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})}), /alert_event_limit/);
    assert.equal(count(), 3);
    // 落盘失败的累加不写进内存：内存计数必须与保留文件一致，绝不出现「界面成功、磁盘没写」。
    const items = ctx.center.list({gatewayId: 'dayu-a'}).items;
    assert.equal(items.length, 1);
    assert.equal(items[0].occurrences, 3);
    assert.equal(items[0].revision, 3);
  } finally { await ctx.close(); }
});

test('写入失败一律 alert_persist_failed，绝不返回成功也不留下半条记录', async () => {
  const history = {
    rows: [],
    append: async () => { throw Error('history_write_failed'); },
  };
  const center = await new AlertCenter({history, now: () => NOW}).open();
  await assert.rejects(
    center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})}),
    /alert_persist_failed/,
  );
  const list = center.list({gatewayId: 'dayu-a'});
  assert.equal(list.items.length, 0);
  assert.equal(list.counts.all, 0);
});

// ---------- 列表、筛选、游标 ----------

test('列表：筛选、counts/countBasis、source 与游标分页', async () => {
  let clock = NOW;
  const ctx = await env({now: () => clock});
  try {
    // 25 个"发生→恢复"循环，产生 25 条已恢复告警，lastAt 各不相同。
    for (let i = 0; i < 25; i += 1) {
      clock = NOW + i * 1_000;
      await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({lastAcceptedAt: clock - 20_000})]})});
      await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({lastAcceptedAt: clock})]})});
    }
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({lastAcceptedAt: clock, snapshot: {...device().snapshot, receivedAt: clock, quality: {temperatureValid: true, humidityValid: true, gasValid: false}}})]})});

    const page1 = ctx.center.list({gatewayId: 'dayu-a', limit: 10, source: {connected: true, lastAcceptedAt: clock}});
    assert.equal(page1.schemaVersion, 1);
    assert.equal(page1.scope, 'alerts');
    assert.equal(page1.gatewayId, 'dayu-a');
    assert.deepEqual(page1.filters, {type: null, severity: null, status: null});
    assert.equal(page1.counts.all, 26);
    assert.equal(page1.counts.open, 1);
    assert.equal(page1.counts.recovered, 25);
    assert.equal(page1.counts.acknowledged, 0);
    assert.deepEqual(page1.counts.bySeverity, {low: 0, medium: 1, high: 25, critical: 0});
    assert.equal(page1.countBasis.recovered, '已恢复，不再计入未处理');
    assert.deepEqual(page1.source, {connected: true, lastAcceptedAt: clock, lastReconcileError: null, evaluation: 'derived-on-read'});
    assert.equal(page1.items.length, 10);
    assert.equal(page1.truncated, true);
    assert.match(page1.nextCursor, /^s\d+$/);
    // 未恢复的那条 lastAt 最新，必然在首页。
    assert.equal(page1.items[0].state, 'open');

    const page2 = ctx.center.list({gatewayId: 'dayu-a', limit: 10, cursor: page1.nextCursor});
    assert.equal(page2.items.length, 10);
    const seen = new Set([...page1.items, ...page2.items].map(i => i.alertId));
    assert.equal(seen.size, 20);
    const page3 = ctx.center.list({gatewayId: 'dayu-a', limit: 10, cursor: page2.nextCursor});
    assert.equal(page3.items.length, 6);
    assert.equal(page3.nextCursor, null);
    assert.equal(page3.truncated, false);

    const onlyOpen = ctx.center.list({gatewayId: 'dayu-a', status: 'open'});
    assert.deepEqual(onlyOpen.items.map(i => i.state), ['open']);
    assert.equal(onlyOpen.counts.all, 1);
    assert.equal(onlyOpen.counts.recovered, 0);
    const bySeverity = ctx.center.list({gatewayId: 'dayu-a', severity: 'high'});
    assert.equal(bySeverity.counts.all, 25);
    const byType = ctx.center.list({gatewayId: 'dayu-a', type: 'sensor_channel_invalid'});
    assert.deepEqual(byType.items.map(i => i.subject), ['gas']);
  } finally { await ctx.close(); }
});

test('列表与详情恒 executed:false / hardwareControl:false / sample:false', async () => {
  const ctx = await env();
  try {
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})});
    const item = ctx.center.list({gatewayId: 'dayu-a'}).items[0];
    assert.equal(item.executed, false);
    assert.equal(item.hardwareControl, false);
    assert.equal(item.sample, false);
    const detail = ctx.center.detail({gatewayId: 'dayu-a', alertId: item.alertId});
    assert.equal(detail.executed, false);
    assert.equal(detail.hardwareControl, false);
    const acked = await ctx.center.submit({gatewayId: 'dayu-a', alertId: item.alertId, action: 'ack', expectedRevision: 1, actor: 'admin'});
    assert.equal(acked.executed, false);
    assert.equal(acked.hardwareControl, false);
    assert.equal(acked.schemaVersion, 1);
  } finally { await ctx.close(); }
});

test('详情返回完整记录（evidence/relatedTaskIds/acks/notes），跨设备一律 alert_not_found', async () => {
  const ctx = await env();
  try {
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device()], tasks: [{gatewayId: 'dayu-a', taskId: 'task-1', status: 'failed', error: 'pipeline_or_storage_failed', finishedAt: NOW - 1_000}]})});
    const item = ctx.center.list({gatewayId: 'dayu-a'}).items[0];
    const detail = ctx.center.detail({gatewayId: 'dayu-a', alertId: item.alertId});
    assert.equal(detail.type, 'model_task_failed');
    assert.equal(detail.subject, 'pipeline');
    assert.deepEqual(detail.relatedTaskIds, ['task-1']);
    assert.equal(detail.evidence.length, 1);
    assert.equal(detail.evidence[0].ref, 'task:task-1');
    assert.deepEqual(detail.acks, []);
    assert.deepEqual(detail.notes, []);
    assert.equal(detail.occurrences, 1);
    assert.equal(detail.firstAt, NOW);
    assert.equal(detail.lastAt, NOW);
    assert.throws(() => ctx.center.detail({gatewayId: 'dayu-b', alertId: item.alertId}), /alert_not_found/);
    assert.throws(() => ctx.center.detail({gatewayId: 'dayu-a', alertId: 'alert_missing'}), /alert_not_found/);
  } finally { await ctx.close(); }
});

test('非法查询与非法请求体分别报 invalid_alert_query / invalid_alert_note', async () => {
  const ctx = await env();
  try {
    assert.throws(() => ctx.center.list({gatewayId: 'dayu-a', type: 'nope'}), /invalid_alert_query/);
    assert.throws(() => ctx.center.list({gatewayId: 'dayu-a', status: 'closed'}), /invalid_alert_query/);
    assert.throws(() => ctx.center.list({gatewayId: 'dayu-a', limit: 0}), /invalid_alert_query/);
    assert.throws(() => ctx.center.list({gatewayId: 'dayu-a', limit: 101}), /invalid_alert_query/);
    assert.throws(() => ctx.center.list({gatewayId: 'dayu-a', cursor: 'x1'}), /invalid_alert_query/);
    assert.throws(() => ctx.center.list({gatewayId: ''}), /gateway_required/);

    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})});
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    await assert.rejects(ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'ack', expectedRevision: 0, actor: 'admin'}), /invalid_alert_note/);
    await assert.rejects(ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 1, text: '', actor: 'admin'}), /invalid_alert_note/);
    await assert.rejects(ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 1, text: 'x'.repeat(501), actor: 'admin'}), /invalid_alert_note/);
    await assert.rejects(ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'ack', expectedRevision: 1, note: 'x'.repeat(501), actor: 'admin'}), /invalid_alert_note/);
    await assert.rejects(ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'nope', expectedRevision: 1, actor: 'admin'}), /invalid_alert_note/);
  } finally { await ctx.close(); }
});

test('无当前证据时不判恢复：hasSession=false 的设备既有告警保持未恢复', async () => {
  const ctx = await env();
  try {
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({lastAcceptedAt: NOW - 120_000})]})});
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    assert.equal(ctx.center.detail({gatewayId: 'dayu-a', alertId}).type, 'device_offline');
    // 设备接入状态被清空（无任何当前证据）→ 既不能新建也不能宣布恢复。
    const result = await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({hasSession: false, lastAcceptedAt: null, snapshot: {}})]})});
    assert.equal(result.evaluated, false);
    assert.equal(ctx.center.detail({gatewayId: 'dayu-a', alertId}).state, 'open');
  } finally { await ctx.close(); }
});

test('reconcile 失败的错误码可回传列表 source.lastReconcileError，成功后清除', async () => {
  const history = {rows: [], append: async () => { throw Error('history_write_failed'); }};
  const center = await new AlertCenter({history, now: () => NOW}).open();
  try { await center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})}); }
  catch (error) { assert.equal(center.recordReconcileFailure(error), 'alert_persist_failed'); }
  assert.equal(center.list({gatewayId: 'dayu-a'}).source.lastReconcileError, 'alert_persist_failed');
  center.clearReconcileError();
  assert.equal(center.list({gatewayId: 'dayu-a'}).source.lastReconcileError, null);
});
test('首次发生/恢复/确认/备注一律立即落盘，绝不进合并节流窗口', async () => {
  // 60s 窗口：若落盘被节流，下面每次调用的行数不会立即增长。
  const ctx = await env({mergeWindowMs: 60_000});
  try {
    const stale = () => device({lastAcceptedAt: NOW - 20_000});
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    assert.equal(ctx.alertRows().length, 1, '首次发生必须立即落盘');
    const alertId = ctx.center.list({gatewayId: 'dayu-a'}).items[0].alertId;
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'ack', expectedRevision: 1, note: '确认', actor: 'admin'});
    assert.equal(ctx.alertRows().length, 2, '确认必须立即落盘');
    await ctx.center.submit({gatewayId: 'dayu-a', alertId, action: 'note', expectedRevision: 2, text: '备注', actor: 'admin'});
    assert.equal(ctx.alertRows().length, 3, '备注必须立即落盘');
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs()});
    assert.equal(ctx.alertRows().length, 4, '恢复必须立即落盘');
    assert.equal(ctx.center.detail({gatewayId: 'dayu-a', alertId}).state, 'recovered');
  } finally { await ctx.close(); }
});

test('读取触发的同步（mode=read）只做状态迁移，不增加 occurrences 也不新写行', async () => {
  let clock = NOW;
  const ctx = await env({now: () => clock});
  try {
    const stale = () => device({lastAcceptedAt: clock - 20_000});
    // 观察一次 → 开启。
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const first = ctx.center.list({gatewayId: 'dayu-a'}).items[0];
    const rows = ctx.alertRows().length;
    // 读取三次（GET 同步）：仍在发生，但读取不得污染统计。
    for (let i = 0; i < 3; i += 1) {
      clock += 5_000;
      await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]}), mode: 'read'});
    }
    const afterReads = ctx.center.detail({gatewayId: 'dayu-a', alertId: first.alertId});
    assert.equal(afterReads.occurrences, 1);
    assert.equal(afterReads.lastAt, NOW);
    assert.equal(afterReads.revision, first.revision);
    assert.equal(ctx.alertRows().length, rows);
    // 读取触发的恢复仍然是状态迁移，必须允许。
    clock += 1_000;
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({lastAcceptedAt: clock})]}), mode: 'read'});
    assert.equal(ctx.center.detail({gatewayId: 'dayu-a', alertId: first.alertId}).state, 'recovered');
    // 读取触发的开启同样允许（首次看到故障即为状态迁移）。
    clock += 1_000;
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]}), mode: 'read'});
    assert.equal(ctx.center.list({gatewayId: 'dayu-a'}).counts.open, 1);
  } finally { await ctx.close(); }
});

test('节流窗口内的累加在重启后最多丢次数，不会因 revision 回退误报 409', async () => {
  let clock = NOW;
  const ctx = await env({now: () => clock, mergeWindowMs: 60_000});
  try {
    const stale = () => device({lastAcceptedAt: clock - 20_000});
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    const first = ctx.center.list({gatewayId: 'dayu-a'}).items[0];
    // 窗口内的纯观察累加不落盘，revision 保持为已落盘值。
    clock += 1_000;
    await ctx.center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [stale()]})});
    assert.equal(ctx.center.detail({gatewayId: 'dayu-a', alertId: first.alertId}).revision, 1);
    const reopened = await ctx.restart();
    const after = reopened.center.detail({gatewayId: 'dayu-a', alertId: first.alertId});
    assert.equal(after.revision, 1);
    // 以落盘 revision 为基准的确认必须成功，不能被内存里更高的计数带偏。
    const acked = await reopened.center.submit({gatewayId: 'dayu-a', alertId: first.alertId, action: 'ack', expectedRevision: after.revision, actor: 'admin'});
    assert.equal(acked.alert.state, 'acknowledged');
    assert.equal(acked.alert.revision, 2);
  } finally { await ctx.close(); }
});

test('安全拒止不算模型失败：completed+verdict=block、failed+verdict=block 都不产告警', () => {
  const base = {gatewayId: 'dayu-a', taskId: 'task-1', startedAt: NOW - 4_000, finishedAt: NOW - 1_000};
  for (const task of [
    {...base, status: 'completed', verdict: 'block'},
    {...base, status: 'completed', verdict: 'needs_human'},
    {...base, status: 'failed', verdict: 'block', error: 'pipeline_or_storage_failed'},
    {...base, status: 'failed', verdict: 'needs_human', error: 'pipeline_or_storage_failed'},
  ]) {
    assert.deepEqual(deriveFaults(inputs({tasks: [task]}), NOW), [], JSON.stringify(task));
  }
});

test('写入失败时列表不出现 saved/成功标志，且旧记录原样保留', async () => {
  const rows = [];
  let boom = false;
  const history = {
    rows,
    append: async row => { if (boom) throw Error('history_write_failed'); const full = {...row, seq: rows.length + 1, recordedAt: NOW}; rows.push(full); return full; },
  };
  const center = await new AlertCenter({history, now: () => NOW}).open();
  await center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_read_failed'}})]})});
  const before = center.list({gatewayId: 'dayu-a'});
  assert.equal(before.counts.all, 1);
  boom = true;
  await assert.rejects(
    center.reconcile({gatewayId: 'dayu-a', inputs: inputs({devices: [device({snapshot: {...device().snapshot, reason: 'hardware_file_too_large'}})]})}),
    /alert_persist_failed/,
  );
  const after = center.list({gatewayId: 'dayu-a'});
  assert.equal(after.counts.all, 1);
  assert.deepEqual(after.items.map(i => i.subject), ['hardware_read_failed']);
  assert.ok(!('saved' in after));
  assert.ok(!JSON.stringify(after).includes('saved'));
  assert.ok(!JSON.stringify(after).includes('alert_persist_failed'));
});
