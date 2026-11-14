import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {startDemo} from '../runtime.mjs';
import {AgentPlanner} from '../agent.mjs';
import {hspSnapshot} from '../hsp-telemetry.mjs';
const frame=()=>({schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:20000,th_ok:true,temperature10:253,humidity10:621,gas_ok:true,gas_raw:550,gas_mv:967,th_sample_age_ms:100,gas_sample_age_ms:200,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false});
const response=result=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'analyze_observations',arguments:JSON.stringify(result)}}]}}]}));

test('真实模式不依赖模拟MQTT端口，已有服务占用时仍能启动',{timeout:15000},async()=>{
 const occupied=net.createServer();await new Promise((resolve,reject)=>{occupied.once('error',reject);occupied.listen(0,'127.0.0.1',resolve);});let runtime;
 try{
  runtime=await startDemo({operationMode:'hardware',mqttPort:occupied.address().port,httpPort:0});assert.equal(runtime.mqttPort,null);
  const health=await fetch(`http://127.0.0.1:${runtime.httpPort}/api/health`).then(response=>response.json());assert.equal(health.mode,'hardware');assert.equal(health.transport,'serial-http');
 }finally{await runtime?.close();await new Promise(resolve=>occupied.close(resolve));}
});
test('真实模式：无模拟遥测或指令，真实观测/离线状态进入独立AI分析',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-real-ai-')),hardwareFile=path.join(dir,'sample.json');let input;
 const r=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,hardwareFile,plannerOptions:{provider:'qwen',model:'test',key:'test-key',fetchFn:async(url,options)=>{input=JSON.parse(JSON.parse(options.body).messages[1].content);return response({summary:'温湿度建议',findings:['按观测分析'],unknowns:[]});}}});
 const base=`http://127.0.0.1:${r.httpPort}`,get=url=>fetch(base+url).then(r=>r.json()),post=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal(r.snapshot().frame,null);assert.equal(r.snapshot().deviceOnline,false);
  for(const url of ['/api/device','/api/command','/api/demo/scenario','/api/agent/plan']){const res=await post(url,{action:'ventilate',name:'co',prompt:'测试'});assert.equal(res.status,403);assert.equal((await res.json()).error,'simulation_disabled');}
  await assert.rejects(r.command('ventilate'),/simulation_disabled/);
  assert.equal((await get('/api/health')).simulated,false);assert.equal((await get('/api/observations')).hardware.deviceOnline,false);
  let analysis=await post('/api/agent/analyze',{prompt:'没有设备怎么办'}).then(r=>r.json());assert.equal(analysis.deviceOnline,false);assert.equal(input.hardware.values.temperatureC,null);assert.equal('frame' in input,false);assert.equal('environment' in input,false);assert.equal(analysis.hardwareControl,false);assert.equal(analysis.simulated,false);assert.deepEqual(analysis.steps,[]);assert.ok(analysis.unknowns.some(s=>s.includes('离线')));
  await writeFile(hardwareFile,JSON.stringify({receivedAt:Date.now(),frame:frame()}));
  const observed=await get('/api/observations');assert.equal(observed.hardware.values.temperatureC,25.3);assert.equal(observed.simulated,false);assert.equal(observed.capabilities.actuate,false);assert.equal((await get('/api/health')).hardwareConnected,true);
  analysis=await post('/api/agent/analyze',{prompt:'查询真实数据'}).then(r=>r.json());assert.equal(analysis.deviceOnline,true);assert.equal(input.hardware.values.gasRaw,550);assert.equal(input.recentAnalyses.length,1);assert.equal(analysis.realAdmission,'unknown_denied');
 }finally{await r.close();await rm(dir,{recursive:true,force:true});}
});
test('真实分析：未配置不伪造，拒绝控制字段/错误工具，历史与演示隔离',async()=>{
 const hardware=hspSnapshot({receivedAt:Date.now(),frame:frame()});
 const none=new AgentPlanner({provider:'none',model:'',key:'',fetchFn:()=>{throw Error('unexpected request')}});await assert.rejects(none.analyze('查询',hardware),/ai_not_configured/);
 for(const bad of [{summary:'控制',findings:[],unknowns:[],steps:[{action:'ventilate'}]},{summary:'',findings:[42],unknowns:[]}]){
  const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async()=>response(bad)});await assert.rejects(planner.analyze('查询',hardware),/invalid_model_analysis/);assert.equal(planner.recentAnalyses.length,0);assert.equal(planner.recentProposals.length,0);
 }
 const good=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async()=>response({summary:'可以入棚',findings:[],unknowns:[]})});const result=await good.analyze('查询',hardware);assert.match(result.summary,/准入未知／拒止/);assert.equal(result.executed,false);assert.equal(good.recentProposals.length,0);
});
test('真实分析等待期间过期：保留分析快照来源但当前在线转未知',async()=>{
 const hardware=hspSnapshot({receivedAt:Date.now()-9990,frame:frame()});assert.equal(hardware.deviceOnline,true);
 const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async()=>{await new Promise(resolve=>setTimeout(resolve,30));return response({summary:'快照分析',findings:[],unknowns:[]});}});
 const result=await planner.analyze('查询',hardware);assert.equal(result.deviceOnline,false);assert.equal(result.observationStale,true);assert.ok(result.observationAgeMs>=10000);assert.equal(result.observationReceivedAt,hardware.receivedAt);assert.equal(result.observation,hardware);assert.match(result.summary,/分析期间样本过期/);
});
const toolResponse=(name,args,id='read_1')=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
test('真实分析等待期间传感器自身年龄过期，坏有效年龄保守拒止，无效通道不影响其他通道',async()=>{
 const make=()=>hspSnapshot({receivedAt:Date.now(),frame:frame()});
 const run=async hardware=>{
  const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async()=>{await new Promise(resolve=>setTimeout(resolve,35));return response({summary:'快照分析',findings:[],unknowns:[]});}});
  return planner.analyze('读取',hardware);
 };
 for(const key of ['climateAgeMs','gasAgeMs']){
  const hardware=make();hardware[key]=9990;const result=await run(hardware);
  assert.equal(result.deviceOnline,false,key);assert.equal(result.observationStale,true,key);assert.ok(result.observationAgeMs>=10000,key);assert.equal(result.observation,hardware);assert.equal(result.observationReceivedAt,hardware.receivedAt);assert.match(result.summary,/样本过期/);
 }
 for(const [key,value] of [['climateAgeMs',undefined],['gasAgeMs',-1],['gasAgeMs',NaN]]){
  const hardware=make();hardware[key]=value;const result=await run(hardware);assert.equal(result.observationStale,true);assert.equal(result.observationAgeMs,null);
 }
 const hardware=make();hardware.quality.temperatureValid=false;hardware.quality.humidityValid=false;hardware.climateAgeMs=999999;
 let result=await run(hardware);assert.equal(result.observationStale,false);assert.equal(result.deviceOnline,true);assert.ok(result.observationAgeMs<10000);
 hardware.quality.temperatureValid=true;hardware.quality.humidityValid=true;hardware.climateAgeMs=100;hardware.quality.gasValid=false;hardware.gasAgeMs=undefined;
 result=await run(hardware);assert.equal(result.observationStale,false);assert.equal(result.deviceOnline,true);assert.ok(result.observationAgeMs<10000);
});
test('真实Agent多轮：实际读取当前与历史，工具结果进入模型上下文且历史不冒充当前',async()=>{
 const initial=hspSnapshot({receivedAt:Date.now()-20000,frame:frame()}),latest=hspSnapshot({receivedAt:Date.now(),frame:frame()});
 let round=0,currentReads=0,historyReads=0;const requests=[];
 const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async(url,options)=>{
  requests.push(JSON.parse(options.body));round++;
  if(round===1)return toolResponse('read_environment',{});
  if(round===2)return toolResponse('read_recent_history',{limit:2},'read_2');
  return response({summary:'按真实工具观测分析',findings:['工具读取温度'],unknowns:[]});
 }});
 const result=await planner.analyze('查询当前并对比历史',initial,{readEnvironment:()=>{currentReads++;return latest;},readHistory:limit=>{historyReads++;assert.equal(limit,2);return {simulated:false,historical:true,isCurrent:false,items:[{historical:true,isCurrent:false,observation:latest}]};}});
 assert.equal(currentReads,1);assert.equal(historyReads,1);assert.equal(round,3);assert.equal(result.observationReceivedAt,latest.receivedAt);assert.equal(result.deviceOnline,true);assert.equal(result.hardwareControl,false);assert.deepEqual(result.steps,[]);assert.equal(result.toolTrace.length,2);assert.ok(result.toolTrace.every(t=>t.readOnly===true));
 const toolMessages=requests[2].messages.filter(m=>m.role==='tool');assert.equal(toolMessages.length,2);assert.equal(JSON.parse(toolMessages[0].content).values.temperatureC,25.3);assert.equal(JSON.parse(toolMessages[1].content).isCurrent,false);assert.equal(requests[2].tool_choice.function.name,'analyze_observations');
});
test('真实Agent拒绝未知工具/任意路径/坏参数/超轮次，未完成不追加记忆',async()=>{
 const hardware=hspSnapshot({receivedAt:Date.now(),frame:frame()});
 for(const [name,args,expected] of [['shell',{},/ai_unknown_read_tool/],['read_environment',{path:'secret'},/ai_invalid_tool_arguments/],['read_recent_history',{limit:21},/ai_invalid_tool_arguments/],['read_recent_history',{limit:1,url:'http:\/\/bad'},/ai_invalid_tool_arguments/]]){
  let called=false;const planner=new AgentPlanner({provider:'qwen',model:'test',key:'test-key',fetchFn:async()=>toolResponse(name,args)});
  await assert.rejects(planner.analyze('查询',hardware,{readEnvironment:()=>{called=true;},readHistory:()=>{called=true;}}),expected);assert.equal(called,false);assert.equal(planner.recentAnalyses.length,0);
 }
 let reads=0;const planner=new AgentPlanner({provider:'qwen',model:'test',key:'test-key',fetchFn:async()=>toolResponse('read_environment',{})});
 await assert.rejects(planner.analyze('查询',hardware,{readEnvironment:()=>{reads++;return hardware;}}),/ai_tool_round_limit/);assert.equal(reads,2);assert.equal(planner.recentAnalyses.length,0);
});

