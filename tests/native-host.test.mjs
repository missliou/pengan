import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const ts=require(path.join(root,'openharmony/node_modules/@ohos/hvigor/node_modules/typescript/lib/typescript.js'));

// Execute the actual native non-UI source on the host with explicit OS API mocks.
// This is not an ArkUI runtime or real-device acceptance test.
function nativeRuntime(){
 const unsupportedCaps=new Set();const committed=new Map();let failFlush=false,httpResponse,failHttp=false,destroyed=0;const requests=[];
 const photoFiles=new Map();let permissionGranted=false,photoCallback,autoPhoto=true,releasedPhotos=0,closedInputs=0,stalledCaptureAck=false;
 let audioBytes=0,audioReleases=0,audioFail=false;
 let pickerCanceled=false,maxFileWrite=Infinity,maxFileRead=Infinity,fileCloses=0;
 const makePhoto=()=>({main:{getComponent:async()=>({byteBuffer:new Uint8Array([255,216,255,217]).buffer})},release:async()=>{releasedPhotos++;}});
 const output={on:(name,callback)=>{photoCallback=callback;},off:()=>{photoCallback=undefined;},release:async()=>{},capture:async()=>{if(autoPhoto)setImmediate(()=>photoCallback?.(null,makePhoto()));if(stalledCaptureAck)await new Promise(()=>{});}};
 const cameraManager={getSupportedCameras:()=>[{}],getSupportedOutputCapability:()=>({previewProfiles:[{size:{width:640,height:480}}],photoProfiles:[{size:{width:1280,height:720}}]}),createCameraInput:()=>({open:async()=>{},close:async()=>{closedInputs++;}}),createPreviewOutput:()=>({release:async()=>{}}),createPhotoOutput:()=>output,createSession:()=>({beginConfig:()=>{},addInput:()=>{},addOutput:()=>{},commitConfig:async()=>{},start:async()=>{},stop:async()=>{},release:async()=>{}})};
 class Encoder{encodeInto(text){return new TextEncoder().encode(text);}}
 const mocks={
  '@ohos.data.preferences':{default:{getPreferences:async()=>{
   const working=new Map(committed);
   return {get:async(k,d)=>working.has(k)?working.get(k):d,put:async(k,v)=>{working.set(k,v);},flush:async()=>{if(failFlush)throw new Error('disk_full');committed.clear();for(const [k,v] of working)committed.set(k,v);}};
  }}},
  '@ohos.security.cryptoFramework':{default:{createMd:()=>{const hash=createHash('sha256');return {update:async({data})=>{hash.update(data);},digest:async()=>({data:new Uint8Array(hash.digest())})};}}},
  '@ohos.util':{default:{TextEncoder:Encoder,Base64Helper:class{encodeToStringSync(data){return Buffer.from(data).toString('base64');}}}},
  '@ohos.net.http':{default:{RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:0},createHttp:()=>({request:async(url,options)=>{requests.push({url,options});if(failHttp)throw new Error('network_down');return httpResponse;},destroy:()=>{destroyed++;}})}},
  '@ohos.abilityAccessCtrl':{default:{createAtManager:()=>({requestPermissionsFromUser:async()=>({authResults:[permissionGranted?0:-1]})})}},
  '@ohos.multimedia.camera':{default:{SceneMode:{NORMAL_PHOTO:1},getCameraManager:()=>cameraManager}},
  '@ohos.multimedia.image':{default:{ComponentType:{JPEG:4}}},
  '@ohos.file.fs':{default:{OpenMode:{CREATE:1,WRITE_ONLY:2,TRUNC:4,READ_ONLY:0},openSync:(name,mode)=>{if(mode!==0)photoFiles.set(name,new Uint8Array());return {fd:name};},statSync:fd=>({size:photoFiles.get(fd).length}),readSync:(fd,buffer,options)=>{const part=photoFiles.get(fd).slice(options.offset,options.offset+Math.min(buffer.byteLength,maxFileRead));new Uint8Array(buffer).set(part);return part.length;},writeSync:(fd,bytes)=>{const part=new Uint8Array(bytes).slice(0,maxFileWrite),previous=photoFiles.get(fd)||new Uint8Array(),joined=new Uint8Array(previous.length+part.length);joined.set(previous);joined.set(part,previous.length);photoFiles.set(fd,joined);return part.length;},closeSync:()=>{fileCloses++;},unlinkSync:name=>{photoFiles.delete(name);}}},
  '@ohos.multimedia.audio':{default:{AudioSamplingRate:{SAMPLE_RATE_16000:16000},AudioChannel:{CHANNEL_1:1},AudioSampleFormat:{SAMPLE_FORMAT_S16LE:1},AudioEncodingType:{ENCODING_TYPE_RAW:0},StreamUsage:{STREAM_USAGE_NOTIFICATION:7},createAudioRenderer:async()=>{let feed,stopped=false;const pump=()=>{if(stopped||!feed)return;const buffer=new ArrayBuffer(audioFail?0:4);feed(buffer);audioBytes+=buffer.byteLength;setImmediate(pump);};return {on:(name,callback)=>{feed=callback;},off:()=>{feed=undefined;},start:async()=>{setImmediate(pump);},drain:async()=>{},stop:async()=>{stopped=true;},release:async()=>{stopped=true;audioReleases++;}};}}},
  '@ohos.file.picker':{default:{DocumentViewPicker:class{async save(){return pickerCanceled?[]:['/chosen/audit.json'];}}}}
 };
 const cache=new Map();
 function load(relative){
  const file=path.isAbsolute(relative)?relative:path.join(root,'openharmony/entry/src/main/ets',relative+'.ets');
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=fs.readFileSync(file,'utf8');
  const out=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const localRequire=specifier=>{
   if(mocks[specifier])return mocks[specifier];
   if(specifier.startsWith('.'))return load(path.resolve(path.dirname(file),specifier+'.ets'));
   throw new Error('Unmocked native platform module: '+specifier);
  };
  const wrapper=vm.runInThisContext('(function(require,module,exports,canIUse){'+out+'\n})',{filename:file});wrapper(localRequire,module,module.exports,cap=>!unsupportedCaps.has(cap));return module.exports;
 }
 return {fileCloses:()=>fileCloses,setMaxFileRead:v=>{maxFileRead=v;},setMaxFileWrite:v=>{maxFileWrite=v;},setCapability:(cap,enabled)=>{if(enabled)unsupportedCaps.delete(cap);else unsupportedCaps.add(cap);},load,committed,requests,photoFiles,getPhotoCallback:()=>photoCallback,makePhoto,setStalledCaptureAck:v=>{stalledCaptureAck=v;},setPickerCanceled:v=>{pickerCanceled=v;},audioBytes:()=>audioBytes,audioReleases:()=>audioReleases,setAudioFail:v=>{audioFail=v;},setPermission:v=>{permissionGranted=v;},setAutoPhoto:v=>{autoPhoto=v;},releasedPhotos:()=>releasedPhotos,closedInputs:()=>closedInputs,setFailFlush:v=>{failFlush=v;},respond:(body,status=200)=>{httpResponse={responseCode:status,result:JSON.stringify(body)};},setFailHttp:v=>{failHttp=v;},destroyCount:()=>destroyed};
}

