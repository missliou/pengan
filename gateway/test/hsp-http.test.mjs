import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {readHspTelemetry} from '../hsp-telemetry.mjs';
import {HspHttpReader,hspHttpUrl} from '../hsp-http.mjs';
const frame=()=>({schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,controlSupported:false,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,uptime_ms:1,th_ok:true,gas_ok:true,temperature10:253,humidity10:500,gas_raw:100,gas_mv:176,th_sample_age_ms:50,gas_sample_age_ms:50});
test('无线目标只接受明确私网IPv4，不解析任意URL或主机',()=>{
 for(const ip of ['127.0.0.1','8.8.8.8','localhost','http://192.168.1.1','192.168.1.1:80','192.168.1.1/','::1'])assert.throws(()=>hspHttpUrl(ip));
 assert.equal(hspHttpUrl('192.168.1.100'),'http://192.168.1.100/api/pengan/telemetry');
});
test('HTTP采集原子落盘白名单、保守请求时间、重复/失败不刷新且重启仍去重',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-wifi-')),file=path.join(dir,'sample.json');let time=1000,data=frame(),fail=false;
 const options={ip:'192.168.1.100',file,now:()=>time,fetchFn:async(url,init)=>{assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');time+=50;if(fail)throw Error('offline');return new Response(JSON.stringify({...data,password:'never-save'}));}};
 try{
  const reader=await new HspHttpReader(options).open();assert.equal((await reader.poll()).accepted,true);
  const first=await readFile(file,'utf8'),stored=JSON.parse(first);assert.equal(stored.receivedAt,1000);assert.equal(stored.transport,'http');assert.equal(first.includes('never-save'),false);
  assert.equal((await reader.poll()).duplicate,true);assert.equal(await readFile(file,'utf8'),first);
  const restarted=await new HspHttpReader(options).open();assert.equal((await restarted.poll()).duplicate,true);
  fail=true;await assert.rejects(reader.poll(),/offline/);assert.equal(await readFile(file,'utf8'),first);
  fail=false;data.uptime_ms=2;data.simulated=true;await assert.rejects(reader.poll(),/identity/);assert.equal(await readFile(file,'utf8'),first);
  data=frame();data.uptime_ms=0;assert.equal((await reader.poll()).accepted,true);
  data.uptime_ms=3;data.th_ok=false;data.temperature10='never-save';await reader.poll();assert.equal((await readFile(file,'utf8')).includes('never-save'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('无线响应超限、超时与取消不覆盖最后样本',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-wifi-')),file=path.join(dir,'sample.json');
 try{
  const original=JSON.stringify({receivedAt:1,frame:frame()});await writeFile(file,original);
  let now=10;const reader=await new HspHttpReader({ip:'192.168.1.100',file,now:()=>now,fetchFn:async()=>new Response('x'.repeat(4097))}).open();
  await assert.rejects(reader.poll(),/too_large/);
  reader.fetchFn=async()=>{now+=3000;return new Response(JSON.stringify(frame()));};await assert.rejects(reader.poll(),/too_slow/);
  const controller=new AbortController();controller.abort();await assert.rejects(reader.poll(controller.signal));assert.equal(await readFile(file,'utf8'),original);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('实际主机HTTP响应经无线桥入库，过期与断线不保留正常值',{timeout:10000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-wifi-http-')),file=path.join(dir,'sample.json');let broken=false;
 const server=http.createServer((req,res)=>{assert.equal(req.url,'/api/pengan/telemetry');res.setHeader('Cache-Control','no-store');res.end(broken?'invalid-json':JSON.stringify(frame()));});
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const reader=await new HspHttpReader({ip:'192.168.1.100',file,fetchFn:(_url,options)=>fetch(`http://127.0.0.1:${server.address().port}/api/pengan/telemetry`,options)}).open();
  await reader.poll();const saved=JSON.parse(await readFile(file,'utf8'));
  const live=await readHspTelemetry(file,saved.receivedAt+100);assert.equal(live.deviceOnline,true);assert.equal(live.values.temperatureC,25.3);assert.equal(live.values.coPpm,null);assert.equal(live.actuationAvailable,false);
  broken=true;await assert.rejects(reader.poll());assert.equal(JSON.parse(await readFile(file,'utf8')).receivedAt,saved.receivedAt);
  const stale=await readHspTelemetry(file,saved.receivedAt+10000);assert.equal(stale.deviceOnline,false);assert.equal(stale.values.temperatureC,null);assert.equal(stale.admission,'unknown_denied');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
