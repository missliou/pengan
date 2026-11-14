// 告警中心前端回归（ALERT-CENTER-20261103，执行者 alert-web）。
// 逐条对应 docs/告警中心接口契约.md 第 6 节的 8 条 Web 交互契约：
//   ① 导航未处理数徽标口径（open+acknowledged，缺项即隐藏）
//   ② 统计区 all/open/acknowledged/recovered + countBasis 原文 + 分严重程度
//   ③ 类型/严重程度/状态筛选 + 游标分页 + 空态「暂无告警」
//   ④ 详情 basis / occurrences / firstAt / lastAt / recoveredAt / 确认记录 / 备注时间轴
//   ⑤ admin 可写、viewer 只读、提交中禁用防重复、失败「未确认」保留输入、409 重读
//   ⑥ 15s 轮询只替换统计与列表容器、卸载清定时器、迟到响应按 generation 丢弃
//   ⑦ 演示模式带「样例」且不调用真实写接口
//   ⑧ 后端不可达显示「后端未连接」，不渲染成空列表或 0 告警
// 用最小 DOM 宿主跑真实页面模块；这里只证明行为与文案，不作像素级布局证据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, button, input, find, flush } from './helpers/dom.mjs';
import renderAlerts, { alertPendingTotal, applyAlertBadge } from '../src/pages/alerts.js';
import { el } from '../src/lib/dom.js';
import { PageScope, MutationGate } from '../src/lib/session.js';
import { ApiError } from '../src/lib/api.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

function context(t, dataSource, extra = {}) {
  const scope = new PageScope(); t.after(() => scope.dispose());
  const state = { gatewayId: 'dayu-a', user: { username: extra.username || 'admin', role: extra.role || 'admin' }, alertPending: null };
  const marks = [];
  const ctx = {
    scope, gate: new MutationGate(), state, dataSource, demoMode: Boolean(extra.demoMode), live: null,
    markStatus: () => { marks.push(state.alertPending); },
    setConnection() {}, notify() {}, navigate() {}, ...extra,
  };
  ctx.marks = marks;
  return ctx;
}

// 替身定时器：只记录 setInterval 注册，不真的等待 15 秒。
function fakeTimers(t) {
  const oldSet = globalThis.setInterval, oldClear = globalThis.clearInterval;
  const entries = [], live = new Set(); let seq = 0;
  globalThis.setInterval = (fn, ms) => { const id = ++seq; live.add(id); entries.push({ id, fn, ms }); return id; };
  globalThis.clearInterval = (id) => { live.delete(id); };
  t.after(() => { globalThis.setInterval = oldSet; globalThis.clearInterval = oldClear; });
  return { entries, live };
}

const rowButton = (root, alertId) => find(root, (n) => n.tagName === 'button' && n.dataset?.alertId === alertId);

async function change(node, value) {
  node.value = value;
  for (const fn of node.listeners?.change || []) await fn({ target: node });
}

const COUNT_BASIS = {
  all: '该设备全部告警（含已恢复）',
  open: '发生中且未确认',
  acknowledged: '发生中且已确认',
  recovered: '已恢复，不再计入未处理',
};

const item = (over = {}) => ({
  alertId: 'alert_open', gatewayId: 'dayu-a', type: 'device_offline', subject: 'session',
  title: '设备离线', severity: 'high', state: 'open', acknowledged: false, revision: 3,
  firstAt: 1_000, lastAt: 4_000, recoveredAt: null, occurrences: 2,
  basis: { code: 'stale_frames', detail: '最近一帧年龄达到离线阈值', observedAt: 4_000, sampleAgeMs: 4_000, ttlMs: 10_000 },
  ackCount: 0, noteCount: 0, sample: false, ...over,
});

const listOf = (items = [item()], over = {}) => ({
  schemaVersion: 1, scope: 'alerts', generatedAt: 5_000, gatewayId: 'dayu-a',
  filters: { type: null, severity: null, status: null },
  counts: { all: 3, open: 1, acknowledged: 1, recovered: 1, bySeverity: { low: 0, medium: 1, high: 1, critical: 1 } },
  countBasis: COUNT_BASIS,
  source: { connected: true, lastAcceptedAt: 4_000, lastReconcileError: null, evaluation: 'derived-on-read' },
  items, nextCursor: null, truncated: false, ...over,
});