test('原生手动模型测试仅POST空测试参数，拒绝现场发送/执行标记和错误模型',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const response={kind:'model_connection_check',ok:true,provider:'deepseek',model:'test',checkedAt:Date.now(),roundTripMs:25,fieldDataSent:false,imageSent:false,executed:false};
 r.respond(response);assert.equal((await link.testModel()).ok,true);assert.ok(r.requests.at(-1).url.endsWith('/api/agent/test'));assert.equal(r.requests.at(-1).options.extraData,'{}');assert.equal(r.requests.at(-1).options.readTimeout,30000);
 for(const change of [{fieldDataSent:true},{imageSent:true},{executed:true},{provider:'unknown'},{roundTripMs:-1},{checkedAt:0}]){r.respond({...response,...change});await assert.rejects(link.testModel(),/模型测试协议无效/);}
});

test('原生AI错误仅显示已知安全解释，不回显服务端私密正文',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 for(const [error,expected] of [['ai_not_configured',/模型设置/],['ai_provider_http_401',/密钥校验失败/],['ai_provider_http_429',/限流/],['ai_analysis_timeout',/超时/],['ai_busy_try_later',/其他请求/]]){
  r.respond({error,detail:'private-do-not-echo'},422);await assert.rejects(link.testModel(),failure=>expected.test(failure.message)&&!failure.message.includes('private-do-not-echo'));
 }
 r.respond({error:'private-do-not-echo',detail:'private-do-not-echo'},502);await assert.rejects(link.testModel(),failure=>failure.message.includes('HTTP 502')&&!failure.message.includes('private-do-not-echo'));
});
test('原生源码：安全引擎独立拒止 CO、CO₂、过期与急停',()=>{
 const r=nativeRuntime(),{EnvSnapshot}=r.load('model/Models'),{SafetyEngine}=r.load('services/SafetyEngine');
 for(const change of [{co:30},{co2:1500},{sensorOnline:false},{sampledAt:0},{emergency:true},{co:NaN}]){const e=Object.assign(new EnvSnapshot(),change);assert.equal(SafetyEngine.check(e).allowed,false);}
 assert.equal(SafetyEngine.check(new EnvSnapshot()).allowed,true);
});

