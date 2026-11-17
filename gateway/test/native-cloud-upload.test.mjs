import {test} from 'node:test';
import {AgentPipeline} from '../agent-pipeline.mjs';
import {summarizeWeather} from '../weather.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const ts=require(path.join(root,'openharmony/node_modules/@ohos/hvigor/node_modules/typescript/lib/typescript.js'));
function host({createFailures=0,destroyFailures=0}={}){let response={responseCode:200,result:JSON.stringify({schemaVersion:1,accepted:true,duplicate:false})};const calls=[],cache=new Map();
 const http={RequestMethod:{POST:'POST',GET:'GET'},HttpDataType:{STRING:0},createHttp:()=>{if(createFailures-->0)throw Error('os_create_failure');return {request:async(url,options)=>{calls.push({url,options});return typeof response==='function'?response(url,options):response;},destroy(){if(destroyFailures-->0)throw Error('os_destroy_failure');}};}};
 function load(file){if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const req=n=>n==='@ohos.net.http'?{default:http}:n==='@ohos.util'?{default:{TextEncoder:class{encodeInto(v){return new TextEncoder().encode(v);}}}}:n==='@ohos.data.preferences'?{default:{}}:load(path.resolve(path.dirname(file),n+'.ets'));
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(req,m,m.exports);return m.exports;}
 const {CloudUpload,CloudSample}=load(path.join(root,'openharmony/entry/src/main/ets/services/CloudUpload.ets'));return {CloudUpload,CloudSample,calls,respond:v=>response=v};}
const token='test_only_token_not_real_01234567890123456789';
test('native weather advice requires scoped saved read-only acknowledgement',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 const d={schemaVersion:1,kind:'weather_advice',gatewayId:'dayu-test',readOnly:true,executed:false,requiresHumanConfirmation:true,summary:'人工检查保温',checks:[{title:'检查覆盖物',reason:'室外低温预报'}],limitations:['棚内数据未知'],sourceHash:'a'.repeat(64),persistence:{saved:true,recordId:42},evidence:{fetchedAt:Date.now(),expiresAt:Date.now()+1800000}};
 h.respond({responseCode:200,result:JSON.stringify(d)});assert.match(await u.generateWeatherAdvice('番茄如何防冻'),/审计记录 #42/);assert.equal(JSON.parse(h.calls.at(-1).options.extraData).question,'番茄如何防冻');
 for(const change of [{executed:true},{gatewayId:'other'},{persistence:{saved:false,recordId:42}},{evidence:{expiresAt:0}}]){h.respond({responseCode:200,result:JSON.stringify({...d,...change})});await assert.rejects(u.generateWeatherAdvice('核查'))};
});

