import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HardwareHistory} from '../hardware-history.mjs';
import {startDemo} from '../runtime.mjs';
const sample=receivedAt=>({receivedAt,frame:{schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:receivedAt,th_ok:true,temperature10:253,humidity10:621,gas_ok:true,gas_raw:550,gas_mv:967,th_sample_age_ms:100,gas_sample_age_ms:200,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false}});

test('真实采集历史落盘、去重、重启校验；历史不冒充当前观测',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-real-history-')),file=path.join(dir,'history.jsonl'),latest=path.join(dir,'sample.json');
 try{
  const store=await new HardwareHistory(file).open();assert.equal(await store.collect(latest,100000),false);
  const fixture=sample(100000);fixture.frame.unexpectedSecret='must-not-persist';await writeFile(latest,JSON.stringify(fixture));
  assert.deepEqual(await Promise.all([store.collect(latest,100100),store.collect(latest,100100)]),[true,false]);
  let response=store.read();assert.equal(response.storage.records,1);assert.equal(response.isCurrent,false);assert.equal(response.historical,true);assert.equal(response.items[0].observation.values.temperatureC,25.3);assert.equal(response.items[0].observation.admission,'unknown_denied');
  assert.ok(!(await readFile(file,'utf8')).includes('must-not-persist'));
  const restored=await new HardwareHistory(file).open();assert.equal(await restored.collect(latest,100200),false);
  await writeFile(latest,JSON.stringify(sample(102000)));assert.equal(await restored.collect(latest,102100),true);
  response=restored.read({beforeSeq:2});assert.deepEqual(response.items.map(row=>row.seq),[1]);assert.equal(restored.read().storage.records,2);
  assert.throws(()=>restored.read({limit:201}),/invalid_history_query/);
  const text=await readFile(file,'utf8');await writeFile(file,text.replace('253','254'));await assert.rejects(new HardwareHistory(file).open(),/integrity/);
  await writeFile(file,text.slice(0,-1));await assert.rejects(new HardwareHistory(file).open(),/incomplete/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('过期、未来、模拟或损坏采样不保存；存储失败明确不健康',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-real-history-')),file=path.join(dir,'history.jsonl'),latest=path.join(dir,'sample.json');
 try{
  const store=await new HardwareHistory(file).open();
  for(const [value,now] of [[sample(100000),110000],[sample(100000),99999],[{...sample(100000),frame:{...sample(100000).frame,simulated:true}},100100]]){
   await writeFile(latest,JSON.stringify(value));assert.equal(await store.collect(latest,now),false);
  }
  await writeFile(latest,'{');assert.equal(await store.collect(latest,100100),false);assert.equal(store.status().records,0);assert.equal(store.status().healthy,true);
  await writeFile(latest,JSON.stringify(sample(100000)));await mkdir(file);
  await assert.rejects(store.collect(latest,100100));assert.equal(store.status().healthy,false);assert.equal(store.status().records,0);
  await assert.rejects(store.collect(latest,100100),/unavailable/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('正式服务采集历史：启动落盘、只读查询、失联保留历史而非当前',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-real-history-api-')),file=path.join(dir,'history.jsonl'),hardwareFile=path.join(dir,'sample.json');let r;
 try{
  const input=sample(Date.now());input.frame.uptime_ms=20000;await writeFile(hardwareFile,JSON.stringify(input));
  const historyStore=await new HardwareHistory(file).open();
  r=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,hardwareFile,historyStore});
  const base=`http://127.0.0.1:${r.httpPort}`;
  const get=pathname=>fetch(base+pathname);
  let result=await get('/api/hardware/history?limit=50').then(response=>response.json());
  assert.equal(result.storage.records,1);assert.equal(result.historical,true);assert.equal(result.isCurrent,false);assert.equal(result.items[0].observation.values.temperatureC,25.3);
  for(const query of ['limit=201','limit=-1','limit=abc','beforeSeq=0'])assert.equal((await get('/api/hardware/history?'+query)).status,400);
  await writeFile(hardwareFile,JSON.stringify({...input,receivedAt:Date.now()-10001}));
  assert.equal((await get('/api/observations').then(response=>response.json())).hardware.deviceOnline,false);
  result=await get('/api/hardware/history').then(response=>response.json());assert.equal(result.items[0].observation.values.temperatureC,25.3);assert.equal(result.items[0].isCurrent,false);assert.equal(result.storage.records,1);
  await r.close();r=null;assert.equal((await new HardwareHistory(file).open()).status().records,1);
 }finally{await r?.close();await rm(dir,{recursive:true,force:true});}
});

test('采集历史文件运行中被截断时冻结记录，不误报新样本已保存',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-real-history-change-')),file=path.join(dir,'history.jsonl'),latest=path.join(dir,'sample.json');
 try{
  const store=await new HardwareHistory(file).open();await writeFile(latest,JSON.stringify(sample(100000)));await store.collect(latest,100100);
  await writeFile(file,'');await writeFile(latest,JSON.stringify(sample(102000)));
  await assert.rejects(store.collect(latest,102100),/file_changed/);assert.equal(store.status().healthy,false);assert.equal(store.status().records,1);assert.equal(await readFile(file,'utf8'),'');
 }finally{await rm(dir,{recursive:true,force:true});}
});
