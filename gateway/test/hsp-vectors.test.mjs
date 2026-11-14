import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {validateHspFrame,hspSnapshot,hspSource,readHspTelemetry} from '../hsp-telemetry.mjs';
import {HspHttpReader} from '../hsp-http.mjs';
// 期望值来源：docs/DAYU200遥测帧校验向量.md（Qwen-3.8 QWEN-DAYU200-CONTRACT-20261102 设计稿）。
// 本文件把该文档 §2/§3/§4 的推导结果固化为可执行断言，任何一侧（网关/原生/云端）改动后都必须重跑。
const base=()=>({schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:123456,th_ok:true,temperature10:256,humidity10:640,gas_ok:true,gas_raw:1234,gas_mv:3210,th_sample_age_ms:800,gas_sample_age_ms:900,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false});
const withFrame=patch=>{const f=base();for(const [key,value] of Object.entries(patch)){if(value===undefined)delete f[key];else f[key]=value;}return f;};
const code=fn=>{try{fn();return 'ok';}catch(error){return error.message;}};

test('校验向量 §2：F-01~F-25 逐条对齐现有实现语义',()=>{
 const table=[
  ['F-01',{},'ok'],
  ['F-02',{th_ok:false,temperature10:9999,humidity10:9999},'ok'],
  ['F-03',{gas_ok:false,gas_raw:9999},'ok'],
  ['F-04',{gas_ok:false,gas_raw:undefined},'ok'],
  ['F-05',{temperature10:851},'invalid_hsp_climate'],
  ['F-06',{temperature10:-401},'invalid_hsp_climate'],
  ['F-07',{humidity10:1001},'invalid_hsp_climate'],
  ['F-08',{temperature10:'256'},'invalid_hsp_climate'],
  ['F-09',{gas_raw:4096},'invalid_hsp_adc'],
  ['F-10',{gas_mv:7201},'invalid_hsp_adc'],
  ['F-11',{coPpm:5},'invalid_hsp_identity'],
  ['F-12',{coPpm:undefined},'invalid_hsp_identity'],
  ['F-13',{coValid:undefined},'invalid_hsp_identity'],
  ['F-14',{simulated:true},'invalid_hsp_identity'],
  ['F-15',{controlSupported:true},'invalid_hsp_identity'],
  ['F-16',{deviceId:'HH-HSP101-001'},'invalid_hsp_identity'],
  ['F-17',{schemaVersion:'1'},'invalid_hsp_identity'],
  ['F-18',{uptime_ms:undefined},'invalid_hsp_quality'],
  ['F-19',{uptime_ms:4294967296},'invalid_hsp_quality'],
  ['F-20',{uptime_ms:100.5},'invalid_hsp_quality'],
  ['F-21',{th_ok:0},'invalid_hsp_quality'],
  ['F-22',{th_sample_age_ms:4294967296},'invalid_hsp_quality'],
  ['F-25',{wifi_ssid:'HomeNet',page:3},'ok'],
 ];
 for(const [id,patch,expected] of table)assert.equal(code(()=>validateHspFrame(withFrame(patch))),expected,id);
 // F-23 / F-24：整帧非对象时走身份分支或解析层，两者都不允许通过。
 assert.equal(code(()=>validateHspFrame([])),'invalid_hsp_identity','F-23');
 assert.equal(code(()=>validateHspFrame(null)),'invalid_hsp_identity','F-24');
});

test('时效向量 §3：S-01~S-09 通道年龄叠加与未知语义',()=>{
 const live=hspSnapshot({receivedAt:100000,frame:base()},100000);
 assert.equal(live.deviceOnline,true,'S-01');assert.equal(live.reason,'read_only_hardware','S-01');
 assert.equal(live.values.temperatureC,25.6,'S-01');assert.equal(live.values.humidityPct,64,'S-01');
 assert.equal(live.values.gasRaw,1234,'S-01');assert.equal(live.values.gasMv,3210,'S-01');
 assert.equal(live.actuationAvailable,false,'S-01');assert.equal(live.admission,'unknown_denied','S-01');

 const late=hspSnapshot({receivedAt:100000,frame:base()},109999);
 assert.equal(late.deviceOnline,true,'S-02');assert.equal(late.climateAgeMs,10799,'S-02');
 assert.equal(late.values.temperatureC,null,'S-02');assert.equal(late.values.gasRaw,null,'S-02');

 const stale=hspSnapshot({receivedAt:100000,frame:base()},110000);
 assert.equal(stale.reason,'telemetry_stale','S-03');assert.equal(stale.receivedAt,null,'S-03');

 const fresh=hspSnapshot({receivedAt:100000,frame:withFrame({th_sample_age_ms:900,gas_sample_age_ms:50})},109000);
 assert.equal(fresh.quality.temperatureValid,true,'S-04');assert.equal(fresh.climateAgeMs,9900,'S-04');
 assert.equal(fresh.quality.gasValid,true,'S-04');assert.equal(fresh.gasAgeMs,9050,'S-04');

 const split=hspSnapshot({receivedAt:100000,frame:withFrame({th_sample_age_ms:600,gas_sample_age_ms:100})},109500);
 assert.equal(split.quality.temperatureValid,false,'S-05');assert.equal(split.climateAgeMs,10100,'S-05');
 assert.equal(split.quality.gasValid,true,'S-05');assert.equal(split.values.gasRaw,1234,'S-05');

 assert.equal(hspSnapshot({receivedAt:100100,frame:base()},100000).reason,'invalid_receive_time','S-06');
 assert.equal(hspSnapshot({receivedAt:100000,frame:withFrame({temperature10:851})},100100).reason,'invalid_hsp_sample','S-07');
 assert.equal(hspSnapshot({receivedAt:100000,transport:'http',frame:base()},100100).source,'http','S-08');
 assert.equal(hspSnapshot({receivedAt:100000,frame:base()},100100).source,'serial','S-09');
});