const detailOf = (over = {}) => ({
  ...item(),
  evidence: [{ ref: 'sampleAgeMs', value: '4000', observedAt: 4_000, fresh: false }],
  acks: [{ at: 4_100, actor: 'admin-1', note: '现场已确认设备离线' }],
  notes: [{ at: 4_200, actor: 'admin-2', text: '已到场检查供电与串口线' }],
  relatedTaskIds: [],
  executed: false, hardwareControl: false, ...over,
});

const receiptOf = (over = {}) => ({
  schemaVersion: 1, alert: detailOf({ acknowledged: true, state: 'acknowledged', revision: 4 }),
  duplicate: false, executed: false, hardwareControl: false, ...over,
});

function source(extra = {}) {
  return {
    listAlerts: async () => listOf(),
    readAlert: async () => detailOf(),
    acknowledgeAlert: async () => receiptOf(),
    noteAlert: async () => receiptOf({ alert: detailOf({ revision: 4 }) }),
    ...extra,
  };
}

// ---------- ① 导航徽标口径 ----------

test('alerts: 未处理数=open+acknowledged，缺项即未知，0 与未知都隐藏徽标', async (t) => {
  installDom(t);
  assert.equal(alertPendingTotal({ open: 2, acknowledged: 3 }), 5);
  assert.equal(alertPendingTotal({ open: 0, acknowledged: 0 }), 0);
  assert.equal(alertPendingTotal({ open: 2 }), null);                     // 半边数字不当结论
  assert.equal(alertPendingTotal({ open: 2, acknowledged: -1 }), null);
  assert.equal(alertPendingTotal(null), null);
  const badge = el('span', { class: 'nav-badge', dataset: { badge: 'alerts' }, hidden: true });
  applyAlertBadge(badge, 5);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '5');
  applyAlertBadge(badge, 0);        // 读到 0：不显示 0 徽标
  assert.equal(badge.hidden, true);
  applyAlertBadge(badge, null);     // 读不到：隐藏，不显示 0
  assert.equal(badge.hidden, true);
  assert.equal(badge.textContent, '');
});

// ---------- ② 统计区 ----------

test('alerts: 统计区展示四项计数与 countBasis 原文，并给出分严重程度', async (t) => {
  installDom(t);
  const root = await renderAlerts(context(t, source()));
  await flush();
  assert.match(root.textContent, /全部告警3/);
  assert.match(root.textContent, /发生中未确认1/);
  assert.match(root.textContent, /发生中已确认1/);
  assert.match(root.textContent, /已恢复1/);
  assert.match(root.textContent, new RegExp(COUNT_BASIS.all));            // 口径文案原样，不自造
  assert.match(root.textContent, new RegExp(COUNT_BASIS.open));
  assert.match(root.textContent, new RegExp(COUNT_BASIS.recovered));
  assert.match(root.textContent, /high 1/);                               // 分严重程度
  assert.match(root.textContent, /derived-on-read/);
});

test('alerts: 设备未连接显示「未连接」，不拿 0 冒充正常', async (t) => {
  installDom(t);
  const ds = source({ listAlerts: async () => listOf([], { source: { connected: false, lastAcceptedAt: null, lastReconcileError: null, evaluation: 'derived-on-read' } }) });
  const root = await renderAlerts(context(t, ds));
  await flush();
  assert.match(root.textContent, /未连接/);
  assert.doesNotMatch(root.textContent, /全部告警/);                      // 统计网格整体不渲染
  assert.doesNotMatch(root.textContent, /全部告警0/);
});

// ---------- ③ 列表 / 筛选 / 分页 / 空态 ----------

