import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../panel.js',import.meta.url),'utf8').split('let readingHardware=false')[1].split('// Persistent real observations')[0];
function runtime(){
 let now=100000,response,release;const nodes=new Map(),events={},timers=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',className:'',addEventListener:(name,fn)=>{events[id+':'+name]=fn;}});return nodes.get(id);};
 class Clock extends Date{static now(){return now;}}
 const document={hidden:false,addEventListener:(name,fn)=>{events[name]=fn;}};
 const context=vm.createContext({$,Date:Clock,document,window:{addEventListener:(name,fn)=>{events[name]=fn;}},setInterval:(fn,ms)=>{timers.push({fn,ms});},timestamp:()=> 'server-time',request:async()=>{if(release===true)await new Promise(r=>{release=r;});return response;}});
 response={simulated:false,deviceId:'hh-hsp101-001',actuationAvailable:false,deviceOnline:false,values:{},quality:{coValid:false,co2Valid:false}};
 vm.runInContext('let readingHardware=false'+source,context);
 return {$,context,events,document,setNow:n=>{now=n;},respond:r=>{response=r;},defer:()=>{release=true;},release:()=>{if(typeof release==='function')release();},read:()=>vm.runInContext('refreshHardware()',context),render:()=>vm.runInContext('renderHardware()',context)};
}
const frame=()=>({simulated:false,deviceId:'hh-hsp101-001',actuationAvailable:false,deviceOnline:true,receivedAt:50000,sampleAgeMs:100,climateAgeMs:200,gasAgeMs:100,values:{temperatureC:25.3,humidityPct:62.1,gasRaw:500,gasMv:890},quality:{temperatureValid:true,humidityValid:true,gasValid:true,coValid:false,co2Valid:false}});
const settle=()=>new Promise(r=>setImmediate(r));
test('真实硬件页面：显示单位、接收时间与年龄，过期不保留旧正常值',async()=>{
 const r=runtime();await settle();r.respond(frame());await r.read();assert.match(r.$('hardware-status').textContent,/25.3 ℃/);assert.match(r.$('hardware-timing').textContent,/server-time/);assert.match(r.$('hardware-timing').textContent,/0.2 秒/);
 r.setNow(110000);r.render();assert.match(r.$('hardware-status').textContent,/温度：未知/);assert.doesNotMatch(r.$('hardware-status').textContent,/25.3/);
});
test('真实硬件页面：后台恢复与离线使在途响应作废',async()=>{
 const r=runtime();await settle();r.respond(frame());r.defer();const pending=r.read();await settle();r.events.offline();r.release();await pending;assert.match(r.$('hardware-connection').textContent,/未知/);
 r.document.hidden=true;r.events.visibilitychange();assert.match(r.$('hardware-timing').textContent,/后台/);
});
test('真实硬件页面：质量无效不显示数值，坏身份与年龄明确未知',async()=>{
 const r=runtime();await settle();const f=frame();f.quality.temperatureValid=false;await (r.respond(f),r.read());assert.match(r.$('hardware-status').textContent,/温度：未知/);
 for(const change of [{deviceId:'hsp-demo-001'},{sampleAgeMs:10000},{receivedAt:null}]){r.respond({...frame(),...change});await r.read();assert.match(r.$('hardware-connection').textContent,/未知/);}
});
