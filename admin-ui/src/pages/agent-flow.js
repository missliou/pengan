import {el,button,banner,sectionCard} from '../lib/dom.js';
import {PIPELINE_TEST_RECEIPT} from '../demo-pipeline.js';
const stages=[['retrieval','知识检索','检索相关资料，核对引用来源'],['decision','决策','识别意图、风险与必要条件'],['generate','生成','组织建议和可核验的依据'],['verify','审核','硬规则校验与模型复核'],['execute','执行','执行器尚未接入，禁止下发'],['feedback','结果回传','无真实执行，不生成控制回执'],['save','保存','保存过程与结果，形成历史']];
const names={passed:'成功',completed:'完成',running:'进行中',failed:'失败',blocked:'已阻止',waiting:'等待',unavailable:'未接入',not_executed:'未执行'};
const processing=['retrieval','decision','generate','verify','save'];
export default async function renderAgentFlow(ctx){
 const root=el('div',{class:'agent-flow'}),status=el('p',{role:'status',class:'flow-status'}),nodes=new Map(),details=el('div',{class:'flow-details'});
 const selector=el('select',{'aria-label':'查看任务'});let selected='',busy=false,revision=0,replay=-1,paused=false,detailSignature='';
 const line=el('ol',{class:'agent-flow-track'}),branch=el('ol',{class:'flow-device-branch'}),progress=el('progress',{max:5,value:0,'aria-label':'分析与保存进度'});
 const summary=el('div',{class:'flow-metrics'},[metric('观测来源',ctx.demoMode?'历史测试回放':'设备任务观测'),metric('运行方式','只读建议 · 未下发控制'),metric('流程结构','5 个处理阶段 / 2 个隔离节点')]);
 function metric(label,value){return el('div',{},[el('small',{text:label}),el('strong',{text:value})]);}
 for(const [index,[key,label,hint]] of stages.entries()){
  const state=el('span',{class:'flow-state',text:'等待'}),time=el('small',{class:'flow-time',text:'耗时未知'}),node=el('li',{class:'flow-node waiting'},[
   el('div',{class:'flow-anchor'},[el('span',{class:'flow-number',text:({retrieval:'⌕',decision:'◇',generate:'≡',verify:'✓',save:'↧',execute:'⊘',feedback:'↩'})[key]}),el('span',{class:'flow-index',text:String(index+1).padStart(2,'0')}),el('i',{class:'flow-wire','aria-hidden':'true'})]),el('div',{class:'flow-copy'},[el('strong',{text:label}),state,el('p',{text:hint}),time])]);
  nodes.set(key,{node,state,time,current:'waiting'});(key==='execute'||key==='feedback'?branch:line).append(node);
 }
 function set(key,state,duration){const n=nodes.get(key);n.current=state;n.node.className='flow-node '+state;n.state.textContent=names[state]||state;n.time.textContent=Number.isFinite(duration)?duration+' 毫秒':state==='unavailable'||state==='not_executed'?'没有执行耗时':'耗时未知';}
 function count(){progress.value=processing.filter(key=>['completed','passed'].includes(nodes.get(key).current)).length;}
 function guardExecution(){set('execute','unavailable');set('feedback','not_executed');}
 function paint(task){
  const result=task.result,events=task.events||[];
  for(const [key] of stages){
   if(key==='execute'||key==='feedback')continue;
   const record=result?.stages?.find(s=>s.stage===key),started=events.find(e=>e.type==='stage_started'&&e.data?.stage===key),ended=events.findLast(e=>e.type==='stage_completed'&&e.data?.stage===key);
   if(key==='retrieval')set(key,result?.retrieval?.error?'failed':events.some(e=>e.type==='retrieval_completed')?'completed':events.some(e=>e.type==='retrieval_started')?(task.status==='failed'?'failed':'running'):'waiting');
   else if(key==='save')set(key,task.persistenceUnconfirmed?'failed':events.some(e=>e.type==='task_completed')?'completed':task.status==='failed'?'failed':'waiting');
   else set(key,record?.state||ended?.data?.state||(started?(task.status==='failed'?'failed':'running'):'waiting'),record?.durationMs??ended?.data?.durationMs);
  }
  guardExecution();count();status.textContent='任务 '+task.taskId+' · '+(names[task.status]||task.status)+' · '+(task.error||'仅分析与保存，未执行设备');
  const signature=JSON.stringify(result?.stages||[]);if(signature!==detailSignature){detailSignature=signature;details.replaceChildren(...(result?.stages||[]).map(s=>el('article',{class:'flow-detail'},[el('small',{text:stages.find(([key])=>key===s.stage)?.[1]||s.stage}),el('p',{text:s.summary||'暂无摘要'}),s.error?el('span',{text:'错误：'+s.error}):null])));}
 }
 async function read(){if(busy||!selected||!ctx.scope.active)return;busy=true;const id=selected,version=revision;try{const t=await ctx.dataSource.readPipelineTask(id);if(ctx.scope.active&&version===revision){if(t.gatewayId!==ctx.state.gatewayId||t.taskId!==id)throw Error('任务身份不匹配');paint(t);}}catch(e){if(ctx.scope.active&&version===revision)status.textContent='状态暂未确认：'+e.message;}finally{busy=false;}}
 selector.addEventListener('change',()=>{revision++;selected=selector.value;for(const[key]of stages)set(key,'waiting');guardExecution();count();details.replaceChildren();detailSignature='';status.textContent='正在核对所选任务';read();});
 const replayButton=button('播放历史演示动画',()=>{replay=0;paused=false;pauseButton.textContent='暂停回放';for(const[key]of stages)set(key,'waiting');guardExecution();count();status.textContent='演示回放：不重新调用模型，不代表当前设备运行。';},{disabled:!ctx.demoMode,variant:'flow-play'});
 const pauseButton=button('暂停回放',()=>{if(replay<0)return;paused=!paused;pauseButton.textContent=paused?'继续回放':'暂停回放';status.textContent=paused?'历史回放已暂停；不是当前设备运行。':'历史回放继续；动画速度不代表真实耗时。';},{disabled:!ctx.demoMode,variant:'secondary small'});
 root.append(el('header',{class:'flow-heading'},[el('div',{},[el('p',{class:'flow-eyebrow',text:'智能体工作流'}),el('h2',{text:'每一步，都有依据与去向'}),el('p',{text:'知识检索 / 风险决策 / 建议生成 / 独立审核 / 过程留存'})]),el('span',{class:'flow-mode',text:ctx.demoMode?'历史回放':'实时观测'})]),summary,
 el('section',{class:'flow-studio'},[el('div',{class:'flow-studio-bar'},[el('span',{class:'flow-section-label',text:'PROCESS ORCHESTRATION'}),el('div',{class:'flow-toolbar'},[selector,replayButton,pauseButton,button('查看三阶段提示词',()=>ctx.navigate('prompts'),{variant:'secondary small'})])]),status,progress,el('div',{class:'flow-board'},[line,el('div',{class:'flow-branch-caption'},[el('span',{text:'⊘'}),' 隔离的设备支路 · 未部署执行能力']),branch])]),
 banner('warn',ctx.demoMode?'这是合成测试历史的示意动画，不是当前模型或设备运行。执行与回传始终未执行。':'安全边界：模型输出只读建议，现阶段没有真实执行器；审核通过也不会下发控制。'),details);
 if(ctx.demoMode){selector.disabled=true;selector.append(el('option',{text:'DeepSeek · 合成测试历史'}));for(const s of PIPELINE_TEST_RECEIPT.stages)set(s.stage,s.state,s.durationMs);guardExecution();count();status.textContent='历史测试：三阶段调用通过。播放动画查看处理顺序；没有真实设备执行。';details.append(el('p',{class:'flow-footnote',text:'已有阶段耗时来自测试回执；检索及保存缺少起止证据，显示未知。演示动画节奏不代表真实耗时。'}));}
 else try{const data=await ctx.dataSource.listPipelineTasks();if(!ctx.scope.active)return root;for(const t of data.items||[])selector.append(el('option',{value:t.taskId,text:t.taskId}));selected=selector.value;guardExecution();if(selected)await read();else status.textContent='暂无任务，请在AI任务过程提交问题。';}catch(e){if(ctx.scope.active)status.textContent='任务列表读取失败：'+e.message;}
 const timer=setInterval(()=>{if(!ctx.scope.active)return;if(ctx.demoMode){if(replay<0||paused)return;for(let i=0;i<processing.length;i++){const key=processing[i];set(key,i<replay?'completed':i===replay?'running':'waiting',PIPELINE_TEST_RECEIPT.stages.find(s=>s.stage===key)?.durationMs);}guardExecution();count();if(++replay>processing.length){replay=-1;status.textContent='历史演示回放结束；执行器未接入，未执行、无控制回执。';}}else read();},1000);
 ctx.scope.onDispose(()=>{revision++;clearInterval(timer);});return root;
}
