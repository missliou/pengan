// 数据记录：真实采集历史 + AI 分析历史。筛选、分页、详情展开、浏览器导出。
// 口径：
//  - "当前数据"与"历史"分开——本页只显示历史（historical=true 的接口返回）；
//  - 未知值留空并标"未知"，不填 0；CO/CO₂ 永远"未接入"；
//  - 导出=当前筛选视图的浏览器下载（与既有 CSV 口径一致），服务端范围导出属 [待实现]，页面上如实区分；
//  - 后端 limit 最大 200，本页默认取 200 后客户端分页筛选。
import { el, chip, sectionCard, banner, button, skeleton, emptyState, clear } from '../lib/dom.js';
import { fmtDateTime, fmtValue, fmtSource, sourceKind, fmtReason, fmtBytes } from '../lib/format.js';
import { paginate, filterRows, filterByValidity, filterByRange, toCsv } from '../lib/pagination.js';
import { getPref } from '../lib/store.js';
import { historyCursor } from '../lib/history-cursor.js';

export default async function renderRecords(ctx) {
  const wrap = el('div', {});
  const tabs = ['采集历史', 'AI 分析历史'];
  const tabBar = el('div', { class: 'toolbar' }, tabs.map((t, i) =>
    button(t, () => { active = i; renderTab(); }, { variant: 'secondary small' })));
  const host = el('div', {});
  let active = 0;
  let tabRevision = 0;
  ctx.scope.onDispose(() => { tabRevision++; });
  wrap.append(el('p', { class: 'muted text-sm' }, ['以下均为历史记录，不代表当前环境状态；当前读数请看"运行总览"。']));
  wrap.append(tabBar, host);

  function setActiveBtn() { [...tabBar.children].forEach((b, i) => b.classList.toggle('ghost', i === active)); }
  function renderTab() {
    const revision = ++tabRevision;
    clear(host); setActiveBtn();
    (active === 0 ? hardwareTab(ctx) : analysisTab(ctx)).then(node => {
      if (ctx.scope.active && revision === tabRevision) host.append(node);
    }).catch(() => { if (ctx.scope.active && revision === tabRevision) host.append(banner('bad', '读取记录失败，请重试')); });
  }

  renderTab();
  return wrap;
}

