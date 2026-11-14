import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,rename,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DayuIngress,startDayuIngressServer} from '../dayu-ingest.mjs';
const token='test_only_device_token_01234567890123456789';
const tokenSha256=createHash('sha256').update(token).digest('hex');
const body=(uptime=100,session='boot-1')=>({schemaVersion:1,gatewayId:'dayu-test',sessionBootId:session,sampleAgeMs:100,
  frame:{schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,controlSupported:false,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,
    uptime_ms:uptime,th_ok:true,gas_ok:true,temperature10:256,humidity10:638,gas_raw:1234,gas_mv:3210,th_sample_age_ms:100,gas_sample_age_ms:200}});
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'pengan-ingest-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));let now=100000;
 const options={gatewayId:'dayu-test',tokenSha256,file:path.join(dir,'latest.json'),now:()=>now};
 return {options,store:await new DayuIngress(options).open(),time:v=>now=v};}

test('authenticated sample persists without token; current snapshot ages and survives restart',async t=>{
 const {store,options,time}=await setup(t);assert.equal(store.current().hardware.deviceOnline,false);
 await assert.rejects(store.accept(body(),'wrong'),/unauthorized/);await store.accept(body(),token);
 assert.equal(store.current().hardware.source,'dayu-direct');assert.equal(store.current().hardware.values.temperatureC,25.6);
 const text=await readFile(options.file,'utf8');assert.ok(!text.includes(token));assert.ok(!text.includes(tokenSha256));
 const restored=await new DayuIngress(options).open();assert.equal((await restored.accept(body(),token)).duplicate,true);
 time(109900);assert.equal(restored.current().hardware.deviceOnline,false);assert.equal(restored.current().hardware.values.temperatureC,null);
});
test('restart, monotonic uptime, retired sessions and device partitions cannot renew prior frames',async t=>{
 const {store,options,time}=await setup(t);await store.accept(body(),token);time(102000);
 assert.equal((await store.accept(body(99),token)).duplicate,true);assert.equal(store.current().hardware.sampleAgeMs,2100);
 await store.accept(body(1,'boot-2'),token);const restored=await new DayuIngress(options).open();
 await assert.rejects(restored.accept(body(101),token),/retired_session/);
 await assert.rejects(restored.accept({...body(),gatewayId:'other'},token),/envelope/);
 time(101999);await assert.rejects(restored.accept(body(2,'boot-2'),token),/server_time/);
});
test('unknown fields, stale samples, invalid frames are rejected before persistence',async t=>{
 const {store,options}=await setup(t);
 for(const change of [b=>b.sampleAgeMs=10000,b=>b.password='forbidden',b=>b.frame.wifi_password='forbidden',b=>b.frame.coValid=true,b=>b.frame.gas_raw=4096]){
  const b=body();change(b);await assert.rejects(store.accept(b,token));
 }
 await assert.rejects(readFile(options.file),{code:'ENOENT'});
});
test('write failure does not commit in memory or acknowledge success; corruption fails closed',async t=>{
 const {store,options}=await setup(t);await store.accept(body(),token);await rename(options.file,options.file+'.backup');await mkdir(options.file);
 await assert.rejects(store.accept(body(101),token),/write_failed/);assert.equal(store.state.frame.uptime_ms,100);
 await rm(options.file,{recursive:true});await writeFile(options.file,'{broken');
 const broken=new DayuIngress(options);await assert.rejects(broken.open(),/state_unavailable/);assert.throws(()=>broken.current(),/not_ready/);
});
test('HTTP listener authenticates, bounds body, rejects browser origins, and has no public reads',async t=>{
 const {store}=await setup(t),server=await startDayuIngressServer(store);t.after(()=>new Promise(resolve=>server.close(resolve)));
 assert.equal(server.address().address,'127.0.0.1');const url=`http://127.0.0.1:${server.address().port}/api/v1/telemetry/current`;
 const post=(value,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'x-pengan-sent-at':'100000',...headers},body:typeof value==='string'?value:JSON.stringify(value)});
 assert.equal((await post(body(),{authorization:'Bearer wrong'})).status,401);
 assert.equal((await post(body(),{origin:'https://example.invalid'})).status,403);
 assert.equal((await post('x'.repeat(4097))).status,413);assert.equal((await post('{')).status,400);
 assert.equal((await post(body(),{'x-pengan-sent-at':'90000'})).status,409);
 assert.equal((await fetch(url)).status,404);assert.equal((await post(body())).status,200);
 assert.equal(store.current().hardware.sampleAgeMs,1100);
 assert.equal((await (await post(body())).json()).duplicate,true);
});
