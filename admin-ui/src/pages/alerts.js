// 告警中心（ALERT-CENTER-20261103）。
//
// 诚实与安全边界（与 docs/告警中心接口契约.md 第 5、6 节一一对应）：
//  - 统计与口径一律取服务端 counts / countBasis，前端不自造数字；
//  - source.connected=false（设备尚无采集会话）显示「未连接」，不把 0 当成「没有故障」；
//  - 读取失败显示「后端未连接」，绝不渲染成空列表或 0 条告警；
//  - 确认只追加确认记录，不改变故障是否仍在发生；备注只追加，不覆盖既有记录；
//  - viewer 只读：按钮禁用且不发送写请求；服务端仍会二次校验；
//  - 演示模式带「样例」标记，确认与备注禁用且不调用真实写接口；
//  - 15s 轮询只替换统计与列表容器：不重建详情输入框、不重放入场动画；
//  - 所有后端文本走 textContent；缺值显示「未知」，不补数、不补时间。
import { el, chip, button, banner, sectionCard, emptyState, skeleton, clear, spinner, statCard } from '../lib/dom.js';
import { fmtDateTime, fmtAge } from '../lib/format.js';

const LIMIT = 20;
const POLL_MS = 15_000;
const NOTE_MAX = 500;

const TYPE_LABEL = {
  device_offline: '设备离线',
  telemetry_stale: '遥测数据过期',
  collection_error: '采集异常',
  sensor_channel_invalid: '传感器通道无效',
  model_task_failed: '模型任务失败',
};
const STATE_LABEL = { open: '发生中未确认', acknowledged: '发生中已确认', recovered: '已恢复' };
const STATE_KIND = { open: 'bad', acknowledged: 'warn', recovered: 'ok' };
const SEVERITY_KIND = { low: 'info', medium: 'warn', high: 'bad', critical: 'bad' };
const NON_NEGATIVE = (value) => Number.isSafeInteger(value) && value >= 0;

const severityKind = (severity) => SEVERITY_KIND[severity] || 'unknown';
const countText = (value) => (NON_NEGATIVE(value) ? String(value) : '未知');
const textOf = (value, fallback = '未知') => (value === null || value === undefined || value === '' ? fallback : String(value));

// 未处理数量 = 发生中未确认 + 发生中已确认（契约 6.1）。
// 任一项缺失就返回 null：只把半边数字相加，会比事实更确定。
export function alertPendingTotal(counts) {
  const open = counts?.open, acknowledged = counts?.acknowledged;
  if (!NON_NEGATIVE(open) || !NON_NEGATIVE(acknowledged)) return null;
  return open + acknowledged;
}

// 导航徽标渲染：app.js 与页面共用这一条路径，避免两处口径打架。
// 读不到数字（null）就隐藏徽标——不显示 0，也不显示空占位。
export function applyAlertBadge(badge, pending) {
  if (!badge) return badge;
  if (Number.isSafeInteger(pending) && pending > 0) {
    badge.hidden = false;
    badge.textContent = String(pending);
  } else {
    badge.hidden = true;
    badge.textContent = '';
  }
  return badge;
}

// 错误码 → 面向人的解释。只映射契约里有的码，未知码原样透出，不编造翻译。
function explain(code, message) {
  if (code === 'alert_revision_conflict') return '该告警已被其他人更新，当前版本已过期，本次未保存。请先「重新读取详情」拿到最新版本，再重新提交。';
  if (code === 'alert_not_found') return '未找到该告警，或它属于其它设备。本次未保存，请刷新告警列表。';
  if (code === 'alert_persist_failed') return '服务端存储写入失败，本次未保存。请刷新核对后再试。';
  if (code === 'alert_store_full' || code === 'alert_event_limit') return '服务端告警容量或单条事件数已达上限，本次未保存（服务端不会淘汰旧记录）。';
  if (code === 'invalid_alert_note' || code === 'invalid_alert_query') return '提交内容或查询参数不符合服务端校验，本次未保存。';
  if (code === 'forbidden' || code === 'admin_forbidden' || code === 'csrf_required' || code === 'origin_denied') return '会话已失效或权限不足，请重新登录。本次未保存。';
  if (code === 'gateway_required') return '尚未选择设备，无法读取该设备的告警。';
  return message || code || '未知错误';
}

function failureBanner(error) {
  const kind = error?.kind === 'offline' ? 'bad' : 'warn';
  if (error?.kind === 'offline') return banner('bad', '后端未连接：告警列表读取失败。这里不会显示空列表或 0 条告警——那会把「读不到」伪装成「没有故障」。');
  if (error?.kind === 'forbidden') return banner('warn', '没有权限或管理会话已失效：' + explain(error.code, error.message));
  return banner(kind, '告警列表读取失败：' + explain(error?.code, error?.message));
}

