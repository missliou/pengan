import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {CloudHistory} from '../cloud-history.mjs';
async function fixture(t,maxBytes){const dir=await mkdtemp(path.join(tmpdir(),'pengan-cloud-history-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'history.jsonl');return {file,history:await new CloudHistory({file,...(maxBytes?{maxBytes}:{})}).open()};}
test('full retained history paginates past 200 rows, survives restart and isolates devices',async t=>{
 const {file,history}=await fixture(t);
 for(let i=0;i<230;i++)await history.append({kind:'telemetry',gatewayId:i%2?'dayu-b':'dayu-a',data:{reading:i},key:'row-'+i});
 await history.flush();const restored=await new CloudHistory({file}).open();let beforeSeq,seen=[];
 do{const page=restored.query({limit:50,beforeSeq});seen.push(...page.items);beforeSeq=page.nextBeforeSeq;}while(beforeSeq!==null);
 assert.equal(seen.length,230);assert.equal(new Set(seen.map(r=>r.seq)).size,230);
 assert.equal(restored.query({gatewayId:'dayu-a',limit:200}).items.length,115);
 assert.equal(restored.status().externalCompletenessVerified,false);
});
test('idempotency persists and rejects conflicting content without duplicate append',async t=>{
 const {file,history}=await fixture(t),entry={kind:'analysis',gatewayId:'dayu-a',key:'same',data:{summary:'known'}};
 const first=await history.append(entry);assert.equal((await history.append(entry)).seq,first.seq);
 const restored=await new CloudHistory({file}).open();assert.equal((await restored.append(entry)).seq,first.seq);
 await assert.rejects(restored.append({...entry,data:{summary:'different'}}),/key_conflict/);assert.equal(restored.status().records,1);
});
test('corrupt or partial history fails closed and does not overwrite source',async t=>{
 const {file,history}=await fixture(t);await history.append({kind:'audit',gatewayId:'system',data:{event:'login',outcome:'success'}});
 const text=await readFile(file,'utf8');await writeFile(file,text+'{partial');
 const restored=new CloudHistory({file});await assert.rejects(restored.open(),/unavailable/);assert.throws(()=>restored.query(),/unavailable/);
 assert.equal(restored.ready,false);assert.equal(restored.healthy,false);assert.equal(restored.rows.length,0);
 assert.equal(await readFile(file,'utf8'),text+'{partial');
 await writeFile(file,text.replace('success','failure'));await assert.rejects(new CloudHistory({file}).open(),/unavailable/);
});
test('capacity and storage failures never acknowledge or silently discard older records',async t=>{
 const {file,history}=await fixture(t,1024);await history.append({kind:'telemetry',gatewayId:'dayu-a',data:{value:1}});
 await assert.rejects(history.append({kind:'telemetry',gatewayId:'dayu-a',data:{large:'x'.repeat(1000)}}),/capacity/);assert.equal(history.status().records,1);
 const blocked=path.join(path.dirname(file),'blocked');await mkdir(blocked);const bad=await new CloudHistory({file:blocked+'.jsonl'}).open();bad.file=blocked;
 await assert.rejects(bad.append({kind:'audit',gatewayId:'system',data:{event:'login'}}),/file_changed/);assert.equal(bad.status().healthy,false);
});
test('sensitive data names cannot leak through audit or other history',async t=>{
 const {history}=await fixture(t);for(const field of ['password','token','apiKey','wifi_ssid'])await assert.rejects(history.append({kind:'audit',gatewayId:'system',data:{nested:{[field]:'not-a-real-secret'}}}),/sensitive/);
 assert.equal(history.status().records,0);
});
test('external append, tail deletion and file removal disable writes including idempotent replay',async t=>{
 for(const mutation of [text=>text+'external\n',text=>'',()=>null]){
  const {file,history}=await fixture(t),entry={kind:'audit',gatewayId:'system',key:'once',data:{event:'login'}};
  await history.append(entry);const original=await readFile(file,'utf8'),altered=mutation(original);
  if(altered===null)await rm(file);else await writeFile(file,altered);
  await assert.rejects(history.append(entry),/file_changed/);assert.equal(history.status().healthy,false);
  assert.throws(()=>history.query(),/unavailable/);await assert.rejects(history.append({...entry,key:'next'}),/unavailable/);
  if(altered!==null)assert.equal(await readFile(file,'utf8'),altered);
 }
});