test('alerts: 列表项显示设备、类型、最近发生时间与状态徽标，末页禁用「下一页」', async (t) => {
  installDom(t);
  const root = await renderAlerts(context(t, source()));
  await flush();
  assert.match(root.textContent, /device_offline/);
  assert.match(root.textContent, /设备 dayu-a/);
  assert.match(root.textContent, /最近发生 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  assert.match(root.textContent, /发生中未确认/);
  assert.match(root.textContent, /已到末页/);
  assert.equal(button(root, '下一页').disabled, true);
  assert.equal(button(root, '返回首屏').disabled, true);
});

test('alerts: 游标分页优先用服务端 nextCursor，到末页禁用并可返回首屏', async (t) => {
  installDom(t);
  const calls = [];
  const first = listOf([item({ alertId: 'alert_p1' })], { nextCursor: 's2' });
  const second = listOf([item({ alertId: 'alert_p2' })], { nextCursor: null });
  const ds = source({ listAlerts: async (params) => { calls.push(params); return params?.cursor === 's2' ? second : first; } });
  const root = await renderAlerts(context(t, ds));
  await flush();
  assert.ok(rowButton(root, 'alert_p1'));                                 // 首屏锚点
  assert.equal(button(root, '下一页').disabled, false);

  await button(root, '下一页').click();
  await flush();
  assert.equal(calls.at(-1).cursor, 's2');
  assert.ok(rowButton(root, 'alert_p2'));
  assert.equal(rowButton(root, 'alert_p1'), undefined);                   // 换页后旧行被替换，不叠加
  assert.equal(button(root, '下一页').disabled, true);

  await button(root, '返回首屏').click();
  await flush();
  assert.equal(calls.at(-1).cursor, null);
  assert.ok(rowButton(root, 'alert_p1'));
  assert.equal(rowButton(root, 'alert_p2'), undefined);
});

test('alerts: 类型/严重程度/状态筛选重置游标并透传，带筛选时不拿过滤后 counts 写徽标', async (t) => {
  installDom(t);
  const calls = [];
  const filtered = listOf([item()], { counts: { all: 1, open: 0, acknowledged: 0, recovered: 1, bySeverity: { low: 0, medium: 1, high: 0, critical: 0 } } });
  const ds = source({ listAlerts: async (params) => { calls.push(params); return params?.type || params?.severity || params?.status ? filtered : listOf(); } });
  const ctx = context(t, ds);
  const root = await renderAlerts(ctx);
  await flush();
  assert.equal(ctx.state.alertPending, 2);                                 // open 1 + acknowledged 1

  await change(input(root, 'alert-type'), 'device_offline');
  await flush();
  assert.equal(calls.at(-1).type, 'device_offline');
  assert.equal(calls.at(-1).cursor, null);
  assert.match(root.textContent, /筛选后集合/);                            // 明确说明计数是过滤后集合
  assert.equal(ctx.state.alertPending, 2);                                 // 过滤后的 0 没有污染徽标

  await change(input(root, 'alert-severity'), 'high');
  await flush();
  assert.equal(calls.at(-1).severity, 'high');

  await change(input(root, 'alert-status'), 'recovered');
  await flush();
  assert.equal(calls.at(-1).status, 'recovered');
});

test('alerts: 空列表显示「暂无告警」明确空态，不虚构任何记录', async (t) => {
  installDom(t);
  const root = await renderAlerts(context(t, source({ listAlerts: async () => listOf([]) })));
  await flush();
  assert.match(root.textContent, /暂无告警/);
  assert.match(root.textContent, /未虚构/);
  assert.match(root.textContent, /不代表设备一定正常/);
  assert.doesNotMatch(root.textContent, /alert_open/);
});

// ---------- ④ 详情 ----------

test('alerts: 详情展示 basis、occurrences、firstAt/lastAt/recoveredAt、恢复情况、确认记录与备注时间轴', async (t) => {
  installDom(t);
  const ctx = context(t, source());
  const root = await renderAlerts(ctx);
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  const text = root.textContent;
  assert.match(text, /stale_frames/);                                      // basis.code
  assert.match(text, /最近一帧年龄达到离线阈值/);                           // basis.detail
  assert.match(text, /累计发生 2 次/);                                      // occurrences
  assert.match(text, /首次发生/);
  assert.match(text, /恢复时间 recoveredAt/);
  assert.match(text, /无（未恢复或未提供）/);
  assert.match(text, /未恢复：故障可能仍在发生/);                            // 确认不等于恢复
  assert.match(text, /确认记录（1 条）/);
  assert.match(text, /admin-1/);                                           // 确认处理人
  assert.match(text, /现场已确认设备离线/);                                 // 确认内容
  assert.match(text, /处理备注时间轴（1 条）/);
  assert.match(text, /admin-2/);                                           // 备注处理人
  assert.match(text, /已到场检查供电与串口线/);                              // 备注内容
  assert.match(text, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);          // 时间列
});

test('alerts: 已恢复缺 recoveredAt 时如实说未给出，不补造恢复时间', async (t) => {
  installDom(t);
  const ds = source({ readAlert: async () => detailOf({ state: 'recovered', acknowledged: true, recoveredAt: null }) });
  const root = await renderAlerts(context(t, ds));
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  assert.match(root.textContent, /状态为已恢复，但服务端未给出恢复时间/);
  assert.match(root.textContent, /无（未恢复或未提供）/);
});

// ---------- ⑤ 确认与备注 ----

test('alerts: viewer 只读——确认/备注禁用且不发送任何写请求', async (t) => {
  installDom(t);
  let writes = 0;
  const ds = source({ acknowledgeAlert: async () => { writes++; }, noteAlert: async () => { writes++; } });
  const root = await renderAlerts(context(t, ds, { role: 'viewer', username: 'v' }));
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  assert.match(root.textContent, /只读/);
  assert.equal(button(root, '确认告警').disabled, true);
  assert.equal(button(root, '提交备注').disabled, true);
  assert.equal(input(root, 'alert-note').disabled, true);
  await button(root, '确认告警').click();
  await button(root, '提交备注').click();
  await flush();
  assert.equal(writes, 0);
});

test('alerts: admin 确认携带 expectedRevision，提交中禁用防重复，成功后不重建备注输入框', async (t) => {
  installDom(t);
  const gate = deferred();
  const calls = [];
  const ds = source({ acknowledgeAlert: async (body) => { calls.push(body); await gate.promise; return receiptOf(); } });
  const root = await renderAlerts(context(t, ds));
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  const noteBox = input(root, 'alert-note');
  noteBox.value = '现场已复核，等待恢复';

  await button(root, '确认告警').click();
  await flush();
  assert.deepEqual(calls[0], { alertId: 'alert_open', expectedRevision: 3 });
  assert.equal(button(root, '确认告警').disabled, true);                   // 提交中禁用
  assert.equal(button(root, '提交备注').disabled, true);
  await button(root, '确认告警').click();                                  // 第二次点击不产生第二次提交
  await flush();
  assert.equal(calls.length, 1);

  gate.resolve();
  await flush();
  assert.match(root.textContent, /服务端已确认保存确认记录/);
  assert.equal(input(root, 'alert-note'), noteBox);                       // 只更新详情区，备注框没被重建
  assert.equal(noteBox.value, '现场已复核，等待恢复');                      // 正在填写的备注不被确认吞掉
});

test('alerts: admin 备注提交携带文本与 expectedRevision，成功后清空输入', async (t) => {
  installDom(t);
  const calls = [];
  const ds = source({ noteAlert: async (body) => { calls.push(body); return receiptOf({ alert: detailOf({ revision: 4 }) }); } });
  const root = await renderAlerts(context(t, ds));
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  const noteBox = input(root, 'alert-note');
  noteBox.value = '已更换串口线，观察中';
  await button(root, '提交备注').click();
  await flush();
  assert.deepEqual(calls[0], { alertId: 'alert_open', expectedRevision: 3, text: '已更换串口线，观察中' });
  assert.match(root.textContent, /服务端已确认保存备注/);
  assert.equal(input(root, 'alert-note').value, '');
});

test('alerts: 提交失败显示「未确认」并保留已填写的备注', async (t) => {
  installDom(t);
  const ds = source({ noteAlert: async () => { throw new ApiError('后端不可达', { kind: 'offline' }); } });
  const root = await renderAlerts(context(t, ds));
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  const noteBox = input(root, 'alert-note');
  noteBox.value = '断电检查未完成';
  await button(root, '提交备注').click();
  await flush();
  assert.match(root.textContent, /未确认/);
  assert.match(root.textContent, /后端不可达/);
  assert.equal(input(root, 'alert-note').value, '断电检查未完成');
});

test('alerts: 版本冲突 409 提示已被他人更新，并可重新读取详情', async (t) => {
  installDom(t);
  let reads = 0;
  const ds = source({
    acknowledgeAlert: async () => { throw new ApiError('请求失败（alert_revision_conflict）', { kind: 'http', status: 409, code: 'alert_revision_conflict' }); },
    readAlert: async () => { reads++; return detailOf({ revision: 3 + reads }); },
  });
  const root = await renderAlerts(context(t, ds));
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  const before = reads;
  await button(root, '确认告警').click();
  await flush();
  assert.match(root.textContent, /已被其他人更新/);
  assert.match(root.textContent, /重新读取详情/);
  await button(root, '重新读取详情').click();
  await flush();
  assert.equal(reads, before + 1);                                        // 真的重新读取，不是只改文案
});

// ---------- ⑥ 轮询 / 卸载 ----------

test('alerts: 15s 轮询只替换统计与列表容器，不重建详情输入框、不重放入场动画', async (t) => {
  installDom(t);
  const timers = fakeTimers(t);
  const calls = []; let reads = 0;
  const ds = source({
    listAlerts: async (params) => { calls.push(params); return listOf(); },
    readAlert: async () => { reads++; return detailOf(); },
  });
  const root = await renderAlerts(context(t, ds));
  await flush();
  await rowButton(root, 'alert_open').click();
  await flush();
  const noteBox = input(root, 'alert-note');
  noteBox.value = '轮询不要冲掉我';

  assert.equal(calls.length, 1);
  assert.equal(timers.entries.length, 1);
  assert.equal(timers.entries[0].ms, 15_000);

  await timers.entries[0].fn();
  await flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);                                   // 轮询沿用当前筛选与游标
  assert.equal(reads, 1);                                                 // 详情不参与轮询、不重读
  assert.equal(input(root, 'alert-note'), noteBox);                       // 输入框节点没有被重建
  assert.equal(noteBox.value, '轮询不要冲掉我');
  const liveBox = find(root, (n) => String(n.className).startsWith('alert-live'));
  assert.match(liveBox.className, /alert-polling/);                       // 静默替换：入场动画关闭
});

