import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentPlanner,validatePlan} from '../agent.mjs';
test('模型计划允许清单阻止强制开锁和非法运行时长',()=>{
 for(const action of ['force_unlock','set_threshold','shell'])assert.throws(()=>validatePlan({summary:'',steps:[{action,reason:'绕过'}]}));
 assert.throws(()=>validatePlan({summary:'',steps:[{action:'ventilate',reason:'test',maxRunMs:999999}]}));
 const plan=validatePlan({summary:'检查',steps:[{action:'request_access',reason:'检查'}]});assert.equal(plan.steps[0].requiresConfirmation,true);
});
test('未配置模型时不发请求，不伪造 AI 响应',async()=>{
 let called=false;const p=new AgentPlanner({provider:'none',model:'',key:'',fetchFn:async()=>{called=true;}});
 await assert.rejects(p.plan('test',{}),/ai_not_configured/);assert.equal(called,false);
});
test('真实接口适配的桩验证：结构化计划返回后仍未执行',async()=>{
 let request;
 const p=new AgentPlanner({provider:'deepseek',model:'test-model',key:'test-key',fetchFn:async(url,options)=>{request={url,options};return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'propose_plan',arguments:JSON.stringify({summary:'通风复测',steps:[{action:'ventilate',reason:'模拟超标',maxRunMs:20000}]})}}]}}]}));}});
 const plan=await p.plan('帮我通风',{co:65,simulated:true});assert.equal(plan.executed,false);assert.equal(plan.steps[0].requiresConfirmation,true);
 assert.equal(request.url,'https://api.deepseek.com/chat/completions');assert.equal(JSON.parse(request.options.body).tools[0].function.name,'propose_plan');
});
test('拒绝模型输出错误工具或暴露服务商错误正文',async()=>{
 const p=new AgentPlanner({provider:'deepseek',model:'test',key:'test',fetchFn:async()=>new Response('sensitive error',{status:401})});
 await assert.rejects(p.plan('test',{}),error=>error.message==='ai_provider_http_401');
 const q=new AgentPlanner({provider:'qwen',model:'test',key:'test',fetchFn:async()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'force_unlock',arguments:'{}'}}]}}]}))});
 await assert.rejects(q.plan('test',{}),/ai_missing_plan_tool/);
});
test('模型短期记忆仅保留8次建议，明确标注未执行',async()=>{
 const bodies=[];
 const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test',fetchFn:async(url,options)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'propose_plan',arguments:JSON.stringify({summary:'环境查询',steps:[{action:'query_environment',reason:'查询'}]})}}]}}]}));}});
 for(let i=0;i<10;i++)await planner.plan('查询'+i,{});
 const memory=JSON.parse(bodies.at(-1).messages[1].content).recentProposals;
 assert.equal(memory.length,8);assert.equal(memory[0].request,'查询1');assert.ok(memory.every(item=>item.executed===false));
});


test('模型即使声称真实安全，服务端仍标注未知拒止且无实物执行权',async()=>{
 const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'propose_plan',arguments:JSON.stringify({summary:'安全，可以入棚',steps:[]})}}]}}]}))});
 const plan=await planner.plan('我能进入大棚吗',{readOnlyHardware:{quality:{coValid:false,co2Valid:false}}});
 assert.ok(plan.summary.startsWith('真实准入状态未知'));assert.equal(plan.realAdmission,'unknown_denied');assert.equal(plan.hardwareControl,false);assert.equal(plan.executed,false);
});

test('异常模型响应有界读取，超限取消流且不写入历史建议',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(20001));},cancel(){cancelled=true;}});
 const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async()=>new Response(stream)});
 await assert.rejects(planner.plan('查询',{}),/ai_response_too_large/);
 assert.equal(cancelled,true);assert.equal(planner.recentProposals.length,0);
 for(const text of ['null','{}','invalid json']){
  const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async()=>new Response(text)});
  await assert.rejects(planner.plan('查询',{}),/ai_(missing_plan_tool|invalid_json)/);
  assert.equal(planner.recentProposals.length,0);
 }
});
