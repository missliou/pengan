import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source='function invalidateReport'+readFileSync(new URL('../panel.js',import.meta.url),'utf8').split('function invalidateReport')[1].split('// Manual model connection')[0];
const report=()=>({schemaVersion:1,kind:'pengan_real_session_report',mode:'hardware',simulated:false,hardwareActuation:false,realAdmission:'unknown_denied',generatedAt:1,current:{schemaVersion:1,mode:'hardware',simulated:false,hardware:{deviceId:'hh-hsp101-001',simulated:false,deviceOnline:false,actuationAvailable:false,values:{temperatureC:null,coPpm:null,co2Ppm:null},quality:{coValid:false,co2Valid:false}}},observationHistory:{schemaVersion:1,simulated:false,historical:true,isCurrent:false,items:[]},analysisHistory:{schemaVersion:1,simulated:false,historical:true,isCurrent:false,items:[]},scope:{observationLimit:50,analysisLimit:20,completeHistory:false},limitations:['非完整历史']});
function runtime(){
 const nodes=new Map(),events={};let payload=report(),created=0,revoked=0,clicked=0;
 const element=()=>({listeners:{},textContent:'',addEventListener(k,f){this.listeners[k]=f;},click(){clicked++;},remove(){}}),get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context=vm.createContext({modelTestBusy:false,reportEpoch:0,reportBusy:false,imageBusy:false,configBusy:false,planning:false,sending:false,operationMode:'hardware',serviceOnline:true,$:get,updateButtons(){},message:e=>e.message,window:{addEventListener(k,f){events[k]=f;}},document:{createElement:element,body:{append(){}}},Blob,URL:{createObjectURL(){created++;return 'blob:test';},revokeObjectURL(){revoked++;}},Date,AbortSignal,Uint8Array,TextDecoder,validateAnalysis:p=>p,fetch:async()=>({ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify(payload)));c.close();}})})});
 vm.runInContext(source,context);return {context,get,events,setPayload:p=>payload=p,counts:()=>({created,revoked,clicked})};
}
test('报告点击下载仅提交浏览器，URL及时释放，拒绝模拟/全量/历史填当前',async()=>{
 const r=runtime();assert.deepEqual(r.counts(),{created:0,revoked:0,clicked:0});await r.get('report-export').listeners.click();assert.deepEqual(r.counts(),{created:1,revoked:1,clicked:1});assert.match(r.get('report-status').textContent,/请确认保存位置/);
 for(const mutate of [p=>p.simulated=true,p=>p.scope.completeHistory=true,p=>p.current.hardware.values.temperatureC=25,p=>p.observationHistory.simulated=true]){const p=report();mutate(p);r.setPayload(p);await r.get('report-export').listeners.click();assert.match(r.get('report-status').textContent,/未确认/);}
 r.events.offline();assert.match(r.get('report-status').textContent,/断开/);
});
test('报告超过1MiB取消读取，不创建下载链接',async()=>{
 const r=runtime();r.context.fetch=async()=>({ok:true,body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(1048577));}})});await r.get('report-export').listeners.click();assert.equal(r.counts().created,0);assert.match(r.get('report-status').textContent,/1MiB/);
});
test('报告在网络断开后到达，不产生旧成功提示或下载',async()=>{
 const r=runtime();let release;r.context.fetch=async()=>{await new Promise(resolve=>release=resolve);return new Response(JSON.stringify(report()));};
 const pending=r.get('report-export').listeners.click();r.events.offline();release();await pending;assert.equal(r.counts().created,0);assert.match(r.get('report-status').textContent,/网络已断开/);
});

test('CSV保留有效真实历史、未知留空、不导出分析文本或伪造气体浓度',()=>{
 const r=runtime(),p=report();p.observationHistory.storage={healthy:true};
 p.observationHistory.items=[{seq:1,hash:'a'.repeat(64),historical:true,isCurrent:false,observation:{deviceId:'hh-hsp101-001',simulated:false,actuationAvailable:false,deviceOnline:true,receivedAt:1234,sampleAgeMs:50,values:{temperatureC:-0.5,humidityPct:99,gasRaw:4095,gasMv:7200,coPpm:null,co2Ppm:null},quality:{temperatureValid:true,humidityValid:false,gasValid:true,coValid:false,co2Valid:false}}}];
 p.analysisHistory.items=[{seq:2,historical:true,isCurrent:false,analysis:{summary:'=UNTRUSTED_FORMULA'}}];
 const text=r.context.observationCsv(p),lines=text.slice(1).trimEnd().split('\r\n'),row=lines[1].split(',').map(s=>s.slice(1,-1));
 assert.equal(text.charCodeAt(0),0xfeff);assert.equal(lines.length,2);assert.equal(row.length,21);assert.equal(row[5],'true');assert.equal(row[6],'false');assert.equal(row[10],'-0.5');assert.equal(row[12],'');assert.equal(row[14],'4095');assert.equal(row[17],'');assert.equal(row[18],'');assert.equal(row[19],'unknown_denied');assert.equal(text.includes('UNTRUSTED'),false);
 const h=p.observationHistory.items[0].observation;
 h.values.gasRaw='=1+1';assert.throws(()=>r.context.observationCsv(p),/读数无效/);
 h.values.gasRaw=1;h.receivedAt='=1+1';assert.throws(()=>r.context.observationCsv(p),/时间无效/);
 h.deviceOnline=false;const offline=r.context.observationCsv(p).split('\r\n')[1].split(',');assert.equal(offline[7],'""');assert.equal(offline[10],'""');assert.equal(offline[14],'""');
 p.observationHistory.items[0].hash='=1+1';assert.throws(()=>r.context.observationCsv(p),/协议无效/);
});

test('CSV入口复用有界读取和失效保护，空历史仅下载表头',async()=>{
 const r=runtime();await r.get('history-csv-export').listeners.click();assert.deepEqual(r.counts(),{created:1,revoked:1,clicked:1});assert.match(r.get('report-status').textContent,/仅有表头/);
 assert.equal(r.context.observationCsv(report()).split('\r\n').length,2);
 let release;r.context.fetch=async()=>{await new Promise(resolve=>release=resolve);return new Response(JSON.stringify(report()));};
 const pending=r.get('history-csv-export').listeners.click();r.events.offline();release();await pending;assert.equal(r.counts().created,1);assert.match(r.get('report-status').textContent,/断开/);
});
