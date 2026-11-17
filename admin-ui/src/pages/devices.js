// 设备管理与诊断。
// 数据来源（均为云端已实现接口）：
//   GET /admin-api/devices             已登记 DAYU200 列表，每项含当前采集快照 hardware
//   GET /api/observations?gatewayId=…  选中设备的实时状态（watchHardware 每 2s 轮询 + 本地老化）
// 诚实原则：
//   1) 只渲染服务端真实返回的字段；null/缺失一律显示"未知"，绝不补 0 或补默认值；
//   2) CO/CO₂ 未接入就写未接入；gas_raw/gas_mv 是 ADC 原始值，不换算成浓度；
//   3) 读取失败区分"后端未连接 / 权限或会话失效 / 响应格式无效"，不显示虚构设备；
//   4) 演示模式不读取真实设备登记，也不编造设备数量；
//   5) 列表刷新复用 watchHardware 的既有轮询节拍，不新增定时器（避免页面卸载后遗留计时）。
import { el, chip, sectionCard, banner, skeleton, button, emptyState } from '../lib/dom.js';
import { fmtDateTime, fmtRelative, fmtAge, fmtValue, fmtSource, sourceKind, fmtReason } from '../lib/format.js';
import { watchHardware } from '../lib/live-hardware.js';

import { LiveObservations, validateObservations } from '../lib/freshness.js';
import { ApiError, issueDeviceToken } from '../lib/api.js';

const LIST_REFRESH_MS = 5000;

// 有效值 + 质量标记：无效就显示"无效"，而不是把 null 当成 0℃。
// 注意 fmtValue 自身会在数值与单位间补一个空格，这里不要再传前导空格。
function reading(value, valid, unit, digits = 1) {
  if (valid === false) return chip('unknown', '无效');
  if (value === null || value === undefined || !Number.isFinite(value)) return chip('unknown', '未知');
  return el('span', { class: 'mono', text: fmtValue(value, unit, digits) });
}

function onlineChip(hardware) {
  if (!hardware) return chip('unknown', '未知');
  return chip(hardware.deviceOnline === true ? 'ok' : 'bad', hardware.deviceOnline === true ? '在线' : '离线/过期');
}

// 失败原因分类：offline=后端未连接，forbidden=会话/权限，parse=响应无效，其余=一般错误。
function failureBanner(error, feature) {
  if (error?.kind === 'offline') return banner('bad', '后端未连接：无法读取' + feature + '。请确认云端服务已启动。');
  if (error?.kind === 'forbidden') return banner('warn', '没有权限或管理会话已失效：' + feature + '读取被拒绝，请重新登录。');
  if (error?.kind === 'parse') return banner('warn', feature + '响应格式无效，未显示任何推测数据。');
  if (error?.kind === 'not_implemented') return banner('warn', feature + '：当前后端未提供该接口。');
  return banner('bad', feature + '读取失败：' + (error?.message || error));
}

