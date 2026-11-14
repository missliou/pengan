import {el,button} from './dom.js';

// Accumulate explicit server pages, without claiming a loaded window is the
// full database. Keep browser memory bounded; server history is never truncated.
export function historyCursor(ctx, data, load, appended) {
  const items = data.items || [], label = el('span'), error = el('span',{role:'status'});
  let next = data.nextBeforeSeq ?? null, busy = false;
  const more = button('加载更早记录', async () => {
    if (busy || !ctx.scope.active || next === null || items.length >= 5000) return;
    busy = true; paint(); error.textContent = '';
    try {
      const before = next, page = await load({limit:200,beforeSeq:before}); ctx.scope.assertActive();
      const incoming = page.items;
      if (!Array.isArray(incoming) || incoming.length > 200 || incoming.some(row=>!Number.isSafeInteger(row.seq)||row.seq<1||row.seq>=before) ||
          new Set([...items,...incoming].map(row=>row.seq)).size !== items.length+incoming.length ||
          page.nextBeforeSeq != null && (!Number.isSafeInteger(page.nextBeforeSeq)||page.nextBeforeSeq<1||page.nextBeforeSeq>=before) || items.length+incoming.length>5000)
        throw Error('历史游标响应无效或超出浏览器5000条上限');
      items.push(...incoming); next = page.nextBeforeSeq ?? null; appended(incoming);
    } catch (e) { if(ctx.scope.active)error.textContent = '加载失败：'+e.message; }
    finally { busy = false; if(ctx.scope.active)paint(); }
  },{variant:'secondary'});
  function paint() { label.textContent = `已加载 ${items.length} 条 · ${next === null ? '该查询范围无更早记录' : items.length >= 5000 ? '还有更早记录，达到浏览器5000条上限' : '还有更早记录'}；筛选与导出仅针对已加载数据。`; more.disabled = busy || next === null || items.length >= 5000; }
  paint(); return el('div',{class:'toolbar'},[label,more,error]);
}
