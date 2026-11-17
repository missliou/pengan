import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {CloudSecurity} from '../cloud-security.mjs';
import {startCloudServer} from '../cloud-server.mjs';
import {DeviceCredentials} from '../cloud-server.mjs';
import {DayuIngress} from '../dayu-ingest.mjs';

// 演示期明文HTTP只允许回环与私有局域网；公网地址仍必须HTTPS。
test('plaintext HTTP origin is limited to loopback and private LAN',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-origin-'));
 t.after(async()=>{await rm(dir,{recursive:true,force:true});});
 const passwordHash=await CloudSecurity.hashPassword('synthetic-origin-password-2026');
 const token='synthetic-origin-token-0123456789',digest=createHash('sha256').update(token).digest('hex');
 const base={dataDir:dir,users:[{username:'admin',role:'admin',passwordHash}],devices:[{gatewayId:'dayu-a',tokenSha256:digest}]};
 for(const publicOrigin of ['http://8.8.8.8:5201','http://pengan.example.com','https://user:pw@cloud.example','https://cloud.example/path'])
  await assert.rejects(startCloudServer({...base,publicOrigin}),/cloud_https_required/);
 for(const publicOriginHost of ['8.8.8.8','0.0.0.0','localhost'])
  await assert.rejects(startCloudServer({...base,publicOrigin:'http://127.0.0.1:0',publicOriginHost}),/cloud_listen_host_must_be_private_ipv4/);
});

