import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRealReport,disabledReportHistory} from '../report.mjs';
import {hspSnapshot} from '../hsp-telemetry.mjs';
import {HardwareHistory} from '../hardware-history.mjs';
import {AnalysisHistory} from '../analysis-history.mjs';
import {startDemo} from '../runtime.mjs';
const frame=()=>({schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:20000,th_ok:true,temperature10:253,humidity10:621,gas_ok:true,gas_raw:550,gas_mv:967,th_sample_age_ms:100,gas_sample_age_ms:200,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false});
const current=hardware=>({schemaVersion:1,mode:'hardware',simulated:false,gatewayNow:Date.now(),hardware});
const analysis=()=>({mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:'只读建议',findings:[],unknowns:[],provider:'deepseek',model:'test',analyzedAt:Date.now(),observation:hspSnapshot(null),observationReceivedAt:null,observationAgeMs:null,observationStale:true,deviceOnline:false,toolTrace:[]});
test('真实报告白名单与窗口界限：不补当前、不包含配置/照片/路径/内部字段',()=>{
 const secret='DO_NOT_EXPORT',hardware={...hspSnapshot(null),key:secret,path:secret,imageBase64:secret,workspaceId:secret};
 const observationHistory=disabledReportHistory(64*1024*1024);observationHistory.key=secret;observationHistory.storage.path=secret;
 const analysisHistory=disabledReportHistory(16*1024*1024);analysisHistory.items=[{seq:1,hash:'a'.repeat(64),recordedAt:Date.now(),prompt:'问题',historical:true,isCurrent:false,key:secret,analysis:{...analysis(),key:secret,reasoning_content:secret,imageBase64:secret,url:secret,path:secret}}];
 const output=createRealReport({current:{...current(hardware),key:secret,workspaceId:secret},observationHistory,analysisHistory,generatedAt:1793424000000});
 assert.equal(output.body.includes(secret),false);assert.equal(output.report.current.hardware.values.temperatureC,null);assert.equal(output.report.analysisHistory.items[0].historical,true);assert.equal(output.report.scope.completeHistory,false);assert.match(output.filename,/^pengan-real-report-\d{8}-\d{6}\.json$/);
 assert.equal(output.report.observationHistory.retainedInMemory,0);assert.ok(output.report.limitations.some(row=>row.includes('导出时间的快照')));
 for(const retainedInMemory of [-1,501,1.5,undefined])assert.throws(()=>createRealReport({current:current(hardware),observationHistory:{...observationHistory,retainedInMemory}}),/report_unavailable/);
 const huge={...analysis(),summary:'字'.repeat(2000),findings:Array(10).fill('字'.repeat(1000)),unknowns:Array(12).fill('字'.repeat(1000))};
 analysisHistory.items=Array.from({length:20},(_,i)=>({seq:i+1,hash:'a'.repeat(64),recordedAt:Date.now(),prompt:'问题',analysis:huge,historical:true,isCurrent:false}));
 assert.throws(()=>createRealReport({current:current(hardware),analysisHistory}),/report_too_large/);
});
test('真实报告HTTP：实际采集/分析历史与离线当前分离，GET无模型或记录副作用',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-report-')),hardwareFile=path.join(dir,'hardware.json');let r,modelCalls=0;
 try{
  const now=Date.now();await writeFile(hardwareFile,JSON.stringify({receivedAt:now,frame:frame()}));
  const historyStore=await new HardwareHistory(path.join(dir,'history.jsonl')).open();await historyStore.collect(hardwareFile,now);
  const analysisStore=await new AnalysisHistory(path.join(dir,'analyses.jsonl')).open();await analysisStore.append('已保存的问题',analysis());
  await writeFile(hardwareFile,JSON.stringify({receivedAt:now-20000,frame:frame()}));
  r=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,hardwareFile,historyStore,analysisStore,plannerOptions:{provider:'deepseek',model:'test',key:'do-not-export-key',workspaceId:'private-workspace',fetchFn:async()=>{modelCalls++;throw Error('must not call');}}});
  const base=`http://127.0.0.1:${r.httpPort}`,before=[historyStore.status().records,analysisStore.status().records];
  const response=await fetch(base+'/api/reports/latest');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/^attachment; filename="pengan-real-report-\d{8}-\d{6}\.json"$/);
  const text=await response.text(),report=JSON.parse(text);assert.equal(text.includes('do-not-export-key'),false);assert.equal(text.includes('private-workspace'),false);assert.equal(report.current.hardware.deviceOnline,false);assert.equal(report.current.hardware.values.temperatureC,null);assert.equal(report.observationHistory.items[0].observation.values.temperatureC,25.3);assert.equal(report.observationHistory.items[0].isCurrent,false);assert.equal(report.analysisHistory.items[0].prompt,'已保存的问题');assert.equal(report.hardwareActuation,false);assert.equal(report.realAdmission,'unknown_denied');assert.equal(modelCalls,0);assert.deepEqual([historyStore.status().records,analysisStore.status().records],before);
  assert.equal(report.observationHistory.retainedInMemory,historyStore.read().retainedInMemory);assert.equal(report.observationHistory.retainedInMemory,1);
 }finally{await r?.close();await rm(dir,{recursive:true,force:true});}
});
test('报告无store使用完整disabled状态，模拟模式明确拒绝',{timeout:15000},async()=>{
 for(const operationMode of ['hardware','simulation']){
  const r=await startDemo({operationMode,mqttPort:0,httpPort:0});
  try{const response=await fetch(`http://127.0.0.1:${r.httpPort}/api/reports/latest`);assert.equal(response.status,operationMode==='hardware'?200:403);const data=await response.json();if(operationMode==='hardware'){assert.equal(data.observationHistory.storage.enabled,false);assert.equal(data.observationHistory.storage.bytes,0);assert.equal(data.analysisHistory.storage.maxBytes,16*1024*1024);assert.deepEqual(data.analysisHistory.items,[]);}else assert.equal(data.error,'real_mode_required');}finally{await r.close();}
 }
});