test('时效向量 §3：S-10 非法 transport 不再被错标为 serial 来源',()=>{
 const ble=hspSnapshot({receivedAt:100000,transport:'ble',frame:base()},100100);
 assert.equal(ble.deviceOnline,false,'S-10');assert.equal(ble.reason,'invalid_hsp_sample','S-10');
 // 未知 transport 没有可确证的来源：只能标 unknown，不能标 serial（否则历史与报告会把无线帧记成串口）。
 assert.equal(ble.source,'unknown','S-10 回归：非法运输方式不得冒充串口来源');
 assert.throws(()=>hspSource('ble'),/invalid_hsp_transport/);
 // 直采取值在决策落地前被明确拒绝，而不是静默降级为另一个来源。
 assert.throws(()=>hspSource('dayu-direct'),/invalid_hsp_transport/);
 const staleHttp=hspSnapshot({receivedAt:100000,transport:'http',frame:base()},120000);
 assert.equal(staleHttp.reason,'telemetry_stale');
 assert.equal(staleHttp.source,'http','超时帧保留可确证的真实来源');
});

test('裁剪向量 §4：T-01~T-04 白名单、残值置空与重复帧不刷新',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-vectors-')),file=path.join(dir,'sample.json');
 let time=5000,data=withFrame({wifi_ssid:'HomeNet',wifi_ip:'192.168.1.100',nfc_text:'x',page:3,trend:'up'}),fail=false;
 const options={ip:'192.168.1.100',file,now:()=>time,fetchFn:async()=>{if(fail)throw Error('offline');return new Response(JSON.stringify(data));}};
 try{
  const reader=await new HspHttpReader(options).open();
  assert.equal((await reader.poll()).accepted,true,'T-01');
  const stored=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(Object.keys(stored.frame).sort(),['co2Ppm','co2Valid','coPpm','coValid','controlSupported','deviceId','gas_mv','gas_ok','gas_raw','humidity10','schemaVersion','simulated','temperature10','th_ok','th_sample_age_ms','gas_sample_age_ms','uptime_ms'].sort(),'T-01 只保留契约字段');

  data={...base(),uptime_ms:2,th_ok:false,temperature10:0,humidity10:0};
  time+=10;assert.equal((await reader.poll()).accepted,true,'T-02');
  const climate=JSON.parse(await readFile(file,'utf8'));
  assert.equal(climate.frame.temperature10,null,'T-02 残值必须置空');assert.equal(climate.frame.humidity10,null,'T-02');

  data={...base(),uptime_ms:3,gas_ok:false,gas_raw:0,gas_mv:0};
  time+=10;assert.equal((await reader.poll()).accepted,true,'T-03');
  const adc=JSON.parse(await readFile(file,'utf8'));
  assert.equal(adc.frame.gas_raw,null,'T-03');assert.equal(adc.frame.gas_mv,null,'T-03');

  const before=await readFile(file,'utf8');
  time+=10;assert.deepEqual(await reader.poll(),{accepted:false,duplicate:true},'T-04');
  assert.equal(await readFile(file,'utf8'),before,'T-04 重复帧不刷新落盘内容');
  fail=true;await assert.rejects(reader.poll(),/offline/,'T-05 失败不产生记录');
  assert.equal(await readFile(file,'utf8'),before,'T-05 失败不覆盖最后样本');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('文件与未知路径不泄漏来源错标',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-vectors-')),file=path.join(dir,'missing.json');
 try{
  assert.equal((await readHspTelemetry(file,100000)).reason,'hardware_not_connected');
  await writeFile(file,JSON.stringify({receivedAt:100000,transport:'http',frame:base()}));
  const live=await readHspTelemetry(file,100100);
  assert.equal(live.source,'http');assert.equal(live.values.temperatureC,25.6);
  await writeFile(file,'{');
  const broken=await readHspTelemetry(file,100100);
  assert.equal(broken.reason,'hardware_read_failed');
  assert.equal(broken.source,'unknown','损坏的无线样本来源未知，不得记成串口');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('来源标签端到端 §6：unknown 来源可以通过历史持久化与报告生成，不得被写回串口',async()=>{
 const {AnalysisHistory}=await import('../analysis-history.mjs');
 const {createRealReport}=await import('../report.mjs');
 const reportWith=snapshot=>createRealReport({current:{schemaVersion:1,mode:'hardware',simulated:false,gatewayNow:100100,hardware:snapshot},generatedAt:100100}).report.current.hardware.source;
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-vectors-')),file=path.join(dir,'history.jsonl');
 try{
  const unknownSnapshot=hspSnapshot({receivedAt:100000,transport:'ble',frame:base()},100100);
  assert.equal(unknownSnapshot.source,'unknown');
  const analysis={mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:'离线',findings:[],unknowns:[],provider:'deepseek',model:'test',analyzedAt:100000,observation:unknownSnapshot,observationReceivedAt:null,observationAgeMs:null,observationStale:true,deviceOnline:false,toolTrace:[]};
  const store=await new AnalysisHistory(file).open();
  assert.equal(await store.append('离线分析',analysis),1,'未知来源的分析必须能落盘');
  assert.equal(store.read().items[0].analysis.observation.source,'unknown','历史不得把未知来源改写为串口');
  assert.equal(reportWith(unknownSnapshot),'unknown','报告不得把未知来源改写为串口');
  const serial=hspSnapshot({receivedAt:100000,frame:base()},100100);
  assert.equal(reportWith(serial),'serial','可确证串口来源保持原样');
 }finally{await rm(dir,{recursive:true,force:true});}
});
