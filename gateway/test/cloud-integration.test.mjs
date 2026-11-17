import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {CloudSecurity} from '../cloud-security.mjs';
import {startCloudServer} from '../cloud-server.mjs';
const token='only_a_test_device_token_01234567890123456789',tokenB='only_b_test_device_token_01234567890123456789';
const digest=s=>createHash('sha256').update(s).digest('hex');
function nativeServices(port){
 const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
 const ts=require(path.join(root,'openharmony/node_modules/@ohos/hvigor/node_modules/typescript/lib/typescript.js')),cache=new Map();
 const localOrigin='http://127.0.0.1:'+port,store=new Map();
 const preferences={getPreferences:async()=>({get:async(key,fallback)=>store.get(key)??fallback,put:async(key,value)=>store.set(key,value),flush:async()=>{}})};
 const http={RequestMethod:{POST:'POST',GET:'GET'},HttpDataType:{STRING:0},createHttp:()=>({async request(url,options){
  assert.ok(url.startsWith('https://cloud.test/')||url.startsWith(localOrigin+'/'));
  const response=await fetch(url.replace(/^https:\/\/cloud\.test/,localOrigin),{method:options.method,headers:options.header,body:options.extraData});return {responseCode:response.status,result:await response.text()};
 },destroy(){}})};
 const load=file=>{if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const scoped=name=>name==='@ohos.net.http'?{default:http}:name==='@ohos.util'?{default:{TextEncoder:class{encodeInto(s){return new TextEncoder().encode(s);}}}}:name==='@ohos.data.preferences'?{default:preferences}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ets')):(()=>{throw Error('unmocked dependency');})();
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(scoped,module,module.exports);return module.exports;
 };
 const services=path.join(root,'openharmony/entry/src/main/ets/services');
 return {client:new (load(path.join(services,'CloudUpload.ets')).CloudUpload)(),Queue:load(path.join(services,'OfflineQueue.ets')).OfflineQueue};
}
const nativeUploader=port=>nativeServices(port).client;
const upload=(gatewayId='dayu-a',uptime=100,temperature10=256)=>({schemaVersion:1,gatewayId,sessionBootId:'test-boot',sampleAgeMs:100,frame:{schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,controlSupported:false,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,uptime_ms:uptime,th_ok:true,gas_ok:true,temperature10,humidity10:638,gas_raw:1234,gas_mv:3210,th_sample_age_ms:100,gas_sample_age_ms:100}});
test('Web manual crop review -> actual ArkTS authenticated inbox, crop-only and cross-device isolation',async t=>{
 const h=await setup(t),admin=await h.login();
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHDsAAAAASUVORK5CYII=';
 const image=category=>({category,label:'synthetic crop collaboration',capturedAt:1000,authorized:true,base64:png});
 const crop=await(await h.request('/admin-api/media?gatewayId=dayu-a',{headers:admin,body:image('crop')})).json();
 await h.request('/admin-api/media?gatewayId=dayu-a',{headers:admin,body:image('person')});
 const saved=await h.request('/admin-api/crop-reviews?gatewayId=dayu-a',{headers:admin,body:{mediaId:crop.item.mediaId,expectedRevision:0,status:'confirmed',plot:'synthetic plot',note:'Synthetic manual review only',regions:[{x:10,y:10,width:20,height:20}]}});assert.equal(saved.status,200);
 const a=nativeUploader(h.runtime.port);a.configure('https://cloud.test','dayu-a',token);const result=await a.readCropReviews();assert.equal(result.items.length,1);assert.equal(result.items[0].mediaId,crop.item.mediaId);assert.equal(result.items[0].source,'manual');assert.equal(result.items[0].status,'confirmed');
 const b=nativeUploader(h.runtime.port);b.configure('https://cloud.test','dayu-b',tokenB);assert.equal((await b.readCropReviews()).items.length,0);
 await h.runtime.close();await h.start();const restored=nativeUploader(h.runtime.port);restored.configure('https://cloud.test','dayu-a',token);assert.equal((await restored.readCropReviews()).items[0].revision,1);
});
async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-cloud-integration-'));let runtime;const modelRequests=[];
 t.after(async()=>{await runtime?.close();await rm(dir,{recursive:true,force:true});});
 const password='test-password-only-12345',passwordHash=await CloudSecurity.hashPassword(password);
 const options={dataDir:dir,publicOrigin:'http://127.0.0.1:0',users:[{username:'admin',role:'admin',passwordHash},{username:'reader',role:'viewer',passwordHash}],devices:[{gatewayId:'dayu-a',tokenSha256:digest(token)},{gatewayId:'dayu-b',tokenSha256:digest(tokenB)}],fetchFn:async(_url,opts)=>{
  modelRequests.push(JSON.parse(opts.body));return Response.json({choices:[{message:{tool_calls:[{function:{name:'analyze_observations',arguments:JSON.stringify({summary:'test-only analysis',findings:[],unknowns:[]})}}]}}]});
 }};
 const start=async()=>{runtime=await startCloudServer(options);return runtime;};await start();
 const request=async(route,{body,headers={},method=body===undefined?'GET':'POST'}={})=>fetch('http://127.0.0.1:'+runtime.port+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const login=async(username='admin')=>{const response=await request('/admin-api/session/login',{body:{username,password},headers:{origin:runtime.publicOrigin}});assert.equal(response.status,200);const session=await response.json();return {cookie:response.headers.get('set-cookie').split(';')[0],'x-pengan-csrf':session.csrfToken,origin:runtime.publicOrigin};};
 const deviceHeaders=(gatewayId='dayu-a',bearer=token)=>({authorization:'Bearer '+bearer,'x-pengan-gateway-id':gatewayId,'x-pengan-sent-at':String(Date.now())});
 return {dir,options,request,login,deviceHeaders,modelRequests,start,get runtime(){return runtime;}};
}