test('服务商兼容：关闭思考、保留工具续轮字段，普通文本改为强制结构化终结',async()=>{
 const hardware=hspSnapshot({receivedAt:Date.now(),frame:frame()}),requests=[];let round=0;
 const planner=new AgentPlanner({provider:'deepseek',model:'test',key:'test-key',fetchFn:async(url,options)=>{
  requests.push(JSON.parse(options.body));
  if(round++===0)return new Response(JSON.stringify({choices:[{message:{content:null,reasoning_content:'internal-provider-field',tool_calls:[{id:'read_1',type:'function',function:{name:'read_environment',arguments:'{}'}}]}}]}));
  return response({summary:'真实快照分析',findings:[],unknowns:[]});
 }});
 const result=await planner.analyze('查询',hardware,{readEnvironment:()=>hardware});
 assert.equal(requests[0].thinking.type,'disabled');assert.equal(requests[1].messages.find(item=>item.role==='assistant').reasoning_content,'internal-provider-field');assert.ok(!JSON.stringify(result).includes('internal-provider-field'));
 let requestCount=0;const qwenRequests=[];
 const qwen=new AgentPlanner({provider:'qwen',model:'test',key:'test-key',fetchFn:async(url,options)=>{
  qwenRequests.push(JSON.parse(options.body));
  return requestCount++===0?new Response(JSON.stringify({choices:[{message:{content:'先给出一段未结构化文本'}}]})):response({summary:'结构化结果',findings:[],unknowns:[]});
 }});
 const structured=await qwen.analyze('你好',hardware);assert.equal(qwenRequests.length,2);assert.equal(qwenRequests[0].enable_thinking,false);assert.equal(qwenRequests[1].tool_choice.function.name,'analyze_observations');assert.ok(!structured.summary.includes('未结构化文本'));
});
