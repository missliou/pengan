import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,decide,hashRecord,verifyChain} from '../prototype/safety.js';
const now=1_000_000;
const normal=()=>({co:4,co2:680,at:now,sensorOnline:true,emergency:false});
test('CO 与 CO₂ 独立触发拒止，边界包含阈值',()=>{
 assert.equal(evaluate(normal(),now).allowed,true);
 for(const overrides of [{co:30},{co2:1500},{co:60,co2:680}])assert.equal(decide({...normal(),...overrides},'access',now).ok,false);
});
test('失联、过期、无效数据、急停均不允许准入',()=>{
 for(const overrides of [{sensorOnline:false},{at:now-15001},{at:now+5000},{co:NaN},{co2:-1},{emergency:true}])assert.equal(evaluate({...normal(),...overrides},now).allowed,false);
});
test('断云不是本地规则输入；急停禁止通风，未知工具拒绝',()=>{
 assert.equal(decide(normal(),'access',now).ok,true);
 assert.equal(decide({...normal(),co:65},'ventilate',now).ok,true);
 assert.equal(decide({...normal(),emergency:true},'ventilate',now).ok,false);
 assert.equal(decide(normal(),'force_unlock',now).ok,false);
});
test('哈希链发现内容篡改、删中间记录、调换顺序',async()=>{
 let prev='GENESIS';const rows=[];
 for(let id=1;id<=3;id++){const record={id,result:'允许',snapshot:{co:4,co2:680}};const hash=await hashRecord(record,prev);rows.push({...record,prev,hash});prev=hash;}
 assert.equal((await verifyChain(rows)).ok,true);
 const changed=structuredClone(rows);changed[1].result='篡改';assert.deepEqual(await verifyChain(changed),{ok:false,index:1});
 assert.equal((await verifyChain([rows[0],rows[2]])).ok,false);
 assert.equal((await verifyChain([rows[1],rows[0],rows[2]])).ok,false);
});
