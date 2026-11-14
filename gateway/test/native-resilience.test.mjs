import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import path from 'node:path';import {readFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),ts=require(path.join(root,'openharmony/node_modules/@ohos/hvigor/node_modules/typescript/lib/typescript.js'));
function host(extra={}){
 const stores=new Map(),keys=new Map(),sessions=new Map();let handle=0,generated=0,failFlush=false;
 const prefs={getPreferences:async(_context,name)=>{if(!stores.has(name))stores.set(name,new Map());const disk=stores.get(name);let pending=new Map(disk);return {get:async(k,d)=>pending.has(k)?pending.get(k):d,put:async(k,v)=>pending.set(k,v),delete:async k=>pending.delete(k),flush:async()=>{if(failFlush)throw Error('disk failure');disk.clear();for(const [k,v]of pending)disk.set(k,v);}};}};
 const tags={};for(const t of ['ALGORITHM','KEY_SIZE','PURPOSE','PADDING','BLOCK_MODE','NONCE','ASSOCIATED_DATA','AE_TAG'])tags['HUKS_TAG_'+t]=t;
 const purpose={HUKS_KEY_PURPOSE_ENCRYPT:1,HUKS_KEY_PURPOSE_DECRYPT:2};
 const huks={HuksTag:tags,HuksKeyAlg:{HUKS_ALG_AES:1},HuksKeySize:{HUKS_AES_KEY_SIZE_256:256},HuksKeyPurpose:purpose,HuksKeyPadding:{HUKS_PADDING_NONE:0},HuksCipherMode:{HUKS_MODE_GCM:1},isKeyItemExist:async name=>keys.has(name),generateKeyItem:async(name)=>{generated++;keys.set(name,randomBytes(32));},initSession:async(name,options)=>{const h=++handle;sessions.set(h,{key:keys.get(name),p:Object.fromEntries(options.properties.map(p=>[p.tag,p.value]))});return {handle:h};},finishSession:async(h,options)=>{const {key,p}=sessions.get(h);sessions.delete(h);if(p.PURPOSE===1){const c=createCipheriv('aes-256-gcm',key,p.NONCE);c.setAAD(p.ASSOCIATED_DATA);return {outData:Buffer.concat([c.update(options.inData),c.final(),c.getAuthTag()])};}const d=createDecipheriv('aes-256-gcm',key,p.NONCE);d.setAAD(p.ASSOCIATED_DATA);d.setAuthTag(p.AE_TAG);return {outData:Buffer.concat([d.update(options.inData),d.final()])};},abortSession:async h=>sessions.delete(h)};
 const util={TextEncoder:class{encodeInto(v){return new TextEncoder().encode(v);}},TextDecoder:class{decodeWithStream(v){return new TextDecoder().decode(v);}},Base64Helper:class{encodeToStringSync(v){return Buffer.from(v).toString('base64');}decodeSync(v){return new Uint8Array(Buffer.from(v,'base64'));}}};
 const os={'@ohos.security.huks':huks,'@ohos.security.cryptoFramework':{createRandom:()=>({generateRandomSync:n=>({data:randomBytes(n)})})},'@ohos.data.preferences':prefs,'@ohos.util':util,'@ohos.net.http':{},'@ohos.app.ability.common':{}};
 Object.assign(os,extra);
 const cache=new Map();const load=file=>{if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;const local=n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ets')):{default:os[n]??{}};vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})(local,module,module.exports);return module.exports;};
 return {load:n=>load(path.join(root,'openharmony/entry/src/main/ets/services',n+'.ets')),stores,keys,get generated(){return generated;},fail:()=>failFlush=true};
}
test('actual native vault uses authenticated encryption, rejects target tampering and never persists plaintext',async()=>{
 const h=host(),{CredentialVault}=h.load('CredentialVault'),v=new CredentialVault(),token='synthetic_device_token_01234567890123456789';await v.open({});await v.save('https://cloud.test','dayu-test',token);
 const store=h.stores.get('pengan_credentials_v1'),raw=store.get('envelope');assert.ok(!raw.includes(token));assert.equal((await v.restore()).token,token);assert.equal(h.generated,1);
 const envelope=JSON.parse(raw);store.set('envelope',JSON.stringify({...envelope,id:'other-device'}));const other=new CredentialVault();await other.open({});await assert.rejects(other.restore(),/解密失败/);
 store.set('envelope',raw);h.keys.clear();const missing=new CredentialVault();await missing.open({});await assert.rejects(missing.restore(),/解密失败/);assert.equal(h.generated,1);
 await missing.forget();assert.equal(store.has('envelope'),false);
});
test('actual native queue persists before success, scopes targets, survives restart and fails closed on flush error',async()=>{
 const h=host(),{OfflineQueue}=h.load('OfflineQueue'),{CloudSample}=h.load('CloudUpload');const q=new OfflineQueue();await q.open({});
 const s=new CloudSample();Object.assign(s,{sessionBootId:'boot-1',sampleAgeMs:100,frameJson:'{"uptime_ms":100}'});const target='https://cloud.test|dayu-test';
 const [key]=await Promise.all([q.enqueue(s,target),q.enqueue(s,target)]);assert.equal(q.count(),1);const restored=new OfflineQueue();await restored.open({});assert.equal(restored.batch(target).length,1);assert.equal(restored.batch('https://other.test|dayu-test').length,0);
 await restored.acknowledge('https://other.test|dayu-test',[key]);assert.equal(restored.count(),1);await restored.acknowledge(target,[key]);assert.equal(restored.count(),0);
 await restored.enqueue(s,target);h.fail();await assert.rejects(restored.acknowledge(target,[key]),/写入失败/);assert.throws(()=>restored.batch(target),/不可用/);assert.equal(h.stores.get('pengan_offline_v1').get('samples').includes('boot-1'),true);
});

test('actual microphone adapter produces bounded mono WAV and releases on cancel/denial',async t=>{
 let stopped=0,released=0,callback,permission=0;
 const audio={AudioSamplingRate:{SAMPLE_RATE_16000:16000},AudioChannel:{CHANNEL_1:1},AudioSampleFormat:{SAMPLE_FORMAT_S16LE:1},AudioEncodingType:{ENCODING_TYPE_RAW:0},createAudioCapturer:async options=>{assert.equal(options.streamInfo.samplingRate,16000);return {on:(_type,fn)=>callback=fn,start:async()=>callback(new Uint8Array(4096).buffer),stop:async()=>{stopped++;},release:async()=>{released++;}};},SourceType:{SOURCE_TYPE_MIC:0}};
 const h=host({'@ohos.multimedia.audio':audio,'@ohos.abilityAccessCtrl':{createAtManager:()=>({requestPermissionsFromUser:async()=>({authResults:[permission]})})}}),{NativeSpeechInput}=h.load('NativeSpeechInput');
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 1;});t.mock.method(globalThis,'clearTimeout',()=>{});
 const input=new NativeSpeechInput(),wav=Buffer.from(await input.capture({}),'base64');assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt32LE(40),4096);assert.equal(released,1);
 permission=-1;await assert.rejects(input.capture({}),/未授权/);assert.equal(released,1);permission=0;
 t.mock.method(globalThis,'setTimeout',()=>1);const pending=input.capture({});await new Promise(r=>setImmediate(r));input.cancel();await assert.rejects(pending,/取消/);assert.equal(released,2);assert.ok(stopped>=2);
});
