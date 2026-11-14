import test from 'node:test';
import assert from 'node:assert/strict';
import {startDemo} from '../runtime.mjs';
const response=()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'propose_plan',arguments:JSON.stringify({summary:'查看环境，随后申请模拟通风',steps:[{action:'ventilate',reason:'演示通风',maxRunMs:1000}]})}}]}}]}));
test('网页AI HTTP：服务端调用、忙碌限制、返回计划不自动执行且不泄露密钥',{timeout:15000},async()=>{
 let release,started;const called=new Promise(r=>{started=r});
 const r=await startDemo({mqttPort:0,httpPort:0,plannerOptions:{provider:'deepseek',model:'test-model',key:'test-secret',fetchFn:async(url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer test-secret');const context=JSON.parse(JSON.parse(opts.body).messages[1].content).environment;assert.equal(context.readOnlyHardware.simulated,false);assert.equal(context.readOnlyHardware.quality.coValid,false);assert.equal(context.readOnlyHardware.quality.co2Valid,false);assert.equal(context.readOnlyHardware.actuationAvailable,false);started();await new Promise(r=>{release=r});return response();}}});
 const base=`http://127.0.0.1:${r.httpPort}`,post=()=>fetch(base+'/api/agent/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'帮我看看环境'})});
 try{
 const pending=post();await called;assert.equal((await post()).status,429);release();const result=await pending;assert.equal(result.status,200);const plan=await result.json();
 assert.equal(plan.executed,false);assert.equal(plan.steps[0].requiresConfirmation,true);assert.equal(r.snapshot().events.some(e=>e.event==='command_requested'),false);
 const status=await fetch(base+'/api/agent/status').then(r=>r.text());assert.ok(!status.includes('test-secret'));assert.equal(JSON.parse(status).configured,true);
 assert.equal((await fetch(base+'/.env')).status,404);
 }finally{release?.();await r.close();}
});
test('网页AI未配置时明确失败，GET不触发模型调用',{timeout:15000},async()=>{
 const r=await startDemo({mqttPort:0,httpPort:0,plannerOptions:{provider:'none',model:'',key:''}});
 try{const base=`http://127.0.0.1:${r.httpPort}`;assert.equal((await fetch(base+'/api/agent/status').then(r=>r.json())).configured,false);
 const res=await fetch(base+'/api/agent/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'查询环境'})});assert.equal(res.status,422);assert.equal((await res.json()).error,'ai_not_configured');
 }finally{await r.close();}
});