test('native authenticated weather rejects invalid scope, expiry and unsafe summaries',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 const now=Date.now(),base=Math.floor(now/3600000)*3600;
 const raw={hourly_units:{time:'unixtime',temperature_2m:'°C',precipitation:'mm',wind_gusts_10m:'m/s',snowfall:'cm',weather_code:'wmo code'},hourly:{time:Array.from({length:48},(_,i)=>base+i*3600),temperature_2m:Array(48).fill(1),precipitation:Array(48).fill(0),wind_gusts_10m:Array(48).fill(3),snowfall:Array(48).fill(0),weather_code:Array(48).fill(0)}};
 const d={...summarizeWeather(raw,now),gatewayId:'dayu-test'};h.respond({responseCode:200,result:JSON.stringify(d)});assert.equal((await u.readWeather()).risks[0].code,'frost');assert.match(h.calls.at(-1).url,/device\/weather$/);
 for(const change of [{gatewayId:'other'},{officialWarning:true},{hardwareControl:true},{available:false},{expiresAt:now-1},{summary:{...d.summary,maxGustMs:-1}}]){h.respond({responseCode:200,result:JSON.stringify({...d,...change})});await assert.rejects(u.readWeather());}
});
test('native crop inbox reads authenticated historical manual summaries and rejects forged scopes/sources',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 const item={mediaId:'12345678-1234-1234-1234-123456789abc',label:'synthetic crop',capturedAt:1000,status:'suspected',revision:1,plot:'第3垄',note:'人工观察，待复核',source:'manual',reviewedAt:2000,regionCount:1};
 const reply={schemaVersion:1,gatewayId:'dayu-test',readOnly:true,historical:true,isCurrent:false,multispectralConnected:false,indicesAvailable:false,scope:'latest-10-crop-images',readAt:3000,items:[item]};
 const respond=v=>h.respond({responseCode:200,result:JSON.stringify(v)});
 respond(reply);assert.equal((await u.readCropReviews()).items[0].status,'suspected');assert.equal(h.calls[0].url,'https://cloud.example/api/v1/device/crop-reviews');assert.equal(h.calls[0].options.method,'GET');
 for(const patch of [{gatewayId:'other'},{readOnly:false},{multispectralConnected:true},{items:[item,item]},{items:[{...item,source:'AI'}]},{items:[{...item,reviewedAt:4000}]},{items:[{...item,status:'healthy'}]},{items:[{...item,note:''}]}]){respond({...reply,...patch});await assert.rejects(u.readCropReviews());}
 respond({...reply,items:[{...item,revision:0,status:'unreviewed',source:'none',reviewedAt:null,regionCount:0,note:'',plot:''}]});assert.equal((await u.readCropReviews()).items[0].source,'none');
});
test('native photo archive requires explicit authorization and verifies scoped 201 receipt',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 const capturedAt=1000,reply={saved:true,item:{mediaId:'12345678-1234-1234-1234-123456789abc',gatewayId:'dayu-test',category:'crop',label:'test crop',capturedAt,bytes:100,mime:'image/jpeg',sha256:'a'.repeat(64)}};
 await assert.rejects(u.savePhoto('aGVsbG8=','crop','test crop',capturedAt,false,'photo-1'),/授权/);assert.equal(h.calls.length,0);
 h.respond({responseCode:201,result:JSON.stringify(reply)});
 assert.equal((await u.savePhoto('aGVsbG8=','crop','test crop',capturedAt,true,'photo-1')).mediaId,reply.item.mediaId);
 const call=h.calls[0],body=JSON.parse(call.options.extraData);assert.equal(call.url,'https://cloud.example/api/v1/device/media');assert.equal(call.options.readTimeout,35000);assert.equal(body.uploadId,'photo-1');assert.equal(body.authorized,true);assert.equal(Object.hasOwn(body,'frame'),false);
 for(const patch of [{gatewayId:'other'},{category:'person'},{capturedAt:2000},{mime:'text/html'},{sha256:'bad'}]){h.respond({responseCode:201,result:JSON.stringify({...reply,item:{...reply.item,...patch}})});await assert.rejects(u.savePhoto('aGVsbG8=','crop','test crop',capturedAt,true,'photo-1'),/协议/);}
 h.respond({responseCode:201,result:JSON.stringify({...reply,item:{...reply.item,category:'person'}})});assert.equal((await u.savePhoto('aGVsbG8=','person','test crop',capturedAt,true,'photo-2')).category,'person');
});
function sample(h){const s=new h.CloudSample();s.sessionBootId='boot-1';s.sampleAgeMs=500;s.frameJson='{"uptime_ms":100}';return s;}
test('native uploader restricts plaintext HTTP to private LAN and still sends bounded authenticated fixed-path request',async()=>{const h=host(),u=new h.CloudUpload();
 assert.throws(()=>u.configure('http://8.8.8.8','dayu-test',token),/HTTPS/);assert.throws(()=>u.configure('http://pengan.example.com','dayu-test',token),/HTTPS/);
 u.configure('http://192.168.1.20:5201','dayu-test',token);assert.equal(u.demoTlsBypass(),true);u.clear();
 u.configure('https://cloud.example','dayu-test',token);assert.equal(u.demoTlsBypass(),false);assert.match(await u.upload(sample(h)),/确认接收/);const c=h.calls[0];assert.equal(c.url,'https://cloud.example/api/v1/telemetry/current');assert.equal(c.options.header.Authorization,'Bearer '+token);assert.equal(c.options.header['X-Pengan-Gateway-Id'],'dayu-test');assert.equal(c.options.maxRedirects,0);assert.equal(c.options.readTimeout,3000);assert.equal(JSON.parse(c.options.extraData).sampleAgeMs,500);});
