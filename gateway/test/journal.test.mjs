import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {EventJournal} from '../journal.mjs';
test('服务端日志串行落盘、重启恢复、篡改与截断拒绝',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-journal-')),file=path.join(dir,'events.jsonl');
 try{
 const journal=await new EventJournal(file).open();await Promise.all(Array.from({length:12},(_,i)=>journal.append({at:i,event:'command_ack',detail:{commandId:String(i),status:'executed'}})));
 assert.equal(journal.status().records,12);const restored=await new EventJournal(file).open();assert.equal(restored.status().records,12);
 const text=await readFile(file,'utf8');await writeFile(file,text.replace('executed','rejected'));await assert.rejects(new EventJournal(file).open(),/integrity/);
 await writeFile(file,text.slice(0,-1));await assert.rejects(new EventJournal(file).open(),/incomplete/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('服务端日志写入故障后保持不可用，禁止误报持久化成功',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-journal-')),file=path.join(dir,'events.jsonl');
 try{
 const journal=await new EventJournal(file).open();await rm(dir,{recursive:true,force:true});
 await assert.rejects(journal.append({at:1,event:'command_ack',detail:{status:'executed'}}));
 assert.equal(journal.status().healthy,false);assert.equal(journal.status().records,0);
 await assert.rejects(journal.append({at:2,event:'command_ack',detail:{}}),/unavailable/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
