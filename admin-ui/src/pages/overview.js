// 运行总览：设备连接、最后采样、有效读数、时效、来源、模型状态、趋势、存储健康。
// 原则：每项独立加载，一项失败不拖垮整页；缺值显示"未知"，绝不补数；
// CO/CO₂ 未接入就写"未接入"；历史趋势与"当前读数"分开呈现，不互相冒充。
import { el, chip, statCard, sectionCard, skeleton, banner, emptyState, button } from '../lib/dom.js';
import { fmtDateTime, fmtRelative, fmtValue, fmtSource, sourceKind, fmtReason, fmtAge, fmtBytes } from '../lib/format.js';
import { renderTrendSvg } from '../lib/trend.js';
import { syncLiveChildren } from '../lib/live-dom.js';

export default async function renderOverview(ctx) {
  const wrap = el('div', { class: 'live-dashboard' });
  wrap.append(sectionCard('正在读取运行状态…', null, skeleton(4)));
  const parts = {};
  let liveBusy = false, slowBusy = false, nextLive = 0, nextSlow = 0;
  function paint() {
    if (!ctx.scope.active) return;
    if (!ctx.demoMode && parts.observations?.status === 'fulfilled') {
      const current = ctx.live.current();
      parts.observations = current ? { status: 'fulfilled', value: current } : { status: 'rejected', reason: new Error('当前观测未确认') };
    }
    ctx.state.hardwareOnline = parts.observations?.status === 'fulfilled' && parts.observations.value?.hardware?.deviceOnline === true;
    ctx.markStatus();
    renderBody(ctx, wrap, parts);
  }
  async function pollLive() {
    if (liveBusy || !ctx.scope.active) return;
    liveBusy = true; nextLive = Date.now() + 2000;
    try {
      const settled = await Promise.allSettled([load('health', ctx), load('observations', ctx)]);
      if (!ctx.scope.active) return;
      parts.health = settled[0]; parts.observations = settled[1];
      if (parts.health.status === 'rejected' && !ctx.demoMode) { ctx.live.invalidate(); parts.observations = { status: 'rejected' }; }
      ctx.setConnection(parts.health.status === 'fulfilled' ? 'online' : 'offline', ({hardware:'真实采集',simulation:'模拟模式'})[parts.health.value?.mode] || '');
      paint();
    } finally { liveBusy = false; }
  }
  async function pollSlow() {
    if (slowBusy || !ctx.scope.active) return;
    slowBusy = true; nextSlow = Date.now() + 10000;
    try {
      const settled = await Promise.allSettled([load('model', ctx), load('history', ctx)]);
      if (!ctx.scope.active) return;
      parts.model = settled[0]; parts.history = settled[1];
      ctx.state.modelConfigured = parts.model.status === 'fulfilled' ? parts.model.value?.configured === true : null;
      paint();
    } finally { slowBusy = false; }
  }
  const timer = setInterval(() => {
    if (!ctx.scope.active) return;
    paint();
    if (Date.now() >= nextLive) pollLive();
    if (Date.now() >= nextSlow) pollSlow();
  }, 500);
  ctx.scope.onDispose(() => clearInterval(timer));
  pollLive(); pollSlow();
  return wrap;
}

async function load(kind, ctx) {
  switch (kind) {
    case 'health': return ctx.dataSource.getHealth();
    case 'observations': return ctx.dataSource.getObservations();
    case 'model': return ctx.dataSource.getModelStatus();
    case 'history': return ctx.dataSource.getHardwareHistory({ limit: 50 });
  }
}

function renderBody(ctx, host, parts) {
  const wrap = el('div');

  // 演示模式提示
  if (ctx.state.demoMode) wrap.append(banner('warn', '本页为演示样例数据，非真实设备读数。'));

  // 离线横幅（health 失败）
  if (parts.health?.status === 'rejected') {
    wrap.append(banner('bad', '后端未连接：以下状态均无法确认。请启动云端服务，或在侧栏进入演示模式查看界面结构。'));
  }

  wrap.append(overviewCards(parts));
  wrap.append(currentReadings(ctx, parts.observations));
  wrap.append(modelCard(parts.model));
  wrap.append(trendCard(ctx, parts.history));
  const storage = storeCard(parts.history);
  if (storage) wrap.append(storage);
  wrap.append(el('p', { class: 'muted text-sm' }, ['边界：真实 CO/CO₂ 与执行器未接入；本平台只读，不下发控制、不自动上传照片。']));
  syncLiveChildren(host, wrap);
  return host;
}