test('stale frame, bad receipt and old context do not report upload success',async()=>{const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);const s=sample(h);s.sampleAgeMs=8000;await assert.rejects(u.upload(s));assert.equal(h.calls.length,0);h.respond({responseCode:200,result:'{"ok":true}'});await assert.rejects(u.upload(sample(h)),/回执/);let resolve;h.respond(new Promise(r=>resolve=r));const pending=u.upload(sample(h));u.invalidate();resolve({responseCode:200,result:'{"schemaVersion":1,"accepted":true,"duplicate":false}'});await assert.rejects(pending,/上下文/);u.clear();assert.equal(u.configured(),false);});
test('physical requests remain serialized across invalidation',async()=>{const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);let resolve;h.respond(new Promise(r=>resolve=r));const pending=u.upload(sample(h));u.invalidate();await assert.rejects(u.upload(sample(h)),/仍在进行/);resolve({responseCode:500,result:'{}'});await assert.rejects(pending);assert.equal(h.calls.length,1);});
test('analysis rejects different registered device or online session',async()=>{const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);const result={gatewayId:'other',sessionBootId:'boot-1',mode:'hardware',simulated:false,executed:false,hardwareControl:false,realAdmission:'unknown_denied',summary:'summary',findings:[],unknowns:[],provider:'deepseek',model:'deepseek-chat',deviceOnline:true};h.respond({responseCode:200,result:JSON.stringify(result)});await assert.rejects(u.analyze('question','boot-1'),/协议/);result.gatewayId='dayu-test';h.respond({responseCode:200,result:JSON.stringify(result)});await assert.rejects(u.analyze('question','boot-2'),/会话/);assert.equal((await u.analyze('question','boot-1')).summary,'summary');});
test('synthetic connection test requires device identity and proves no environment/image transmission',async()=>{const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);const result={gatewayId:'dayu-test',kind:'model_connection_check',ok:true,provider:'deepseek',model:'deepseek-chat',checkedAt:1000,roundTripMs:2,fieldDataSent:false,imageSent:false,executed:false};h.respond({responseCode:200,result:JSON.stringify(result)});assert.equal((await u.testModel()).ok,true);assert.equal(h.calls[0].url,'https://cloud.example/api/v1/device/test');assert.equal(h.calls[0].options.extraData,'{}');assert.equal(h.calls[0].options.readTimeout,35000);result.fieldDataSent=true;h.respond({responseCode:200,result:JSON.stringify(result)});await assert.rejects(u.testModel(),/协议/);});
test('photo analysis uses isolated device endpoint, validates bounds and no action proof',async()=>{const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);await assert.rejects(u.inspectImage('bad'));assert.equal(h.calls.length,0);const result={gatewayId:'dayu-test',mode:'hardware',kind:'crop_image_analysis',source:'user_photo',simulated:false,executed:false,hardwareControl:false,realAdmission:'unknown_denied',steps:[],imageSha256:'a'.repeat(64),analyzedAt:1000,provider:'qwen',model:'qwen-vl-plus',summary:'visible phenomena',findings:[],unknowns:[]};h.respond({responseCode:200,result:JSON.stringify(result)});assert.equal((await u.inspectImage('aGVsbG8=')).summary,result.summary);assert.equal(h.calls[0].url,'https://cloud.example/api/v1/device/inspect-image');assert.equal(h.calls[0].options.readTimeout,35000);const body=JSON.parse(h.calls[0].options.extraData);assert.equal(body.mimeType,'image/jpeg');assert.equal(Object.hasOwn(body,'frame'),false);result.gatewayId='other';h.respond({responseCode:200,result:JSON.stringify(result)});await assert.rejects(u.inspectImage('aGVsbG8='),/协议/);});
test('analysis rejects missing local session and oversized provider lists',async()=>{const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);const result={gatewayId:'dayu-test',sessionBootId:'boot-1',mode:'hardware',simulated:false,executed:false,hardwareControl:false,realAdmission:'unknown_denied',summary:'summary',findings:[],unknowns:[],provider:'deepseek',model:'deepseek-chat',deviceOnline:true};h.respond({responseCode:200,result:JSON.stringify(result)});await assert.rejects(u.analyze('question'),/会话/);for(const changes of [{findings:Array(11).fill('x')},{unknowns:Array(13).fill('x')},{findings:['x'.repeat(1001)]}]){h.respond({responseCode:200,result:JSON.stringify({...result,...changes})});await assert.rejects(u.analyze('question','boot-1'),/限制/);}});

function historyPage(kind = 'telemetry') {
  const storage = {enabled:true,healthy:true,records:3,bytes:100,maxBytes:10000,scope:'retained-file',externalCompletenessVerified:false};
  const observation = {schemaVersion:1,deviceId:'hh-hsp101-001',source:'dayu-direct',simulated:false,deviceOnline:true,actuationAvailable:false,controlSupported:false,admission:'unknown_denied',receivedAt:1000,sampleAgeMs:1200,climateAgeMs:1500,gasAgeMs:1700,
    quality:{temperatureValid:true,humidityValid:true,gasValid:true,coValid:false,co2Valid:false},values:{temperatureC:25.6,humidityPct:48.2,gasRaw:812,gasMv:640,coPpm:null,co2Ppm:null}};
  const analysis = {mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:'test-only summary',findings:[],unknowns:[],provider:'deepseek',model:'deepseek-chat',analyzedAt:1000,deviceOnline:true};
  return {schemaVersion:1,gatewayId:'dayu-test',simulated:false,historical:true,isCurrent:false,storage,nextBeforeSeq:null,items:[{seq:2,hash:'a'.repeat(64),recordedAt:1000,sessionBootId:'boot-1',historical:true,isCurrent:false,...(kind==='telemetry'?{observation}:{prompt:'test-only question',analysis})}]};
}
function answer(h, page) { h.respond({responseCode:200,result:JSON.stringify(page)}); }