test('原生真实AI不依赖模拟连接，拒绝执行权、模拟结果和伪造在线时间',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const result={mode:'hardware',simulated:false,executed:false,steps:[],summary:'采集离线',findings:['没有有效读数'],unknowns:['CO/CO₂未接入'],observationReceivedAt:null,deviceOnline:false,analyzedAt:Date.now(),provider:'qwen',model:'test',hardwareControl:false,realAdmission:'unknown_denied'};
 r.respond(result);assert.equal((await link.analyze('分析当前环境')).summary,'采集离线');assert.ok(r.requests.at(-1).url.endsWith('/api/agent/analyze'));assert.equal(r.requests.at(-1).options.readTimeout,30000);
 r.respond({...result,toolTrace:[{tool:'read_environment',at:Date.now(),readOnly:true,resultSummary:'设备离线'}]});assert.equal((await link.analyze('分析')).toolTrace.length,1);
 for(const change of [{simulated:true},{hardwareControl:true},{executed:true},{deviceOnline:true},{steps:[{action:'ventilate'}]},{findings:[1]},{toolTrace:[{tool:'ventilate',at:Date.now(),readOnly:true,resultSummary:'拒绝'}]},{toolTrace:[{tool:'read_environment',at:Date.now(),readOnly:false,resultSummary:'拒绝'}]},{toolTrace:[{tool:'read_recent_history',at:0,readOnly:true,resultSummary:'拒绝'}]}]){r.respond({...result,...change});await assert.rejects(link.analyze('分析'),/真实分析/);}
});

test('原生真实历史按记录时刻展示，拒绝模拟、坏质量与伪当前记录',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const observation={simulated:false,deviceId:'hh-hsp101-001',deviceOnline:true,actuationAvailable:false,receivedAt:1000,values:{temperatureC:25.3,humidityPct:61,gasRaw:550,gasMv:900},quality:{temperatureValid:true,humidityValid:true,gasValid:true,coValid:false,co2Valid:false}};
 const item={seq:1,hash:'a'.repeat(64),historical:true,isCurrent:false,observation};
 const response={schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:{enabled:true,healthy:true,records:1,bytes:100,maxBytes:10000},retainedInMemory:1,items:[item]};
 r.respond(response);const history=await link.readHardwareHistory();assert.match(history.rows[0],/25.3 ℃/);assert.match(history.rows[0],/不代表当前/);assert.ok(r.requests.at(-1).url.endsWith('/api/hardware/history?limit=50'));
 for(const change of [{simulated:true},{isCurrent:true},{items:[{...item,observation:{...observation,receivedAt:null}}]},{items:[{...item,observation:{...observation,values:{...observation.values,temperatureC:100}}}]}]){r.respond({...response,...change});await assert.rejects(link.readHardwareHistory(),/历史/);}
});

test('真实照片仅从私有抓拍路径读取，短读补齐且所有读取失败关闭文件',()=>{
 const r=nativeRuntime(),{NativePhotoUpload}=r.load('services/NativePhotoUpload'),file='/private/crop-100.jpg';
 const bytes=new Uint8Array(64);bytes.set([255,216,255]);bytes.set([255,217],62);r.photoFiles.set(file,bytes);r.setMaxFileRead(2);
 assert.equal(NativePhotoUpload.readCapturedJpeg(file,'/private'),Buffer.from(bytes).toString('base64'));assert.equal(r.fileCloses(),1);
 assert.throws(()=>NativePhotoUpload.readCapturedJpeg('/private/../other.jpg','/private'),/只能发送/);
 r.setMaxFileRead(0);assert.throws(()=>NativePhotoUpload.readCapturedJpeg(file,'/private'),/读取不完整/);assert.equal(r.fileCloses(),2);
 r.setMaxFileRead(Infinity);
 for(const data of [new Uint8Array(),new Uint8Array(2097153),new Uint8Array([1,2,3,4])]){r.photoFiles.set(file,data);assert.throws(()=>NativePhotoUpload.readCapturedJpeg(file,'/private'));}
 assert.equal(r.fileCloses(),5);
});