test('private LAN plaintext demo serves the admin API with non-secure session cookie',async t=>{
 let runtime;
 t.after(async()=>{await runtime?.close();});
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-lan-'));
 t.after(async()=>{await rm(dir,{recursive:true,force:true});});
 const password='synthetic-lan-password-2026',passwordHash=await CloudSecurity.hashPassword(password);
 const token='synthetic-lan-token-0123456789',digest=createHash('sha256').update(token).digest('hex');
 runtime=await startCloudServer({dataDir:dir,publicOrigin:'http://192.168.1.20:'+(await freePort()),publicOriginHost:'127.0.0.1',
  users:[{username:'admin',role:'admin',passwordHash}],devices:[{gatewayId:'dayu-a',tokenSha256:digest}]});
 assert.equal(runtime.publicOrigin.startsWith('http://192.168.1.20:'),true);
 const origin=runtime.publicOrigin;
 const login=await fetch('http://127.0.0.1:'+runtime.port+'/admin-api/session/login',{method:'POST',
  headers:{origin,host:new URL(origin).host,'content-type':'application/json'},body:JSON.stringify({username:'admin',password})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');
 assert.match(cookie,/^pengan-session=/);assert.equal(/;\s*Secure/i.test(cookie),false);
 const session=await login.json(),headers={cookie:cookie.split(';')[0],origin,'x-pengan-csrf':session.csrfToken};
 const probe=new DayuIngress({gatewayId:'dayu-a',tokenSha256:digest,file:path.join(dir,'devices','dayu-a-state.json')});
 // 摘要命中即通过；只有令牌被改动或缺失时才拒绝。authenticate 不依赖 open() 完成。
 assert.doesNotThrow(()=>probe.authenticate(token));
 assert.throws(()=>probe.authenticate(token+'x'),/device_unauthorized/);
 assert.throws(()=>probe.authenticate(''),/device_unauthorized/);
 // dayu-a 在配置里有摘要，因此装载的是 DayuIngress：持有正确令牌的请求必须被接受。
 const deviceHeaders={authorization:'Bearer '+token,'x-pengan-gateway-id':'dayu-a'};
 assert.equal((await fetch('http://127.0.0.1:'+runtime.port+'/api/v1/device/speech/status',{headers:deviceHeaders})).status,200);
 // 令牌错误或设备ID未登记时必须拒绝。
 const wrongToken={...deviceHeaders,authorization:'Bearer '+token+'x'};
 assert.equal((await fetch('http://127.0.0.1:'+runtime.port+'/api/v1/device/speech/status',{headers:wrongToken})).status,401);
 const unknownDevice={...deviceHeaders,'x-pengan-gateway-id':'dayu-unregistered'};
 assert.equal((await fetch('http://127.0.0.1:'+runtime.port+'/api/v1/device/speech/status',{headers:unknownDevice})).status,401);
 const current=await fetch('http://127.0.0.1:'+runtime.port+'/api/observations?gatewayId=dayu-a',{headers});
 assert.equal(current.status,200);
});

// 设备令牌必须能在后台生成后立即用于上报：这是演示当天最容易卡住的一环。
test('admin issues a device token that authenticates a real telemetry upload',async t=>{
 let runtime;
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-token-'));
 t.after(async()=>{await runtime?.close();});
 t.after(async()=>{await rm(dir,{recursive:true,force:true});});
 const password='synthetic-token-password-2026',passwordHash=await CloudSecurity.hashPassword(password);
 const demoOrigin='http://192.168.1.20:'+(await freePort());
 runtime=await startCloudServer({dataDir:dir,publicOrigin:demoOrigin,publicOriginHost:'127.0.0.1',
  users:[{username:'admin',role:'admin',passwordHash}],devices:[{gatewayId:'dayu-demo'}],deviceCredentials:new DeviceCredentials()});
 const origin=runtime.publicOrigin,h={origin,host:new URL(origin).host,'content-type':'application/json'};
 const login=await fetch('http://127.0.0.1:'+runtime.port+'/admin-api/session/login',{method:'POST',headers:h,body:JSON.stringify({username:'admin',password})});
 assert.equal(login.status,200);
 const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0],
  admin={cookie,origin,'content-type':'application/json','x-pengan-csrf':session.csrfToken};
 const before=await fetch('http://127.0.0.1:'+runtime.port+'/admin-api/devices',{headers:{cookie}});
 const listed=await before.json();
 assert.equal(listed.items[0].tokenConfigured,false);
 assert.equal(listed.items[0].hardware.deviceOnline,false);
 assert.equal(listed.items[0].hardware.reason,'device_token_not_issued');
 const issued=await fetch('http://127.0.0.1:'+runtime.port+'/admin-api/devices/token',{method:'POST',headers:admin,body:JSON.stringify({gatewayId:'dayu-demo'})});
 assert.equal(issued.status,200);
 const credential=await issued.json();
 assert.match(credential.token,/^[A-Za-z0-9_-]{32,}$/);
 assert.equal(credential.persisted,false);
 assert.ok(!JSON.stringify(runtime.deviceCredentials.sha256('dayu-demo')).includes(credential.token));
 const again=await fetch('http://127.0.0.1:'+runtime.port+'/admin-api/devices/token',{method:'POST',headers:admin,body:JSON.stringify({gatewayId:'dayu-demo'})});
 assert.equal(again.status,400);assert.equal((await again.json()).error,'device_token_exists');
 // 真实模式帧：缺值一律为 null，且身份段固定为 hh-hsp101-001（不因演示放宽）。
 const frame={schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,controlSupported:false,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,uptime_ms:1000,th_ok:true,gas_ok:true,th_sample_age_ms:500,gas_sample_age_ms:500,temperature10:253,humidity10:612,gas_raw:1800,gas_mv:900};
 const upload=await fetch('http://127.0.0.1:'+runtime.port+'/api/v1/telemetry/current',{method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer '+credential.token,'x-pengan-gateway-id':'dayu-demo','x-pengan-sent-at':String(Date.now()-500)},
  body:JSON.stringify({schemaVersion:1,gatewayId:'dayu-demo',sessionBootId:'boot-demo-1',sampleAgeMs:500,frame})});
 const uploaded=await upload.json();
 assert.equal(upload.status,200,'upload='+JSON.stringify(uploaded));
 assert.equal(uploaded.accepted,true);
 const after=await (await fetch('http://127.0.0.1:'+runtime.port+'/admin-api/devices',{headers:{cookie}})).json();
 assert.equal(after.items[0].tokenConfigured,true);
 assert.equal(after.items[0].hardware.deviceOnline,true);
});

// 重启恢复：摘要台账里存的是 SHA-256 摘要，恢复时必须直接当摘要装载，不能再散列一次。
test('issued device token still authenticates after a service restart',async t=>{
 let first,second;
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-restart-'));
 t.after(async()=>{await first?.close();await second?.close();});
 t.after(async()=>{await rm(dir,{recursive:true,force:true});});
 const password='synthetic-restart-password-2026',passwordHash=await CloudSecurity.hashPassword(password);
 const demoOrigin='http://192.168.1.20:'+(await freePort());
 const start=()=>startCloudServer({dataDir:dir,publicOrigin:demoOrigin,publicOriginHost:'127.0.0.1',
  users:[{username:'admin',role:'admin',passwordHash}],devices:[{gatewayId:'dayu-restart'}]});
 first=await start();
 const origin=first.publicOrigin,h={origin,host:new URL(origin).host,'content-type':'application/json'};
 const login=await fetch('http://127.0.0.1:'+first.port+'/admin-api/session/login',{method:'POST',headers:h,body:JSON.stringify({username:'admin',password})});
 assert.equal(login.status,200);
 const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0],
  admin={cookie,origin,'content-type':'application/json','x-pengan-csrf':session.csrfToken};
 const issued=await fetch('http://127.0.0.1:'+first.port+'/admin-api/devices/token',{method:'POST',headers:admin,body:JSON.stringify({gatewayId:'dayu-restart'})});
 assert.equal(issued.status,200);
 const credential=await issued.json();
 const ledgerText=await readFile(path.join(dir,'device-tokens.json'),'utf8');
 // 落盘只允许摘要：明文令牌绝不出现，且存的摘要与签发响应一致。
 assert.equal(ledgerText.includes(credential.token),false);
 assert.deepEqual(JSON.parse(ledgerText).devices,{'dayu-restart':credential.tokenSha256});
 await first.close();first=null;
 second=await start();
 const frame={schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,controlSupported:false,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,uptime_ms:1000,th_ok:true,gas_ok:true,th_sample_age_ms:500,gas_sample_age_ms:500,temperature10:253,humidity10:612,gas_raw:1800,gas_mv:900};
 const upload=token=>fetch('http://127.0.0.1:'+second.port+'/api/v1/telemetry/current',{method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-pengan-gateway-id':'dayu-restart','x-pengan-sent-at':String(Date.now()-500)},
  body:JSON.stringify({schemaVersion:1,gatewayId:'dayu-restart',sessionBootId:'boot-restart-1',sampleAgeMs:500,frame})});
 const accepted=await upload(credential.token),uploaded=await accepted.json();
 assert.equal(accepted.status,200,'upload='+JSON.stringify(uploaded));
 assert.equal(uploaded.accepted,true);
 // 恢复摘要不得放宽校验：错一位的令牌与未签发的令牌在重启后的服务上仍被拒。
 const wrong=await upload(credential.token.slice(0,-1)+(credential.token.endsWith('A')?'B':'A'));
 assert.equal(wrong.status,401);
 assert.equal((await wrong.json()).error,'device_unauthorized');
 const missing=await upload('synthetic-unissued-token-0123456789abcdef');
 assert.equal(missing.status,401);
 assert.equal((await missing.json()).error,'device_unauthorized');
});

// 未发放令牌时任何人都不能上报，错误码必须明确指向发令牌这一步。
test('unissued device is rejected with device_token_not_issued',async t=>{
 let runtime;
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-notoken-'));
 t.after(async()=>{await runtime?.close();});
 t.after(async()=>{await rm(dir,{recursive:true,force:true});});
 const passwordHash=await CloudSecurity.hashPassword('synthetic-notoken-password-2026');
 runtime=await startCloudServer({dataDir:dir,publicOrigin:'http://127.0.0.1:0',users:[{username:'admin',role:'admin',passwordHash}],devices:[{gatewayId:'dayu-x'}]});
 const response=await fetch('http://127.0.0.1:'+runtime.port+'/api/v1/telemetry/current',{method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer synthetic-not-issued-token-012345','x-pengan-gateway-id':'dayu-x'},body:'{}'});
 assert.equal(response.status,400);
 assert.equal((await response.json()).error,'device_token_not_issued');
});

async function freePort(){const server=(await import('node:net')).createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