test('native cloud history uses authenticated GET and renders historical values without calling model',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);answer(h,historyPage());
 const history=await u.readHistory('telemetry');assert.match(history.rows[0],/25.6℃/);assert.match(history.rows[0],/不代表当前/);assert.match(history.status,/非全量/);
 assert.equal(h.calls[0].url,'https://cloud.example/api/v1/device/history?kind=telemetry&limit=10');assert.equal(h.calls[0].options.method,'GET');assert.equal(h.calls[0].options.extraData,undefined);assert.equal(h.calls[0].options.header.Authorization,'Bearer '+token);
 answer(h,historyPage('analysis'));const ai=await u.readHistory('analysis');assert.match(ai.rows[0],/test-only summary/);assert.match(ai.rows[0],/未执行设备/);
});

test('native history rejects cross-device, current, invalid cursor, oversized and duplicate records',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 for(const patch of [{gatewayId:'other'},{isCurrent:true},{nextBeforeSeq:7},{items:Array(11).fill(historyPage().items[0])},{items:[historyPage().items[0],historyPage().items[0]]}]){
  answer(h,{...historyPage(),...patch});await assert.rejects(u.readHistory('telemetry'));
 }
 const page=historyPage();page.storage.externalCompletenessVerified=true;answer(h,page);await assert.rejects(u.readHistory('telemetry'),/存储/);
 await assert.rejects(u.readHistory('audit'));assert.equal(h.calls.length,6);
});

test('native historical sensor channels require quality, valid ages and no concentration claims',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 for(const change of [p=>p.items[0].observation.values.coPpm=1,p=>p.items[0].observation.climateAgeMs=10000,p=>p.items[0].observation.values.gasRaw=4096,p=>p.items[0].observation.source='unknown']){
  const p=historyPage();change(p);answer(h,p);await assert.rejects(u.readHistory('telemetry'));
 }
 const p=historyPage();p.items[0].observation.quality.temperatureValid=false;p.items[0].observation.values.temperatureC=999;answer(h,p);
 const history=await u.readHistory('telemetry');assert.match(history.rows[0],/温度 未知/);assert.doesNotMatch(history.rows[0],/999/);
});

test('native history rejects executable or oversized AI results',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 for(const patch of [{executed:true},{steps:[{action:'run'}]},{summary:'x'.repeat(2001)},{findings:Array(11).fill('x')},{realAdmission:'allowed'}]){
  const p=historyPage('analysis');Object.assign(p.items[0].analysis,patch);answer(h,p);await assert.rejects(u.readHistory('analysis'),/分析历史/);
 }
});

test('native report is a whitelisted historical snapshot and rejects changed context',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 const p=historyPage();p.unexpectedSecret='not_to_export';p.items=[];answer(h,p);
 const report=JSON.parse(await u.readRecentReport());assert.equal(report.gatewayId,'dayu-test');assert.equal(report.completeHistory,false);assert.equal(report.isCurrent,false);assert.equal(report.telemetryLimit,10);assert.equal(report.analysisLimit,10);assert.equal(report.realAdmission,'unknown_denied');assert.ok(!JSON.stringify(report).includes('not_to_export'));assert.ok(!JSON.stringify(report).includes(token));
 let resolve;h.respond(new Promise(r=>resolve=r));const pending=u.readHistory('telemetry');u.clear();resolve({responseCode:200,result:JSON.stringify(historyPage())});await assert.rejects(pending,/上下文/);
});

test('HTTP handle creation and destruction failures release the native cloud request lock',async()=>{
 for(const options of [{createFailures:1},{destroyFailures:1}]){
  const h=host(options),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
  await assert.rejects(u.upload(sample(h)),/os_(create|destroy)_failure/);
  assert.match(await u.upload(sample(h)),/确认接收/);
 }
});