function overviewCards(parts) {
  const health = parts.health?.status === 'fulfilled' ? parts.health.value : null;
  const obs = parts.observations?.status === 'fulfilled' ? parts.observations.value : null;
  const h = obs?.hardware || {};

  const onlineChip = !health && !obs ? chip('unknown', '未知')
    : h.deviceOnline ? chip('ok', '在线')
      : chip('bad', '离线/过期');

  const conn = el('div', { class: 'grid cols-4' }, [
    statCard('设备连接', onlineChip, h.deviceOnline ? fmtReason(h.reason) : (h.reason ? fmtReason(h.reason) : '未获取到快照')),
    statCard('服务模式', el('span', { text: health ? (health.transport === 'demo-mode' ? '演示样例' : health.mode === 'hardware' ? '真实数据' : health.mode === 'simulation' ? '模拟' : health.mode) : '未知' }),
      health ? '接入方式：' + ({'demo-mode':'演示样例',http:'局域网连接',serial:'串口连接'}[health.transport] || '待核对') : '后端未连接'),
    statCard('最后采样', el('span', { text: h.receivedAt ? fmtRelative(h.receivedAt) : '未知' }),
      h.receivedAt ? fmtDateTime(h.receivedAt) : '无有效接收时间'),
    statCard('真实准入', chip(h.admission === 'unknown_denied' || !h.admission ? 'warn' : 'unknown', h.admission === 'unknown_denied' ? '未知/拒止' : (h.admission || '未知')),
      'CO/CO₂ 未接入，禁止据此放行'),
  ]);
  // 交错入场：给每张卡片一个递增的 stagger 属性，CSS 会据此延迟动画
  [...conn.children].forEach((c, i) => c.setAttribute('data-stagger', String(i + 1)));
  return sectionCard('连接与准入', '只反映本次实际探测到的状态，不知道就写未知。', conn);
}

function currentReadings(ctx, obsResult) {
  if (obsResult?.status === 'rejected') {
    return sectionCard('当前有效读数', null, banner('bad', '读取失败：无法确认当前读数。历史数据仍可下方查询。'));
  }
  if (!obsResult) return sectionCard('当前有效读数', null, skeleton(2));
  const h = obsResult.value?.hardware || {};
  const q = h.quality || {}, v = h.values || {};
  const cells = [];
  const add = (label, valid, text, extra) => cells.push(el('div', { class: 'card stat' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value' }, [valid ? chip(sourceKind(h.source), text) : chip('unknown', '未知')]),
    el('div', { class: 'detail', text: extra || (valid ? '质量有效' : (fmtReason(h.reason) || '该通道无有效读数')) }),
  ]));
  add('温度', q.temperatureValid, fmtValue(v.temperatureC, '℃'), q.temperatureValid ? '样本年龄 ' + fmtAge(h.climateAgeMs) : '未知');
  add('湿度', q.humidityValid, fmtValue(v.humidityPct, '%'), q.humidityValid ? '样本年龄 ' + fmtAge(h.climateAgeMs) : '未知');
  add('MQ-2 ADC', q.gasValid, v.gasRaw != null ? (v.gasRaw + ' / ' + v.gasMv + ' mV') : '未知', q.gasValid ? '原始值，非浓度 · 年龄 ' + fmtAge(h.gasAgeMs) : '未知');
  // CO / CO₂ 永远未接入
  cells.push(el('div', { class: 'card stat' }, [
    el('div', { class: 'label', text: 'CO 一氧化碳' }),
    el('div', { class: 'value' }, [chip('plain', '未接入')]),
    el('div', { class: 'detail', text: '无传感器，不报告浓度' }),
  ]));
  cells.push(el('div', { class: 'card stat' }, [
    el('div', { class: 'label', text: 'CO₂ 二氧化碳' }),
    el('div', { class: 'value' }, [chip('plain', '未接入')]),
    el('div', { class: 'detail', text: '无传感器，不报告浓度' }),
  ]));

  const head = el('div', { class: 'toolbar' }, [
    chip(sourceKind(h.source), '来源：' + fmtSource(h.source)),
    h.deviceOnline && Number.isFinite(h.sampleAgeMs) ? chip('plain', '接收年龄 ' + fmtAge(h.sampleAgeMs)) : chip('plain', '样本年龄未知'),
    el('span', { class: 'spacer' }),
    button('重新读取', () => ctx.navigate('overview'), { variant: 'ghost small' }),
  ]);
  return sectionCard('当前有效读数（只读）', '这些是网关/直采的当前快照；历史趋势在下方，二者来源不同不互相冒充。', head, el('div', { class: 'grid cols-3' }, cells));
}

