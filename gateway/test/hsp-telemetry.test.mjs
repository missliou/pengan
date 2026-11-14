import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {parseHspLine,hspSnapshot,readHspTelemetry,HSP_TTL_MS} from '../hsp-telemetry.mjs';
const frame=()=>({schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:20000,th_ok:true,temperature10:253,humidity10:621,gas_ok:true,gas_raw:550,gas_mv:967,th_sample_age_ms:100,gas_sample_age_ms:200,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false});
test('HH-HSP只读遥测：身份与schema校验，单位转换，不生成气体浓度或执行权限',()=>{
 const f=frame();assert.deepEqual(parseHspLine('PENGAN_TELEMETRY '+JSON.stringify(f)),f);
 for(const patch of [{deviceId:'hsp-demo-001'},{simulated:true},{schemaVersion:2},{coValid:true},{coPpm:0},{controlSupported:true},{temperature10:900},{gas_raw:4096},{th_sample_age_ms:-1}])assert.throws(()=>parseHspLine('PENGAN_TELEMETRY '+JSON.stringify({...f,...patch})));
 assert.throws(()=>parseHspLine('ready '+JSON.stringify(f)));
 const sample=hspSnapshot({receivedAt:100000,frame:f},101000);assert.equal(sample.values.temperatureC,25.3);assert.equal(sample.values.humidityPct,62.1);assert.equal(sample.values.gasRaw,550);assert.equal(sample.values.coPpm,null);assert.equal(sample.quality.co2Valid,false);assert.equal(sample.actuationAvailable,false);assert.equal(sample.admission,'unknown_denied');assert.equal(sample.simulated,false);
});
test('HH-HSP时效：采样年龄叠加接收年龄、超时/非法帧不沿用正常值',()=>{
 const f=frame(),old=hspSnapshot({receivedAt:100000,frame:{...f,th_sample_age_ms:9500}},101000);assert.equal(old.deviceOnline,true);assert.equal(old.quality.temperatureValid,false);assert.equal(old.values.temperatureC,null);assert.equal(old.climateAgeMs,10500);
 for(const envelope of [{receivedAt:100000,frame:f},{receivedAt:200000,frame:f},{receivedAt:100000,frame:{...f,gas_raw:-1}}]){const s=hspSnapshot(envelope,100000+HSP_TTL_MS);assert.equal(s.deviceOnline,false);assert.equal(s.values.temperatureC,null);}
 const invalid=hspSnapshot({receivedAt:100000,frame:{...f,th_ok:false,gas_ok:false}},100100);assert.equal(invalid.values.gasMv,null);assert.equal(invalid.quality.temperatureValid,false);
});
test('HH-HSP文件读取：缺失/损坏/超大文件明确未知，不泄漏路径或旧值',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-hsp-')),file=path.join(dir,'latest.json');
 try{
 assert.equal((await readHspTelemetry(file,100000)).reason,'hardware_not_connected');await writeFile(file,JSON.stringify({receivedAt:100000,frame:frame()}));assert.equal((await readHspTelemetry(file,100200)).deviceOnline,true);
 await writeFile(file,'{');assert.equal((await readHspTelemetry(file,100200)).deviceOnline,false);await writeFile(file,'x'.repeat(17000));assert.equal((await readHspTelemetry(file,100200)).reason,'hardware_file_too_large');
 }finally{await rm(dir,{recursive:true,force:true});}
});