test('cloud login, role/CSRF, device scopes, latest upload and persisted complete pagination',async t=>{
 const h=await setup(t);assert.equal((await h.request('/api/observations')).status,401);
 await assert.rejects(startCloudServer(h.options),/cloud_writer_lock_unavailable/);
 await assert.rejects(startCloudServer({...h.options,dataDir:path.resolve('tmp/forbidden-cloud-data')}),/cloud_data_outside_project_required/);
 const admin=await h.login(),reader=await h.login('reader');
 assert.equal((await h.request('/api/observations',{headers:admin})).status,400); // multi-device selection required
 assert.equal((await h.request('/api/agent/config',{body:{provider:'deepseek',model:'deepseek-chat',key:'test-key-only'},headers:reader})).status,403);
 assert.equal((await h.request('/api/agent/config',{body:{},headers:{cookie:admin.cookie,origin:admin.origin}})).status,403);
 assert.equal((await h.request('/api/v1/telemetry/current',{body:upload(),headers:h.deviceHeaders('dayu-a',tokenB)})).status,401);
 const first=await h.request('/api/v1/telemetry/current',{body:upload(),headers:h.deviceHeaders()});assert.equal(first.status,200);
 assert.equal((await h.request('/api/v1/telemetry/current',{body:upload('dayu-b',100,812),headers:h.deviceHeaders('dayu-b',tokenB)})).status,200);
 const obs=await (await h.request('/api/observations?gatewayId=dayu-a',{headers:reader})).json();assert.equal(obs.hardware.values.temperatureC,25.6);assert.equal(obs.hardware.source,'dayu-direct');
 await h.request('/api/v1/telemetry/current',{body:upload(),headers:h.deviceHeaders()});
 let rows=await (await h.request('/api/hardware/history?gatewayId=dayu-a',{headers:reader})).json();assert.equal(rows.items.length,1);
 for(let i=101;i<106;i++)assert.equal((await h.request('/api/v1/telemetry/current',{body:upload('dayu-a',i),headers:h.deviceHeaders()})).status,200);
 rows=await (await h.request('/api/hardware/history?gatewayId=dayu-a&limit=2',{headers:reader})).json();assert.equal(rows.items.length,2);assert.ok(rows.nextBeforeSeq);
 const older=await (await h.request('/api/hardware/history?gatewayId=dayu-a&limit=2&beforeSeq='+rows.nextBeforeSeq,{headers:reader})).json();assert.ok(older.items.every(r=>r.seq<rows.items.at(-1).seq));
 const oldCookie=admin.cookie;await h.runtime.close();await h.start();
 assert.equal((await h.request('/api/health',{headers:{cookie:oldCookie}})).status,401);
 const renewed=await h.login();rows=await (await h.request('/api/hardware/history?gatewayId=dayu-a',{headers:renewed})).json();assert.equal(rows.items.length,6);
 const audit=await (await h.request('/admin-api/audit',{headers:renewed})).json();assert.ok(audit.items.some(r=>r.data.event==='login_success'));
 assert.equal((await h.request('/admin-api/audit',{headers:{cookie:reader.cookie}})).status,401);
 const disk=await readFile(path.join(h.dir,'history.jsonl'),'utf8');assert.ok(!disk.includes(token));assert.ok(!disk.includes('test-password-only'));
});