test('alerts: 页面卸载清理定时器，迟到响应按 generation 丢弃', async (t) => {
  installDom(t);
  const timers = fakeTimers(t);
  const calls = [];
  const pending = deferred();
  const ds = source({ listAlerts: async (params) => { calls.push(params); return pending.promise; } });
  const ctx = context(t, ds);
  const root = await renderAlerts(ctx);
  await flush();
  assert.equal(timers.live.size, 1);                                      // 定时器已注册
  const entry = timers.entries[0];

  ctx.scope.dispose();
  assert.equal(timers.live.size, 0);                                      // 卸载即清理

  pending.resolve(listOf([item({ alertId: 'alert_late' })]));
  await flush();
  assert.doesNotMatch(root.textContent, /alert_late/);                    // 迟到响应被丢弃
  assert.equal(ctx.state.alertPending, null);                             // 也没有借迟到数据改徽标

  await entry.fn();
  await flush();
  assert.equal(calls.length, 1);                                          // 卸载后不再发轮询请求
});

// ---------- ⑦ 演示模式 ----------

test('alerts: 演示模式样例带「样例」标记，确认/备注禁用且不调用真实写接口', async (t) => {
  installDom(t);
  let touched = 0;
  const boom = () => { touched++; throw new Error('演示模式不得触达真实接口'); };
  const ds = { listAlerts: boom, readAlert: boom, acknowledgeAlert: boom, noteAlert: boom };
  const root = await renderAlerts(context(t, ds, { demoMode: true }));
  await flush();
  assert.match(root.textContent, /演示模式/);
  assert.match(root.textContent, /样例/);
  assert.match(root.textContent, /全部告警2/);                             // 样例统计，不是真实数字
  assert.equal(touched, 0);
  assert.equal(button(root, '确认告警').disabled, true);
  assert.equal(button(root, '提交备注').disabled, true);
  assert.equal(button(root, '刷新告警').disabled, true);
  assert.equal(input(root, 'alert-note').disabled, true);
  await button(root, '确认告警').click();
  await button(root, '提交备注').click();
  await flush();
  assert.equal(touched, 0);
});