test('真实照片分析拒绝错误来源、执行权及伪造摘要',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const result={mode:'hardware',kind:'crop_image_analysis',source:'user_photo',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',imageSha256:'a'.repeat(64),analyzedAt:Date.now(),provider:'qwen',model:'vision',summary:'可见叶片',findings:['叶片可见'],unknowns:['不能确诊']};
 r.respond(result);assert.equal((await link.inspectImage('/9j/2Q==')).summary,'可见叶片');assert.ok(r.requests.at(-1).url.endsWith('/api/agent/inspect-image'));assert.equal(r.requests.at(-1).options.readTimeout,30000);
 for(const change of [{source:'url'},{hardwareControl:true},{imageSha256:'x'},{steps:[{}]},{findings:[1]}]){r.respond({...result,...change});await assert.rejects(link.inspectImage('/9j/2Q=='),/照片分析/);}
});

test('原生AI文字历史严格区分保存状态、真实来源与历史标记',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const analysis={mode:'hardware',simulated:false,executed:false,steps:[],summary:'旧分析',findings:[],unknowns:['缺少CO/CO₂'],observationReceivedAt:1000,deviceOnline:true,analyzedAt:2000,provider:'deepseek',model:'test',hardwareControl:false,realAdmission:'unknown_denied',persistence:{saved:true,recordId:1}};
 r.respond(analysis);assert.equal((await link.analyze('查询')).persistence.saved,true);
 r.respond({...analysis,persistence:{saved:false,error:'storage_failed'}});assert.equal((await link.analyze('查询')).persistence.saved,false);
 r.respond({...analysis,persistence:{saved:'yes'}});await assert.rejects(link.analyze('查询'),/保存状态/);
 const item={seq:1,hash:'b'.repeat(64),prompt:'过去温度如何',analysis,recordedAt:3000,historical:true,isCurrent:false};
 const response={schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:{enabled:true,healthy:true,records:1,bytes:500,maxBytes:10000},items:[item]};
 r.respond(response);const history=await link.readAnalysisHistory();assert.match(history.rows[0],/旧分析/);assert.match(history.rows[0],/不代表当前/);assert.ok(r.requests.at(-1).url.endsWith('/api/agent/history?limit=20'));
 for(const change of [{isCurrent:true},{items:[{...item,recordedAt:0}]},{items:[{...item,analysis:{...analysis,simulated:true}}]},{items:[{...item,analysis:{...analysis,hardwareControl:true}}]}]){r.respond({...response,...change});await assert.rejects(link.readAnalysisHistory());}
});

test('原生真实报告拒绝模拟、伪全量及离线补值；原生选择器取消或上下文变化不写入',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const storage={enabled:true,healthy:true,records:0,bytes:0,maxBytes:10000};
 const hardware={simulated:false,deviceId:'hh-hsp101-001',deviceOnline:false,actuationAvailable:false,receivedAt:null,values:{temperatureC:null,humidityPct:null,gasRaw:null,gasMv:null,coPpm:null,co2Ppm:null},quality:{temperatureValid:false,humidityValid:false,gasValid:false,coValid:false,co2Valid:false}};
 const report={schemaVersion:1,kind:'pengan_real_session_report',mode:'hardware',simulated:false,hardwareActuation:false,realAdmission:'unknown_denied',generatedAt:Date.now(),current:{schemaVersion:1,mode:'hardware',simulated:false,gatewayNow:Date.now(),hardware,capabilities:{readEnvironment:true,actuate:false,co:false,co2:false},admission:'unknown_denied'},observationHistory:{schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage,retainedInMemory:0,items:[]},analysisHistory:{schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage,items:[]},scope:{observationLimit:50,analysisLimit:20,completeHistory:false},limitations:['历史不是当前，未包含照片']};
 r.respond(report);assert.equal(JSON.parse(await link.readRealReport()).kind,'pengan_real_session_report');assert.ok(r.requests.at(-1).url.endsWith('/api/reports/latest'));
 for(const change of [{simulated:true},{hardwareActuation:true},{scope:{...report.scope,completeHistory:true}},{observationHistory:{...report.observationHistory,isCurrent:true}},{current:{...report.current,hardware:{...hardware,values:{...hardware.values,temperatureC:20}}}}]){r.respond({...report,...change});await assert.rejects(link.readRealReport());}
 const {NativeDocumentExport}=r.load('services/NativeDocumentExport');
 r.setPickerCanceled(true);assert.equal(await NativeDocumentExport.saveJson('{}','棚安-最近真实记录'),false);assert.equal(r.photoFiles.size,0);
 r.setPickerCanceled(false);await assert.rejects(NativeDocumentExport.saveJson('{}','棚安-最近真实记录',()=>false),/上下文/);assert.equal(r.photoFiles.size,0);
});

