import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AnalysisHistory} from '../analysis-history.mjs';
import {hspSnapshot} from '../hsp-telemetry.mjs';
import {startDemo} from '../runtime.mjs';
const entry=i=>({mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:'历史建议'+i,findings:[],unknowns:[],provider:'deepseek',model:'memory-test',analyzedAt:Date.now(),observation:hspSnapshot(null),observationReceivedAt:null,observationAgeMs:null,observationStale:true,deviceOnline:false,toolTrace:[]});
test('真实AI持久记忆：服务关闭重启恢复同服务商同模型最近8条，切换模型/服务商隔离',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-memory-')),file=path.join(dir,'history.jsonl');let r,observed;
 const fetchFn=async(url,options)=>{observed=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'analyze_observations',arguments:JSON.stringify({summary:'新的只读分析',findings:[],unknowns:[]})}}]}}]}));};
 const start=async(provider='deepseek',model='memory-test',store)=>{
  const analysisStore=store||await new AnalysisHistory(file).open();
  r=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,analysisStore,configStore:{save:async()=>{}},hardwareFile:path.join(dir,'missing.json'),plannerOptions:{provider,model,key:'test-key',fetchFn}});return `http://127.0.0.1:${r.httpPort}`;
 };
 // A restarted test server can receive the same ephemeral port. Each logical
 // client session closes its connection rather than reusing a terminated one.
 const analyze=(base,prompt)=>fetch(base+'/api/agent/analyze',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({prompt})}).then(r=>r.json());
 try{
  const seed=await new AnalysisHistory(file).open();for(let i=0;i<10;i++)await seed.append('问题'+i,entry(i));await seed.append('其他服务商',{...entry(20),provider:'qwen'});await seed.append('其他模型',{...entry(21),model:'other'});
  let base=await start();await analyze(base,'第一次启动');assert.equal(observed.recentAnalyses.length,8);assert.equal(observed.recentAnalyses[0].request,'问题2');assert.equal(observed.recentAnalyses.at(-1).request,'问题9');assert.ok(observed.recentAnalyses.every(row=>row.executed===false&&!('steps' in row)));
  await r.close();r=undefined;base=await start();await analyze(base,'重启后');assert.equal(observed.recentAnalyses.length,8);assert.equal(observed.recentAnalyses[0].request,'问题3');assert.equal(observed.recentAnalyses.at(-1).request,'第一次启动');assert.equal(observed.hardware.deviceOnline,false);
  const {csrfToken}=await fetch(base+'/api/agent/config',{headers:{Connection:'close'}}).then(r=>r.json());
  const change=async(provider,model)=>{const response=await fetch(base+'/api/agent/config',{method:'POST',headers:{'Content-Type':'application/json','X-Pengan-Config-Token':csrfToken,Connection:'close'},body:JSON.stringify({provider,model,key:'test-key'})});assert.equal(response.status,200);};
  await change('deepseek','new-model');await analyze(base,'新模型');assert.deepEqual(observed.recentAnalyses,[]);
  await change('qwen','memory-test');await analyze(base,'另一家');assert.equal(observed.recentAnalyses.length,1);assert.equal(observed.recentAnalyses[0].request,'其他服务商');
  const status=await fetch(base+'/api/agent/status',{headers:{Connection:'close'}}).then(r=>r.json());assert.equal(JSON.stringify(status).includes('问题'),false);
 }finally{await r?.close();await rm(dir,{recursive:true,force:true});}
});
test('真实AI记忆：损坏或不可读存储不恢复任何历史，不阻止真实分析',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-memory-bad-')),file=path.join(dir,'history.jsonl');let r;
 try{
  await writeFile(file,'damaged');const broken=await new AnalysisHistory(file).open();assert.equal(broken.status().healthy,false);
  for(const analysisStore of [broken,{status:()=>({healthy:true}),read:()=>{throw Error('private filesystem path');},append:async()=>{throw Error('unavailable');},flush:async()=>{}}]){
   let context;r=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,analysisStore,plannerOptions:{provider:'deepseek',model:'memory-test',key:'test-key',fetchFn:async(url,options)=>{context=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'analyze_observations',arguments:JSON.stringify({summary:'缺少数据',findings:[],unknowns:[]})}}]}}]}));}}});
   const response=await fetch(`http://127.0.0.1:${r.httpPort}/api/agent/analyze`,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({prompt:'查询'})});assert.equal(response.status,200);assert.deepEqual(context.recentAnalyses,[]);assert.equal((await response.json()).persistence.saved,false);await r.close();r=undefined;
  }
 }finally{await r?.close();await rm(dir,{recursive:true,force:true});}
});
