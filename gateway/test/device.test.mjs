import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulatedDevice} from '../device.mjs';
import {validateCommand,DEVICE_ID,validateTelemetry} from '../protocol.mjs';
let now=100000;
const command=(action='request_access',id='cmd-1')=>({version:1,deviceId:DEVICE_ID,commandId:id,action,parameters:action==='ventilate'?{maxRunMs:20000}:{},issuedAt:now,expiresAt:now+5000,source:'test',simulated:true});
test('命令拒绝跨设备、真实模式、过期、retained 和未知动作',()=>{
  const c=command();
  assert.equal(validateCommand(c,{now}),null);
  for(const change of [{deviceId:'other'},{simulated:false},{expiresAt:now},{action:'force_unlock'},{issuedAt:now+2000}])assert.ok(validateCommand({...c,...change},{now}));
  assert.equal(validateCommand(c,{now,retained:true}),'retained_command');
});
test('设备本地检查气体、急停和失效，命令不能携带环境覆盖',()=>{
 const d=new SimulatedDevice({now:()=>now});d.scenario('co');
 assert.equal(d.execute({...command(),environment:{co:4}}).status,'rejected');
 d.scenario('normal');d.scenario('emergency');assert.equal(d.execute(command('ventilate','cmd-2')).status,'rejected');
 d.scenario('clear_emergency');d.scenario('stale');assert.equal(d.execute(command('request_access','cmd-3')).status,'rejected');
});
test('重复投递不重复启动，命令 ID 冲突拒绝',()=>{
 const d=new SimulatedDevice({now:()=>now}),c=command('ventilate');
 assert.equal(d.execute(c).status,'executed');assert.equal(d.execute(c).duplicate,true);assert.equal(d.executions,1);
 assert.equal(d.execute({...c,action:'request_access'}).reason,'command_id_conflict');
});
test('通风超时与成功回采分开，急停立即停机',()=>{
 const d=new SimulatedDevice({now:()=>now});d.scenario('stale');d.execute(command('ventilate'));
 now+=20000;assert.equal(d.tick().reason,'fan_timeout');assert.equal(d.fan,false);
 d.scenario('co');d.execute(command('ventilate','cmd-2'));d.scenario('emergency');assert.equal(d.fan,false);
 d.scenario('clear_emergency');d.scenario('normal');d.execute(command('ventilate','cmd-3'));assert.equal(d.tick().reason,'verification_passed');
});
test('遥测有明确模拟标记，损坏帧和 NaN 不进入状态',()=>{
 const d=new SimulatedDevice({now:()=>now}),frame=d.telemetry();assert.equal(validateTelemetry(frame),true);
 assert.equal(validateTelemetry({...frame,simulated:false}),false);
 assert.equal(validateTelemetry({...frame,values:{...frame.values,coPpm:NaN}}),false);
});
test('通信断开不能停止本地风机超时检查',()=>{
 const d=new SimulatedDevice({now:()=>now});d.scenario('co');d.execute(command('ventilate','offline-fan'));
 d.scenario('offline');now+=20000;
 assert.equal(d.tick().reason,'fan_timeout');assert.equal(d.fan,false);
});