export default async function renderDevices(ctx) {
  const wrap = el('div', {});
  const listHost = el('div', {}, [skeleton(2)]);

  wrap.append(sectionCard('已登记 DAYU200 设备',
    '设备身份以服务端登记为准（每台 DAYU200 一个 gatewayId）。下表为服务端返回的当前采集快照，随实时轮询每 '
    + (LIST_REFRESH_MS / 1000) + ' 秒刷新；点击一行可切换为当前设备。',
    listHost));


  // ---------- 设备列表（真实接口，失败不虚构） ----------
  let busy = false, lastListAt = 0, lastItems = null, staleSignature = '';
  let deviceLives = new Map();

  function currentItems() {
    return lastItems?.map(item => deviceLives.get(item.gatewayId)?.current() || item);
  }

  // 包括本地增长的样本/通道年龄，保证各列与详情采用同一失效口径。
  function signatureOf(items) {
    if (!Array.isArray(items)) return '';
    return JSON.stringify(items);
  }

  // ---------- 设备令牌（后台生成，明文只显示一次） ----------
  const tokenHost = el('div', { class: 'token-panel' });
  const selectedDevice = () => (Array.isArray(lastItems) && lastItems.length
    ? (lastItems.find(i => i.gatewayId === ctx.state?.gatewayId) || lastItems[0]).gatewayId
    : '');
  wrap.append(sectionCard('设备令牌（后台生成，DAYU200 用它上报）',
    '场景：DAYU200 首次接入或令牌遗失时，由管理员在这里生成一次性令牌并录入设备。令牌明文只在生成的那一刻显示，服务端只保存 SHA-256 摘要；重新生成会立即让旧令牌失效。',
    tokenHost));

  function paintTokenPanel(issued = null) {
    if (!ctx.scope.active) return;
    const gatewayId = selectedDevice();
    const node = el('div', {});
    if (!gatewayId) {
      node.append(banner('warn', '尚未登记设备：请先在部署配置中登记 gatewayId，之后才能发放令牌。'));
      tokenHost.replaceChildren(node);
      return;
    }
    const item = (lastItems || []).find(i => i.gatewayId === gatewayId) || {};
    const configured = item.tokenConfigured === true;
    node.append(el('p', { text: '目标设备：' + gatewayId + '（' + (configured ? '已有令牌摘要' : '尚未发放令牌，设备暂时无法上报') + '）' }));
    const status = el('p', { class: 'hint' });
    const action = button(issued ? '重新生成并作废旧令牌' : '生成设备令牌', async () => {
      status.textContent = '正在生成…';
      try {
        const result = await issueDeviceToken({ gatewayId, force: Boolean(issued || configured) });
        paintTokenPanel(result);
        status.textContent = '已生成。请立即把令牌录入 DAYU200：服务端只保存摘要，关闭后无法再次查看。';
      } catch (error) {
        status.textContent = '生成失败：' + (error?.code || error?.message || error);
      }
    });
    if (issued?.token) {
      const box = el('pre', { class: 'token-value', text: issued.token });
      const hints = el('ul', { class: 'hint' });
      hints.append(el('li', { text: '请求头：Authorization: Bearer <上面的令牌>' }));
      hints.append(el('li', { text: '同时必须带 x-pengan-gateway-id: ' + issued.gatewayId }));
      hints.append(el('li', { text: '以及 x-pengan-sent-at: 设备当前毫秒时间戳（与服务端时钟误差需在 3 秒内）' }));
      hints.append(el('li', { text: '上报地址：POST ' + location.origin + '/api/v1/telemetry/current' }));
      node.append(banner('warn', '令牌只显示这一次，关闭页面后无法再次获取；遗失请重新生成。'), box, hints);
    }
    node.append(action, status);
    tokenHost.replaceChildren(node);
  }
  function paintList(items) {
    if (!ctx.scope.active) return;
    if (!Array.isArray(items) || items.length === 0) {
      staleSignature = '';
      listHost.replaceChildren(emptyState('尚无已登记设备',
        '云端没有返回任何 DAYU200 登记记录。设备需在部署配置中登记后才出现在这里；本页不会显示推测的设备数量。'));
      return;
    }
    const selected = ctx.state?.gatewayId;
    const rows = items.map((item) => {
      const h = item?.hardware || null;
      const view = h;
      const isCurrent = Boolean(item?.gatewayId) && item.gatewayId === selected;
      const tr = el('tr', {
        class: isCurrent ? 'row-current' : '',
        dataset: { gatewayId: String(item?.gatewayId ?? '') },
        title: isCurrent ? '当前选中设备' : '点击设为当前设备',
      }, [
        el('td', {}, [el('span', { class: 'mono', text: String(item?.gatewayId ?? '未知') }),
          isCurrent ? chip('info', '当前') : null]),
        el('td', { class: 'mono', text: String(h?.deviceId ?? '未知') }),
        el('td', {}, [onlineChip(view)]),
        el('td', {}, [chip(sourceKind(h?.source), fmtSource(h?.source))]),
        el('td', { text: h?.receivedAt ? fmtRelative(h.receivedAt) : '从未接收' }),
        el('td', { text: !Number.isFinite(h?.sampleAgeMs) ? '未知' : fmtAge(h.sampleAgeMs) }),
        el('td', {}, [reading(h?.values?.temperatureC, h?.quality?.temperatureValid, '℃')]),
        el('td', {}, [reading(h?.values?.humidityPct, h?.quality?.humidityValid, '%')]),
        el('td', { class: 'mono', text: h?.quality?.gasValid === true && Number.isFinite(h?.values?.gasRaw) ? fmtValue(h.values.gasRaw, '', 0) : '未知' }),
        el('td', { class: 'muted', text: view?.reason ? fmtReason(view.reason) : '未知' }),
      ]);
      tr.addEventListener('click', () => selectDevice(item?.gatewayId));
      return tr;
    });
    listHost.replaceChildren(el('div', { class: 'table-scroll' }, [
      el('table', { class: 'device-grid' }, [
        el('thead', {}, [el('tr', {}, ['设备 gatewayId', '采集板', '在线', '来源', '最后接收', '样本年龄', '温度', '湿度', '气体ADC', '状态原因']
          .map((t) => el('th', { text: t })))]),
        el('tbody', {}, rows),
      ]),
    ]), el('p', { class: 'muted mt-sm mb-0',
      text: '共 ' + items.length + ' 台已登记设备（服务端返回数量，非估算）。温度/湿度仅在质量位有效时显示，否则标"无效"。' }));
    staleSignature = signatureOf(items);
  }

  function selectDevice(gatewayId) {
    if (!ctx.scope.active) return;
    if (typeof gatewayId !== 'string' || !gatewayId) return;
    if (gatewayId === ctx.state?.gatewayId) return;
    if (ctx.state) ctx.state.gatewayId = gatewayId;
    // 交回外壳重渲染：顶栏设备选择器与各页数据都按新的 gatewayId 重新读取。
    if (typeof ctx.navigate === 'function') ctx.navigate('devices');
  }

  async function refreshList() {
    if (busy || !ctx.scope.active) return;
    busy = true;
    const startedAt = Date.now();
    try {
      const response = await ctx.dataSource.listDevices();
      if (!ctx.scope.active) return;
      if (!Array.isArray(response?.items) || response.items.length > 100)
        throw new ApiError('设备列表协议无效', { kind: 'parse' });
      const ids = new Set();
      // Validate the entire response before changing per-device evidence.
      for (const item of response.items) {
        if (typeof item?.gatewayId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.gatewayId) || ids.has(item.gatewayId))
          throw new ApiError('设备身份无效或重复', { kind: 'parse' });
        ids.add(item.gatewayId); validateObservations(item);
      }
      const nextLives = new Map();
      for (const item of response.items) {
        const live = deviceLives.get(item.gatewayId) || new LiveObservations(() => Date.now());
        live.ingest(item, startedAt); nextLives.set(item.gatewayId, live);
      }
      deviceLives = nextLives;
      lastItems = response.items;
      paintList(currentItems());
      paintTokenPanel();
    } catch (error) {
      if (!ctx.scope.active) return;
      lastItems = null;
      paintTokenPanel();
      for (const live of deviceLives.values()) live.invalidate();
      listHost.replaceChildren(failureBanner(error, '设备登记列表'));
    } finally { busy = false; }
  }

  // 本地时效重算：复用每设备LiveObservations，无需比较两台机器的墙钟。
  // 挂在 watchHardware 的 500ms 节拍里，使列表与详情面板的老化时点一致。
  function recheckStaleness() {
    if (ctx.demoMode || !ctx.scope.active || !lastItems) return;
    const items = currentItems();
    const next = signatureOf(items);
    if (next !== staleSignature) paintList(items);
  }

  if (ctx.demoMode) {
    listHost.replaceChildren(banner('warn',
      '演示模式不读取真实设备登记，也不显示虚构设备数量。退出演示模式并登录管理会话后可查看已登记 DAYU200。'));
  } else {
    paintTokenPanel();
    await refreshList();
    if (!ctx.scope.active) return wrap;
    lastListAt = Date.now();
  }

  // ---------- 选中设备的实时诊断（复用共享轮询与本地老化） ----------
  const detailHost = el('div', {}, [skeleton(2)]);
  wrap.append(sectionCard('当前设备诊断', '仅显示所选 DAYU200 转发的采集板状态；停止采集超过 10 秒按后端时效规则转未知。', detailHost));

  let obs = null, obsError = null;
  try { obs = await ctx.dataSource.getObservations(); }
  catch (error) { obsError = error; }
  if (!ctx.scope.active) return wrap;

  const detailError = el('div');
  if (obsError) detailError.append(failureBanner(obsError, '当前设备状态'));

  const status = el('td'), origin = el('td'), seen = el('td');
  const uptime = el('dd'), climateAge = el('dd'), gasAge = el('dd');
  const temp = el('dd'), humidity = el('dd'), gas = el('dd');
  const reason = el('dd'), deviceId = el('td', { class: 'mono' });

  detailHost.replaceChildren(
    detailError,
    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['设备', '角色', '状态', '来源', '最后可见'].map((t) => el('th', { text: t })))]),
      el('tbody', {}, [el('tr', {}, [
        deviceId,
        el('td', { text: 'HH-HSP101 采集板（经 DAYU200 转发）' }),
        status, origin, seen,
      ])]),
    ]),
    el('dl', { class: 'kv mt-md' }, [
      el('dt', { text: '设备运行时长' }), uptime,
      el('dt', { text: '温湿度通道年龄' }), climateAge,
      el('dt', { text: '气体通道年龄' }), gasAge,
      el('dt', { text: '温度' }), temp,
      el('dt', { text: '湿度' }), humidity,
      el('dt', { text: '气体 ADC（原始值）' }), gas,
      el('dt', { text: '状态原因' }), reason,
    ]));

  watchHardware(ctx, obs, (h) => {
    // 每个 500ms 节拍先按本地时钟重算列表时效（无网络请求），再更新详情面板。
    recheckStaleness();
    deviceId.textContent = String(h?.deviceId ?? '未知');
    if (h) detailError.replaceChildren();
    status.replaceChildren(onlineChip(h));
    origin.replaceChildren(chip(sourceKind(h?.source), fmtSource(h?.source)));
    seen.textContent = h?.receivedAt ? fmtRelative(h.receivedAt) + '（' + fmtDateTime(h.receivedAt) + '）' : '从未接收';
    uptime.replaceChildren(el('span', { class: 'mono', text: Number.isFinite(h?.uptimeMs) ? fmtAge(h.uptimeMs) : '未知' }));
    climateAge.replaceChildren(el('span', { class: 'mono', text: Number.isFinite(h?.climateAgeMs) ? fmtAge(h.climateAgeMs) : '未知' }));
    gasAge.replaceChildren(el('span', { class: 'mono', text: Number.isFinite(h?.gasAgeMs) ? fmtAge(h.gasAgeMs) : '未知' }));
    temp.replaceChildren(reading(h?.values?.temperatureC, h?.quality?.temperatureValid, '℃'));
    humidity.replaceChildren(reading(h?.values?.humidityPct, h?.quality?.humidityValid, '%'));
    gas.replaceChildren(h?.quality?.gasValid === true && Number.isFinite(h?.values?.gasRaw)
      ? el('span', { class: 'mono', text: fmtValue(h.values.gasRaw, '', 0) + (Number.isFinite(h?.values?.gasMv) ? '（' + fmtValue(h.values.gasMv, 'mV', 0) + '）' : '') })
      : chip('unknown', '未知'));
    reason.replaceChildren(el('span', { class: 'muted', text: h?.reason ? fmtReason(h.reason) : '未知' }));

    // 节流刷新设备列表：搭在既有 500ms 节拍上，不另开定时器。
    if (!ctx.demoMode && ctx.scope.active && Date.now() - lastListAt >= LIST_REFRESH_MS) {
      lastListAt = Date.now();
      refreshList();
    }
  });

  wrap.append(capabilityCard());
  return wrap;

  function capabilityCard() {
    return sectionCard('能力边界（如实）', null,
      el('dl', { class: 'kv' }, [
        el('dt', { text: '执行器控制' }), el('dd', {}, [chip('plain', '未接入（本平台不提供也不虚构控制功能）')]),
        el('dt', { text: 'CO / CO₂' }), el('dd', {}, [chip('plain', '传感器未接入，无浓度数据')]),
        el('dt', { text: '气体读数含义' }), el('dd', {}, [chip('plain', 'MQ-2 ADC 原始值，不换算为浓度')]),
        el('dt', { text: '设备配对 / 令牌签发' }), el('dd', {}, [chip('gap', '由部署配置登记；网页不签发设备令牌')]),
        el('dt', { text: '远程诊断（串口/烧录）' }), el('dd', {}, [chip('gap', '不在网页平台范围；现场工具另计')]),
      ]),
      el('div', { class: 'btn-row mt-sm' }, [
        button('立即刷新设备列表', () => refreshList(), { variant: 'secondary small', disabled: ctx.demoMode }),
      ]));
  }
}
