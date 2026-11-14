import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AnalysisHistory,cleanAnalysis} from '../analysis-history.mjs';
import {hspSnapshot} from '../hsp-telemetry.mjs';
import {startDemo} from '../runtime.mjs';
const observation=()=>hspSnapshot(null);
const analysis=()=>({mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:'当前采集未知',findings:[],unknowns:['CO未接入'],provider:'deepseek',model:'test',analyzedAt:Date.now(),observation:observation(),observationReceivedAt:null,observationAgeMs:null,observationStale:true,deviceOnline:false,toolTrace:[]});
test('AI文字历史：并发串行、重启哈希校验、白名单去除照片/密钥/路径与附加字段',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-analysis-')),file=path.join(dir,'history.jsonl');
 try{
  const store=await new AnalysisHistory(file).open(),input={...analysis(),key:'secret-credential',imageBase64:'secret-image',reasoning_content:'secret-reasoning',url:'https://secret.example',path:'C:/private'};
  input.observation.extra='secret-nested';input.toolTrace=[{tool:'read_environment',at:Date.now(),readOnly:true,resultSummary:'读取真实采集快照',key:'secret-trace'}];
  input.toolTrace.push({tool:'read_recent_history',at:Date.now(),readOnly:true,resultSummary:'真实历史0条，不代表当前',count:0,key:'secret-history'});
  await Promise.all(Array.from({length:3},(_,i)=>store.append('问题'+i,input)));
  const text=await readFile(file,'utf8');assert.equal(text.includes('secret-'),false);assert.equal(store.status().records,3);
  const restored=await new AnalysisHistory(file).open();assert.equal(restored.status().healthy,true);const history=restored.read({limit:2});assert.equal(history.items.length,2);assert.equal(history.items[0].seq,3);assert.equal(history.isCurrent,false);assert.equal(history.items[0].analysis.observation.values.temperatureC,null);
  assert.deepEqual(history.items[0].analysis.toolTrace.map(row=>row.resultSummary),['读取真实采集快照','真实历史0条，不代表当前']);assert.ok(history.items[0].analysis.toolTrace.every(row=>row.at>0&&row.readOnly===true));
  assert.throws(()=>cleanAnalysis({...analysis(),kind:'crop_image_analysis'}),/invalid_analysis_record/);
  for(const patch of [{receivedAt:-1},{receivedAt:1.5},{deviceOnline:true},{quality:{...observation().quality,coValid:true}},{quality:{...observation().quality,temperatureValid:'true'}}])assert.throws(()=>cleanAnalysis({...analysis(),observation:{...observation(),...patch}}),/invalid_analysis_observation/);
  assert.throws(()=>cleanAnalysis({...analysis(),toolTrace:[{tool:'read_environment',at:0,readOnly:true,resultSummary:'读取'}]}),/invalid_analysis_trace/);
  const copy=history.items[0].analysis;copy.summary='mutated response';assert.notEqual(restored.read().items[0].analysis.summary,copy.summary);
  for(const corrupt of [text.slice(0,-1),text.replace('当前采集未知','篡改内容')]){
   await writeFile(file,corrupt);const broken=await new AnalysisHistory(file).open();assert.equal(broken.status().healthy,false);assert.equal(broken.read().items.length,0);await assert.rejects(broken.append('查询',analysis()),/analysis_history_unavailable/);assert.equal(await readFile(file,'utf8'),corrupt);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('AI历史写失败冻结追加，16MB满不覆盖；200条内存窗口保留总序号',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-analysis-fail-')),file=path.join(dir,'history.jsonl');
 try{
  const store=await new AnalysisHistory(file).open();await store.append('已保存',analysis());const original=await readFile(file,'utf8');store.bytes=16*1024*1024;
  await assert.rejects(store.append('不能覆盖',analysis()),/analysis_history_size_limit/);assert.equal(await readFile(file,'utf8'),original);assert.equal(store.status().healthy,false);
  const fail=await new AnalysisHistory(path.join(dir,'directory')).open();await mkdir(fail.file);await assert.rejects(fail.append('失败',analysis()));assert.equal(fail.status().healthy,false);await assert.rejects(fail.append('重试',analysis()),/analysis_history_unavailable/);
  const window=await new AnalysisHistory(path.join(dir,'window.jsonl')).open();for(let i=0;i<202;i++)await window.append('记录'+i,analysis());assert.equal(window.status().records,202);assert.equal(window.read({limit:200}).items.length,200);assert.equal(window.read().items[0].seq,202);assert.equal((await new AnalysisHistory(window.file).open()).status().records,202);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('实际文字AI响应持久化，失败不存；保存失败仍返回模型分析，图片不追加',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-analysis-http-')),store=await new AnalysisHistory(path.join(dir,'history.jsonl')).open();let providerFails=false;
 const r=await startDemo({operationMode:'hardware',analysisStore:store,mqttPort:0,httpPort:0,hardwareFile:path.join(dir,'missing.json'),plannerOptions:{provider:'deepseek',model:'test',key:'test-key',fetchFn:async(url,options)=>{
  if(providerFails)return new Response('sensitive provider body',{status:401});const request=JSON.parse(options.body),name=request.tools.at(-1).function.name;
  if(name==='analyze_observations'){
   const reads=request.messages.filter(row=>row.role==='tool').length;
   if(reads<2){const toolName=reads===0?'read_environment':'read_recent_history';return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'call_'+reads,type:'function',function:{name:toolName,arguments:JSON.stringify(reads===0?{}:{limit:1})}}]}}]}));}
  }
  return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify({summary:'只读分析',findings:[],unknowns:[]})}}]}}]}));
 }}});
 const base=`http://127.0.0.1:${r.httpPort}`,post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  let res=await post('/api/agent/analyze',{prompt:'读取真实数据'}),data=await res.json();assert.equal(res.status,200);assert.deepEqual(data.persistence,{saved:true,recordId:1});
  const history=await fetch(base+'/api/agent/history?limit=20').then(r=>r.json());assert.equal(history.items.length,1);assert.equal(history.items[0].prompt,'读取真实数据');assert.equal(history.items[0].historical,true);assert.equal(history.items[0].isCurrent,false);assert.equal('persistence' in history.items[0].analysis,false);
  const reloaded=await new AnalysisHistory(store.file).open();assert.equal(reloaded.status().healthy,true);assert.deepEqual(reloaded.read().items[0].analysis.toolTrace,history.items[0].analysis.toolTrace);assert.equal(history.items[0].analysis.toolTrace.length,2);assert.ok(history.items[0].analysis.toolTrace.every(row=>typeof row.resultSummary==='string'));
  providerFails=true;assert.equal((await post('/api/agent/analyze',{prompt:'失败'})).status,422);assert.equal(store.status().records,1);providerFails=false;
  const bytes=Buffer.alloc(32);bytes.set([255,216,255]);assert.equal((await post('/api/agent/inspect-image',{prompt:'照片',mimeType:'image/jpeg',imageBase64:bytes.toString('base64')})).status,200);assert.equal(store.status().records,1);
  store.healthy=false;res=await post('/api/agent/analyze',{prompt:'仍分析'});data=await res.json();assert.equal(res.status,200);assert.equal(data.summary.includes('只读分析'),true);assert.deepEqual(data.persistence,{saved:false,error:'analysis_history_write_failed'});
 }finally{await r.close();await rm(dir,{recursive:true,force:true});}
});

test('文字AI历史文件被截断或删除后拒绝续写，不创建断链成功记录',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-analysis-change-'));
 try{
  for(const action of ['truncate','delete']){
   const file=path.join(dir,action+'.jsonl'),store=await new AnalysisHistory(file).open();await store.append('原始记录',analysis());
   if(action==='truncate')await writeFile(file,'');else await rm(file);
   await assert.rejects(store.append('不能续写',analysis()),/file_changed/);assert.equal(store.status().healthy,false);assert.equal(store.status().records,1);
   if(action==='truncate')assert.equal(await readFile(file,'utf8'),'');else await assert.rejects(readFile(file),error=>error.code==='ENOENT');
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