// 恢复情况：recoveredAt 有值才说"已恢复于"；状态为 recovered 却没时间就如实说不知道，不补造。
function recoveryText(alert) {
  if (Number.isFinite(alert?.recoveredAt) && alert.recoveredAt > 0) return '已恢复于 ' + fmtDateTime(alert.recoveredAt);
  if (alert?.state === 'recovered') return '状态为已恢复，但服务端未给出恢复时间（不补造时间）';
  return '未恢复：故障可能仍在发生（确认不等于恢复）';
}

// ---------- 演示样例（只有站点演示开关打开时才会被引用） ----------
// 字段形状与契约 5.1 / 5.2 对齐，内容一律标注为样例，不代表真实设备或真实告警。
function demoPayload() {
  const now = Date.now();
  const items = [
    {
      alertId: 'alert_demo_offline', gatewayId: 'dayu-demo', type: 'device_offline', subject: 'session',
      title: '设备离线（演示样例）', severity: 'high', state: 'open', acknowledged: false, revision: 3,
      firstAt: now - 420_000, lastAt: now - 65_000, recoveredAt: null, occurrences: 4,
      basis: { code: 'stale_frames', detail: '演示样例：最近一帧年龄达到离线阈值，之后未再收到新鲜帧', observedAt: now - 65_000, sampleAgeMs: 65_000, ttlMs: 10_000 },
      ackCount: 0, noteCount: 1, sample: true,
    },
    {
      alertId: 'alert_demo_collect', gatewayId: 'dayu-demo', type: 'collection_error', subject: 'invalid_hsp_sample',
      title: '采集异常：样本无效（演示样例）', severity: 'medium', state: 'recovered', acknowledged: true, revision: 5,
      firstAt: now - 900_000, lastAt: now - 800_000, recoveredAt: now - 700_000, occurrences: 2,
      basis: { code: 'invalid_hsp_sample', detail: '演示样例：快照 reason 属于采集异常集合', observedAt: now - 800_000, sampleAgeMs: 1_200, ttlMs: 10_000 },
      ackCount: 1, noteCount: 1, sample: true,
    },
  ];
  return {
    schemaVersion: 1, scope: 'alerts', generatedAt: now, gatewayId: 'dayu-demo',
    filters: { type: null, severity: null, status: null },
    counts: { all: 2, open: 1, acknowledged: 0, recovered: 1, bySeverity: { low: 0, medium: 1, high: 1, critical: 0 } },
    countBasis: {
      all: '该设备全部告警（含已恢复）',
      open: '发生中且未确认',
      acknowledged: '发生中且已确认',
      recovered: '已恢复，不再计入未处理',
    },
    source: { connected: true, lastAcceptedAt: now - 65_000, lastReconcileError: null, evaluation: 'derived-on-read' },
    items, nextCursor: null, truncated: false,
  };
}

function demoDetail(alertId) {
  const now = Date.now();
  const items = demoPayload().items;
  const base = items.find((item) => item.alertId === alertId) || items[0];
  const offline = base.alertId === 'alert_demo_offline';
  return {
    ...base,
    evidence: offline
      ? [{ ref: 'sampleAgeMs', value: '65000', observedAt: now - 65_000, fresh: false },
         { ref: 'lastAcceptedAt', value: String(now - 65_000), observedAt: now - 65_000, fresh: false }]
      : [{ ref: 'snapshot.reason', value: 'invalid_hsp_sample', observedAt: now - 800_000, fresh: false }],
    acks: base.acknowledged ? [{ at: now - 760_000, actor: 'demo-admin', note: '演示样例：已确认，等待下一次采集核对' }] : [],
    notes: offline
      ? [{ at: now - 60_000, actor: 'demo-admin', text: '演示样例：已到场检查供电与串口线，等待恢复。' }]
      : [{ at: now - 750_000, actor: 'demo-admin', text: '演示样例：更换样本文件后恢复。' }],
    relatedTaskIds: offline ? [] : ['demo-task-0001'],
    executed: false, hardwareControl: false, sample: true,
  };
}

