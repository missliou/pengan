import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentPipeline,PIPELINE_STAGES} from '../agent-pipeline.mjs';
import {PIPELINE_LIMITS,normalizeEnvironment,environmentRules} from '../agent-audit.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startDemo} from '../runtime.mjs';

const STAGE_ORDER=['decision','generate','verify'];
const PROVIDER='deepseek',MODEL='deepseek-chat',KEY='test-key';

function sandbox(overrides={}){
  return {deviceId:'sim-001',source:'simulation',simulated:true,emergency:false,sensorOnline:true,sampledAt:Date.now(),co:4,co2:680,...overrides};
}
function decision(overrides={}){
  return {intent:'降低棚内 CO2',situation:'CO2 680ppm，环境正常',confidence:0.9,riskLevel:'low',candidates:[{action:'ventilate',reason:'CO2 略高于日常',riskLevel:'low',maxRunMs:5000}],openQuestions:[],...overrides};
}
function plan(overrides={}){
  return {summary:'先确认环境，再短时通风',steps:[{action:'query_environment',reason:'确认当前读数'},{action:'ventilate',reason:'短时通风',maxRunMs:5000}],evidence:[{ref:'env.co2',note:'当前 CO2'},{ref:'env.co'}] ,...overrides};
}
function auditOutput(overrides={}){
  return {verdict:'allow',reasons:['计划与快照一致'],missingEvidence:[],...overrides};
}
function toolReply(name,args){
  return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'call-1',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}),{status:200,headers:{'content-type':'application/json'}});
}
function build({decision:decisionInput=decision(),plan:planInput=plan(),audit:auditInput=auditOutput(),environment=null,memory=[],stageTimeoutMs=2000,budgetMs=40000,fetchFn=null,key=KEY,model=MODEL,provider=PROVIDER,onTool=null}={}){
  const toolNames=[];
  const stub=fetchFn||(async(url,init)=>{
    const body=JSON.parse(init.body);
    const name=body.tool_choice.function.name;
    toolNames.push(name);
    if(onTool)onTool(name,body);
    const pick=name==='report_decision'?decisionInput:name==='propose_pipeline_plan'?planInput:name==='audit_plan'?auditInput:null;
    if(pick===null)throw new Error('unexpected tool '+name);
    if(typeof pick==='function')return pick();
    return toolReply(name,pick);
  });
  const pipeline=new AgentPipeline({provider,model,key,workspaceId:'',fetchFn:stub,readEnvironment:async()=>environment??sandbox(),readMemory:async()=>memory,stageTimeoutMs,budgetMs});
  return {pipeline,toolNames};
}

test('允许路径：低风险高置信度直接放行且不需要人工确认',async()=>{
  const {pipeline,toolNames}=build({memory:[12,11]});
  const result=await pipeline.pipeline({prompt:'棚里 CO2 有点高，怎么办？',mode:'simulation'});
  assert.equal(result.kind,'agent_pipeline');
  assert.equal(result.pipelineVersion,1);
  assert.equal(result.audit.verdict,'allow');
  assert.equal(result.audit.authoritative,'rules');
  assert.equal(result.calls,3);
  assert.deepEqual(toolNames,['report_decision','propose_pipeline_plan','audit_plan']);
  assert.equal(result.decision.riskLevel,'low');
  assert.equal(result.plan.steps.length,2);
  for(const step of result.plan.steps)assert.equal(step.requiresConfirmation,false);
  for(const candidate of result.decision.candidates)assert.equal(candidate.requiresConfirmation,false);
  assert.equal(result.executed,false);
  assert.equal(result.hardwareControl,false);
  assert.deepEqual(result.memory,{used:2,sources:['analysis-history:12','analysis-history:11']});
});

test('stages 恰好三条且顺序固定为 decision/generate/verify',async()=>{
  const {pipeline}=build();
  const result=await pipeline.pipeline({prompt:'检查大棚环境',mode:'simulation'});
  assert.equal(result.stages.length,3);
  assert.deepEqual(result.stages.map(stage=>stage.stage),STAGE_ORDER);
  assert.deepEqual([...PIPELINE_STAGES],STAGE_ORDER);
  for(const stage of result.stages){
    assert.ok(['passed','blocked','failed'].includes(stage.state));
    assert.ok(Number.isInteger(stage.startedAt)&&Number.isInteger(stage.finishedAt));
    assert.ok(stage.durationMs>=0);
    assert.ok(stage.summary.length<=300);
  }
  assert.ok(result.stages.every(stage=>stage.error===null));
});