async function hardwareTab(ctx) {
  const host = el('div', {});
  host.append(skeleton(6));
  let data;
  try { data = await ctx.dataSource.getHardwareHistory({ limit: 200 }); }
  catch (e) { clear(host); host.append(banner('bad', e?.kind === 'offline' ? '后端未连接：无法读取采集历史。' : ('读取失败：' + (e?.message || e)))); return host; }

  const items = data.items || [];
  const s = data.storage || {};
  const state = { query: '', validity: 'all', from: '', to: '', page: 1, pageSize: getPref('ui.pageSize', 20), expanded: new Set() };

  const rows = items.map((it) => ({...(it.observation || {}), _replayed: it.replayed === true}));
  const timeOf = (o) => o.receivedAt ?? 0;
  const validOf = (o) => o.quality?.temperatureValid || o.quality?.humidityValid || o.quality?.gasValid;

  const search = el('input', { type: 'search', placeholder: '按时间/来源/设备搜索', oninput: () => { state.query = search.value; state.page = 1; paint(); } });
  const validity = el('select', { onchange: () => { state.validity = validity.value; state.page = 1; paint(); } }, [
    el('option', { value: 'all', text: '全部记录' }), el('option', { value: 'valid', text: '仅含有效读数' }), el('option', { value: 'unknown', text: '仅未知/失效' })]);
  const from = el('input', { type: 'date', onchange: () => { state.from = from.value; state.page = 1; paint(); } });
  const to = el('input', { type: 'date', onchange: () => { state.to = to.value; state.page = 1; paint(); } });

  const exportBtn = button('导出当前筛选视图 CSV', () => {
    const view = compute();
    if (view.length === 0) { ctx.notify('warn', '当前筛选结果为空，未生成文件。'); return; }
    const csv = toCsv([
      { header: '序号', value: (o) => o._seq },
      { header: '入库方式', value: (o) => o._replayed ? '历史补发' : '普通历史' },
      { header: '接收时间', value: (o) => o.receivedAt ? new Date(o.receivedAt).toISOString() : '' },
      { header: '设备', value: (o) => o.deviceId || '' },
      { header: '来源', value: (o) => o.source || '' },
      { header: '温度C', value: (o) => (o.quality?.temperatureValid && o.values?.temperatureC != null) ? o.values.temperatureC : '' },
      { header: '湿度%', value: (o) => (o.quality?.humidityValid && o.values?.humidityPct != null) ? o.values.humidityPct : '' },
      { header: 'ADC原始', value: (o) => (o.quality?.gasValid && o.values?.gasRaw != null) ? o.values.gasRaw : '' },
      { header: 'ADC mV', value: (o) => (o.quality?.gasValid && o.values?.gasMv != null) ? o.values.gasMv : '' },
      { header: 'CO', value: () => '' },
      { header: 'CO2', value: () => '' },
      { header: '状态原因', value: (o) => o.reason || '' },
    ], view);
    download(csv, 'pengan-observations-filtered.csv');
    ctx.notify('ok', `已导出 ${view.length} 条到浏览器下载（当前筛选视图；非完整历史）。CO/CO₂ 列恒为空——未接入。`);
  }, { variant: 'secondary' });

  const tableScroll = el('div', { class: 'table-scroll' });
  const pagerInfo = el('div', { class: 'pager' });

  function compute() {
    let view = rows.map((o, i) => ({ ...o, _seq: items[i].seq }));
    view = filterByValidity(view, state.validity, validOf);
    const t0 = state.from ? Date.parse(state.from + 'T00:00:00') : null;
    const t1 = state.to ? Date.parse(state.to + 'T23:59:59.999') : null;
    view = filterByRange(view, t0, t1, timeOf);
    view = filterRows(view, state.query, (o) => [fmtDateTime(o.receivedAt), fmtSource(o.source), o.deviceId, fmtReason(o.reason), String(o._seq)].join(' '));
    return view;
  }

  function paint() {
    const view = compute();
    const pg = paginate(view, state.page, state.pageSize);
    state.page = pg.page;
    clear(tableScroll); clear(pagerInfo);
    if (pg.rows.length === 0) { tableScroll.append(emptyState('没有符合筛选条件的记录', view.length ? '换个条件试试。' : '窗口内没有任何记录。')); }
    else {
      const tbody = el('tbody', {});
      for (const o of pg.rows) {
        tbody.append(el('tr', { class: 'clickable-row', onclick: () => { state.expanded.has(o._seq) ? state.expanded.delete(o._seq) : state.expanded.add(o._seq); paint(); } }, [
          el('td', { class: 'num', text: String(o._seq) }),
          el('td', {}, [fmtDateTime(o.receivedAt), o._replayed ? chip('plain', '历史补发') : null]),
          el('td', {}, [chip(o.deviceOnline ? sourceKind(o.source) : 'bad', o.deviceOnline ? fmtSource(o.source) : '离线')]),
          el('td', { class: 'num', text: o.quality?.temperatureValid ? fmtValue(o.values?.temperatureC, '', 1) : '未知' }),
          el('td', { class: 'num', text: o.quality?.humidityValid ? fmtValue(o.values?.humidityPct, '', 1) : '未知' }),
          el('td', { class: 'num', text: o.quality?.gasValid ? (o.values?.gasRaw + '/' + o.values?.gasMv) : '未知' }),
          el('td', {}, [o.quality?.coValid ? chip('warn', '?') : chip('plain', 'CO 未接入'), o.quality?.co2Valid ? chip('warn', '?') : chip('plain', 'CO₂ 未接入')]),
          el('td', { class: 'muted', text: fmtReason(o.reason || '') }),
        ]));
        if (state.expanded.has(o._seq)) {
          tbody.append(el('tr', { class: 'row-detail' }, [el('td', { colspan: '8' }, [
            el('dl', { class: 'kv' }, [
              el('dt', { text: '记录哈希' }), el('dd', { class: 'mono', text: (items.find((x) => x.seq === o._seq)?.hash || '未知') }),
              el('dt', { text: '样本年龄' }), el('dd', { text: Number.isFinite(o.sampleAgeMs) ? o.sampleAgeMs + ' ms' : '未知' }),
              el('dt', { text: '温湿度年龄' }), el('dd', { text: Number.isFinite(o.climateAgeMs) ? o.climateAgeMs + ' ms' : '未知' }),
              el('dt', { text: 'ADC年龄' }), el('dd', { text: Number.isFinite(o.gasAgeMs) ? o.gasAgeMs + ' ms' : '未知' }),
              el('dt', { text: '准入' }), el('dd', { text: o.admission || 'unknown_denied' }),
              el('dt', { text: '执行可用' }), el('dd', { text: o.actuationAvailable ? '异常：应恒为否' : '否（无执行器）' }),
            ]),
          ])]));
        }
      }
      tableScroll.append(el('table', {}, [
        el('thead', {}, [el('tr', {}, ['序号', '接收时间', '在线/来源', '温度℃', '湿度%', 'ADC/mV', 'CO / CO₂', '状态'].map((h) => el('th', { text: h })))]),
        tbody]));
    }
    pagerInfo.append(
      el('span', { text: `第 ${pg.page}/${pg.pageCount} 页 · 已加载数据中匹配 ${pg.total} 条` }),
      button('上一页', () => { state.page--; paint(); }, { variant: 'secondary small', disabled: pg.page <= 1 }),
      button('下一页', () => { state.page++; paint(); }, { variant: 'secondary small', disabled: pg.page >= pg.pageCount }));
  }

  host.replaceChildren(
    sectionCard('真实采集历史', `存储：${s.enabled ? (s.healthy ? '正常' : '异常') : '未启用'} · ${Number.isInteger(s.records) ? s.records : '?'} 条 · ${fmtBytes(s.bytes)}。历史与当前读数分开，导出仅含本筛选视图。`,
      el('div', { class: 'toolbar' }, [search, validity, el('span', { class: 'muted', text: '从' }), from, el('span', { class: 'muted', text: '到' }), to, el('span', { class: 'spacer' }), exportBtn]),
      tableScroll, pagerInfo,
      ctx.state.demoMode ? null : el('p', { class: 'muted text-sm' }, ['筛选针对已加载数据；使用下方游标读取更早记录，未加载范围不计入本次导出。'])),
  );
  paint();
  host.append(historyCursor(ctx,data,opts=>ctx.dataSource.getHardwareHistory(opts), incoming=>{rows.push(...incoming.map(item=>item.observation || {}));paint();}));
  return host;
}

