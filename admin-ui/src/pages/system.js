// 系统与审计。
// 现状诚实说明：登录事件、配置变更审计、系统健康查询接口均属 [待实现]；
// 可确证的只有：/api/health（模式/transport/采集在线）、观测快照（存储来源）、AI 历史存储状态。
import { el, chip, sectionCard, banner } from '../lib/dom.js';
import { fmtDateTime, fmtBytes, fmtSource, sourceKind } from '../lib/format.js';
import { watchHardware } from '../lib/live-hardware.js';

export default async function renderSystem(ctx) {
  const wrap = el('div', {});
  if (!ctx.demoMode) {
    try { const audit = await ctx.dataSource.getAuditEvents(); ctx.scope.assertActive();
      wrap.append(sectionCard('管理审计（最近50条）','持久审计记录；不显示密码、令牌或配置正文。',el('ul',{},(audit.items || []).map(row=>el('li',{text:'#'+(row.seq ?? '?')+' · '+fmtDateTime(row.recordedAt || row.at)+' · '+(row.data?.event || row.action || row.event || '审计事件')})))));
    } catch { wrap.append(banner('warn','审计读取失败或当前账号没有权限。')); }
  }

  const results = await Promise.allSettled([ctx.dataSource.getHealth(), ctx.dataSource.getObservations(), ctx.dataSource.getAnalysisHistory({ limit: 1 })]);
  const health = results[0].status === 'fulfilled' ? results[0].value : null;
  const obs = results[1].status === 'fulfilled' ? results[1].value : null;
  const ai = results[2].status === 'fulfilled' ? results[2].value : null;

  if (!health) { wrap.append(sectionCard('后端状态', null, banner('bad', '后端未连接：/api/health 不可达。'))); return wrap; }

  ctx.scope.assertActive();
  const hwStatus = el('dd'), hwSource = el('dd');
  wrap.append(sectionCard('后端与数据状态（本次实测）', null,
    el('dl', { class: 'kv' }, [
      el('dt', { text: '服务健康' }), el('dd', {}, [chip(health.ok ? 'ok' : 'bad', health.ok ? 'ok' : '异常')]),
      el('dt', { text: '运行模式' }), el('dd', {}, [chip(health.mode === 'hardware' ? 'ok' : 'warn', health.mode === 'hardware' ? '真实数据模式' : health.mode === 'simulation' ? '模拟模式（非参赛数据）' : health.mode)]),
      el('dt', { text: '传输' }), el('dd', {}, [chip(sourceKind(health.transport), String(health.transport || '未知'))]),
      el('dt', { text: '采集在线' }), hwStatus,
      el('dt', { text: '观测来源' }), hwSource,
    ])));

  const s = ai?.storage;
  wrap.append(sectionCard('AI 历史存储', null, s ? el('dl', { class: 'kv' }, [
    el('dt', { text: '启用' }), el('dd', {}, [chip(s.enabled ? 'ok' : 'unknown', s.enabled ? '是' : '否')]),
    el('dt', { text: '健康' }), el('dd', {}, [chip(s.healthy ? 'ok' : 'bad', s.healthy ? '正常' : '写入/恢复异常')]),
    el('dt', { text: '占用' }), el('dd', { text: fmtBytes(s.bytes) + ' / ' + fmtBytes(s.maxBytes) }),
  ]) : emptyStateOrBanner()));


  watchHardware(ctx, obs, hw => {
    hwStatus.replaceChildren(chip(hw ? hw.deviceOnline ? 'ok' : 'bad' : 'unknown', hw ? hw.deviceOnline ? '在线' : '离线/过期' : '未知／读取失败'));
    hwSource.textContent = fmtSource(hw?.source) + (hw?.receivedAt ? ' · ' + fmtDateTime(hw.receivedAt) : '');
  });
  return wrap;

  function emptyStateOrBanner() { return el('p', { class: 'muted' }, ['未能读取存储状态。']); }
}
