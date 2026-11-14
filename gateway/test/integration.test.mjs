import test from 'node:test';
import assert from 'node:assert/strict';
import {startDemo} from '../runtime.mjs';
const until=async(fn)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('state_timeout');};
test('真实本机 MQTT 链路：遥测、拒止、回执、通风、急停和终端失联',{timeout:15000},async()=>{
 const r=await startDemo({mqttPort:0,httpPort:0,tickMs:100});
 try{
  await until(()=>r.snapshot().deviceOnline);
  assert.equal((await r.command('request_access')).status,'executed');
  await r.scenario('co');await until(()=>r.snapshot().frame.values.coPpm===65);
  assert.equal((await r.command('request_access')).status,'rejected');
  assert.equal((await r.command('ventilate')).status,'executed');
  await until(()=>r.snapshot().events.some(e=>e.detail.reason==='verification_passed'));
  await r.scenario('emergency');assert.equal((await r.command('ventilate')).status,'rejected');
  await r.scenario('offline');await assert.rejects(r.command('request_access'),/device_unavailable/);
  const health=await fetch(`http://127.0.0.1:${r.httpPort}/api/health`).then(x=>x.json());assert.equal(health.hardwareConnected,false);
  const denied=await fetch(`http://127.0.0.1:${r.httpPort}/api/command`,{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({action:'ventilate'})});assert.equal(denied.status,403);
 }finally{await r.close();}
});


test('管理面板只读加载、同源手动指令与协议状态',{timeout:15000},async()=>{
 const recorded=[],journal={append:async e=>{recorded.push(e);},status:()=>({enabled:true,healthy:true,records:recorded.length}),flush:async()=>{}};
 const r=await startDemo({mqttPort:0,httpPort:0,tickMs:100,journal});
 const base=`http://127.0.0.1:${r.httpPort}`;
 try{
  await until(()=>r.snapshot().deviceOnline);
  const page=await fetch(base+'/');assert.match(page.headers.get('content-type'),/text\/html/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await page.text(),/真实采集服务/);
  assert.match(await fetch(base+'/panel.js').then(x=>x.text()),/window.confirm/);
  assert.equal((await fetch(base+'/panel.css')).status,200);
  assert.equal((await fetch(base+'/../runtime.mjs')).status,404);
  assert.equal(recorded.length,0,'GET页面不产生控制请求');
  const model=await fetch(base+'/api/agent/status').then(x=>x.json());assert.equal(model.executesDevices,false);assert.equal('key' in model,false);
  const ack=await fetch(base+'/api/command',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'query_environment'})}).then(x=>x.json());
  assert.equal(ack.status,'executed');assert.equal(ack.simulated,true);
  assert.ok(recorded.some(e=>e.event==='command_requested'&&e.detail.commandId===ack.commandId));assert.ok(recorded.some(e=>e.event==='command_ack'&&e.detail.commandId===ack.commandId));
  const snap=await fetch(base+'/api/device').then(x=>x.json());assert.equal(snap.journal.enabled,true);
  assert.equal((await fetch(base+'/',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(base+'/api/health').then(x=>x.json())).hardwareConnected,false);
 }finally{await r.close();}
});