test('原生中文AI历史：20条合法长分析可读，2MiB UTF8上限仍拒绝超大响应',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const analysis={mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:'历史分析',findings:Array(10).fill('观'.repeat(1000)),unknowns:Array(12).fill('缺'.repeat(1000)),provider:'deepseek',model:'test',analyzedAt:Date.now(),observationReceivedAt:null,deviceOnline:false,toolTrace:[]};
 const data={schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:{enabled:true,healthy:true,records:20,bytes:1500000,maxBytes:16777216},items:Array.from({length:20},(_,i)=>({seq:i+1,hash:'a'.repeat(64),prompt:'问题',analysis,recordedAt:Date.now(),historical:true,isCurrent:false}))};
 assert.ok(JSON.stringify(data).length>100000);assert.ok(Buffer.byteLength(JSON.stringify(data))<2097152);
 r.respond(data);assert.equal((await link.readAnalysisHistory()).rows.length,20);
 r.respond({...data,extra:'大'.repeat(800000)});await assert.rejects(link.readAnalysisHistory(),/响应过长/);
 r.respond(data);await assert.rejects(link.testHardware(),/响应过长/);
});
test('原生源码：台账串行并发写入、重启恢复与哈希链校验',async()=>{
 const r=nativeRuntime(),{EnvSnapshot,EventRecord}=r.load('model/Models'),{NativeAuditStore}=r.load('services/NativeAuditStore');
 const store=new NativeAuditStore();await store.open({});const env=new EnvSnapshot();
 await Promise.all(Array.from({length:8},(_,i)=>store.append(new EventRecord(i+1,'事件','结果','测试'),env)));
 assert.equal(await store.verify(),8);assert.deepEqual(store.rows.map(x=>x.id),[1,2,3,4,5,6,7,8]);
 const restored=new NativeAuditStore();await restored.open({});assert.equal(await restored.verify(),8);
 const broken=JSON.parse(r.committed.get('record_3'));broken.detail='被修改';r.committed.set('record_3',JSON.stringify(broken));
 const corrupt=new NativeAuditStore();await assert.rejects(corrupt.open({}),/不一致/);
 await assert.rejects(corrupt.append(new EventRecord(9,'x','x','x'),env),/未就绪/);
});
test('原生源码：无效读数可存证，写入失败不报告持久化成功',async()=>{
 const r=nativeRuntime(),{EnvSnapshot,EventRecord}=r.load('model/Models'),{NativeAuditStore}=r.load('services/NativeAuditStore');
 const store=new NativeAuditStore();await store.open({});const env=new EnvSnapshot();env.co=NaN;
 await store.append(new EventRecord(1,'无效读数','拒止','规则',true),env);
 assert.equal(store.rows[0].coValid,false);const restored=new NativeAuditStore();await restored.open({});assert.equal(await restored.verify(),1);
 r.setFailFlush(true);await assert.rejects(store.append(new EventRecord(2,'x','x','x'),env),/保存失败/);assert.equal(store.rows.length,1);
 await assert.rejects(store.append(new EventRecord(3,'x','x','x'),env),/未就绪/);
});
test('原生源码：未载入或损坏的台账不允许显示空链校验通过',async()=>{
 const r=nativeRuntime(),{NativeAuditStore}=r.load('services/NativeAuditStore');const store=new NativeAuditStore();
 await assert.rejects(store.verify(),/尚未载入/);r.committed.set('count',-1);await assert.rejects(store.open({}),/数量无效/);await assert.rejects(store.verify(),/尚未载入/);
});
test('原生源码：网关按数据年龄转换时效，异常响应清理HTTP对象',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink');const link=new GatewayLink();
 const frame={simulated:true,deviceId:'hsp-demo-001',sampleAgeMs:1000,values:{coPpm:4,co2Ppm:680,temperatureC:25,humidityPct:60,soilPct:48,lightLux:12000},quality:{coValid:true,co2Valid:true},state:{emergency:false,fan:true}};
 r.respond({simulated:true,deviceOnline:true,gatewayNow:500000,receivedAt:499500,frame});
 const result=await link.read();assert.ok(Math.abs(Date.now()-result.env.sampledAt-1500)<100);assert.equal(result.fan,true);
 r.respond({simulated:true,deviceOnline:true,gatewayNow:500000,receivedAt:499500,frame:{...frame,state:{emergency:'false',fan:true}}});await assert.rejects(link.read(),/字段无效/);
 r.setFailHttp(true);await assert.rejects(link.read(),/network_down/);assert.equal(r.destroyCount(),3);
});
test('原生源码：模型计划不会自动执行，并拒绝未知工具与非法时长',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink');const link=new GatewayLink();
 r.respond({summary:'先通风',provider:'test',model:'mock',simulated:true,executed:false,steps:[{action:'ventilate',reason:'模拟超标',maxRunMs:5000}]});
 const plan=await link.plan('通风');assert.equal(plan.executed,false);assert.equal(r.requests.length,1);assert.ok(r.requests[0].url.endsWith('/api/agent/plan'));
 r.respond({summary:'x',simulated:true,executed:false,steps:[{action:'force_unlock',reason:'x'}]});await assert.rejects(link.plan('x'),/工具无效/);
 r.respond({summary:'x',simulated:true,executed:false,steps:[{action:'ventilate',reason:'x',maxRunMs:30000}]});await assert.rejects(link.plan('x'),/时长无效/);
 await assert.rejects(link.command('ventilate',50000),/时长无效/);
});
test('原生源码：摄像头权限拒绝可恢复，抓拍仅写应用目录并释放资源',async()=>{
 const r=nativeRuntime(),{NativeCamera}=r.load('services/NativeCamera');const camera=new NativeCamera();
 await assert.rejects(camera.start({filesDir:'/app-private'},'surface-1'),/权限未授予/);
 r.setPermission(true);await camera.start({filesDir:'/app-private'},'surface-1');
 const file=await camera.capture();assert.ok(file.startsWith('/app-private/crop-'));assert.equal(r.photoFiles.size,1);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(r.releasedPhotos(),1);
 await camera.stop();assert.equal(r.closedInputs(),1);await assert.rejects(camera.capture(),/先启用/);
});
test('原生源码：停止相机时取消未完成抓拍，不产生伪造图片',async()=>{
 const r=nativeRuntime(),{NativeCamera}=r.load('services/NativeCamera');const camera=new NativeCamera();
 r.setPermission(true);r.setAutoPhoto(false);await camera.start({filesDir:'/private'},'surface');
 const capturing=camera.capture();const rejected=assert.rejects(capturing,/抓拍失败/);await camera.stop();await rejected;assert.equal(r.photoFiles.size,0);
});

