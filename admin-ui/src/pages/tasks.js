import {renderTaskTimeline} from '../lib/timeline.js';
import { el, button, banner, sectionCard, emptyState } from '../lib/dom.js';
import { fmtDateTime, fmtTaskState, fmtVerdict } from '../lib/format.js';
import { PIPELINE_TEST_RECEIPT } from '../demo-pipeline.js';
const stageLabel = value => ({decision:'决策',generate:'生成',verify:'审核'})[value] || value;
const json = value => JSON.stringify(value ?? null, null, 2);
export default async function renderTasks(ctx) {
  const wrap = el('div', {class:'live-dashboard'}), status = el('p', {role:'status'}), list = el('div'), detail = el('div');
  const prompt = el('textarea', {id:'pipeline-prompt',maxlength:1000,rows:3,placeholder:'输入问题，读取当前所选设备并检索知识库'});
  let busy = false, polling = false, selected = '', revision = 0, lastTaskSig = '';
  const canWrite = !ctx.demoMode && ctx.state.user?.role === 'admin';
  const start = button('开始决策→生成→审核', async () => {
    if (busy || !ctx.scope.active) return;
    if (!prompt.value.trim()) { status.textContent = '请输入问题'; return; }
    busy=true;start.disabled=true; const version=++revision;
    status.textContent='正在提交；提交后即使关闭页面，服务端任务仍可能继续。';
    try {
      const result=await ctx.dataSource.startPipeline({prompt:prompt.value.trim()});
      if (!ctx.scope.active || version!==revision) return;
      if(typeof result?.taskId!=='string')throw Error('任务回执无效');
      selected=result.taskId;lastTaskSig='';status.textContent='任务已接收：'+selected;await poll();await refreshList();
    } catch(e) { if(ctx.scope.active)status.textContent='提交未确认：'+e.message+'；请先刷新任务列表，避免重复提交。'; }
    finally { busy=false;if(ctx.scope.active)start.disabled=!canWrite; }
  }, {disabled:!canWrite});
  wrap.append(banner('warn', '只读管线：检索→决策→生成→审核→保存。模型建议不等于设备执行，知识资料不能覆盖安全规则。'),
    sectionCard('新建任务 · '+(ctx.state.gatewayId || '尚未选择设备'), null, el('label',{for:'pipeline-prompt',text:'分析问题'}),prompt,start,status),
    sectionCard('本设备任务记录', '历史任务不是当前状态。',button('刷新任务列表',()=>refreshList(),{disabled:ctx.demoMode}),list),detail);
  if(ctx.demoMode){
    status.textContent='演示模式不提交真实任务；下方仅展示已留存的合成测试回执。';
    list.append(banner('warn','真实DeepSeek调用的合成数据测试回执（静态历史，不是当前设备）'));
    const receipt=PIPELINE_TEST_RECEIPT;
    detail.append(sectionCard('检索→决策→生成→审核 · 静态历史回执', '供应商 '+receipt.provider+' / '+receipt.model+' · 实际模型调用 '+receipt.calls+' 次 · 检索命中 '+receipt.retrievalHits+' 块 · 未执行设备',
      el('p',{text:'测试结论 '+fmtVerdict(receipt.verdict)+' 只适用于当时合成软件环境，不表示真实设备或人员安全准入。'}),
      el('ol',{},receipt.stages.map(stage=>el('li',{text:stageLabel(stage.stage)+' · '+({passed:'成功',failed:'失败',blocked:'已阻止'}[stage.state]||stage.state)+' · '+stage.durationMs+' ms · '+fmtDateTime(stage.startedAt)+' → '+fmtDateTime(stage.finishedAt)+' · '+stage.summary}))),
      el('h4',{text:'链路事件（历史顺序）'}),el('ol',{},receipt.events.map((event,index)=>el('li',{text:'#'+(index+1)+' '+event.type+(event.stage?' · '+event.stage:'')+(event.state?' · '+event.state:'')})))));
    const raw=el('pre',{class:'pre-wrap'});
    list.append(button('查看安全测试回执',()=>{raw.textContent=json(receipt);}),raw);
    return wrap;
  }
  function paint(task) {
    if(!task || task.gatewayId!==ctx.state.gatewayId || task.taskId!==selected)throw Error('任务设备身份无效');
    const sig = JSON.stringify(task);
    if (sig === lastTaskSig) return;
    lastTaskSig = sig;
    const result=task.result, events=Array.isArray(task.events)?task.events:[];
    detail.replaceChildren(sectionCard('任务 '+task.taskId, '状态：'+fmtTaskState(task.status)+' · 开始 '+fmtDateTime(task.startedAt)+(task.finishedAt?' · 耗时 '+Math.max(0,task.finishedAt-task.startedAt)+' 毫秒':''),
      el('p',{text:task.error?'失败原因：'+task.error:'任务仅生成建议，没有下发控制。'}),
      el('h4',{text:'全链路事件'}),el('ol',{},events.map(event=>el('li',{text:'#'+event.seq+' '+fmtDateTime(event.at)+' '+event.type+' '+json(event.data)}))),
      el('h4',{text:'RAG 检索依据'}),el('pre',{class:'pre-wrap',text:json(task.retrieval || {items:[],note:'尚未检索或无命中'})}),
      el('details',{},[el('summary',{text:'查看本次任务的提示词版本与快照'}),el('pre',{class:'pre-wrap',text:json(task.promptPolicy || {note:'旧任务未记录提示词快照，不能用当前版本替代历史证据'})})]),
      el('h4',{text:'处理时间轴'}),renderTaskTimeline(task),el('details',{},[el('summary',{text:'查看原始技术回执'}),el('pre',{class:'pre-wrap',text:json(result || {status:'等待阶段结果'})})])));
  }
  async function poll() {
    if(polling || !selected || !ctx.scope.active)return;polling=true;const version=revision,id=selected;
    try {const task=await ctx.dataSource.readPipelineTask(id);if(ctx.scope.active&&version===revision)paint(task);}
    catch(e){if(ctx.scope.active&&version===revision)status.textContent='任务读取失败：'+e.message;}
    finally{polling=false;}
  }
  async function refreshList(){
    try{const data=await ctx.dataSource.listPipelineTasks();if(!ctx.scope.active)return;
      if(!Array.isArray(data?.items))throw Error('任务列表协议无效');
      list.replaceChildren(...(data.items.length?data.items.map(task=>button(task.taskId+' · '+fmtTaskState(task.status),()=>{revision++;selected=task.taskId;lastTaskSig='';poll();},{variant:'secondary small'})):[emptyState('暂无任务','登录管理员后提交问题。')]));
    }catch(e){if(ctx.scope.active)list.replaceChildren(banner('bad','任务列表读取失败：'+e.message));}
  }
  await refreshList();const timer=setInterval(poll,1000);ctx.scope.onDispose(()=>{revision++;clearInterval(timer);});return wrap;
}
