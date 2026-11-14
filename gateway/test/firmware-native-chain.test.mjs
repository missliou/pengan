import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import vm from 'node:vm';
import {startCloudServer} from '../cloud-server.mjs';
import {CloudSecurity} from '../cloud-security.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),sha=s=>createHash('sha256').update(s).digest('hex');

test('current C firmware formatter -> real board HTTP -> actual native parser/uploader -> authenticated Web history',async t=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/firmware-http-frame.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
 const c=readFileSync(path.join(root,'firmware/hh-hsp101/src/dashboard.c'),'utf8');
 const producer=c.slice(c.indexOf('size_t dash_pengan_json'),c.indexOf('static void pengan_telemetry')).trim().replace(/\r\n/g,'\n');
 assert.equal(sha(producer),fixture.producerSha256,'Regenerate fixture with actual C formatter after firmware changes');assert.equal(fixture.synthetic,true);
 const board=createServer((req,res)=>{assert.equal(req.url,'/api/pengan/telemetry');res.setHeader('content-type','application/json');res.end(JSON.stringify(fixture.frame));});
 await new Promise(resolve=>board.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>board.close(resolve)));
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-chain-'));let cloud;t.after(async()=>{await cloud?.close();await rm(dir,{recursive:true,force:true});});
 const token='synthetic-chain-device-token-0123456789',password='synthetic-chain-admin-password';
 cloud=await startCloudServer({dataDir:dir,publicOrigin:'http://127.0.0.1:0',users:[{username:'admin',role:'admin',passwordHash:await CloudSecurity.hashPassword(password)}],devices:[{gatewayId:'chain-dayu',tokenSha256:sha(token)}]});
 const require=createRequire(import.meta.url),ts=require(path.join(root,'openharmony/node_modules/@ohos/hvigor/node_modules/typescript/lib/typescript.js')),cache=new Map();
 const http={RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:0},createHttp:()=>({async request(url,options){
   let mapped;if(url==='http://192.168.1.101/api/pengan/telemetry')mapped='http://127.0.0.1:'+board.address().port+'/api/pengan/telemetry';
   else {assert.ok(url.startsWith('https://chain.test/'));mapped=cloud.publicOrigin+url.slice('https://chain.test'.length);}
   const r=await fetch(mapped,{method:options.method,headers:options.header,body:options.extraData});return {responseCode:r.status,result:await r.text()};
 },destroy(){}})};
 const load=file=>{if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);
   const scoped=name=>name==='@ohos.net.http'?{default:http}:name==='@ohos.util'?{default:{TextEncoder:class{encodeInto(s){return new TextEncoder().encode(s);}}}}:name==='@ohos.data.preferences'?{default:{}}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ets')):(()=>{throw Error('unmapped native dependency '+name);})();
   const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
   vm.runInThisContext('(function(require,module,exports){'+js+'\n})',{filename:file})(scoped,m,m.exports);return m.exports;
 };
 const services=path.join(root,'openharmony/entry/src/main/ets/services');
 const parser=new (load(path.join(services,'DirectTelemetry.ets')).DirectTelemetry)();parser.configure('192.168.1.101');
 const sample=await parser.pollOnce();assert.equal(sample.deviceOnline,true);assert.equal(sample.values.temperatureC,25.6);assert.equal(sample.values.coPpm,null);
 const uploader=new (load(path.join(services,'CloudUpload.ets')).CloudUpload)();uploader.configure('https://chain.test','chain-dayu',token);
 const envelope={sessionBootId:sample.sessionBootId,sampleAgeMs:sample.sampleAgeMs,frameJson:JSON.stringify(sample.frame)};
 await uploader.upload(envelope);await uploader.upload(envelope);
 const login=await fetch(cloud.publicOrigin+'/admin-api/session/login',{method:'POST',headers:{origin:cloud.publicOrigin,'content-type':'application/json'},body:JSON.stringify({username:'admin',password})});assert.equal(login.status,200);
 const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
 const current=await(await fetch(cloud.publicOrigin+'/api/observations?gatewayId=chain-dayu',{headers})).json();
 assert.equal(current.hardware.values.temperatureC,sample.values.temperatureC);assert.equal(current.gatewayId,'chain-dayu');assert.equal(current.hardware.uptimeMs,sample.uptimeMs);
 const history=await(await fetch(cloud.publicOrigin+'/api/hardware/history?gatewayId=chain-dayu',{headers})).json();
 assert.equal(history.items.length,1);assert.equal(history.items[0].observation.uptimeMs,fixture.frame.uptime_ms);assert.equal(history.items[0].sessionBootId,sample.sessionBootId);
 assert.equal(history.items[0].observation.values.coPpm,null);assert.equal(history.gatewayId,'chain-dayu');assert.equal(history.isCurrent,false);
 // TLS is explicitly adapted to loopback for this host test, not real certificate acceptance.
});
