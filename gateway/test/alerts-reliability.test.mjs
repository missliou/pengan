import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {CloudHistory} from '../cloud-history.mjs';
import {AlertCenter,deriveFaults} from '../alerts.mjs';
const NOW=1000000;
const device=(over={})=>({gatewayId:'dayu-a',hasSession:true,lastAcceptedAt:NOW-1000,snapshot:{receivedAt:NOW-1000,sampleAgeMs:1000,deviceOnline:true,reason:'read_only_hardware',quality:{temperatureValid:true,humidityValid:true,gasValid:true}},...over});
const inputs=(tasks=[],d=device())=>({devices:[d],tasks});
const stages=state=>['decision','generate','verify'].map(stage=>({stage,state,error:state==='failed'?'model_unavailable':null}));
const task=(over={})=>({taskId:'task-a',gatewayId:'dayu-a',status:'completed',finishedAt:NOW-100,verdict:'needs_human',stages:stages('failed'),...over});
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'pengan-alert-race-'));t.after(()=>rm(dir,{recursive:true,force:true}));const history=await new CloudHistory({file:path.join(dir,'history.jsonl')}).open();return{history,center:await new AlertCenter({history,now:()=>NOW}).open()};}
test('concurrent differing notes: one committed, one conflicts; no acknowledged note lost after restart',async t=>{
 const {history,center}=await fixture(t);const d=device();d.snapshot.reason='hardware_read_failed';await center.reconcile({gatewayId:'dayu-a',inputs:inputs([],d)});const alertId=center.list({gatewayId:'dayu-a'}).items[0].alertId;
 const body={gatewayId:'dayu-a',alertId,action:'note',expectedRevision:1,actor:'admin'};
 const results=await Promise.allSettled([center.submit({...body,text:'first'}),center.submit({...body,text:'second'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/revision_conflict/);
 const restored=await new AlertCenter({history,now:()=>NOW}).open();assert.deepEqual(restored.detail({gatewayId:'dayu-a',alertId}).notes.map(n=>n.text),['first']);
});
test('concurrent reconcile creates one alert, and serialized ack/reconcile preserves confirmation',async t=>{
 const {center}=await fixture(t);const d=device();d.snapshot.reason='hardware_read_failed';
 await Promise.all([center.reconcile({gatewayId:'dayu-a',inputs:inputs([],d)}),center.reconcile({gatewayId:'dayu-a',inputs:inputs([],d)})]);const list=center.list({gatewayId:'dayu-a'});assert.equal(list.items.length,1);assert.equal(list.items[0].occurrences,2);
 const first=list.items[0];await Promise.all([center.submit({gatewayId:'dayu-a',alertId:first.alertId,action:'ack',expectedRevision:first.revision,actor:'admin'}),center.reconcile({gatewayId:'dayu-a',inputs:inputs([],d)})]);assert.equal(center.detail({gatewayId:'dayu-a',alertId:first.alertId}).acknowledged,true);
});
test('aged frame is stale immediately even if accepted a moment ago; offline still tracks connection silence',()=>{
 const d=device({lastAcceptedAt:NOW-1000,snapshot:{deviceOnline:false,reason:'telemetry_stale',receivedAt:NOW-10000,sampleAgeMs:null,quality:{}}});
 assert.deepEqual(deriveFaults(inputs([],d),NOW).map(f=>f.type),['telemetry_stale']);
 d.snapshot.receivedAt=NOW-60000;assert.deepEqual(deriveFaults(inputs([],d),NOW).map(f=>f.type),['telemetry_stale']);
 d.lastAcceptedAt=NOW-60000;assert.deepEqual(deriveFaults(inputs([],d),NOW).map(f=>f.type),['device_offline']);
});
test('completed job containing failed model stages emits model fault regardless of safety verdict',()=>{
 for(const verdict of ['block','needs_human','allow'])assert.ok(deriveFaults(inputs([task({verdict})]),NOW).some(f=>f.type==='model_task_failed'));
 assert.equal(deriveFaults(inputs([task({verdict:'block',stages:stages('blocked')})]),NOW).length,0);
});
test('later blocked or stage-failed completed task cannot recover earlier model fault',async t=>{
 const {center}=await fixture(t),failed=task({finishedAt:NOW-1000});await center.reconcile({gatewayId:'dayu-a',inputs:inputs([failed])});const alertId=center.list({gatewayId:'dayu-a'}).items[0].alertId;
 const blocked=task({taskId:'task-b',verdict:'block',stages:stages('blocked')});await center.reconcile({gatewayId:'dayu-a',inputs:inputs([failed,blocked]),mode:'read'});assert.equal(center.detail({gatewayId:'dayu-a',alertId}).state,'open');
 const success=task({taskId:'task-success',verdict:'allow',finishedAt:NOW,stages:stages('passed')});await center.reconcile({gatewayId:'dayu-a',inputs:inputs([failed,success]),mode:'read'});assert.equal(center.detail({gatewayId:'dayu-a',alertId}).state,'recovered');
});
test('stale frame or backward clock cannot falsely recover an existing stale alarm',async t=>{
 const {center}=await fixture(t),stale=device({snapshot:{deviceOnline:false,reason:'telemetry_stale',receivedAt:NOW-10000,quality:{}}});await center.reconcile({gatewayId:'dayu-a',inputs:inputs([],stale)});const alertId=center.list({gatewayId:'dayu-a'}).items[0].alertId;
 stale.lastAcceptedAt=NOW;await center.reconcile({gatewayId:'dayu-a',inputs:inputs([],stale)});assert.equal(center.detail({gatewayId:'dayu-a',alertId}).state,'open');
 stale.lastAcceptedAt=NOW+1;stale.snapshot={...device().snapshot,receivedAt:NOW+1};await center.reconcile({gatewayId:'dayu-a',inputs:inputs([],stale)});assert.equal(center.detail({gatewayId:'dayu-a',alertId}).state,'open');
});