test('device analysis and Web AI history use the same device observation; model is an explicit stub',async t=>{
 const h=await setup(t),admin=await h.login();
 assert.equal((await h.request('/api/agent/config',{body:{provider:'deepseek',model:'deepseek-chat',key:'test-key-only'},headers:admin})).status,200);
 await h.request('/api/v1/telemetry/current',{body:upload(),headers:h.deviceHeaders()});
 await h.request('/api/v1/telemetry/current',{body:upload('dayu-b',100,812),headers:h.deviceHeaders('dayu-b',tokenB)});
 const response=await h.request('/api/v1/device/analyze',{body:{prompt:'test-only device-a question'},headers:h.deviceHeaders()});
 const analysis=await response.json();assert.equal(response.status,200,JSON.stringify(analysis));assert.equal(analysis.gatewayId,'dayu-a');assert.equal(analysis.persistence.saved,true);assert.equal(analysis.observation.values.temperatureC,25.6);
 assert.ok(!JSON.stringify(h.modelRequests).includes('81.2'));
 const a=await (await h.request('/api/agent/history?gatewayId=dayu-a',{headers:admin})).json(),b=await (await h.request('/api/agent/history?gatewayId=dayu-b',{headers:admin})).json();
 assert.equal(a.items.length,1);assert.equal(b.items.length,0);
});

test('actual native upload service -> real HTTP server -> model stub -> authenticated Web history',async t=>{
 const h=await setup(t),admin=await h.login(),client=nativeUploader(h.runtime.port);
 await h.request('/api/agent/config',{body:{provider:'deepseek',model:'deepseek-chat',key:'test-key-only'},headers:admin});
 client.configure('https://cloud.test','dayu-a',token);const b=upload();
 await client.upload({sessionBootId:b.sessionBootId,sampleAgeMs:b.sampleAgeMs,frameJson:JSON.stringify(b.frame)});
 const analysis=await client.analyze('native integration test',b.sessionBootId);assert.equal(analysis.persistence.saved,true);
 const history=await (await h.request('/api/agent/history?gatewayId=dayu-a',{headers:admin})).json();assert.equal(history.items[0].prompt,'native integration test');
 client.clear();await assert.rejects(client.analyze('test',b.sessionBootId),/未配置/);
});

test('native general agriculture answer shares only the question even when cloud telemetry is fresh',async t=>{
 const h=await setup(t),admin=await h.login(),client=nativeUploader(h.runtime.port);
 await h.request('/api/agent/config',{body:{provider:'deepseek',model:'deepseek-chat',key:'test-key-only'},headers:admin});
 await h.request('/api/v1/telemetry/current',{body:upload(),headers:h.deviceHeaders()});
 client.configure('https://cloud.test','dayu-a',token);
 const question='synthetic crop-care question';
 const analysis=await client.analyze(question,'',true);
 assert.equal(analysis.generalOnly,true);assert.equal(analysis.observationReceivedAt,null);assert.equal(analysis.observation,null);
 assert.deepEqual(JSON.parse(h.modelRequests.at(-1).messages[1].content),{request:question});
 assert.deepEqual(h.modelRequests.at(-1).tools.map(t=>t.function.name),['analyze_observations']);
 const history=await client.readHistory('analysis');assert.match(history.rows[0],/未使用现场读数或历史/);
});