export default async function renderAlerts(ctx) {
  const wrap = el('div', { class: 'alert-page' });
  const canWrite = !ctx.demoMode && ctx.state?.user?.role === 'admin';
  const live = el('div', { class: 'alert-live' });
  const statsHost = el('div', { class: 'alert-stats' }, [skeleton(1)]);
  const listHost = el('div', {}, [skeleton(2)]);
  const detailHost = el('div', {});
  const feedback = el('div', { 'data-role': 'alert-feedback' });

  // 筛选与分页控件常驻：轮询只替换下面的 listHost，不动用户正在操作的表单。
  const typeFilter = el('select', { id: 'alert-type', 'aria-label': '按类型筛选', disabled: ctx.demoMode }, [
    el('option', { value: '', text: '全部类型', selected: true }),
    ...Object.entries(TYPE_LABEL).map(([value, label]) => el('option', { value, text: value + ' · ' + label })),
  ]);
  const severityFilter = el('select', { id: 'alert-severity', 'aria-label': '按严重程度筛选', disabled: ctx.demoMode }, [
    el('option', { value: '', text: '全部严重程度', selected: true }),
    el('option', { value: 'low', text: 'low · 低' }),
    el('option', { value: 'medium', text: 'medium · 中' }),
    el('option', { value: 'high', text: 'high · 高' }),
    el('option', { value: 'critical', text: 'critical · 严重' }),
  ]);
  const statusFilter = el('select', { id: 'alert-status', 'aria-label': '按状态筛选', disabled: ctx.demoMode }, [
    el('option', { value: '', text: '全部状态', selected: true }),
    el('option', { value: 'open', text: 'open · 发生中未确认' }),
    el('option', { value: 'acknowledged', text: 'acknowledged · 发生中已确认' }),
    el('option', { value: 'recovered', text: 'recovered · 已恢复' }),
  ]);
  const pageInfo = el('span', { class: 'muted' });

  let cursor = null, nextCursor = null, pageIndex = 0;
  let selectedId = '', currentAlert = null, busy = false;
  let loadGeneration = 0, detailGeneration = 0;

  const firstBtn = button('返回首屏', () => { if (cursor === null) return; cursor = null; pageIndex = 0; void load(); }, { variant: 'secondary small', disabled: true });
  const nextBtn = button('下一页', () => { if (!nextCursor) return; cursor = nextCursor; pageIndex++; void load(); }, { variant: 'secondary small', disabled: true });
  const refreshBtn = button('刷新告警', () => { void load(); }, { variant: 'secondary small', disabled: ctx.demoMode });

  // 提交区：页面级常驻节点。轮询与详情重绘都不会重建这里的输入框，
  // 因此正在填写的备注不会被刷掉，失败也能原样保留。
  const noteBox = el('textarea', {
    id: 'alert-note', rows: 3, maxlength: String(NOTE_MAX), disabled: ctx.demoMode,
    placeholder: '填写处理备注（只追加，不能覆盖历史；最多 ' + NOTE_MAX + ' 字）。不要填写密码、密钥或家庭网络信息。',
  });
  const ackBtn = button('确认告警', () => { void submit('ack'); }, { disabled: true });
  const noteBtn = button('提交备注', () => { void submit('note'); }, { variant: 'secondary', disabled: true });
  const reloadBtn = button('重新读取详情', () => { void openDetail(); }, { variant: 'secondary small', disabled: true });
  const submitHint = el('p', { class: 'muted mt-sm' });

  const listCard = el('section', { class: 'card' }, [
    el('h3', { text: '告警列表 · ' + (ctx.state?.gatewayId || '未选择设备') }),
    el('p', { class: 'card-sub', text: '按当前设备隔离读取；游标分页使用服务端 nextCursor，到末页即禁用「下一页」。' }),
    el('div', { class: 'toolbar' }, [
      typeFilter, severityFilter, statusFilter,
      el('span', { class: 'spacer' }), pageInfo, firstBtn, nextBtn, refreshBtn,
    ]),
    listHost,
  ]);
  const submitCard = el('section', { class: 'card' }, [
    el('h3', { text: '确认与处理备注' }),
    el('p', { class: 'card-sub', text: '确认只追加确认记录，不改变故障是否仍在发生；备注只追加，不能覆盖既有确认或备注。本页不下发设备控制。' }),
    el('div', { class: 'field' }, [el('label', { for: 'alert-note', text: '处理备注（可选）' }), noteBox]),
    el('div', { class: 'btn-row' }, [ackBtn, noteBtn, reloadBtn]),
    submitHint,
  ]);
  // 统计与列表一起放进 live：15s 轮询只重绘这两个容器，
  // 详情与提交区里的输入框是常驻节点，不会被轮询重建。
  live.append(
    sectionCard('告警统计', '数字与口径文案原样来自服务端 counts / countBasis，前端不做二次统计。', statsHost),
    listCard,
  );
  wrap.append(
    banner('warn', '告警中心：统计与口径由服务端派生（读时计算），本页只读取与追加处理记录，不下发任何设备控制。'),
    live,
    detailHost,
    submitCard,
    feedback,
  );
  detailHost.append(emptyState('尚未选择告警', '在列表点击一条告警查看判定依据、确认记录与备注时间轴；详情不参与轮询。'));

  // ---------- 页面状态发布（侧栏徽标） ----------
  // counts 是"当前筛选后集合"的计数（契约 5.1）：带筛选时它不等于未处理总数，
  // 拿它去写侧栏徽标会把徽标筛成一个假的小数字，所以带筛选时一律不发布。
  function publishPending(data) {
    if (typeFilter.value || severityFilter.value || statusFilter.value) return;
    if (ctx.state && typeof ctx.state === 'object') ctx.state.alertPending = alertPendingTotal(data?.counts);
    if (typeof ctx.markStatus === 'function') ctx.markStatus();
  }

  // 读取失败＝未处理数未知：徽标隐藏，而不是沿用旧数字。
  function clearPending() {
    if (ctx.state && typeof ctx.state === 'object') ctx.state.alertPending = null;
    if (typeof ctx.markStatus === 'function') ctx.markStatus();
  }

  function replace(host, nodes, silent) {
    live.classList.toggle('alert-polling', Boolean(silent));
    clear(host);
    host.append(...nodes.filter(Boolean));
  }

  // ---------- 统计区 ----------
  function paintStats(data, silent) {
    const counts = data?.counts && typeof data.counts === 'object' ? data.counts : null;
    const connected = data?.source?.connected === true;
    const nodes = [];
    // counts 是过滤后集合：带筛选时必须说清楚，否则"全部告警 3"会被读成设备总共只有 3 条。
    if (typeFilter.value || severityFilter.value || statusFilter.value) {
      nodes.push(banner('info', '当前筛选生效：下面的统计与列表都是筛选后集合（服务端 counts 随筛选变化），口径文案仍原样取自 countBasis。'));
    }
    if (!connected) {
      // 未连接不等于没有告警：这里一个数字都不显示，避免把 0 读成"一切正常"。
      nodes.push(banner('warn', '未连接：服务端没有该设备的采集会话记录，无法给出可信统计。这里不显示 0——0 会被误读成「没有故障」。'));
    } else {
      const basis = data?.countBasis && typeof data.countBasis === 'object' ? data.countBasis : {};
      const grid = el('div', { class: 'alert-stats-grid' }, [
        statCard('全部告警', countText(counts?.all), textOf(basis.all, '服务端未提供口径文案')),
        statCard('发生中未确认', countText(counts?.open), textOf(basis.open, '服务端未提供口径文案')),
        statCard('发生中已确认', countText(counts?.acknowledged), textOf(basis.acknowledged, '服务端未提供口径文案')),
        statCard('已恢复', countText(counts?.recovered), textOf(basis.recovered, '服务端未提供口径文案')),
      ]);
      [...grid.children].forEach((c, i) => c.setAttribute('data-stagger', String(i + 1)));
      nodes.push(grid);
      const severity = counts?.bySeverity && typeof counts.bySeverity === 'object' ? counts.bySeverity : null;
      nodes.push(el('div', { class: 'btn-row mt-md' }, [
        el('span', { class: 'muted', text: '分严重程度：' }),
        ...(severity
          ? Object.entries(severity).map(([key, value]) => chip(severityKind(key), String(key) + ' ' + countText(value)))
          : [chip('unknown', '服务端未提供分严重程度统计')]),
      ]));
    }
    const meta = [];
    if (Number.isFinite(data?.source?.lastAcceptedAt) && data.source.lastAcceptedAt > 0) meta.push('最近接受帧 ' + fmtDateTime(data.source.lastAcceptedAt));
    if (data?.source?.evaluation) meta.push('派生方式 ' + String(data.source.evaluation));
    if (data?.source?.lastReconcileError) meta.push('派生失败码 ' + String(data.source.lastReconcileError));
    if (data?.truncated === true) meta.push('服务端结果已截断');
    if (meta.length) nodes.push(el('p', { class: 'muted mt-md mb-0', text: meta.join(' · ') }));
    replace(statsHost, nodes, silent);
  }

  // ---------- 列表 ----------
  function alertRow(item, fallbackDevice) {
    const id = String(item?.alertId ?? '');
    const state = STATE_LABEL[item?.state] ? item.state : '';
    return el('div', {
      class: 'alert-row' + (id && id === selectedId ? ' is-active' : ''),
      dataset: { alertId: id },
      onclick: (e) => { if (!e?.target?.closest?.('button')) select(id); },
    }, [
      el('button', {
        class: 'btn secondary small', type: 'button', dataset: { alertId: id },
        onclick: () => select(id),
      }, [textOf(item?.type) + ' · ' + textOf(item?.state)]),
      el('div', { class: 'alert-row-meta' }, [
        chip(severityKind(item?.severity), '严重 ' + textOf(item?.severity)),
        chip(state ? STATE_KIND[state] : 'unknown', state ? STATE_LABEL[state] : textOf(item?.state)),
        item?.acknowledged === true ? chip('plain', '已确认') : null,
        item?.sample === true ? chip('warn', '样例') : null,
        el('span', { class: 'muted', text: '设备 ' + textOf(item?.gatewayId ?? fallbackDevice) }),
        el('span', { text: textOf(item?.title, TYPE_LABEL[item?.type] || '未知标题') }),
        el('span', { class: 'muted', text: '最近发生 ' + fmtDateTime(item?.lastAt) }),
      ]),
    ]);
  }

  function paintList(data, silent) {
    const items = Array.isArray(data?.items) ? data.items : null;
    if (!items) throw new Error('告警列表协议无效');
    const connected = data?.source?.connected === true;
    const nodes = [];
    if (!connected) nodes.push(banner('warn', '未连接：该设备尚未建立采集会话，列表为空不表示没有故障。'));
    if (!items.length) {
      nodes.push(connected
        ? emptyState('暂无告警（未虚构）', '服务端在当前筛选下没有返回告警记录。空列表只表示服务端没有返回数据，不代表设备一定正常。')
        : emptyState('未连接', '还没有该设备的采集会话，无法判断是否存在告警。'));
    } else {
      nodes.push(el('div', { class: 'alert-list' }, items.map((item) => alertRow(item, data?.gatewayId))));
    }
    nextCursor = typeof data?.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null;
    pageInfo.textContent = '第 ' + (pageIndex + 1) + ' 屏' + (nextCursor ? ' · 还有更多' : ' · 已到末页');
    nextBtn.disabled = nextCursor === null;
    firstBtn.disabled = cursor === null;
    replace(listHost, nodes, silent);
  }

  function paintFailure(error) {
    clear(statsHost);
    statsHost.append(banner(error?.kind === 'offline' ? 'bad' : 'warn',
      error?.kind === 'offline'
        ? '后端未连接：无法读取该设备的告警统计，这里不显示任何数字。'
        : '告警统计读取失败：' + explain(error?.code, error?.message)));
    clear(listHost);
    listHost.append(failureBanner(error));
    nextBtn.disabled = true;
    clearPending();
  }

  async function load({ silent = false } = {}) {
    if (!ctx.scope.active || ctx.demoMode) return;
    const generation = ++loadGeneration;
    if (!silent) { clear(listHost); listHost.append(skeleton(2)); }
    try {
      const data = await ctx.dataSource.listAlerts({
        type: typeFilter.value || null,
        severity: severityFilter.value || null,
        status: statusFilter.value || null,
        cursor,
        limit: LIMIT,
      });
      if (!ctx.scope.active || generation !== loadGeneration) return;
      if (!Array.isArray(data?.items) || !data?.counts) throw new Error('告警列表协议无效');
      paintStats(data, silent);
      paintList(data, silent);
      paintSelectedRow();
      publishPending(data);
    } catch (error) {
      if (!ctx.scope.active || generation !== loadGeneration) return;
      paintFailure(error);
    }
  }

  // ---------- 详情 ----------
  function paintDetail(alert) {
    const state = STATE_LABEL[alert?.state] ? alert.state : '';
    const basis = alert?.basis && typeof alert.basis === 'object' ? alert.basis : null;
    const acks = Array.isArray(alert?.acks) ? alert.acks : [];
    const notes = Array.isArray(alert?.notes) ? alert.notes : [];
    const evidence = Array.isArray(alert?.evidence) ? alert.evidence : [];
    const tasks = Array.isArray(alert?.relatedTaskIds) ? alert.relatedTaskIds : [];
    const occurrences = NON_NEGATIVE(alert?.occurrences) ? alert.occurrences : null;
    const nodes = [];

    nodes.push(sectionCard(
      '告警详情 · ' + textOf(alert?.alertId),
      '状态 ' + textOf(alert?.state) + ' · 版本 v' + (NON_NEGATIVE(alert?.revision) ? alert.revision : '未知')
        + ' · 合并键 ' + textOf(alert?.type) + '/' + textOf(alert?.subject)
        + (alert?.sample === true ? ' · 演示样例' : ''),
      el('div', { class: 'btn-row mb-sm' }, [
        chip(severityKind(alert?.severity), '严重程度 ' + textOf(alert?.severity)),
        chip(state ? STATE_KIND[state] : 'unknown', state ? STATE_LABEL[state] : textOf(itemStateOrText(alert))),
        chip(alert?.acknowledged === true ? 'ok' : 'unknown', alert?.acknowledged === true ? '已确认' : '未确认'),
        chip('plain', '累计发生 ' + (occurrences === null ? '未知' : occurrences + ' 次')),
        alert?.sample === true ? chip('warn', '样例') : null,
        alert?.executed === true || alert?.hardwareControl === true ? chip('bad', '异常：声明已下发控制') : chip('ok', '未下发设备控制'),
      ]),
      el('dl', { class: 'kv' }, [
        el('dt', { text: '类型' }), el('dd', { text: textOf(alert?.type) + ' · ' + (TYPE_LABEL[alert?.type] || '未知类型') }),
        el('dt', { text: '标题' }), el('dd', { text: textOf(alert?.title) }),
        el('dt', { text: '设备' }), el('dd', { text: textOf(alert?.gatewayId) }),
        el('dt', { text: '首次发生' }), el('dd', { text: fmtDateTime(alert?.firstAt) }),
        el('dt', { text: '最近发生' }), el('dd', { text: fmtDateTime(alert?.lastAt) }),
        el('dt', { text: '恢复时间 recoveredAt' }), el('dd', { text: Number.isFinite(alert?.recoveredAt) && alert.recoveredAt > 0 ? fmtDateTime(alert.recoveredAt) : '无（未恢复或未提供）' }),
        el('dt', { text: '恢复情况' }), el('dd', { text: recoveryText(alert) }),
        el('dt', { text: '累计发生次数' }), el('dd', { text: occurrences === null ? '未知' : String(occurrences) }),
      ]),
    ));

    nodes.push(sectionCard('判定依据 basis', '这段是服务端给出的派生依据，属解释而非推测；缺项显示「未知」，不补造。',
      basis
        ? el('dl', { class: 'kv' }, [
          el('dt', { text: '依据码 code' }), el('dd', { text: textOf(basis.code) }),
          el('dt', { text: '说明 detail' }), el('dd', { text: textOf(basis.detail, '服务端未提供说明') }),
          el('dt', { text: '观测时间 observedAt' }), el('dd', { text: fmtDateTime(basis.observedAt) }),
          el('dt', { text: '样本年龄 / 有效期' }), el('dd', { text: (Number.isFinite(basis.sampleAgeMs) ? fmtAge(basis.sampleAgeMs) : '未知') + ' / ' + (Number.isFinite(basis.ttlMs) ? fmtAge(basis.ttlMs) : '未知') }),
        ])
        : el('p', { class: 'muted', text: '服务端未提供判定依据（不补造）。' }),
      evidence.length
        ? el('div', {}, [
          el('h4', { text: '证据（' + evidence.length + ' 条）' }),
          el('ul', { class: 'alert-timeline' }, evidence.map((item) => el('li', {}, [
            chip(item?.fresh === true ? 'ok' : 'warn', item?.fresh === true ? '新鲜' : '非新鲜'),
            el('span', { class: 'mono', text: ' ' + textOf(item?.ref) + ' = ' + textOf(item?.value) }),
            el('span', { class: 'muted', text: ' · ' + fmtDateTime(item?.observedAt) }),
          ]))),
        ])
        : null,
      tasks.length ? el('p', { class: 'muted', text: '关联模型任务：' + tasks.map((id) => String(id)).join('、') }) : null,
    ));

    nodes.push(sectionCard('确认记录（' + acks.length + ' 条）', '每次确认都是独立追加记录：保留时间与处理人，不覆盖历史，也不改变故障是否仍在发生。',
      acks.length
        ? el('ul', { class: 'alert-timeline' }, acks.map((ack) => el('li', {}, [
          el('span', { class: 'mono muted', text: fmtDateTime(ack?.at) }), ' ',
          chip('plain', textOf(ack?.actor, '未知处理人')),
          el('div', { class: 'alert-note-body', text: textOf(ack?.note, '（本条确认未填说明）') }),
        ])))
        : el('p', { class: 'muted', text: '暂无确认记录（该告警未被确认）。' }),
    ));

    nodes.push(sectionCard('处理备注时间轴（' + notes.length + ' 条）', '按服务端记录顺序展示「时间 / 处理人 / 内容」；备注只追加，不允许覆盖。',
      notes.length
        ? el('ol', { class: 'alert-timeline', 'data-role': 'alert-notes' }, notes.map((note) => el('li', {}, [
          el('div', { class: 'alert-note-head' }, [
            el('span', { class: 'mono muted', text: fmtDateTime(note?.at) }), ' ',
            chip('plain', textOf(note?.actor, '未知处理人')),
          ]),
          el('div', { class: 'alert-note-body', text: textOf(note?.text, '（空备注）') }),
        ])))
        : el('p', { class: 'muted', text: '暂无处理备注。' }),
    ));

    clear(detailHost);
    detailHost.append(...nodes.filter(Boolean));
  }

  function itemStateOrText(alert) { return alert?.state; }

  function rowsOf(host) {
    const out = [];
    const walk = (node) => {
      for (const child of Array.isArray(node?.childNodes) ? node.childNodes : []) {
        const name = String(child.className || '');
        if (name === 'alert-row' || name === 'alert-row is-active') out.push(child);
        walk(child);
      }
    };
    walk(host);
    return out;
  }

  function paintSelectedRow() {
    for (const row of rowsOf(listHost)) {
      row.classList.toggle('is-active', Boolean(row.dataset?.alertId) && row.dataset.alertId === selectedId);
    }
  }

  function syncSubmitState() {
    const alert = currentAlert;
    const writable = canWrite && !ctx.demoMode && !busy && Boolean(alert) && alert.alertId === selectedId;
    ackBtn.disabled = !writable || alert?.acknowledged === true;
    noteBtn.disabled = !writable;
    reloadBtn.disabled = Boolean(ctx.demoMode) || !selectedId;
    noteBox.disabled = Boolean(ctx.demoMode) || !canWrite;   // viewer 只读：连输入框都不给写
    const hints = [];
    if (ctx.demoMode) hints.push('演示模式：样例告警，确认与备注已禁用，不会调用真实写接口，也不会保存任何内容。');
    else if (!canWrite) hints.push('当前账号为只读角色（viewer）：只能查看告警，不能确认或写备注。写入权限由服务端再次校验。');
    else if (!alert) hints.push('请先在列表选择一条告警，再确认或写备注。');
    else if (alert.acknowledged === true) hints.push('该告警已确认过；如需补充请使用备注（只追加，不覆盖）。');
    else if (alert.state === 'recovered') hints.push('该告警已恢复；确认只追加确认记录，不会让故障重新发生。');
    hints.push('详情不参与 15 秒轮询：避免冲掉正在填写的备注；提示版本冲突时请先「重新读取详情」。');
    submitHint.textContent = hints.join(' ');
  }

  function showFeedback(kind, text) {
    clear(feedback);
    feedback.append(banner(kind, text));
  }

  function select(alertId) {
    if (!alertId) return;
    const changed = alertId !== selectedId;
    selectedId = alertId;
    if (changed) noteBox.value = '';   // 换告警时丢弃上一条的草稿，避免把备注写到错的告警上
    paintSelectedRow();
    if (ctx.demoMode) {
      currentAlert = demoDetail(alertId);
      paintDetail(currentAlert);
      syncSubmitState();
      return;
    }
    void openDetail();
  }

  async function openDetail() {
    if (!ctx.scope.active || !selectedId || ctx.demoMode) return;
    const generation = ++detailGeneration, id = selectedId;
    currentAlert = null; syncSubmitState();
    clear(detailHost);
    detailHost.append(sectionCard('告警详情', null, el('div', { class: 'btn-row' }, [spinner(), ' 正在读取…'])));
    try {
      const alert = await ctx.dataSource.readAlert(id);
      if (!ctx.scope.active || generation !== detailGeneration) return;
      if (!alert || alert.alertId !== id) throw new Error('告警详情协议无效');
      currentAlert = alert;
      paintDetail(alert);
      paintSelectedRow();
    } catch (error) {
      if (!ctx.scope.active || generation !== detailGeneration) return;
      clear(detailHost);
      detailHost.append(sectionCard('告警详情', null, failureBanner(error)));
      currentAlert = null;
    }
    syncSubmitState();
  }

  // 成功只更新对应区域：详情记录区就地重绘，备注输入框节点保持原样。
  async function submit(kind) {
    if (busy || !ctx.scope.active || ctx.demoMode || !canWrite || !currentAlert) return;
    const selectionGeneration = detailGeneration;
    const alert = currentAlert;
    if (alert.alertId !== selectedId) return;
    const alertId = String(alert.alertId ?? '');
    if (!NON_NEGATIVE(alert.revision)) {
      showFeedback('warn', '无法确认该告警的版本号，为避免覆盖他人修改，本次未提交。请先「重新读取详情」。');
      return;
    }
    const expectedRevision = alert.revision;
    const text = String(noteBox.value || '').trim();
    if (kind === 'note' && !text) {
      showFeedback('warn', '请填写备注内容后再提交；空备注不会被发送，也不会产生任何记录。');
      return;
    }
    busy = true;
    ackBtn.disabled = true; noteBtn.disabled = true;
    clear(feedback);
    feedback.append(el('p', { class: 'muted' }, [spinner(), ' 正在提交；提交后即使关闭页面，服务端也可能已完成写入，请以刷新后的记录为准…']));
    try {
      const receipt = kind === 'ack'
        ? await ctx.dataSource.acknowledgeAlert({ alertId, expectedRevision })
        : await ctx.dataSource.noteAlert({ alertId, expectedRevision, text });
      if (!ctx.scope.active || selectedId !== alertId || selectionGeneration !== detailGeneration) return;
      if (kind === 'note' && String(noteBox.value || '').trim() === text) noteBox.value = '';   // 备注已确认保存，清空输入
      const saved = receipt?.alert;
      if (saved && saved.alertId === alertId) {
        currentAlert = saved;
        paintDetail(saved);
        paintSelectedRow();
      }
      clear(feedback);
      feedback.append(banner('ok', receipt?.duplicate === true
        ? '服务端确认这是重复提交：已返回原有记录，没有新增第二条确认或备注。'
        : (kind === 'ack'
          ? '服务端已确认保存确认记录。确认不改变故障是否仍在发生，也未下发任何设备控制。'
          : '服务端已确认保存备注。备注是追加记录，历史确认与备注保持不变；本次未下发任何设备控制。')));
      void load({ silent: true });   // 统计与列表跟随服务端刷新，不触碰详情输入
    } catch (error) {
      if (!ctx.scope.active || selectedId !== alertId || selectionGeneration !== detailGeneration) return;
      const conflict = error?.code === 'alert_revision_conflict' || error?.status === 409;
      clear(feedback);
      feedback.append(banner(error?.kind === 'offline' ? 'bad' : 'warn',
        (error?.kind === 'offline' ? '提交未确认（后端不可达）：' : '提交未确认：') + explain(error?.code, error?.message)
        + (kind === 'note' ? ' 已填写的备注保留在输入框中，可在核对后重试。' : ' 本次确认未保存，可重新读取详情后重试。')));
      if (conflict) feedback.append(button('重新读取详情', () => { void openDetail(); }, { variant: 'secondary small' }));
    } finally {
      busy = false;
      if (ctx.scope.active) syncSubmitState();
    }
  }

  // ---------- 轮询：只替换统计与列表容器 ----------
  async function poll() {
    if (!ctx.scope.active || ctx.demoMode) return;
    if (typeof document !== 'undefined' && document.hidden) return;   // 后台标签页不轮询
    await load({ silent: true });
  }

  // ---------- 演示模式：明确标注，且不调用任何真实接口 ----------
  if (ctx.demoMode) {
    const payload = demoPayload();
    paintStats(payload, false);
    paintList(payload, false);
    showFeedback('warn', '演示模式：以下为样例告警结构（每条带「样例」标记），未连接真实后端，确认与备注已禁用，不会调用真实写接口。');
    const first = payload.items[0]?.alertId || '';
    if (first) select(first);
    syncSubmitState();
    return wrap;
  }

  typeFilter.addEventListener('change', () => { cursor = null; pageIndex = 0; void load(); });
  severityFilter.addEventListener('change', () => { cursor = null; pageIndex = 0; void load(); });
  statusFilter.addEventListener('change', () => { cursor = null; pageIndex = 0; void load(); });

  syncSubmitState();
  void load();
  const timer = setInterval(() => { void poll(); }, POLL_MS);
  // 卸载 / 切页 / 切设备 / 退出登录都会 dispose 本作用域：定时器与在途请求一并作废，
  // 迟到响应由 generation 与 scope.active 双重丢弃。
  ctx.scope.onDispose(() => { loadGeneration++; detailGeneration++; clearInterval(timer); live.classList.toggle('alert-polling', false); });
  return wrap;
}
