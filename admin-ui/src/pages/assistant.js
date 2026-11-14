import {el,button,banner,sectionCard,chip} from '../lib/dom.js';
import {ASSISTANTS,assistantPrompt,assistantSession,checkedTask} from '../lib/assistant.js';
import {renderTaskTimeline} from '../lib/timeline.js';
import {fmtDateTime} from '../lib/format.js';

export default function renderAssistant(ctx,mode='agri-qa'){
  const scene=ASSISTANTS[mode],session=assistantSession(ctx.state,mode,ctx.demoMode);
  const writable=!ctx.demoMode&&ctx.state.user?.role==='admin'&&Boolean(ctx.state.gatewayId);
  const wrap=el('div',{class:'ai-workspace'}),result=el('div',{class:'ai-answer','aria-live':'polite'});
  const status=el('p',{class:'ai-compose-status',role:'status'}),count=el('span',{class:'muted'});
  let reading=false,lastSignature='';
  const question=el('textarea',{id:'assistant-question',rows:5,maxlength:700,placeholder:'描述你遇到的问题，或点击上方示例开始。',value:session.question});
  const crop=el('input',{id:'assistant-crop',maxlength:40,placeholder:'例如：番茄（可选）',value:session.crop});
  const growth=el('input',{id:'assistant-growth',maxlength:40,placeholder:'例如：结果期（可选）',value:session.growth});
  const sync=()=>{session.question=question.value;session.crop=crop.value;session.growth=growth.value;count.textContent=question.value.length+' / 700';};
  question.addEventListener('input',sync);crop.addEventListener('input',sync);growth.addEventListener('input',sync);
  const submit=button(scene.action,async()=>{
    if(!writable||session.busy||session.uncertain||session.task?.status==='running'||!ctx.scope.active)return;
    let prompt;try{sync();prompt=assistantPrompt(mode,session);}catch(e){status.textContent=e.message;question.focus?.();return;}
    session.busy=true;session.task=null;session.taskId='';lastSignature='';updateControls();
    status.textContent='正在提交。切换页面不会取消已提交的服务端任务。';
    result.replaceChildren(banner('info','正在提交问题，等待服务端确认…'));
    try{
      const receipt=await ctx.dataSource.startPipeline({prompt});
      if(!ctx.scope.active)return;
      if(typeof receipt?.taskId!=='string'||!receipt.taskId)throw Error('缺少任务编号');
      session.taskId=receipt.taskId;status.textContent='任务已接收，正在检索和分析。';await poll();
    }catch(e){session.uncertain=true;if(ctx.scope.active){status.textContent='提交未确认：'+e.message+'。请先到 AI 任务过程核对，避免重复调用。';result.replaceChildren(banner('warn','未确认是否已创建任务，请核对任务列表。'));}}
    finally{session.busy=false;if(ctx.scope.active)updateControls();}
  });
  const retry=button('我已核对任务列表，允许重新提交',()=>{session.uncertain=false;status.textContent='可以重新提交，请确认问题后操作。';updateControls();},{variant:'secondary small'});
  const refresh=button('刷新结果',()=>poll(),{variant:'secondary'});
  const clear=button('清空问题',()=>{question.value='';sync();question.focus?.();},{variant:'secondary'});
  question.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();submit.click();}});
  const examples=scene.examples.map(text=>button(text,()=>{question.value=text;sync();question.focus?.();},{variant:'secondary ai-example'}));
  const routes=el('div',{class:'ai-links'},[
    button('查看任务全过程',()=>ctx.navigate('tasks'),{variant:'secondary small'}),
    button('查看引用知识库',()=>ctx.navigate('knowledge'),{variant:'secondary small'}),
    button('模型配置',()=>ctx.navigate('model'),{variant:'secondary small'}),
  ]);
  wrap.append(el('section',{class:'card ai-intro'},[
    el('span',{class:'ai-scene-mark','aria-hidden':'true',text:scene.mark}),el('div',{},[el('h2',{text:scene.title}),el('p',{class:'muted',text:scene.subtitle})]),
    chip(ctx.demoMode?'warn':'unknown',ctx.demoMode?'界面演示':ctx.state.gatewayId?'设备 · '+ctx.state.gatewayId:'未选择设备'),
  ]),el('div',{class:'ai-step-guide','aria-label':'使用步骤'},['1 选择场景','2 描述问题','3 核对依据','4 人工复核'].map(text=>el('span',{text}))),
  ctx.demoMode?banner('warn','演示模式：可体验填写与场景切换，不调用模型、不读取真实设备。'):!writable?banner('warn',ctx.state.user?.role!=='admin'?'当前账号只读；调用模型需要管理员权限。':'请先在顶部选择设备，再提交问题。'):banner('info','使用当前设备与知识库运行只读管线；离线、数据缺失或规则拦截会如实展示。'),
  el('div',{class:'ai-workbench'},[
    sectionCard('描述问题', '只需选择一个示例，也可以自行填写。',
      el('div',{class:'ai-examples'},examples),
      el('div',{class:'ai-context-fields'},[
        el('label',{class:'field',for:'assistant-crop'},['作物',crop]),el('label',{class:'field',for:'assistant-growth'},['生育期',growth]),
      ]),el('label',{for:'assistant-question',text:'问题或现场观察'}),question,
      el('div',{class:'ai-compose-footer'},[el('span',{class:'muted',text:'Ctrl / ⌘ + Enter 提交'},[]),count]),
      el('div',{class:'btn-row'},[submit,clear,refresh]),status,retry),
    el('aside',{class:'ai-help card'},[
      el('h3',{text:'本次分析如何进行'}),el('ol',{},[
        el('li',{text:'检索当前设备知识库，保留原文与出处。'}),el('li',{text:'决策、生成与审核依次处理，缺失数据明确列出。'}),el('li',{text:'结果保存在任务记录，可查看耗时和失败位置。'}),
      ]),el('p',{class:'muted',text:'补充品种、生育期、异常持续时间和人工观察，有助于缩小问题范围。此处不上传照片；照片请在“图片资料”中单独管理。'}),
      el('p',{class:'muted',text:'切页保留本次内存草稿；退出登录或切换设备/模式后清除。每次提交独立分析，请将必要背景写入问题。'}),routes,
    ]),
  ]),result);
  function updateControls(){
    const running=session.task?.status==='running'||Boolean(session.taskId&&!session.task);
    submit.disabled=!writable||session.busy||session.uncertain||running;
    clear.disabled=session.busy;retry.hidden=!session.uncertain;refresh.disabled=ctx.demoMode||!session.taskId||reading;
  }
  function paint(task){
    const signature=JSON.stringify(task);if(lastSignature===signature)return;lastSignature=signature;
    const r=task.result,verdict=r?.audit?.verdict;
    const label=task.status==='running'?'正在分析':task.status==='failed'?'任务失败':verdict==='block'?'规则已拦截':verdict==='needs_human'?'需要人工复核':verdict==='allow'?'建议已生成':'任务已结束，待核对';
    const refs=task.retrieval?.items||r?.retrieval?.items||[];
    result.replaceChildren(sectionCard('分析结果', '任务 '+task.taskId+' · '+fmtDateTime(task.startedAt),
      chip(verdict==='block'||task.status==='failed'?'bad':verdict==='allow'?'ok':'warn',label),
      el('p',{text:r?.plan?.summary||r?.decision?.situation|| (task.status==='running'?'正在检索知识与处理任务，请稍候。':'暂未生成可用建议。请核对以下规则或失败原因。')}),
      el('p',{class:'muted',text:'审核通过表示建议通过本次规则检查，不表示设备已执行或人员可以入棚。'}),
      task.error?banner('bad','失败原因：'+task.error):null,
      ...[...new Set((r?.stages||[]).filter(s=>s.state==='blocked'||s.state==='failed').map(s=>s.summary||s.error||'该阶段未通过'))].map(text=>banner('warn',text)),
      ...(r?.plan?.steps||[]).map((s,i)=>el('div',{class:'ai-plan-item'},[el('strong',{text:'建议 '+(i+1)+' · '+({query_environment:'查询环境',ventilate:'通风建议',query_env:'查询环境',wait:'等待'}[s.action]||s.action)}),el('p',{text:s.reason})])),
      ...(r?.decision?.openQuestions?.length?[sectionCard('还需要补充',null,el('ul',{},r.decision.openQuestions.map(text=>el('li',{text}))))]:[]),
      el('h4',{text:'知识依据'}),
      ...(Array.isArray(refs)&&refs.length?refs.map(ref=>el('details',{class:'ai-reference'},[
        el('summary',{text:(ref.title||'未命名资料')+' · '+(ref.source||'未填写出处')}),el('p',{class:'muted',text:'引用块 '+(ref.chunkId||'未知')+' · 内容哈希 '+(ref.contentSha256||'未返回')}),el('pre',{class:'pre-wrap',text:ref.content||'未返回原文'}),
      ])):[el('p',{class:'muted',text:'当前未返回知识命中，不能把模型意见当作已引用资料。'})]),
      el('h4',{text:'处理时间轴'}),renderTaskTimeline(task),
      verdict==='needs_human'?button('前往人工审核',()=>ctx.navigate('review'),{variant:'secondary'}):null,
      button('继续补充问题',()=>{question.focus?.();},{variant:'secondary'}),
    ));
  }
  async function poll(){
    if(reading||!session.taskId||ctx.demoMode||!ctx.scope.active)return;
    reading=true;updateControls();const id=session.taskId;
    try{const task=checkedTask(await ctx.dataSource.readPipelineTask(id),id,ctx.state.gatewayId);if(!ctx.scope.active||session.taskId!==id)return;session.task=task;paint(task);status.textContent=task.status==='running'?'任务处理中，可切页后返回查看。':'任务已结束；请阅读结果与引用依据后再作判断。';}
    catch(e){if(ctx.scope.active)status.textContent='结果暂时无法读取：'+e.message+'。可刷新结果或到任务列表核对，请勿重复提交。';}
    finally{reading=false;if(ctx.scope.active)updateControls();}
  }
  sync();updateControls();
  if(session.task)paint(session.task);
  else result.append(sectionCard('等待你的问题',null,el('p',{class:'muted',text:'提交后，这里会显示结果、知识依据、审核结论与处理时间轴。'})));
  if(ctx.demoMode)status.textContent='示例仅填入问题，没有提交真实任务。';
  if(session.taskId&&!ctx.demoMode)void poll();
  const timer=setInterval(()=>{updateControls();if(session.uncertain)status.textContent='提交状态未确认，请先到 AI 任务过程核对，避免重复调用。';if(session.taskId&&(!session.task||session.task.status==='running'))void poll();},1500);
  ctx.scope.onDispose(()=>{sync();clearInterval(timer);});
  return wrap;
}