test('local HTTP demo uses the real ArkTS queue and uploads telemetry visible in the Web session',async t=>{
 const h=await setup(t),admin=await h.login(),{client,Queue}=nativeServices(h.runtime.port);
 client.configure(h.runtime.publicOrigin,'dayu-a',token);
 const q=new Queue();await q.open({});
 const body=upload(),sample={sessionBootId:body.sessionBootId,sampleAgeMs:body.sampleAgeMs,frameJson:JSON.stringify(body.frame)};
 await assert.rejects(q.enqueue(sample,'http://public.example|dayu-a'),/无效/);
 const target=client.queueTarget(),key=await q.enqueue(sample,target);
 const reopened=new Queue();await reopened.open({});assert.equal(reopened.batch(target).length,1);
 assert.match(await client.upload(sample),/确认接收/);
 await reopened.acknowledge(target,[key]);assert.equal(reopened.count(),0);
 const response=await h.request('/api/observations?gatewayId=dayu-a',{headers:admin});
 const observation=await response.json();assert.equal(response.status,200);assert.equal(observation.hardware.values.temperatureC,25.6);
});

// Both real device-history endpoints are consumed by the actual ArkTS service.
test('native authenticated history and recent export share cloud storage with Web across restart',async t=>{
 const h=await setup(t),admin=await h.login();
 await h.request('/api/agent/config',{body:{provider:'deepseek',model:'deepseek-chat',key:'test-key-only'},headers:admin});
 await h.request('/api/v1/telemetry/current',{body:upload(),headers:h.deviceHeaders()});
 await h.request('/api/v1/telemetry/current',{body:upload('dayu-b',100,812),headers:h.deviceHeaders('dayu-b',tokenB)});
 await h.request('/api/v1/device/analyze',{body:{prompt:'native history test'},headers:h.deviceHeaders()});
 const client=nativeUploader(h.runtime.port);client.configure('https://cloud.test','dayu-a',token);
 const telemetry=await client.readHistory('telemetry'),analysis=await client.readHistory('analysis');
 assert.equal(telemetry.rows.length,1);assert.match(telemetry.rows[0],/25.6℃/);assert.doesNotMatch(telemetry.rows[0],/81.2℃/);
 assert.match(analysis.rows[0],/native history test/);
 const report=JSON.parse(await client.readRecentReport());assert.equal(report.gatewayId,'dayu-a');assert.equal(report.analysis.rows.length,1);assert.equal(report.completeHistory,false);assert.equal(report.historical,true);
 const b=nativeUploader(h.runtime.port);b.configure('https://cloud.test','dayu-b',tokenB);assert.equal((await b.readHistory('analysis')).rows.length,0);
 const wire=await(await h.request('/api/v1/device/history?kind=telemetry&limit=1',{headers:h.deviceHeaders()})).json();assert.equal(wire.gatewayId,'dayu-a');
 await h.runtime.close();await h.start();
 const restarted=nativeUploader(h.runtime.port);restarted.configure('https://cloud.test','dayu-a',token);assert.equal((await restarted.readHistory('analysis')).rows.length,1);
});

test('actual native authenticated pipeline -> cloud task -> Web trace, missing gas stays blocked',async t=>{
 const h=await setup(t),admin=await h.login(),client=nativeUploader(h.runtime.port);
 await h.request('/api/agent/config',{body:{provider:'deepseek',model:'deepseek-chat',key:'test-key-only'},headers:admin});
 await h.request('/api/v1/telemetry/current',{body:upload(),headers:h.deviceHeaders()});
 client.configure('https://cloud.test','dayu-a',token);
 const result=await client.pipeline('设备缺少安全气体传感器，只检查现有数据');
 assert.equal(result.audit.verdict,'block');assert.equal(result.executed,false);assert.equal(result.calls,0);
 const list=await(await h.request('/admin-api/pipeline/tasks?gatewayId=dayu-a',{headers:admin})).json();assert.equal(list.items.length,1);
 const task=await(await h.request('/admin-api/pipeline/tasks/'+list.items[0].taskId+'?gatewayId=dayu-a',{headers:admin})).json();assert.equal(task.result.traceId,result.traceId);assert.ok(task.events.some(e=>e.type==='task_completed'));
});