test('原生源码：相机短写补齐；写入停滞拒绝并清理残片',async()=>{
 for(const limit of [2,0]){
  const r=nativeRuntime(),{NativeCamera}=r.load('services/NativeCamera'),camera=new NativeCamera();r.setPermission(true);r.setMaxFileWrite(limit);
  await camera.start({filesDir:'/private'},'surface');
  if(limit===0){await assert.rejects(camera.capture(),/抓拍失败/);assert.equal(r.photoFiles.size,0);}
  else{const file=await camera.capture();assert.deepEqual([...r.photoFiles.get(file)],[255,216,255,217]);}
  await new Promise(resolve=>setImmediate(resolve));assert.equal(r.releasedPhotos(),1);await camera.stop();
 }
});
test('原生源码：任务失败不可被后续成功回写覆盖，历史对象保持不变',()=>{
 const r=nativeRuntime(),{TaskRecord}=r.load('model/TaskModels'),{TaskFlow}=r.load('services/TaskFlow');
 const initial=new TaskRecord(1,'准入','测试');
 const waiting=TaskFlow.append(initial,'规则校验','等待中','waiting');
 const rejected=TaskFlow.settle(waiting,'CO超标',false);
 const later=TaskFlow.settle(rejected,'模拟后续成功',true);
 assert.equal(initial.steps.length,0);assert.equal(waiting.steps[0].state,'waiting');assert.equal(later.steps[0].state,'blocked');assert.equal(later.steps[0].detail,'CO超标');
});
test('原生源码：语音按回调填充，尾帧补零，播放后释放且短期去重',async()=>{
 const r=nativeRuntime(),{NativeVoiceAlert}=r.load('services/NativeVoiceAlert');const voice=new NativeVoiceAlert();
 const context={resourceManager:{getRawFileContent:async()=>new Uint8Array(18)}};
 assert.equal(await voice.play(context,'voice_test'),true);assert.equal(r.audioBytes(),20);assert.equal(r.audioReleases(),1);
 assert.equal(await voice.play(context,'voice_test'),false);assert.equal(r.audioBytes(),20);
});
test('原生源码：语音输出失败不无限重试、不影响主安全规则',async()=>{
 const r=nativeRuntime(),{NativeVoiceAlert}=r.load('services/NativeVoiceAlert');const voice=new NativeVoiceAlert();r.setAudioFail(true);
 assert.equal(await voice.play({resourceManager:{getRawFileContent:async()=>new Uint8Array(16)}},'co_high'),false);assert.equal(r.audioReleases(),1);
 assert.equal(await voice.play({resourceManager:{getRawFileContent:async()=>new Uint8Array(16)}},'unknown_clip'),false);
});
test('原生源码：审计导出保留完整性结论与模拟环境标记',async()=>{
 const r=nativeRuntime(),{NativeAuditStore}=r.load('services/NativeAuditStore'),{EnvSnapshot,EventRecord}=r.load('model/Models');const store=new NativeAuditStore();await store.open({});
 await store.append(new EventRecord(1,'入棚','拒止','测试',true),new EnvSnapshot());
 let exported=JSON.parse(await store.exportJson());assert.equal(exported.prototype,true);assert.equal(exported.hardwareActuation,false);assert.equal(exported.integrityValid,true);assert.equal(exported.records[0].environmentSimulated,true);
 store.rows[0].detail='篡改';exported=JSON.parse(await store.exportJson());assert.equal(exported.integrityValid,false);assert.equal(exported.records[0].detail,'篡改');
});
test('原生源码：文件导出UTF8完整写入，用户取消不写新文件',async()=>{
 const r=nativeRuntime(),{NativeDocumentExport}=r.load('services/NativeDocumentExport');
 assert.equal(await NativeDocumentExport.saveJson('中文台账'),true);assert.equal(new TextDecoder().decode(r.photoFiles.get('/chosen/audit.json')),'中文台账');
 r.setPickerCanceled(true);assert.equal(await NativeDocumentExport.saveJson('不应覆盖'),false);assert.equal(new TextDecoder().decode(r.photoFiles.get('/chosen/audit.json')),'中文台账');
});
test('原生源码：旧相机会话迟到图像不能完成或取消新抓拍',async()=>{
 const r=nativeRuntime(),{NativeCamera}=r.load('services/NativeCamera');const camera=new NativeCamera();r.setPermission(true);r.setAutoPhoto(false);
 await camera.start({filesDir:'/private'},'first');const oldCallback=r.getPhotoCallback();
 const first=camera.capture();const rejected=assert.rejects(first,/抓拍失败/);await camera.stop();await rejected;
 await camera.start({filesDir:'/private'},'second');const second=camera.capture();
 oldCallback(null,r.makePhoto());await new Promise(resolve=>setImmediate(resolve));assert.equal(r.photoFiles.size,0);
 r.getPhotoCallback()(null,r.makePhoto());const file=await second;assert.ok(file.startsWith('/private/'));assert.equal(r.photoFiles.size,1);await camera.stop();
});
test('原生源码：有效图像到达时不被迟滞的抓拍请求回执卡住',{timeout:1500},async()=>{
 const r=nativeRuntime(),{NativeCamera}=r.load('services/NativeCamera');const camera=new NativeCamera();r.setPermission(true);r.setStalledCaptureAck(true);
 await camera.start({filesDir:'/private'},'surface');assert.ok((await camera.capture()).endsWith('.jpg'));await camera.stop();
});


