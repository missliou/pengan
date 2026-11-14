import {createHash, randomUUID} from 'node:crypto';
import {HSP_TTL_MS} from './hsp-telemetry.mjs';

// 告警中心（ALERT-CENTER-20261103）。
//
// 设计约束（对应 docs/告警中心接口契约.md）：
// 1) 故障判定是纯函数 deriveFaults(inputs, now)：时间由调用方注入，测试可完全控制边界。
// 2) 持久化复用 CloudHistory 追加链；open() 只重放 alert_state 行重建索引，重启后状态/确认/备注完整恢复。
// 3) 合并键 gatewayId+type+subject：未恢复期间只累加，恢复后再次发生新建 alertId。
// 4) 确认与恢复正交：ack 只追加确认记录并 revision+1，不改变是否仍在发生。
// 5) 容量与事件上限只报错、绝不淘汰旧记录（alert_store_full / alert_event_limit），
//    写失败一律 alert_persist_failed，调用方不得收到成功。
// 6) 本模块没有任何设备控制通道：响应恒 executed:false / hardwareControl:false。
//
// 与契约 §4 的唯一偏差：落盘行用 kind='audit' + data.event='alert_state'，而不是 kind='alert'。
// 原因：gateway/cloud-history.mjs:17/:29 的 kind 白名单只有 telemetry/analysis/audit，
// 写 'alert' 会抛 invalid_history_record，重启 open() 还会抛 history_chain_invalid；
// cloud-history.mjs 不在本次可写范围内。alert_state 事件名已足以区分，与 pipeline_state 同构。

const fail = code => { throw Error(code); };
const copy = value => structuredClone(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const isId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value);
const isTime = value => Number.isSafeInteger(value) && value >= 0;
const clip = (value, max) => String(value ?? '').slice(0, max);
// 判定依据只放代码与阈值，不放原文；再做一层兜底，避免上游错误串把密钥带进保留文件。
const redact = value => String(value ?? '').replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g, '[redacted]');

export const ALERT_ROW_KIND = 'audit';
export const ALERT_EVENT = 'alert_state';
export const ALERT_SCOPE = 'alert';

// 复用 hsp-telemetry 的帧有效期，避免两处阈值漂移。
export const TTL_MS = HSP_TTL_MS;
export const OFFLINE_MS = 60000;

export const ALERT_TYPES = Object.freeze(['device_offline', 'telemetry_stale', 'collection_error', 'sensor_channel_invalid', 'model_task_failed']);
export const ALERT_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
export const ALERT_STATES = Object.freeze(['open', 'acknowledged', 'recovered']);
export const SEVERITY_BY_TYPE = Object.freeze({
  device_offline: 'high',
  telemetry_stale: 'high',
  collection_error: 'medium',
  sensor_channel_invalid: 'medium',
  model_task_failed: 'medium',
});

// 契约 §3.3：采集异常集合；read_only_hardware 属正常只读硬件，不在其中。
export const COLLECTION_ERROR_REASONS = Object.freeze(['invalid_hsp_sample', 'hardware_read_failed', 'hardware_file_too_large', 'invalid_receive_time', 'unknown']);
export const READ_ONLY_REASON = 'read_only_hardware';
// telemetry_stale 由 stale/offline 时间规则覆盖，不重复产出 collection_error。
const STALE_REASON = 'telemetry_stale';
// 契约 §3.5 良性集合：这些失败不是模型调用故障，不产生告警。
export const BENIGN_TASK_ERRORS = Object.freeze([
  'ai_busy_try_later',
  'invalid_prompt',
  'device_session_changed',
  'gateway_required',
  'invalid_alert_query',
  'invalid_alert_note',
  'alert_revision_conflict',
  'alert_not_found',
]);
// 安全规则正常拒止（block / needs_human）不是模型调用失败，绝不产告警。
export const SECURITY_VERDICTS = Object.freeze(['block', 'needs_human']);