// ---------- ⑧ 后端不可达 ----------

test('alerts: 后端不可达显示「后端未连接」，不渲染成空列表或 0 告警', async (t) => {
  installDom(t);
  const ctx = context(t, source({ listAlerts: async () => { throw new ApiError('后端不可达', { kind: 'offline' }); } }));
  const root = await renderAlerts(ctx);
  await flush();
  assert.match(root.textContent, /后端未连接/);
  assert.doesNotMatch(root.textContent, /暂无告警/);                       // 读不到 ≠ 没有告警
  assert.doesNotMatch(root.textContent, /全部告警/);                       // 一个数字都不编
  assert.equal(button(root, '下一页').disabled, true);
  assert.equal(ctx.state.alertPending, null);
  assert.equal(ctx.marks.at(-1), null);                                   // 徽标被显式清空，不沿用旧数字
});

// ---------- 导航注册（app.js 顶层会挂 window/document 监听，不能整模块导入，只核对注册点） ----------

test('alerts: app.js 注册「告警中心」导航，徽标与页面共用 applyAlertBadge，移除含义不明的信号灯', async () => {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const app = readFileSync(dir + 'app.js', 'utf8');
  assert.match(app, /\{ id: 'alerts', title: '告警中心', sec: '日常监测', badge: 'alerts', render: renderAlerts }/);
  assert.match(app, /import renderAlerts, \{ alertPendingTotal, applyAlertBadge \} from '\.\/pages\/alerts\.js'/);
  assert.match(app, /state\.alertPending = alertPendingTotal\(data\?\.counts\)/);      // 只数 counts，不数 items
  assert.match(app, /applyAlertBadge\(badge, state\.alertPending\)/);
  assert.match(app, /'\.nav-badge\[data-badge\]'/);
  assert.doesNotMatch(app, /dataset: \{dot: p\.signal\}/); // 用户要求移除侧栏信号灯
  assert.doesNotMatch(app, /signal: 'review'/);
  assert.match(app, /void probeAlertPending\(\)/);                        // 进入会话/切设备/健康探测都会刷新
  assert.match(app, /state\.alertPending = null/);                        // 退出登录与离线都会清掉旧数字
});