test('原生连接设置：保存恢复、非法地址拒绝、写入失败可见',async()=>{
 const r=nativeRuntime(),{ConnectionSettings,normalizeGatewayAddress}=r.load('services/ConnectionSettings');
 for(const address of ['http://example.com','http://192.168.1.2:0','http://192.168.1.2:65536','https://user:pass@example.com','https://example.com/path','http://999.1.1.1','http://127.0.0.1?x=1'])assert.throws(()=>normalizeGatewayAddress(address));
 const settings=new ConnectionSettings();await assert.rejects(settings.save('http://127.0.0.1:5187'));
 assert.equal(await settings.open({}),'http://127.0.0.1:5187');
 assert.equal(await settings.save(' http://192.168.1.2:5187/ '),'http://192.168.1.2:5187');
 const restored=new ConnectionSettings();assert.equal(await restored.open({}),'http://192.168.1.2:5187');
 r.setFailFlush(true);await assert.rejects(settings.save('https://gateway.example.com'));
});

test('原生连接测试：协议核验、旧连接响应作废，不接受真实设备冒充模拟',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink');const link=new GatewayLink();
 link.configure('http://192.168.1.2:5187');r.respond({ok:true,simulated:true,hardwareConnected:false,transport:'mqtt'});
 assert.match(await link.testConnection(),/未接真实执行器/);assert.equal(r.requests.at(-1).url,'http://192.168.1.2:5187/api/health');
 r.respond({ok:true,simulated:false,hardwareConnected:true,transport:'mqtt'});await assert.rejects(link.testConnection(),/协议不匹配/);
 r.respond({ok:true,simulated:true,hardwareConnected:false,transport:'mqtt'});const stale=link.testConnection();link.configure('http://127.0.0.1:5187');await assert.rejects(stale,/配置已变化/);
 assert.equal(r.destroyCount(),3);
});

