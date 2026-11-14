import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {hspSnapshot} from '../hsp-telemetry.mjs';
import {HardwareHistory} from '../hardware-history.mjs';
import {AnalysisHistory,cleanAnalysis} from '../analysis-history.mjs';
import {createRealReport} from '../report.mjs';
const sample=(receivedAt,transport)=>({receivedAt,...(transport?{transport}:{}),frame:{schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:1000,th_ok:true,temperature10:253,humidity10:621,gas_ok:true,gas_raw:550,gas_mv:967,th_sample_age_ms:100,gas_sample_age_ms:200,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false}});
test('无线来源贯穿实时快照、混合历史重启、AI历史及报告，旧串口链仍兼容',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-transport-'));
 try{
 const latest=path.join(dir,'latest.json'),file=path.join(dir,'history.jsonl'),aiFile=path.join(dir,'ai.jsonl');
 const store=await new HardwareHistory(file).open();
 await writeFile(latest,JSON.stringify(sample(100000)));assert.equal(await store.collect(latest,100001),true);
 const restored=await new HardwareHistory(file).open();await writeFile(latest,JSON.stringify(sample(102000,'http')));assert.equal(await restored.collect(latest,102001),true);
 const history=new HardwareHistory(file);await history.open();const items=history.read().items;assert.deepEqual(items.map(r=>r.observation.source),['http','serial']);
 const raw=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(raw[0].sample.transport,undefined);assert.equal(raw[1].sample.transport,'http');assert.equal(raw[1].source,'http');
 const observation=hspSnapshot(sample(102000,'http'),102001);assert.equal(observation.source,'http');assert.equal(hspSnapshot(sample(102000,'http'),120000).source,'http');assert.equal(hspSnapshot(sample(102000,'ftp'),102001).deviceOnline,false);
 const analysis={mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:'仅建议',findings:[],unknowns:[],provider:'deepseek',model:'test',analyzedAt:102001,observation,observationReceivedAt:102000,observationAgeMs:1,observationStale:false,deviceOnline:true,toolTrace:[]};
 const ai=await new AnalysisHistory(aiFile).open();await ai.append('查询',analysis);const aiRestart=await new AnalysisHistory(aiFile).open();assert.equal(aiRestart.status().healthy,true);assert.equal(aiRestart.read().items[0].analysis.observation.source,'http');
 const report=createRealReport({current:{schemaVersion:1,mode:'hardware',simulated:false,gatewayNow:102001,hardware:observation},observationHistory:history.read(),analysisHistory:aiRestart.read(),generatedAt:102001}).report;
 assert.equal(report.current.hardware.source,'http');assert.deepEqual(report.observationHistory.items.map(r=>r.observation.source),['http','serial']);assert.equal(report.analysisHistory.items[0].analysis.observation.source,'http');
 assert.throws(()=>cleanAnalysis({...analysis,observation:{...observation,source:'ftp'}}),/source/);
 // A correctly rehashed record must still reject disagreement between chain source and envelope transport.
 const {hash,...body}=raw[1];body.source='serial';raw[1]={...body,hash:createHash('sha256').update(JSON.stringify(body)).digest('hex')};await writeFile(file,raw.map(JSON.stringify).join('\n')+'\n');await assert.rejects(new HardwareHistory(file).open(),/integrity/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