export const ALERT_CAPACITY = 2000;
export const ALERT_EVENT_LIMIT = 200;
// 同一未恢复告警的纯发生累加落盘合并窗口：内存每次都累加，落盘最多每 10s 一次，
// 否则每帧 ingest 都 +1 事件、200 帧后该告警永久 alert_event_limit。
export const ALERT_MERGE_WRITE_INTERVAL_MS = 10000;
export const ALERT_LIST_LIMIT_DEFAULT = 20;
export const ALERT_LIST_LIMIT_MAX = 100;
export const ALERT_NOTE_MAX = 500;

export const COUNT_BASIS = Object.freeze({
  all: '该设备全部告警（含已恢复）',
  open: '发生中且未确认',
  acknowledged: '发生中且已确认',
  recovered: '已恢复，不再计入未处理',
});

const CHANNEL_TITLE = Object.freeze({th: '传感器通道无效（温湿度）', gas: '传感器通道无效（气体）'});
const MERGE_SEPARATOR = '\u0000';

const mergeKey = (gatewayId, type, subject) => [gatewayId, type, subject].join(MERGE_SEPARATOR);

function faultOf(gatewayId, type, subject, {basis, evidence = [], relatedTaskIds = [], title} = {}) {
  return {
    gatewayId,
    type,
    subject,
    title: clip(title ?? defaultTitle(type, subject), 120),
    severity: SEVERITY_BY_TYPE[type],
    basis: basis ? {...basis, detail: clip(redact(basis.detail), 300)} : basis,
    evidence: evidence.slice(0, 6),
    relatedTaskIds: relatedTaskIds.slice(0, 5),
  };
}

function defaultTitle(type, subject) {
  if (type === 'collection_error') return '采集异常（' + subject + '）';
  if (type === 'sensor_channel_invalid') return CHANNEL_TITLE[subject] || '传感器通道无效';
  if (type === 'device_offline') return '设备离线';
  if (type === 'telemetry_stale') return '遥测数据过期';
  return '模型任务失败';
}