async function blockedPipeline(){return new AgentPipeline({provider:null,model:null,key:null,readEnvironment:async()=>null}).pipeline({prompt:'test task',mode:'hardware'});}
test('native device pipeline accepts only 202 start receipt and polls authenticated task until readonly completion',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);const result=await blockedPipeline();let polls=0;
 h.respond((url,options)=>url.endsWith('/pipeline')?{responseCode:202,result:JSON.stringify({taskId:'task-1',gatewayId:'dayu-test'})}:{responseCode:200,result:JSON.stringify({taskId:'task-1',gatewayId:'dayu-test',status:polls++?'completed':'running',result})});
 const done=await u.pipeline('test task');assert.equal(done.mode,'hardware');assert.equal(done.executed,false);assert.equal(done.provider,'');assert.equal(polls,2);assert.equal(h.calls[0].options.method,'POST');assert.equal(h.calls[1].options.method,'GET');assert.equal(h.calls[0].options.header['X-Pengan-Gateway-Id'],'dayu-test');assert.match(h.calls[1].url,/\/api\/v1\/device\/pipeline\/tasks\/task-1$/);
});
test('native pipeline rejects wrong HTTP start status, cross-device tasks, failure, executable and simulation results',async()=>{
 const result=await blockedPipeline();
 for(const variant of ['status','receipt','task','failed','executed','simulation']){
  const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
  h.respond(url=>url.endsWith('/pipeline')?{responseCode:variant==='status'?200:202,result:JSON.stringify({taskId:'task-1',gatewayId:variant==='receipt'?'other':'dayu-test'})}:{responseCode:200,result:JSON.stringify({taskId:'task-1',gatewayId:variant==='task'?'other':'dayu-test',status:variant==='failed'?'failed':'completed',result:{...result,...(variant==='executed'?{executed:true}:{}),...(variant==='simulation'?{mode:'simulation'}:{})}})});
  await assert.rejects(u.pipeline('test'));
 }
});
test('native pipeline start is serialized and changed cloud context rejects late start before polling',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);let resolve;
 h.respond(new Promise(r=>resolve=r));const pending=u.pipeline('test');await assert.rejects(u.pipeline('test'),/仍在进行/);u.clear();resolve({responseCode:202,result:JSON.stringify({taskId:'task-1',gatewayId:'dayu-test'})});await assert.rejects(pending,/上下文/);assert.equal(h.calls.length,1);
});

test('native pipeline polling stops at the 45 second overall budget',async t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'setTimeout',(callback,delay)=>{now+=delay;callback();return 0;});
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 h.respond(url=>({responseCode:url.endsWith('/pipeline')?202:200,result:JSON.stringify({taskId:'task-1',gatewayId:'dayu-test',status:'running'})}));
 await assert.rejects(u.pipeline('test'),/超时/);assert.equal(now,145000);assert.ok(h.calls.length<=91);
});

test('native replay requires matching historical receipt and speech requires explicit confirmation proof',async()=>{
 const h=host(),u=new h.CloudUpload();u.configure('https://cloud.example','dayu-test',token);
 const row={...sample(h),target:u.queueTarget(),capturedAt:100000,key:'unused'};
 const receipt={schemaVersion:1,gatewayId:'dayu-test',historical:true,isCurrent:false,accepted:[{sessionBootId:'boot-1',uptimeMs:100,seq:1}]};h.respond({responseCode:200,result:JSON.stringify(receipt)});await u.replay([row]);assert.equal(h.calls[0].url,'https://cloud.example/api/v1/telemetry/replay');assert.equal(JSON.parse(h.calls[0].options.extraData).items[0].frame.uptime_ms,100);
 h.respond({responseCode:200,result:JSON.stringify({...receipt,isCurrent:true})});await assert.rejects(u.replay([row]),/回执/);
 h.respond({responseCode:200,result:JSON.stringify({gatewayId:'dayu-test',configured:false,engine:'whisper.cpp-local',externalProvider:false})});await assert.rejects(u.checkSpeech(),/未开始录音/);
 h.respond({responseCode:200,result:JSON.stringify({gatewayId:'dayu-test',configured:true,engine:'whisper.cpp-local',externalProvider:false})});await u.checkSpeech();
 const speech={gatewayId:'dayu-test',text:'查询温度',engine:'whisper.cpp-local',requiresConfirmation:true,executed:false};h.respond({responseCode:200,result:JSON.stringify(speech)});assert.equal(await u.transcribe('aGVsbG8='),'查询温度');
 assert.equal(JSON.parse(h.calls.at(-1).options.extraData).authorized,true);h.respond({responseCode:200,result:JSON.stringify({...speech,executed:true})});await assert.rejects(u.transcribe('aGVsbG8='),/回执/);
});