function modelCard(modelResult) {
  if (modelResult?.status === 'rejected') {
    return sectionCard('模型与测试', null, banner('bad', '无法读取模型状态（后端未连接或未提供接口）。'));
  }
  if (!modelResult) return sectionCard('模型与测试', null, skeleton(2));
  const m = modelResult.value || {};
  const cc = m.connectionCheck || {};
  const threeState = m.configured
    ? chip('ok', '已配置') : chip('bad', '未配置');
  const check = cc.state === 'passed' ? chip('ok', '上次测试通过') : cc.state === 'failed' ? chip('bad', '上次测试失败') : chip('unknown', '尚未测试');
  return sectionCard('模型与测试', '“已保存/已配置”“上次测试通过”“当前可用”是三种不同状态，此处仅陈述可确证者。',
    el('div', { class: 'kv' }, [
      el('dt', { text: '配置状态' }), el('dd', {}, [threeState]),
      el('dt', { text: '服务商/模型' }), el('dd', { text: m.configured ? ((m.provider || '?') + ' · ' + (m.model || '?')) : '未配置' }),
      el('dt', { text: '上次连接测试' }), el('dd', {}, [check, cc.checkedAt ? el('span', { class: 'muted', text: ' · ' + fmtDateTime(cc.checkedAt) }) : null]),
      el('dt', { text: '设备执行' }), el('dd', {}, [chip('plain', m.executesDevices ? '允许（不应出现）' : '不允许')]),
      el('dt', { text: '图像能力' }), el('dd', {}, [chip('plain', m.imageAnalysis ? '接口声明支持' : '未声明')]),
    ]),
    el('p', { class: 'muted text-sm mt-xs mb-0' }, ['注意：以上不代表“当前模型可用”，可用需现场手动测试。']));
}

function trendCard(ctx, historyResult) {
  if (historyResult?.status === 'rejected') return sectionCard('温度趋势（最近窗口）', null, banner('bad', '无法读取历史，趋势不可用。'));
  if (!historyResult) return sectionCard('温度趋势（最近窗口）', null, skeleton(5));
  const items = historyResult.value?.items || [];
  if (items.length === 0) return sectionCard('温度趋势（最近窗口）', null, emptyState('没有采集记录', '真实链路尚未产生数据。'));
  // items 新→旧，反转为时间升序
  const asc = [...items].reverse();
  const points = asc.map((it) => {
    const o = it.observation || {};
    const valid = o.quality?.temperatureValid;
    return { t: o.receivedAt ?? 0, v: valid ? o.values?.temperatureC ?? null : null };
  }).filter((p) => Number.isFinite(p.t) && p.t > 0);
  const { svg, plotted, gaps } = renderTrendSvg(points, { unit: '℃' });
  const body = svg
    ? el('div', { class: 'trend-wrap' }, [
      el('div', { class: 'trend-legend' }, [el('span', {}, [el('span', { class: 'sw temp' }), '温度 ℃'])]),
      el('div', { html: svg }), // svg 由 trend.js 内部数值生成，无外部文本
      el('div', { class: 'muted text-sm mt-xs' }, [`已绘 ${plotted} 个有效点，缺口 ${gaps} 处（缺口不连线）。仅最近窗口，非完整历史。`]),
    ])
    : emptyState('该窗口内没有有效温度读数', '有记录但均判为未知，故不绘制。');
  return sectionCard('温度趋势（最近窗口）', '只绘制历史里实际有效的点。', body);
}

function storeCard(historyResult) {
  if (historyResult?.status !== 'fulfilled') return null;
  const s = historyResult.value?.storage;
  if (!s) return null;
  return sectionCard('采集存储健康', null,
    el('div', { class: 'kv' }, [
      el('dt', { text: '持久存储' }), el('dd', {}, [chip(s.enabled ? (s.healthy ? 'ok' : 'bad') : 'unknown', s.enabled ? (s.healthy ? '启用·正常' : '启用·异常') : '未启用')]),
      el('dt', { text: '记录数' }), el('dd', { text: Number.isInteger(s.records) ? String(s.records) : '未知' }),
      el('dt', { text: '占用' }), el('dd', { text: fmtBytes(s.bytes) + ' / ' + fmtBytes(s.maxBytes) }),
    ]));
}