// 纯函数：把设备最新快照与模型任务窗口折算成"当前仍存在的故障"。
// 同一帧只产出一条时间类故障（stale 或 offline，不同时产出），避免重复计数。
export function evaluate(inputs, now = 0) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) fail('invalid_alert_inputs');
  if (!isTime(now)) fail('invalid_alert_time');
  const devices = Array.isArray(inputs.devices) ? inputs.devices : [];
  const tasks = Array.isArray(inputs.tasks) ? inputs.tasks : [];
  const faults = [];
  const states = new Map();

  for (const device of devices) {
    if (!device || typeof device !== 'object') continue;
    const gatewayId = device.gatewayId;
    if (!isId(gatewayId)) continue;
    const hasSession = device.hasSession === true;
    const snapshot = device.snapshot && typeof device.snapshot === 'object' && !Array.isArray(device.snapshot) ? device.snapshot : {};
    // 时间证据优先取接入时间，其次退回帧时间；两者都没有就是"无法判断"。
    const lastAcceptedAt = isTime(device.lastAcceptedAt) ? device.lastAcceptedAt : isTime(snapshot.receivedAt) ? snapshot.receivedAt : null;
    // Connection silence and frame freshness are different clocks: an upload may
    // already carry several seconds of sample age when it reaches this server.
    const connectionAge = lastAcceptedAt === null || now < lastAcceptedAt ? null : now - lastAcceptedAt;
    const receivedAge = isTime(snapshot.receivedAt) && now >= snapshot.receivedAt ? now - snapshot.receivedAt : null;
    const candidates = [connectionAge, receivedAge, isTime(snapshot.sampleAgeMs) ? snapshot.sampleAgeMs : null].filter(value => value !== null);
    const age = candidates.length ? Math.max(...candidates) : null;
    const validClock = (lastAcceptedAt === null || now >= lastAcceptedAt) && (!isTime(snapshot.receivedAt) || now >= snapshot.receivedAt);
    const fresh = validClock && age !== null && age < TTL_MS && snapshot.deviceOnline === true;
    const online = fresh && snapshot.deviceOnline === true;
    const reason = typeof snapshot.reason === 'string' ? snapshot.reason : null;
    const quality = snapshot.quality && typeof snapshot.quality === 'object' ? snapshot.quality : {};
    const observedAt = isTime(snapshot.receivedAt) ? snapshot.receivedAt : lastAcceptedAt;
    states.set(gatewayId, {gatewayId, hasSession, fresh, online, reason, age, lastAcceptedAt, tasks: []});
    // 规则 1：从未收到数据时不产生任何告警，也不伪造时间。
    if (!hasSession) continue;

    if (connectionAge !== null && connectionAge >= OFFLINE_MS) {
      faults.push(faultOf(gatewayId, 'device_offline', 'session', {
        basis: {code: 'offline_frames', detail: clip('接入静默 ' + connectionAge + 'ms ≥ 离线阈值 ' + OFFLINE_MS + 'ms', 300), observedAt: lastAcceptedAt, sampleAgeMs: age, ttlMs: TTL_MS},
        evidence: [
          {ref: 'telemetry.lastAcceptedAt', value: lastAcceptedAt, observedAt: lastAcceptedAt, fresh: false},
          {ref: 'telemetry.sampleAgeMs', value: age, observedAt: now, fresh: false},
        ],
      }));
    } else if (age !== null && age >= TTL_MS) {
      faults.push(faultOf(gatewayId, 'telemetry_stale', 'session', {
        basis: {code: 'stale_frames', detail: clip('帧年龄 ' + age + 'ms ∈ [' + TTL_MS + 'ms,' + OFFLINE_MS + 'ms)', 300), observedAt: lastAcceptedAt, sampleAgeMs: age, ttlMs: TTL_MS},
        evidence: [
          {ref: 'telemetry.lastAcceptedAt', value: lastAcceptedAt, observedAt: lastAcceptedAt, fresh: false},
          {ref: 'telemetry.sampleAgeMs', value: age, observedAt: now, fresh: false},
        ],
      }));
    }

    if (reason !== null && COLLECTION_ERROR_REASONS.includes(reason)) {
      faults.push(faultOf(gatewayId, 'collection_error', reason, {
        basis: {code: reason, detail: clip('采集快照 reason=' + reason, 300), observedAt: observedAt ?? now, sampleAgeMs: age, ttlMs: TTL_MS},
        evidence: [{ref: 'snapshot.reason', value: reason, observedAt: observedAt ?? now, fresh}],
      }));
    } else if (reason !== READ_ONLY_REASON && reason !== STALE_REASON && !COLLECTION_ERROR_REASONS.includes(reason) && age === null) {
      // 规则 6：reason 不认识且没有时间证据 → 归入 collection_error，basis.code=unknown_reason，不瞎猜成离线/过期。
      const subject = reason ?? 'unknown';
      faults.push(faultOf(gatewayId, 'collection_error', subject, {
        basis: {code: 'unknown_reason', detail: clip('无法判断的采集快照 reason=' + subject, 300), observedAt: now, sampleAgeMs: null, ttlMs: TTL_MS},
        evidence: [{ref: 'snapshot.reason', value: subject, observedAt: now, fresh: false}],
      }));
    }

    // 规则 4：只有设备在线（新鲜帧 + deviceOnline）才谈得上通道有效性问题。
    if (online) {
      const thInvalid = quality.temperatureValid === false || quality.humidityValid === false;
      if (thInvalid) {
        faults.push(faultOf(gatewayId, 'sensor_channel_invalid', 'th', {
          basis: {code: 'channel_invalid', detail: clip('temperatureValid=' + quality.temperatureValid + ', humidityValid=' + quality.humidityValid, 300), observedAt: observedAt ?? now, sampleAgeMs: age, ttlMs: TTL_MS},
          evidence: [
            {ref: 'quality.temperatureValid', value: quality.temperatureValid === true, observedAt: observedAt ?? now, fresh},
            {ref: 'quality.humidityValid', value: quality.humidityValid === true, observedAt: observedAt ?? now, fresh},
          ],
        }));
      }
      if (quality.gasValid === false) {
        faults.push(faultOf(gatewayId, 'sensor_channel_invalid', 'gas', {
          basis: {code: 'channel_invalid', detail: 'gasValid=false', observedAt: observedAt ?? now, sampleAgeMs: age, ttlMs: TTL_MS},
          evidence: [{ref: 'quality.gasValid', value: false, observedAt: observedAt ?? now, fresh}],
        }));
      }
    }
  }

  for (const task of tasks) {
    if (!task || typeof task !== 'object' || !isId(task.gatewayId) || !isId(task.taskId)) continue;
    const state = states.get(task.gatewayId);
    if (!state) continue;
    state.tasks.push({
      gatewayId: task.gatewayId,
      taskId: task.taskId,
      status: typeof task.status === 'string' ? task.status : null,
      error: typeof task.error === 'string' ? task.error : null,
      startedAt: isTime(task.startedAt) ? task.startedAt : null,
      finishedAt: isTime(task.finishedAt) ? task.finishedAt : null,
      verdict: typeof task.verdict === 'string' ? task.verdict : null,
      stages: Array.isArray(task.stages) ? copy(task.stages) : [],
    });
  }

  for (const state of states.values()) {
    if (!state.hasSession) continue;
    // 规则 5：失败且错误不在良性集合；安全拒止不算模型失败。
    const failed = state.tasks
      .filter(task => taskModelFailed(task))
      .filter(task => task.finishedAt !== null)
      .sort((a, b) => b.finishedAt - a.finishedAt);
    if (!failed.length) continue;
    const latest = failed[0];
    // 恢复证据：同设备后续任务 status=completed 且完成时间不早于最后一次失败。
    const recovered = state.tasks.some(task => taskModelSucceeded(task) && task.finishedAt !== null && task.finishedAt >= latest.finishedAt);
    if (recovered) continue;
    faults.push(faultOf(state.gatewayId, 'model_task_failed', 'pipeline', {
      basis: {code: 'task_failed', detail: clip('任务 ' + latest.taskId + ' 模型阶段/任务失败 error=' + (latest.error ?? latest.stages.find(stage => stage.state === 'failed')?.error ?? 'null'), 300), observedAt: latest.finishedAt, sampleAgeMs: null, ttlMs: TTL_MS},
      evidence: failed.slice(0, 6).map(task => ({ref: 'task:' + task.taskId, value: 'failed/' + (task.error ?? 'null'), observedAt: task.finishedAt, fresh: false})),
      relatedTaskIds: failed.slice(0, 5).map(task => task.taskId),
    }));
  }

  return {faults, devices: states};
}

