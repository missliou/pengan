import {el,button,banner,sectionCard} from '../lib/dom.js';
import {fmtDateTime} from '../lib/format.js';
import {historyTrend,trendQuestion} from '../lib/history-trend.js';
import {assistantSession} from '../lib/assistant.js';

export default async function renderTrends(ctx){
  const wrap=el('div',{class:'history-trends'}),host=el('div'),status=el('p',{role:'status'});let summary=null,busy=false;
  const review=button('带入农业问答复核',()=>{
    if(!summary||!summary.total)return;
    const session=assistantSession(ctx.state,'agri-qa',ctx.demoMode);
    if(session.busy||session.uncertain||session.task?.status==='running'||(session.taskId&&!session.task)){status.textContent='农业问答仍有处理中或未确认的任务，请先核对后再带入。';return;}
    if(session.question.trim()){status.textContent='农业问答已有未清空草稿。请先查看并处理，避免覆盖。';return;}
    session.task=null;session.taskId='';
    session.question=trendQuestion(summary);ctx.navigate('agri-qa');
  },{disabled:true});
  const refresh=button('读取最近200条',async()=>load(),{variant:'secondary',disabled:ctx.demoMode||!ctx.state.gatewayId});
  wrap.append(banner('info','先计算历史趋势，再由你决定是否交给智能体复核。不会自动调用模型或下发设备。'),
    sectionCard('历史趋势与数据质量','只读分析当前所选设备最近最多200条，按原采样时间排序；不代表当前状态或完整历史。',el('div',{class:'btn-row'},[refresh,review]),status),host);
  async function load(){
    if(busy||ctx.demoMode||!ctx.scope.active)return;busy=true;refresh.disabled=true;review.disabled=true;summary=null;status.textContent='正在核对历史来源…';
    try{
      const data=await ctx.dataSource.getHardwareHistory({limit:200});if(!ctx.scope.active)return;
      summary=historyTrend(data,ctx.state.gatewayId);
      const value=v=>v===null?'未知':Number(v.toFixed(2)).toString();
      host.replaceChildren(sectionCard('窗口概况',null,el('p',{text:summary.total+'条记录 · '+summary.replayed+'条补发 · '+summary.sessions+'个会话'}),el('p',{class:'muted',text:fmtDateTime(summary.from)+' → '+fmtDateTime(summary.to)})),
        ...summary.metrics.map(m=>sectionCard(m.label+'变化',null,
          el('p',{class:'trend-range',text:'最低 '+value(m.min)+' / 最高 '+value(m.max)+' '+m.unit}),
          el('p',{text:'有效 '+m.count+' 条 · 未知/无效 '+m.missing+' 条 · 首末 '+value(m.first)+' → '+value(m.last)}),
          el('details',{},[el('summary',{text:'查看最近12个有效采样点'}),el('ol',{},m.points.slice(-12).map(p=>el('li',{text:'#'+p.seq+' · '+fmtDateTime(p.at)+' · '+value(p.value)+m.unit})))]))),
        banner('warn','历史首末差异不等于变化速率或异常因果。采样间隔可能不均；CO/CO₂未接入，ADC不是气体浓度。'));
      review.disabled=!summary.total||!summary.from;status.textContent=summary.total?'历史摘要已就绪。点击复核仅填入农业问答，确认提交后才调用智能体。':'本设备暂无历史记录。';
    }catch(e){if(ctx.scope.active){host.replaceChildren(banner('bad','读取失败：'+e.message));status.textContent='未形成可用分析。';}}
    finally{busy=false;if(ctx.scope.active)refresh.disabled=false;}
  }
  if(ctx.demoMode){status.textContent='演示模式不读取真实历史，也不伪造趋势。';host.append(sectionCard('等待真实历史',null,el('p',{text:'退出演示并登录后，可读取采样窗口、有效率、极值及原始记录序号。'})));}
  else if(ctx.state.gatewayId)await load();else status.textContent='请先选择设备。';
  return wrap;
}