test('alerts: selecting B while its detail is pending cannot submit a note to A', async t => {
 installDom(t);fakeTimers(t);const pending=deferred(),writes=[];
 const root=await renderAlerts(context(t,source({listAlerts:async()=>listOf([item({alertId:'a'}),item({alertId:'b'})]),readAlert:id=>id==='b'?pending.promise:Promise.resolve(detailOf({alertId:id})),noteAlert:async body=>{writes.push(body);return receiptOf();}})));
 await flush();await rowButton(root,'a').click();await flush();await rowButton(root,'b').click();
 find(root,n=>n.tagName==='textarea').value='draft for B';
 assert.equal(button(root,'提交备注').disabled,true);await button(root,'提交备注').click();assert.equal(writes.length,0);
 pending.resolve(detailOf({alertId:'b'}));await flush();assert.equal(button(root,'提交备注').disabled,false);
});

test('alerts: late success/failure for A cannot overwrite B or clear its draft', async t => {
 installDom(t);fakeTimers(t);
 for(const failed of [false,true]){
  const pending=deferred();const root=await renderAlerts(context(t,source({listAlerts:async()=>listOf([item({alertId:'a'}),item({alertId:'b'})]),readAlert:async id=>detailOf({alertId:id}),noteAlert:()=>pending.promise})));
  await flush();await rowButton(root,'a').click();await flush();const field=find(root,n=>n.tagName==='textarea');field.value='comment A';const writing=button(root,'提交备注').click();
  await rowButton(root,'b').click();await flush();field.value='draft B';
  if(failed)pending.reject(Error('old A failure'));else pending.resolve(receiptOf({alert:detailOf({alertId:'a'})}));
  await writing;await flush();assert.equal(field.value,'draft B');assert.doesNotMatch(root.textContent,/old A failure/);assert.equal(button(root,'提交备注').disabled,false);
 }
});
