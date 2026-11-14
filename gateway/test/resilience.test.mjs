import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {CloudHistory} from '../cloud-history.mjs';import {replayHistory} from '../history-replay.mjs';import {LocalSpeech} from '../speech.mjs';
const frame={schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,controlSupported:false,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,uptime_ms:100,th_ok:true,gas_ok:true,temperature10:256,humidity10:638,gas_raw:1234,gas_mv:3210,th_sample_age_ms:100,gas_sample_age_ms:100};
test('historical replay is idempotent and never marks samples current',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-replay-'));t.after(()=>rm(dir,{recursive:true,force:true}));const history=await new CloudHistory({file:path.join(dir,'history.jsonl')}).open();
 const body={items:[{sessionBootId:'boot-1',capturedAt:100000,sampleAgeMs:100,frame}]};
 const a=await replayHistory(history,'dayu-a',body,160000),b=await replayHistory(history,'dayu-a',body,170000);assert.deepEqual(a,b);assert.equal(history.rows.length,1);assert.equal(history.rows[0].data.replayed,true);assert.equal(a.isCurrent,false);assert.equal(a.accepted[0].uptimeMs,100);
 await assert.rejects(replayHistory(history,'dayu-a',{items:[{...body.items[0],frame:{...frame,temperature10:300}}]},170000),/conflict/);
 await assert.rejects(replayHistory(history,'dayu-a',body,9*86400000),/invalid_replay/);
 await assert.rejects(replayHistory(history,'dayu-a',{items:[{...body.items[0],frame:{...frame,extra:'bad'}}]},170000));
});
function wav(){const b=Buffer.alloc(3244);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(3200,40);return b;}
test('local speech requires consent and bounded WAV, never forwards to external model',async()=>{
 assert.throws(()=>new LocalSpeech({url:'https://external.example/inference'}),/config/);let calls=0;
 const speech=new LocalSpeech({url:'http://127.0.0.1:8178/inference',fetchFn:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:8178/inference');assert.equal(options.redirect,'error');assert.equal(options.body.get('language'),'zh');assert.equal((await options.body.get('file').arrayBuffer()).byteLength,3244);return Response.json({text:'测试环境查询'});}});
 await assert.rejects(speech.transcribe({wavBase64:wav().toString('base64'),authorized:false}),/invalid/);const broken=wav();broken.writeUInt32LE(48000,24);await assert.rejects(speech.transcribe({wavBase64:broken.toString('base64'),authorized:true}),/invalid/);assert.equal(calls,0);
 const result=await speech.transcribe({wavBase64:wav().toString('base64'),authorized:true});assert.equal(result.text,'测试环境查询');assert.equal(result.requiresConfirmation,true);assert.equal(result.executed,false);assert.equal(calls,1);
 await assert.rejects(new LocalSpeech().transcribe({}),/not_configured/);
});

import {startCloudServer} from '../cloud-server.mjs';import {CloudSecurity} from '../cloud-security.mjs';import {createHash} from 'node:crypto';
test('authenticated replay HTTP never revives current device snapshot',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-replay-http-'));let runtime;t.after(async()=>{await runtime?.close();await rm(dir,{recursive:true,force:true});});
 const token='synthetic_replay_device_token_0123456789';runtime=await startCloudServer({dataDir:dir,publicOrigin:'http://127.0.0.1:0',users:[{username:'admin',role:'admin',passwordHash:await CloudSecurity.hashPassword('synthetic-test-password')}],devices:[{gatewayId:'dayu-a',tokenSha256:createHash('sha256').update(token).digest('hex')}]});
 const headers={authorization:'Bearer '+token,'x-pengan-gateway-id':'dayu-a','content-type':'application/json'};
 const route='/api/v1/telemetry/replay',request=(url,options={})=>fetch(runtime.publicOrigin+url,options);
 assert.equal((await request(route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 const item={sessionBootId:'old-boot',capturedAt:Date.now()-60000,sampleAgeMs:100,frame};
 const response=await request(route,{method:'POST',headers,body:JSON.stringify({items:[item]})});assert.equal(response.status,200);assert.equal((await response.json()).isCurrent,false);
 const current=await(await request('/api/v1/device/observations',{headers})).json();assert.equal(current.hardware.deviceOnline,false);assert.equal(runtime.ingresses.get('dayu-a').state,null);assert.equal(runtime.history.rows[0].data.replayed,true);
 assert.equal((await request('/api/v1/device/speech/status',{headers})).status,200);assert.equal((await(await request('/api/v1/device/speech/status',{headers})).json()).configured,false);
});