async function analysisTab(ctx) {
  const host = el('div', {});
  host.append(skeleton(4));
  let data;
  try { data = await ctx.dataSource.getAnalysisHistory({ limit: 200 }); }
  catch (e) { clear(host); host.append(banner('bad', e?.kind === 'offline' ? '后端未连接：无法读取 AI 分析历史。' : ('读取失败：' + (e?.message || e)))); return host; }
  const items = data.items || [];
  const state = { query: '', page: 1, pageSize: 10, expanded: new Set() };
  const search = el('input', { type: 'search', placeholder: '搜索问题/模型/结论', oninput: () => { state.query = search.value; state.page = 1; paint(); } });
  const listBox = el('div', {}); const pagerInfo = el('div', { class: 'pager' });

  function paint() {
    const view = filterRows(items, state.query, (it) => [it.prompt, it.analysis?.provider, it.analysis?.model, it.analysis?.summary].join(' '));
    const pg = paginate(view, state.page, state.pageSize); state.page = pg.page;
    clear(listBox);
    if (!pg.rows.length) listBox.append(emptyState('没有匹配的分析记录', '真实模式下，成功完成且保存的文字分析会出现在这里。'));
    for (const it of pg.rows) {
      const a = it.analysis || {};
      const open = state.expanded.has(it.seq);
      listBox.append(el('div', { class: 'card analysis-card', onclick: () => { open ? state.expanded.delete(it.seq) : state.expanded.add(it.seq); paint(); } }, [
        el('div', { class: 'analysis-card-head' }, [
          chip('info', '#' + it.seq), el('strong', { text: it.prompt || '（无问题文本）' }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'muted', text: (a.provider || '?') + ' / ' + (a.model || '?') + ' · ' + fmtDateTime(it.recordedAt) }),
        ]),
        open ? el('div', { class: 'analysis-card-body' }, [
          el('p', { text: a.summary || '（无摘要）' }),
          (a.findings || []).length ? el('div', {}, [el('strong', { text: '发现：' }), el('span', { text: a.findings.join('；') })]) : null,
          (a.unknowns || []).length ? el('div', { class: 'muted' }, [el('strong', { text: '未知：' }), el('span', { text: a.unknowns.join('；') })]) : null,
          el('dl', { class: 'kv mt-sm' }, [
            el('dt', { text: '依据快照时间' }), el('dd', { text: a.observationReceivedAt ? fmtDateTime(a.observationReceivedAt) : '无有效现场读数（当时离线）' }),
            el('dt', { text: '设备执行' }), el('dd', {}, [chip('plain', a.executed === false && a.hardwareControl === false ? '未执行（模型建议≠硬件动作）' : '异常状态')]),
            el('dt', { text: '记录哈希' }), el('dd', { class: 'mono', text: it.hash || '未知' }),
          ]),
          el('p', { class: 'muted text-sm' }, ['历史文字分析，不代表当前安全；照片不自动入历史。']),
        ]) : null,
      ]));
    }
    clear(pagerInfo);
    pagerInfo.append(el('span', { text: `第 ${pg.page}/${pg.pageCount} 页 · 共 ${pg.total} 条` }),
      button('上一页', () => { state.page--; paint(); }, { variant: 'secondary small', disabled: pg.page <= 1 }),
      button('下一页', () => { state.page++; paint(); }, { variant: 'secondary small', disabled: pg.page >= pg.pageCount }));
  }
  host.replaceChildren(sectionCard('AI 文字分析历史', '仅保存成功的真实文字分析（问题/依据/模型/工具轨迹）。图片分析不自动入库。', el('div', { class: 'toolbar' }, [search, el('span', { class: 'spacer' })]), listBox, pagerInfo));
  paint();
  host.append(historyCursor(ctx,data,opts=>ctx.dataSource.getAnalysisHistory(opts),()=>paint()));
  return host;
}

function download(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