export function deriveFaults(inputs, now) {
  return evaluate(inputs, now).faults;
}

function taskModelFailed(task) {
  return task.stages.some(stage => stage?.state === 'failed') ||
    (task.status === 'failed' && !SECURITY_VERDICTS.includes(task.verdict ?? '') && !BENIGN_TASK_ERRORS.includes(task.error ?? ''));
}
function taskModelSucceeded(task) {
  return task.status === 'completed' && task.verdict === 'allow' && task.stages.length === 3 &&
    ['decision', 'generate', 'verify'].every(name => task.stages.some(stage => stage?.stage === name && stage.state === 'passed' && !stage.error));
}

export class AlertCenter {
  constructor({history, now = Date.now, capacity = ALERT_CAPACITY, eventLimit = ALERT_EVENT_LIMIT, mergeWindowMs = ALERT_MERGE_WRITE_INTERVAL_MS} = {}) {
    if (!history || typeof history.append !== 'function' || !Array.isArray(history.rows)) fail('invalid_alert_config');
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > ALERT_CAPACITY) fail('invalid_alert_config');
    if (!Number.isSafeInteger(eventLimit) || eventLimit < 1 || eventLimit > ALERT_EVENT_LIMIT) fail('invalid_alert_config');
    if (!Number.isSafeInteger(mergeWindowMs) || mergeWindowMs < 0 || mergeWindowMs > 3600000) fail('invalid_alert_config');
    Object.assign(this, {history, now, capacity, eventLimit, mergeWindowMs});
    this.alerts = new Map();
    this.index = new Map();
    this.meta = new Map();
    this.lastReconcileError = null;
    this.ready = false;
    this.mutations = Promise.resolve();
  }

  async open() {
    this.ready = false;
    this.alerts.clear();
    this.index.clear();
    this.meta.clear();
    this.lastReconcileError = null;
    for (const row of this.history.rows) {
      if (!row || row.kind !== ALERT_ROW_KIND) continue;
      const data = row.data;
      if (!data || data.event !== ALERT_EVENT) continue;
      const alert = data.alert;
      if (!alert || typeof alert !== 'object' || !isId(alert.alertId) || alert.gatewayId !== row.gatewayId) fail('alert_store_corrupt');
      const prior = this.meta.get(alert.alertId);
      this.alerts.set(alert.alertId, copy(alert));
      this.meta.set(alert.alertId, {events: (prior?.events ?? 0) + 1, seq: row.seq, persistedAt: row.recordedAt});
      const key = mergeKey(alert.gatewayId, alert.type, alert.subject);
      if (alert.state === 'recovered') this.index.delete(key);
      else this.index.set(key, alert.alertId);
    }
    this.ready = true;
    return this;
  }

  #assertReady() { if (!this.ready) fail('alert_store_not_ready'); }

  recordReconcileFailure(error) {
    const code = error && typeof error.message === 'string' && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : 'alert_reconcile_failed';
    this.lastReconcileError = code;
    return code;
  }

  clearReconcileError() { this.lastReconcileError = null; }

  #metaOf(alertId) { return this.meta.get(alertId) || {events: 0, seq: 0, persistedAt: 0}; }

  // 一次落盘 = 一条 alert_state 事件；超限或写失败一律抛错，绝不淘汰、绝不静默成功。
  async #persist(alert, actor, created, now = this.now()) {
    const meta = this.#metaOf(alert.alertId);
    if (created && this.alerts.size >= this.capacity) fail('alert_store_full');
    if (meta.events >= this.eventLimit) fail('alert_event_limit');
    let row;
    try {
      row = await this.history.append({
        kind: ALERT_ROW_KIND,
        gatewayId: alert.gatewayId,
        data: {event: ALERT_EVENT, scope: ALERT_SCOPE, actor, alert: copy(alert)},
      });
    } catch { fail('alert_persist_failed'); }
    // 节流窗口按业务时钟算：row.recordedAt 是 CloudHistory 的墙钟，与注入的 now 不是同一个时间轴。
    this.meta.set(alert.alertId, {events: meta.events + 1, seq: row.seq, persistedAt: now});
  }

  // 派生 → 合并/新建 → 恢复，全部基于注入的 inputs，不改调用方对象。
  // mode='observe'：采集入库帧、模型任务事件等真实观察，累加 occurrences；
  // mode='read'：GET 触发的同步，只做状态迁移（开启/恢复），绝不累加 occurrences —— 读取不得污染统计。
  #enqueue(action) {
    const result = this.mutations.then(action);
    this.mutations = result.catch(() => {});
    return result;
  }

  reconcile(options = {}) { const snapshot = copy(options); return this.#enqueue(() => this.#reconcile(snapshot)); }
  async #reconcile({gatewayId, inputs, actor = 'system', mode = 'observe'} = {}) {
    this.#assertReady();
    if (!isId(gatewayId)) fail('gateway_required');
    const now = this.now();
    const {faults, devices} = evaluate(inputs, now);
    const device = devices.get(gatewayId);
    // 规则 1 + 诚实原则：没有当前证据就不动这个设备的既有告警（既不新建也不判恢复）。
    if (!device || !device.hasSession) return {gatewayId, created: 0, merged: 0, recovered: 0, evaluated: false};

    const readOnly = mode === 'read';
    let created = 0, merged = 0, recovered = 0;
    const seen = new Set();
    for (const fault of faults) {
      if (fault.gatewayId !== gatewayId) continue;
      const key = mergeKey(fault.gatewayId, fault.type, fault.subject);
      seen.add(key);
      const current = this.alerts.get(this.index.get(key));
      if (!current || current.state === 'recovered') { await this.#create(fault, now, actor); created += 1; continue; }
      // 读取触发的同步只允许状态迁移：已在发生的告警既不增 occurrences 也不改 lastAt。
      if (readOnly) continue;
      if (await this.#merge(current, fault, now, actor)) merged += 1;
    }

    for (const [key, alertId] of [...this.index]) {
      if (seen.has(key)) continue;
      const alert = this.alerts.get(alertId);
      if (!alert || alert.gatewayId !== gatewayId) continue;
      const evidence = recoveryEvidence(alert, device);
      if (!evidence) continue;
      await this.#recover(alert, now, actor, evidence);
      recovered += 1;
    }
    return {gatewayId, created, merged, recovered, evaluated: true};
  }

  async #create(fault, now, actor) {
    const alert = {
      alertId: 'alert_' + randomUUID(),
      gatewayId: fault.gatewayId,
      type: fault.type,
      subject: fault.subject,
      title: clip(fault.title, 120),
      severity: fault.severity,
      state: 'open',
      acknowledged: false,
      revision: 1,
      firstAt: now,
      lastAt: now,
      recoveredAt: null,
      occurrences: 1,
      basis: copy(fault.basis),
      evidence: copy(fault.evidence),
      acks: [],
      notes: [],
      relatedTaskIds: copy(fault.relatedTaskIds),
      sample: false,
      executed: false,
      hardwareControl: false,
    };
    await this.#persist(alert, actor, true, now);
    this.alerts.set(alert.alertId, alert);
    this.index.set(mergeKey(alert.gatewayId, alert.type, alert.subject), alert.alertId);
    return alert;
  }

  // 未恢复期间同一合并键只累加 lastAt/occurrences/basis/evidence，绝不新建 alertId。
  async #merge(alert, fault, now, actor) {
    const next = copy(alert);
    next.lastAt = Math.max(alert.lastAt, now);
    next.occurrences = alert.occurrences + 1;
    next.basis = copy(fault.basis);
    next.evidence = copy(fault.evidence);
    next.relatedTaskIds = copy(fault.relatedTaskIds);
    // 语义指纹只取「故障性质」：basis.code、证据引用集合、关联任务、状态。
    // sampleAgeMs/observedAt 这类每帧都变的观测量不进指纹，否则节流形同虚设、单条告警很快撞上事件上限。
    const fingerprint = value => JSON.stringify({
      code: value.basis?.code ?? null,
      refs: (value.evidence ?? []).map(item => item.ref).sort(),
      tasks: [...(value.relatedTaskIds ?? [])].sort(),
      state: value.state,
    });
    const material = fingerprint(next) !== fingerprint(alert);
    const meta = this.#metaOf(alert.alertId);
    if (!material && now - meta.persistedAt < this.mergeWindowMs) {
      // 纯发生累加：内存照常累加（下次落盘带上累计值），不消耗事件额度。
      this.alerts.set(alert.alertId, next);
      return false;
    }
    next.revision = alert.revision + 1;
    await this.#persist(next, actor, false, now);
    this.alerts.set(alert.alertId, next);
    return true;
  }

  async #recover(alert, now, actor, evidence) {
    const next = copy(alert);
    next.state = 'recovered';
    next.recoveredAt = now;
    next.revision = alert.revision + 1;
    next.recovery = {code: evidence.code, detail: clip(evidence.detail, 300), observedAt: now};
    await this.#persist(next, actor, false, now);
    this.alerts.set(alert.alertId, next);
    this.index.delete(mergeKey(alert.gatewayId, alert.type, alert.subject));
    return next;
  }

  list({gatewayId, type = null, severity = null, status = null, cursor = null, limit, source = {}} = {}) {
    this.#assertReady();
    if (!isId(gatewayId)) fail('gateway_required');
    if (type !== null && type !== undefined && !ALERT_TYPES.includes(type)) fail('invalid_alert_query');
    if (severity !== null && severity !== undefined && !ALERT_SEVERITIES.includes(severity)) fail('invalid_alert_query');
    if (status !== null && status !== undefined && !ALERT_STATES.includes(status)) fail('invalid_alert_query');
    const size = limit === undefined || limit === null ? ALERT_LIST_LIMIT_DEFAULT : limit;
    if (!Number.isSafeInteger(size) || size < 1 || size > ALERT_LIST_LIMIT_MAX) fail('invalid_alert_query');
    let bound = Number.POSITIVE_INFINITY;
    if (cursor !== null && cursor !== undefined) {
      if (typeof cursor !== 'string' || !/^s\d{1,16}$/.test(cursor)) fail('invalid_alert_query');
      bound = Number(cursor.slice(1));
      if (!Number.isSafeInteger(bound) || bound < 1) fail('invalid_alert_query');
    }
    const filter = {type: type ?? null, severity: severity ?? null, status: status ?? null};
    const filtered = [...this.alerts.values()].filter(alert => alert.gatewayId === gatewayId
      && (filter.type === null || alert.type === filter.type)
      && (filter.severity === null || alert.severity === filter.severity)
      && (filter.status === null || alert.state === filter.status));
    const counts = {all: filtered.length, open: 0, acknowledged: 0, recovered: 0, bySeverity: {low: 0, medium: 0, high: 0, critical: 0}};
    for (const alert of filtered) {
      if (alert.state === 'open') counts.open += 1;
      else if (alert.state === 'acknowledged') counts.acknowledged += 1;
      else if (alert.state === 'recovered') counts.recovered += 1;
      if (counts.bySeverity[alert.severity] !== undefined) counts.bySeverity[alert.severity] += 1;
    }
    const sorted = filtered.sort((a, b) => b.lastAt - a.lastAt || this.#metaOf(b.alertId).seq - this.#metaOf(a.alertId).seq);
    // 游标是"上一页最后一条"的行号：按当前排序找到它的位置再取其后一段。
    // 只按 seq 大小过滤会在 lastAt 与 seq 顺序不一致时（恢复会重写旧告警的行号）重复或漏项。
    const anchor = bound === Number.POSITIVE_INFINITY ? -1 : sorted.findIndex(alert => this.#metaOf(alert.alertId).seq === bound);
    const rest = bound === Number.POSITIVE_INFINITY ? sorted
      : anchor >= 0 ? sorted.slice(anchor + 1)
        : sorted.filter(alert => this.#metaOf(alert.alertId).seq < bound);
    const items = rest.slice(0, size).map(alert => this.#summary(alert));
    const truncated = rest.length > items.length;
    return {
      schemaVersion: 1,
      scope: 'alerts',
      generatedAt: this.now(),
      gatewayId,
      filters: filter,
      counts,
      countBasis: {...COUNT_BASIS},
      source: {
        connected: source.connected === true,
        lastAcceptedAt: isTime(source.lastAcceptedAt) ? source.lastAcceptedAt : null,
        lastReconcileError: this.lastReconcileError,
        evaluation: 'derived-on-read',
      },
      items,
      nextCursor: truncated && items.length ? 's' + this.#metaOf(items.at(-1).alertId).seq : null,
      truncated,
    };
  }

  #summary(alert) {
    return {
      alertId: alert.alertId,
      type: alert.type,
      subject: alert.subject,
      title: alert.title,
      severity: alert.severity,
      state: alert.state,
      acknowledged: alert.acknowledged,
      revision: alert.revision,
      firstAt: alert.firstAt,
      lastAt: alert.lastAt,
      recoveredAt: alert.recoveredAt,
      occurrences: alert.occurrences,
      basis: copy(alert.basis),
      ackCount: alert.acks.length,
      noteCount: alert.notes.length,
      sample: alert.sample === true,
      executed: false,
      hardwareControl: false,
    };
  }

  detail({gatewayId, alertId} = {}) {
    this.#assertReady();
    return {...copy(this.#alert(gatewayId, alertId)), executed: false, hardwareControl: false};
  }

  // 跨设备读取统一报"不存在"，不泄露其它设备是否有该告警。
  #alert(gatewayId, alertId) {
    if (!isId(gatewayId) || !isId(alertId)) fail('alert_not_found');
    const alert = this.alerts.get(alertId);
    if (!alert || alert.gatewayId !== gatewayId) fail('alert_not_found');
    return alert;
  }

  // 确认/备注：幂等键先于 revision 校验，保证「精确重试」不会因自己已 +1 而 409。
  submit(options = {}) { const snapshot = copy(options); return this.#enqueue(() => this.#submit(snapshot)); }
  async #submit({gatewayId, alertId, action, expectedRevision, note, text, actor} = {}) {
    this.#assertReady();
    if (action !== 'ack' && action !== 'note') fail('invalid_alert_note');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('invalid_alert_note');
    if (typeof actor !== 'string' || !actor.trim() || actor.length > 64) fail('invalid_alert_actor');
    let content = '';
    if (action === 'ack') {
      if (note !== undefined && note !== null && typeof note !== 'string') fail('invalid_alert_note');
      content = (note ?? '').trim();
      if (content.length > ALERT_NOTE_MAX) fail('invalid_alert_note');
    } else {
      if (typeof text !== 'string' || !text.trim() || text.length > ALERT_NOTE_MAX) fail('invalid_alert_note');
      content = text.trim();
    }
    const alert = this.#alert(gatewayId, alertId);
    const key = digest([alertId, action, String(expectedRevision), digest(content)].join('|'));
    const ledger = action === 'ack' ? alert.acks : alert.notes;
    const prior = ledger.find(entry => entry.key === key);
    if (prior) return {schemaVersion: 1, alert: this.detail({gatewayId, alertId}), duplicate: true, executed: false, hardwareControl: false};
    if (alert.revision !== expectedRevision) fail('alert_revision_conflict');

    const now = this.now();
    const next = copy(alert);
    next.revision = alert.revision + 1;
    if (action === 'ack') {
      next.acks.push({at: now, actor: actor.trim(), note: content, expectedRevision, key});
      next.acknowledged = true;
      // 确认只改变"是否已确认"，不改变故障是否仍在发生；已恢复的告警不因确认回退。
      if (next.state !== 'recovered') next.state = 'acknowledged';
    } else {
      next.notes.push({at: now, actor: actor.trim(), text: content, expectedRevision, key});
    }
    await this.#persist(next, actor.trim(), false, now);
    this.alerts.set(next.alertId, next);
    return {schemaVersion: 1, alert: this.detail({gatewayId, alertId}), duplicate: false, executed: false, hardwareControl: false};
  }
}

// 恢复证据：只认契约 §3 指定的证据，没有证据就保持未恢复（绝不因"这次没派生出来"而猜恢复）。
function recoveryEvidence(alert, device) {
  switch (alert.type) {
    case 'telemetry_stale':
      return device.fresh ? {code: 'fresh_frames', detail: '收到新鲜帧，帧年龄 ' + device.age + 'ms < ' + TTL_MS + 'ms'} : null;
    case 'device_offline':
      return device.fresh ? {code: 'fresh_frames', detail: '设备恢复上报，帧年龄 ' + device.age + 'ms < ' + TTL_MS + 'ms'} : null;
    case 'collection_error':
      return {code: 'not_derived', detail: '本次派生未再出现该采集异常'};
    case 'sensor_channel_invalid':
      // 离线时没有当前质量证据，不伪造恢复。
      return device.online ? {code: 'not_derived', detail: '设备在线且该通道已恢复有效'} : null;
    case 'model_task_failed':
      return device.tasks.some(task => taskModelSucceeded(task) && task.finishedAt !== null && task.finishedAt >= alert.lastAt)
        ? {code: 'pipeline_success', detail: '同设备后续模型任务已完成'}
        : null;
    default:
      return null;
  }
}

export default AlertCenter;