test('evidence 只引用真实快照字段：值、观测时间与新鲜度由服务端填充',async()=>{
  const environment=sandbox({co2:742});
  const {pipeline}=build({environment});
  const result=await pipeline.pipeline({prompt:'引用证据',mode:'simulation'});
  assert.equal(result.plan.evidence.length,2);
  const co2=result.plan.evidence.find(item=>item.ref==='env.co2');
  assert.equal(co2.value,742);
  assert.equal(co2.observedAt,environment.sampledAt);
  assert.equal(co2.fresh,true);
});

test('编造的 evidence ref 被拦下：不出现在 plan.evidence，计入 missingEvidence',async()=>{
  const {pipeline}=build({plan:plan({evidence:[{ref:'env.co2'},{ref:'env.radonPpm'},{ref:'device.secret'}]})});
  const result=await pipeline.pipeline({prompt:'引用不存在的字段',mode:'simulation'});
  assert.deepEqual(result.plan.evidence.map(item=>item.ref),['env.co2']);
  assert.ok(result.audit.missingEvidence.includes('env.radonPpm'));
  assert.ok(result.audit.missingEvidence.includes('device.secret'));
  assert.notEqual(result.audit.verdict,'allow');
});

test('模型 allow 但动作越界：硬规则仍然 block，模型不得放宽',async()=>{
  const {pipeline}=build({plan:plan({steps:[{action:'open_door',reason:'直接开门'}]}),audit:auditOutput({verdict:'allow'})});
  const result=await pipeline.pipeline({prompt:'帮我开门',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  assert.equal(result.audit.authoritative,'rules');
  assert.equal(result.audit.modelVerdict,'allow');
  assert.ok(result.audit.ruleHits.some(hit=>hit.ruleId==='R-ACTION'&&hit.passed===false));
  assert.ok(result.audit.reasons.some(reason=>reason.includes('不得放宽')));
});

test('ventilate 的 maxRunMs 越界：R-PLAN 命中并 block',async()=>{
  const {pipeline}=build({plan:plan({steps:[{action:'ventilate',reason:'长时间通风',maxRunMs:30000}]})});
  const result=await pipeline.pipeline({prompt:'多开一会儿风扇',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  const rule=result.audit.ruleHits.find(hit=>hit.ruleId==='R-PLAN');
  assert.equal(rule.passed,false);
  assert.ok(rule.detail.includes('maxRunMs'));
});

test('超过四步的计划：R-PLAN 命中并 block',async()=>{
  const steps=[1,2,3,4,5].map(index=>({action:'query_environment',reason:'第 '+index+' 步'}));
  const {pipeline}=build({plan:plan({steps})});
  const result=await pipeline.pipeline({prompt:'多步计划',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  assert.equal(result.audit.ruleHits.find(hit=>hit.ruleId==='R-PLAN').passed,false);
});

test('急停命中：block、不调用模型、calls 为 0、三阶段 blocked',async()=>{
  const {pipeline,toolNames}=build({environment:sandbox({emergency:true})});
  const result=await pipeline.pipeline({prompt:'急停时还能通风吗',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  assert.equal(result.audit.authoritative,'rules');
  assert.equal(result.calls,0);
  assert.equal(toolNames.length,0);
  assert.deepEqual(result.stages.map(stage=>stage.state),['blocked','blocked','blocked']);
  assert.equal(result.decision,null);
  assert.equal(result.plan,null);
});

test('CO 达到演示阈值：block',async()=>{
  const {pipeline}=build({environment:sandbox({co:PIPELINE_LIMITS.co})});
  const result=await pipeline.pipeline({prompt:'CO 30 了',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  assert.equal(result.audit.ruleHits.find(hit=>hit.ruleId==='R-CO').passed,false);
});

test('CO2 达到演示阈值：block',async()=>{
  const {pipeline}=build({environment:sandbox({co2:1600})});
  const result=await pipeline.pipeline({prompt:'CO2 很高',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  assert.equal(result.audit.ruleHits.find(hit=>hit.ruleId==='R-CO2').passed,false);
});

test('传感离线与采样过期：block',async()=>{
  const offline=build({environment:sandbox({sensorOnline:false})});
  const offlineResult=await offline.pipeline.pipeline({prompt:'离线',mode:'simulation'});
  assert.equal(offlineResult.audit.verdict,'block');
  assert.equal(offlineResult.audit.ruleHits.find(hit=>hit.ruleId==='R-SENSOR-OFFLINE').passed,false);

  const stale=build({environment:sandbox({sampledAt:Date.now()-20000})});
  const staleResult=await stale.pipeline.pipeline({prompt:'过期',mode:'simulation'});
  assert.equal(staleResult.audit.verdict,'block');
  assert.equal(staleResult.audit.ruleHits.find(hit=>hit.ruleId==='R-SAMPLE-STALE').passed,false);
});

test('CO 读数缺失：按非法处理并 block（fail closed）',async()=>{
  const {pipeline}=build({environment:sandbox({co:null,co2:null})});
  const result=await pipeline.pipeline({prompt:'读数缺失',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  assert.equal(result.audit.ruleHits.find(hit=>hit.ruleId==='R-CO-INVALID').passed,false);
  assert.equal(result.audit.ruleHits.find(hit=>hit.ruleId==='R-CO2-INVALID').passed,false);
});

test('confidence 低于 0.7：needs_human',async()=>{
  const {pipeline}=build({decision:decision({confidence:0.42})});
  const result=await pipeline.pipeline({prompt:'不太确定',mode:'simulation'});
  assert.equal(result.audit.verdict,'needs_human');
  assert.ok(result.audit.reasons.some(reason=>reason.includes('0.7')));
  assert.equal(result.plan.steps.find(step=>step.action==='ventilate').requiresConfirmation,true);
  assert.equal(result.plan.steps.find(step=>step.action==='query_environment').requiresConfirmation,false);
});

test('riskLevel 为 high：needs_human',async()=>{
  const {pipeline}=build({decision:decision({riskLevel:'high'})});
  const result=await pipeline.pipeline({prompt:'高风险操作',mode:'simulation'});
  assert.equal(result.audit.verdict,'needs_human');
  assert.ok(result.audit.reasons.some(reason=>reason.includes('high')));
});

test('模型审核要求 block 且规则放行：服务端加严为 block，authoritative 为 model',async()=>{
  const {pipeline}=build({audit:auditOutput({verdict:'block',reasons:['证据不足']})});
  const result=await pipeline.pipeline({prompt:'审核加严',mode:'simulation'});
  assert.equal(result.audit.verdict,'block');
  assert.equal(result.audit.authoritative,'model');
  assert.equal(result.audit.modelVerdict,'block');
});

test('模型审核要求 needs_human：allow 被加严为 needs_human',async()=>{
  const {pipeline}=build({audit:auditOutput({verdict:'needs_human'})});
  const result=await pipeline.pipeline({prompt:'审核复核',mode:'simulation'});
  assert.equal(result.audit.verdict,'needs_human');
  assert.equal(result.audit.authoritative,'model');
});

test('决策阶段超时：stage failed 记为 timeout，verdict 不是 allow，calls 为 1',async()=>{
  const {pipeline}=build({stageTimeoutMs:20,decision:()=>new Promise(()=>{})});
  const result=await pipeline.pipeline({prompt:'超时',mode:'simulation'});
  assert.equal(result.stages[0].state,'failed');
  assert.equal(result.stages[0].error,'timeout');
  assert.deepEqual(result.stages.map(stage=>stage.state),['failed','blocked','blocked']);
  assert.notEqual(result.audit.verdict,'allow');
  assert.equal(result.calls,1);
});

test('模型抛错：对应 stage failed 记为 model_unavailable，verdict 不是 allow',async()=>{
  const {pipeline}=build({decision:()=>{throw new TypeError('fetch failed');}});
  const result=await pipeline.pipeline({prompt:'网络失败',mode:'simulation'});
  assert.equal(result.stages[0].state,'failed');
  assert.equal(result.stages[0].error,'model_unavailable');
  assert.notEqual(result.audit.verdict,'allow');
});

test('模型返回非 JSON 工具参数：stage failed 记为 invalid_output',async()=>{
  const {pipeline}=build({fetchFn:async()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'call-1',type:'function',function:{name:'report_decision',arguments:'{oops'}}]}}]}),{status:200})});
  const result=await pipeline.pipeline({prompt:'坏参数',mode:'simulation'});
  assert.equal(result.stages[0].state,'failed');
  assert.equal(result.stages[0].error,'invalid_output');
  assert.notEqual(result.audit.verdict,'allow');
});

test('供应商 HTTP 失败：stage failed 记为 model_unavailable',async()=>{
  const {pipeline}=build({fetchFn:async()=>new Response('upstream boom',{status:503})});
  const result=await pipeline.pipeline({prompt:'上游失败',mode:'simulation'});
  assert.equal(result.stages[0].error,'model_unavailable');
  assert.notEqual(result.audit.verdict,'allow');
});

test('verify 阶段失败：verdict 不得为 allow',async()=>{
  const {pipeline}=build({audit:()=>{throw new Error('boom');}});
  const result=await pipeline.pipeline({prompt:'审核失败',mode:'simulation'});
  assert.equal(result.stages[2].state,'failed');
  assert.equal(result.stages[2].error,'model_unavailable');
  assert.equal(result.audit.verdict,'needs_human');
  assert.equal(result.calls,3);
});

test('模型未配置：三阶段 failed 且 needs_human，不发起调用',async()=>{
  const {pipeline,toolNames}=build({key:''});
  const result=await pipeline.pipeline({prompt:'未配置',mode:'simulation'});
  assert.deepEqual(result.stages.map(stage=>stage.state),['failed','failed','failed']);
  assert.ok(result.stages.every(stage=>stage.error==='model_unavailable'));
  assert.equal(result.calls,0);
  assert.equal(toolNames.length,0);
  assert.equal(result.audit.verdict,'needs_human');
});

test('任何路径下 executed 与 hardwareControl 恒为 false，calls 不超过 3',async()=>{
  const cases=[
    build(),
    build({environment:sandbox({emergency:true})}),
    build({decision:decision({confidence:0.1})}),
    build({key:''}),
    build({plan:plan({steps:[{action:'open_door',reason:'越权'}]})})
  ];
  for(const item of cases){
    const result=await item.pipeline.pipeline({prompt:'只读校验',mode:'simulation'});
    assert.equal(result.executed,false);
    assert.equal(result.hardwareControl,false);
    assert.equal(result.decision?result.decision.riskLevel!==undefined:true,true);
    assert.ok(Number.isInteger(result.calls)&&result.calls>=0&&result.calls<=3);
    assert.equal(result.stages.length,3);
  }
});

test('阈值与 SafetyEngine.ets 一致：归一化与规则判定可直接核对',()=>{
  const now=Date.now();
  const fresh=normalizeEnvironment({emergency:false,sensorOnline:true,sampledAt:now,co:4,co2:680},now);
  assert.equal(environmentRules(fresh,now).every(hit=>hit.passed),true);
  const edge=normalizeEnvironment({emergency:false,sensorOnline:true,sampledAt:now,co:30,co2:1500},now);
  const hits=environmentRules(edge,now).filter(hit=>hit.passed===false).map(hit=>hit.ruleId);
  assert.deepEqual(hits,['R-CO','R-CO2']);
  const staleAt=normalizeEnvironment({emergency:false,sensorOnline:true,sampledAt:now-15001,co:4,co2:680},now);
  assert.equal(environmentRules(staleAt,now).find(hit=>hit.ruleId==='R-SAMPLE-STALE').passed,false);
  const skew=normalizeEnvironment({emergency:false,sensorOnline:true,sampledAt:now+2000,co:4,co2:680},now);
  assert.equal(environmentRules(skew,now).find(hit=>hit.ruleId==='R-SAMPLE-STALE').passed,false);
});
test('契约字段集：响应各层字段名与契约完全一致（不多不少）',async()=>{
  const {pipeline}=build({memory:[12]});
  const result=await pipeline.pipeline({prompt:'棚里 CO2 有点高，怎么办？',mode:'simulation'});
  const expect={root:['kind','pipelineVersion','traceId','requestedAt','prompt','mode','provider','model','calls','executed','hardwareControl','stages','decision','plan','audit','memory','retrieval'],stage:['stage','state','startedAt','finishedAt','durationMs','summary','error'],decision:['intent','situation','confidence','riskLevel','candidates','openQuestions'],candidate:['action','reason','riskLevel','requiresConfirmation','maxRunMs'],plan:['summary','steps','evidence'],step:['action','reason','requiresConfirmation','maxRunMs','processed'],evidence:['ref','value','observedAt','fresh'],audit:['verdict','reasons','ruleHits','missingEvidence','modelVerdict','authoritative'],ruleHit:['ruleId','passed','detail'],memory:['used','sources']};
  const keys=value=>Object.keys(value).sort();
  const same=(label,value,names)=>{assert.deepEqual(keys(value),[...names].sort(),'字段集不一致：'+label);};
  same('AgentPipelineResult',result,expect.root);
  for(const stage of result.stages)same('Stage',stage,expect.stage);
  same('Decision',result.decision,expect.decision);
  for(const candidate of result.decision.candidates)same('Candidate',candidate,expect.candidate);
  same('Plan',result.plan,expect.plan);
  for(const step of result.plan.steps)same('PlanStep',step,expect.step);
  for(const item of result.plan.evidence)same('Evidence',item,expect.evidence);
  same('Audit',result.audit,expect.audit);
  for(const hit of result.audit.ruleHits)same('RuleHit',hit,expect.ruleHit);
  same('Memory',result.memory,expect.memory);
  assert.equal(typeof result.requestedAt,'number');
  assert.equal(result.traceId.length>0,true);
  assert.equal(result.audit.modelVerdict,'allow');
  assert.equal(result.executed,false);
  assert.equal(result.hardwareControl,false);
  assert.equal(Number.isInteger(result.calls)&&result.calls>=0&&result.calls<=3,true);
});

const until=async(fn)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('state_timeout');};

test('实物模式：/api/agent/pipeline 可用（200）且只读拒止，/api/agent/plan 仍 403',{timeout:20000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-pipeline-'));
  const hardwareFile=path.join(dir,'missing.json');
  const runtime=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,hardwareFile});
  const base='http://127.0.0.1:'+runtime.httpPort;
  const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const response=await post('/api/agent/pipeline',{prompt:'实物模式下这条管线还能用吗'});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.kind,'agent_pipeline');
    assert.equal(body.pipelineVersion,1);
    assert.equal(body.mode,'hardware');
    assert.equal(body.audit.verdict,'block');
    assert.equal(body.calls,0);
    assert.equal(body.executed,false);
    assert.equal(body.hardwareControl,false);
    assert.deepEqual(body.stages.map(stage=>stage.stage),STAGE_ORDER);
    assert.deepEqual(body.stages.map(stage=>stage.state),['blocked','blocked','blocked']);
    assert.equal(body.audit.ruleHits.find(hit=>hit.ruleId==='R-CO-INVALID').passed,false);
    assert.equal((await post('/api/agent/plan',{prompt:'实物计划'})).status,403);
    assert.equal((await post('/api/agent/pipeline',{prompt:'   '})).status,400);
    assert.equal((await post('/api/agent/pipeline',{prompt:'x'.repeat(2001)})).status,400);
    assert.equal((await post('/api/agent/pipeline',{})).status,400);
  }finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
});

test('模拟模式：管线端点端到端返回 allow 且不需要人工确认',{timeout:20000},async()=>{
  const scripted=async(url,init)=>{
    const name=JSON.parse(init.body).tool_choice.function.name;
    const args=name==='report_decision'?decision():name==='propose_pipeline_plan'?plan():auditOutput();
    return toolReply(name,args);
  };
  const runtime=await startDemo({mqttPort:0,httpPort:0,tickMs:100,plannerOptions:{provider:'deepseek',model:'test-pipeline',key:'test-key',fetchFn:scripted}});
  const base='http://127.0.0.1:'+runtime.httpPort;
  try{
    await until(()=>runtime.snapshot().deviceOnline);
    const response=await fetch(base+'/api/agent/pipeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'棚内 CO2 偏高，建议怎么做'})});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.mode,'simulation');
    assert.equal(body.provider,'deepseek');
    assert.equal(body.model,'test-pipeline');
    assert.equal(body.traceId.length>0,true);
    assert.equal(body.audit.verdict,'allow');
    assert.equal(body.calls,3);
    assert.equal(body.decision.riskLevel,'low');
    assert.equal(body.plan.steps.every(step=>step.requiresConfirmation===false),true);
    assert.equal(body.executed,false);
    assert.equal(body.hardwareControl,false);
    assert.equal(body.plan.evidence.every(item=>typeof item.ref==='string'&&item.ref.startsWith('env.')),true);
  }finally{await runtime.close();}
});


test('displayed prompt catalog matches all three actual model requests and is immutable to consumers',async()=>{
 const {pipelinePromptCatalog}=await import('../agent-pipeline.mjs');const catalog=pipelinePromptCatalog();let calls=0;
 const {pipeline}=build({onTool:(_name,body)=>{const expected=catalog.stages[calls++];assert.equal(body.messages[0].role,'system');assert.equal(body.messages[0].content,expected.systemPrompt);assert.deepEqual(body.tools[0],expected.tool);assert.deepEqual(Object.keys(JSON.parse(body.messages[1].content)),expected.inputFields);}});
 await pipeline.pipeline({prompt:'synthetic prompt visibility test',mode:'simulation'});assert.equal(calls,3);
 catalog.stages[0].systemPrompt='modified';assert.notEqual(pipelinePromptCatalog().stages[0].systemPrompt,'modified');
});
