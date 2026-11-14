import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {KnowledgeStore} from '../knowledge-store.mjs';
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'pengan-knowledge-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'knowledge.json');return {file,store:await new KnowledgeStore({file}).open()};}
const doc=(patch={})=>({gatewayId:'dayu-a',title:'温室通风参考',source:'厂家手册第3页',text:'温室湿度偏高时应检查通风，观察作物叶片。知识仅作参考，不能代替安全传感器。',...patch});

test('knowledge requires absolute path, readiness and bounded safe inputs',async t=>{
 assert.throws(()=>new KnowledgeStore({file:'relative.json'}),/absolute/);
 const h=await fixture(t);const pending=new KnowledgeStore({file:h.file});assert.throws(()=>pending.list('a'),/not_ready/);
 for(const bad of [{text:''},{title:' '},{text:'x'.repeat(40001)},{id:'../escape'},{gatewayId:'a/b'},{source:'x'.repeat(501)},{text:'bad\0text'},{unexpected:'field'}])await assert.rejects(h.store.upsert(doc(bad)),/invalid/);
 assert.throws(()=>h.store.search('x','dayu-a',11),/query/);assert.throws(()=>h.store.search('x','../a'),/scope/);
});

test('knowledge persists metadata and Chinese chunks with verifiable hashes',async t=>{
 const h=await fixture(t),created=await h.store.upsert(doc());assert.match(created.id,/^[A-Za-z0-9_-]+$/);assert.equal(created.trust,'untrusted-reference');assert.ok(!Object.hasOwn(created,'text'));
 const hits=h.store.search('温室湿度通风','dayu-a');assert.ok(hits.length);assert.equal(hits[0].documentId,created.id);assert.equal(hits[0].source,'厂家手册第3页');assert.equal(hits[0].contentSha256,createHash('sha256').update(hits[0].content).digest('hex'));
 const reopened=await new KnowledgeStore({file:h.file}).open();assert.equal(reopened.list('dayu-a')[0].contentSha256,created.contentSha256);assert.deepEqual(reopened.search('通风','dayu-a'),h.store.search('通风','dayu-a'));
});

test('knowledge searches English case-insensitively and never fabricates missing hits',async t=>{
 const h=await fixture(t);await h.store.upsert(doc({title:'sensor manual',text:'Humidity sensor calibration uses a reference instrument.'}));
 assert.equal(h.store.search('CALIBRATION','dayu-a').length,1);assert.deepEqual(h.store.search('不相关术语','dayu-a'),[]);assert.deepEqual(h.store.search('!!!','dayu-a'),[]);
});

test('knowledge isolates device scopes and forbids moving another device document',async t=>{
 const h=await fixture(t),a=await h.store.upsert(doc());await h.store.upsert(doc({gatewayId:'dayu-b',title:'隔离设备说明',text:'隔离设备专有说明'}));
 assert.equal(h.store.list('dayu-a').length,1);assert.deepEqual(h.store.search('通风','dayu-b'),[]);
 await assert.rejects(h.store.upsert(doc({id:a.id,gatewayId:'dayu-b'})),/scope_mismatch/);
 const hits=h.store.search('通风','dayu-a');hits[0].content='mutated';assert.notEqual(h.store.search('通风','dayu-a')[0].content,'mutated');
});

test('knowledge updates same document, serializes concurrent writes, and retrieves later chunks',async t=>{
 const h=await fixture(t),a=await h.store.upsert(doc());await h.store.upsert(doc({id:a.id,title:'替换标题',text:'替换后的内容'}));assert.equal(h.store.list('dayu-a').length,1);assert.deepEqual(h.store.search('通风','dayu-a'),[]);
 await Promise.all([h.store.upsert(doc({title:'A',text:'a'.repeat(500)+'特定检索目标'})),h.store.upsert(doc({title:'B',text:'other manual'}))]);
 await h.store.flush();const reopened=await new KnowledgeStore({file:h.file}).open();assert.equal(reopened.list('dayu-a').length,3);const hits=reopened.search('检索目标','dayu-a');assert.ok(hits.some(h=>h.chunkId.endsWith(':320')));assert.ok(hits.every(h=>h.content.length<=400));
});

test('knowledge corrupt file and mismatching hashes fail closed',async t=>{
 const h=await fixture(t);await h.store.upsert(doc());const data=JSON.parse(await readFile(h.file,'utf8'));data.documents[0].text='tampered';await writeFile(h.file,JSON.stringify(data));
 await assert.rejects(new KnowledgeStore({file:h.file}).open(),/unavailable/);
 await writeFile(h.file,'{broken');await assert.rejects(new KnowledgeStore({file:h.file}).open(),/unavailable/);
});

test('knowledge failed atomic replacement preserves prior in-memory state',async t=>{
 const h=await fixture(t);await h.store.upsert(doc());await rename(h.file,h.file+'.backup');await mkdir(h.file);
 await assert.rejects(h.store.upsert(doc({title:'failed new document'})),/write_failed/);assert.equal(h.store.list('dayu-a').length,1);
});

test('knowledge document and UTF8 byte capacities reject without silently deleting records',async t=>{
 const h=await fixture(t);
 for(let i=0;i<100;i++)await h.store.upsert(doc({id:'doc-'+i,text:'reference '+i}));
 await assert.rejects(h.store.upsert(doc({id:'extra'})),/capacity/);assert.equal(h.store.list('dayu-a').length,100);
 const other=await fixture(t);let exceeded=false;
 for(let i=0;i<30;i++){try{await other.store.upsert(doc({id:'big-'+i,text:'中'.repeat(40000)}));}catch(error){assert.match(error.message,/capacity/);exceeded=true;break;}}
 assert.equal(exceeded,true);assert.ok((await readFile(other.file)).byteLength<=2*1024*1024);
});