test('原生断开会话后迟到回执作废，新会话可继续连接',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink');const link=new GatewayLink();
 r.respond({commandId:'old',status:'executed',reason:'ok',simulated:true,deviceId:'hsp-demo-001'});
 const command=link.command('query_environment');link.invalidateSession();await assert.rejects(command,/配置已变化/);
 r.respond({ok:true,simulated:true,hardwareConnected:false,transport:'mqtt'});assert.match(await link.testConnection(),/模拟网关/);
 assert.equal(r.destroyCount(),2);
});

test('原生真实采集：质量与时效核验，坏数据不能显示正常值',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();
 const sample={simulated:false,deviceId:'hh-hsp101-001',deviceOnline:true,actuationAvailable:false,receivedAt:1000,sampleAgeMs:200,climateAgeMs:400,gasAgeMs:300,values:{temperatureC:25.3,humidityPct:62.1,gasRaw:550,gasMv:967},quality:{temperatureValid:true,humidityValid:true,gasValid:true,coValid:false,co2Valid:false}};
 r.respond(sample);assert.match(await link.readHardware(),/25.3℃/);assert.ok(link.hardwareSampleAgeMs>=400);
 for(const change of [{sampleAgeMs:10000},{quality:{...sample.quality,temperatureValid:'true'}},{values:{...sample.values,temperatureC:1000}},{climateAgeMs:10000}]){r.respond({...sample,...change});await assert.rejects(link.readHardware());}
 r.respond({...sample,deviceOnline:false});assert.match(await link.readHardware(),/未知/);assert.equal(link.hardwareSampleAgeMs,-1);
});
test('原生真实采集：同一收到时间的旧样本不可无限保鲜',async()=>{
 const r=nativeRuntime(),{GatewayLink}=r.load('services/GatewayLink'),link=new GatewayLink();const original=Date.now;let now=100000;
 try{Date.now=()=>now;r.respond({simulated:false,deviceId:'hh-hsp101-001',deviceOnline:true,actuationAvailable:false,receivedAt:1000,sampleAgeMs:0,climateAgeMs:0,gasAgeMs:0,values:{temperatureC:null,humidityPct:null,gasRaw:null,gasMv:null,coPpm:null,co2Ppm:null},quality:{temperatureValid:false,humidityValid:false,gasValid:false,coValid:false,co2Valid:false}});await link.readHardware();now+=10001;await assert.rejects(link.readHardware(),/长时间未更新/);}finally{Date.now=original;}
});

test('原生能力缺失：摘要不可用时拒绝打开与追加审计',async()=>{
 const r=nativeRuntime(),{NativeAuditStore}=r.load('services/NativeAuditStore'),{EnvSnapshot,EventRecord}=r.load('model/Models');r.setCapability('SystemCapability.Security.CryptoFramework.MessageDigest',false);const store=new NativeAuditStore();await assert.rejects(store.open({}));await assert.rejects(store.append(new EventRecord(1,'x','x','x'),new EnvSnapshot()));assert.equal(r.committed.size,0);
});
test('原生能力缺失：音频Core或Renderer不可用不报告播放成功',async()=>{
 for(const cap of ['SystemCapability.Multimedia.Audio.Core','SystemCapability.Multimedia.Audio.Renderer']){const r=nativeRuntime(),{NativeVoiceAlert}=r.load('services/NativeVoiceAlert');r.setCapability(cap,false);const voice=new NativeVoiceAlert();assert.equal(await voice.play({resourceManager:{getRawFileContent:async()=>new Uint8Array([0,0,0,0])}},'voice_test'),false);assert.ok(voice.lastError.length>0);assert.equal(r.audioBytes(),0);}
});
