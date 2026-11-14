import {el,button,banner,sectionCard} from '../lib/dom.js';
import {fmtDateTime} from '../lib/format.js';
export default async function renderWeather(ctx){
 const wrap=el('div'),host=el('div'),status=el('p',{role:'status'});let busy=false,latest=null,aiBusy=false;
 const crop=el('input',{placeholder:'作物（可选）',maxlength:80,'aria-label':'作物'}),stage=el('input',{placeholder:'生育期（可选）',maxlength:80,'aria-label':'生育期'}),question=el('textarea',{placeholder:'想结合天气核查什么？（可选，最多500字）',maxlength:500,'aria-label':'天气农事问题'}),aiStatus=el('p',{role:'status'}),adviceHost=el('div');
 const advise=button('生成天气农事建议',async()=>{
  if(aiBusy||!latest||latest.expiresAt<=Date.now())return;aiBusy=true;advise.disabled=true;refresh.disabled=true;adviceHost.replaceChildren();aiStatus.textContent='正在读取服务端最新天气并请求模型；不执行设备…';
  try{
   const d=await ctx.dataSource.generateWeatherAdvice({crop:crop.value,stage:stage.value,question:question.value});if(!ctx.scope.active)return;
   if(d?.schemaVersion!==1||d.kind!=='weather_advice'||d.gatewayId!==ctx.state.gatewayId||d.readOnly!==true||d.executed!==false||d.requiresHumanConfirmation!==true||d.persistence?.saved!==true||!Number.isSafeInteger(d.persistence.recordId)||typeof d.summary!=='string'||!Array.isArray(d.checks)||d.checks.length>6||!Array.isArray(d.limitations)||d.limitations.length>6||!Number.isSafeInteger(d.evidence?.expiresAt)||d.evidence.expiresAt<=Date.now())throw Error('建议响应或天气依据无效');
   adviceHost.append(el('p',{text:d.summary}),...d.checks.map(c=>sectionCard(c.title,null,el('p',{text:c.reason}))),el('ul',{},d.limitations.map(x=>el('li',{text:x}))),el('p',{class:'muted',text:'天气读取 '+fmtDateTime(d.evidence.fetchedAt)+' · 依据哈希 '+d.sourceHash+' · 审计 #'+d.persistence.recordId}));
   aiStatus.textContent=d.provider+' / '+d.model+' · 建议已保存，需人工核对现场。';
  }catch(e){if(ctx.scope.active)aiStatus.textContent='建议未确认：'+e.message+'。请求可能已经发给模型，请先核对系统审计，再决定是否重新提交。';}
  finally{aiBusy=false;if(ctx.scope.active){refresh.disabled=false;advise.disabled=!latest||latest.expiresAt<=Date.now();}}
 },{disabled:true});
 const refresh=button('刷新天气',load,{variant:'secondary',disabled:ctx.demoMode||!ctx.state.gatewayId});
 wrap.append(sectionCard('乌兰察布 · 天气与农业风险','集宁城区参考点；大棚实际位置、海拔和棚内气候可能不同。',refresh,status),
  banner('warn','平台根据天气预报计算的风险提示，不是气象部门正式预警。仅供人工巡检，不执行设备，也不替代棚内传感器。'),host,
  sectionCard('AI天气农事建议','点击后将公开天气预报及此处填写的作物背景发送给已配置模型；不会发送照片或现场人员信息。',crop,stage,question,advise,aiStatus,adviceHost));
 async function load(){
  if(busy||aiBusy||ctx.demoMode||!ctx.scope.active)return;busy=true;latest=null;advise.disabled=true;refresh.disabled=true;host.replaceChildren();adviceHost.replaceChildren();aiStatus.textContent='';status.textContent='正在读取天气服务…';
  try{
   const d=await ctx.dataSource.getWeather();if(!ctx.scope.active)return;
   if(d?.schemaVersion!==1||d.gatewayId!==ctx.state.gatewayId||d.officialWarning!==false||d.hardwareControl!==false)throw Error('天气响应来源校验失败');
   if(!d.available){status.textContent='天气暂不可用；当前风险未知，不把读取失败当作无风险。';return;}
   if(!Number.isSafeInteger(d.expiresAt)||d.expiresAt<=Date.now()||!Array.isArray(d.risks)||!Array.isArray(d.hours)||d.hours.length>25)throw Error('天气数据已过期或格式无效');
   status.textContent='Open-Meteo · 读取 '+fmtDateTime(d.fetchedAt)+' · 有效至 '+fmtDateTime(d.expiresAt)+' · 服务端10分钟缓存';
   latest=d;advise.disabled=ctx.state.user?.role!=='admin';
   const s=d.summary;
   host.append(sectionCard('未来24小时',null,el('p',{text:'气温 '+s.minTemperatureC+'～'+s.maxTemperatureC+'℃ · 最大阵风 '+s.maxGustMs+'m/s · 累计降水 '+s.totalRainMm+'mm'})),
    ...(d.risks.length?d.risks.map(r=>sectionCard(r.title,'命中 '+r.hours+' 个预报时段（可能不连续）',el('p',{text:fmtDateTime(r.startsAt)+' → '+fmtDateTime(r.endsAt)}),el('p',{text:r.advice}))):[banner('info','未来24小时未命中本平台预设阈值；不代表没有气象风险。')]),
    sectionCard('阈值与数据来源',null,el('p',{text:'低温≤2℃；高温≥35℃；阵风≥17.2m/s；小时降水≥10mm；小时降雪≥1cm；雷暴代码95–99。阈值为平台巡检规则，不是作物诊断。'}),el('a',{href:'https://open-meteo.com/',target:'_blank',rel:'noopener noreferrer',text:'天气数据：Open-Meteo'})),
    sectionCard('逐小时预报',null,el('ol',{},d.hours.map(r=>el('li',{text:fmtDateTime(r.at)+' · '+r.temperatureC+'℃ · 阵风 '+r.gustMs+'m/s · 雨 '+r.rainMm+'mm · 雪 '+r.snowCm+'cm'})))));
   const expiry=()=>{if(ctx.scope.active&&latest===d&&Date.now()>=d.expiresAt){host.replaceChildren(banner('warn','已超过有效期，请刷新。当前天气风险未知。'));status.textContent='天气已过期';advise.disabled=true;adviceHost.replaceChildren();aiStatus.textContent='天气依据已过期，原建议不作为当前建议。';}};
   // Scope owns this timer; no page-wide rerender or periodic layout animation.
   const timer=setTimeout(expiry,Math.min(2147483647,Math.max(0,d.expiresAt-Date.now())));ctx.scope.signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
  }catch(e){if(ctx.scope.active){host.replaceChildren();status.textContent='天气读取失败：'+e.message+'；当前风险未知。';}}
  finally{busy=false;if(ctx.scope.active)refresh.disabled=false;}
 }
 if(ctx.demoMode)status.textContent='演示模式不读取真实天气，也不伪造预警。';else if(ctx.state.gatewayId)await load();else status.textContent='请先选择设备。';
 return wrap;
}
