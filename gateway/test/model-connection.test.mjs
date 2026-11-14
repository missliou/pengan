import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentPlanner} from '../agent.mjs';
import {startDemo} from '../runtime.mjs';
const verified=(args={},name='verify_connection')=>new Response(JSON.stringify({choices:[{message:{content:'private ignored text',tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]}));
test('手动模型测试：仅合成问题，验证工具后才通过；不泄正文或修改建议记忆',async()=>{
 let request,calls=0;const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'private-key',fetchFn:async(url,options)=>{calls++;request=options;return verified();}});
 planner.recentAnalyses=[{request:'private-field-question',summary:'private-field-summary'}];planner.recentProposals=[{summary:'private-proposal'}];
 assert.deepEqual(planner.status().connectionCheck,{state:'never',checkedAt:null});
 const result=await planner.testConnection();assert.equal(result.ok,true);assert.equal(result.fieldDataSent,false);assert.equal(result.imageSent,false);assert.equal(result.executed,false);assert.equal(result.kind,'model_connection_check');assert.equal(typeof result.roundTripMs,'number');assert.equal(planner.status().connectionCheck.state,'passed');
 assert.equal(request.redirect,'error');const body=JSON.parse(request.body);assert.equal(body.max_tokens,128);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.tool_choice.function.name,'verify_connection');assert.equal(request.body.includes('private-'),false);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(planner.recentAnalyses.length,1);assert.equal(planner.recentProposals.length,1);assert.equal(calls,1);
 const cases=[async()=>verified({extra:'private'}),async()=>verified([], 'verify_connection'),async()=>verified({},'wrong_tool'),async()=>new Response('bad json private'),async()=>new Response('x'.repeat(100001)),async()=>new Response('private provider error',{status:401}),async()=>{throw Error('private-key or filesystem path');}];
 for(const fetchFn of cases){planner.fetchFn=fetchFn;await assert.rejects(planner.testConnection(),error=>error.message.startsWith('ai_')&&!error.message.includes('private'));assert.equal(planner.status().connectionCheck.state,'failed');assert.equal(JSON.stringify(planner.status().connectionCheck).includes('private'),false);}
 planner.fetchFn=async()=>{const error=new Error('private timeout details');error.name='TimeoutError';throw error;};await assert.rejects(planner.testConnection(),error=>error.message==='ai_analysis_timeout');assert.equal(planner.status().connectionCheck.error,'ai_analysis_timeout');
 let fetched=false;const noConfig=new AgentPlanner({provider:'none',model:'',key:'',fetchFn:async()=>{fetched=true;}});await assert.rejects(noConfig.testConnection(),/ai_not_configured/);assert.equal(fetched,false);
});
test('连接测试HTTP：手动触发，AI/图片/配置互斥，不持久化；配置变化清空上次测试状态',{timeout:15000},async()=>{
 let release,requests=0,appends=0;
 const analysisStore={status:()=>({healthy:true}),read:()=>({simulated:false,historical:true,isCurrent:false,storage:{healthy:true},items:[]}),append:async()=>{appends++;return 1;},flush:async()=>{}};
 const r=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,analysisStore,configStore:{save:async()=>{}},plannerOptions:{provider:'qwen',model:'test',key:'test-key',fetchFn:async()=>{requests++;await new Promise(resolve=>{release=resolve;});return verified();}}});
 const base=`http://127.0.0.1:${r.httpPort}`,post=(route,data,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
  const initial=await fetch(base+'/api/agent/status').then(r=>r.json());assert.equal(initial.connectionCheck.state,'never');assert.equal(requests,0);
  assert.equal((await post('/api/agent/test',{prompt:'actual field'})).status,400);assert.equal((await post('/api/agent/test',{}, {Origin:'https://bad.example'})).status,403);assert.equal(requests,0);
  const {csrfToken}=await fetch(base+'/api/agent/config').then(r=>r.json()),pending=post('/api/agent/test',{});
  for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(typeof release,'function');
  for(const route of ['/api/agent/test','/api/agent/analyze','/api/agent/inspect-image'])assert.equal((await post(route,{})).status,429);
  assert.equal((await post('/api/agent/config',{provider:'qwen',model:'new-model',key:'test-key'},{'X-Pengan-Config-Token':csrfToken})).status,429);
  release();const response=await pending;assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(appends,0);assert.equal(requests,1);assert.equal((await fetch(base+'/api/agent/status').then(r=>r.json())).connectionCheck.state,'passed');
  assert.equal((await post('/api/agent/config',{provider:'qwen',model:'new-model',key:'test-key'},{'X-Pengan-Config-Token':csrfToken})).status,200);assert.deepEqual((await fetch(base+'/api/agent/status').then(r=>r.json())).connectionCheck,{state:'never',checkedAt:null});
 }finally{release?.();await r.close();}
});
