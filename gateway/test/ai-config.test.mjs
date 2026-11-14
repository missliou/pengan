import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {AiConfigStore,validateConfig} from '../ai-config.mjs';import {startDemo} from '../runtime.mjs';
test('网页模型配置保存、保留密钥、热更新、清除与重启恢复，不回传密钥',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-ai-config-')),file=path.join(dir,'config.json'),store=new AiConfigStore(file);await store.open();
 const r=await startDemo({mqttPort:0,httpPort:0,configStore:store,plannerOptions:{provider:'none',model:'',key:''}}),base=`http://127.0.0.1:${r.httpPort}`;
 try{
 const initial=await fetch(base+'/api/agent/config').then(r=>r.json());assert.equal(initial.keySaved,false);
 const send=(data,token=initial.csrfToken)=>fetch(base+'/api/agent/config',{method:'POST',headers:{'Content-Type':'application/json','X-Pengan-Config-Token':token},body:JSON.stringify(data)});
 assert.equal((await send({provider:'deepseek',model:'test',key:'test-secret'},'bad')).status,403);
 let result=await send({provider:'deepseek',model:'test-model',key:'test-secret'});assert.equal(result.status,200);const text=await result.text();assert.ok(!text.includes('test-secret'));assert.equal(JSON.parse(text).keySaved,true);
 assert.equal((await fetch(base+'/api/agent/status').then(r=>r.json())).configured,true);
 result=await send({provider:'deepseek',model:'updated-model',key:''});assert.equal(result.status,200);assert.equal((await new AiConfigStore(file).open()).key,'test-secret');
 assert.equal((await send({provider:'qwen',model:'qwen-test',key:''})).status,422);
 assert.equal((await send({provider:'deepseek',model:'updated-model',clearKey:true})).status,200);
 assert.equal((await new AiConfigStore(file).open()).key,'');assert.equal((await fetch(base+'/api/agent/status').then(r=>r.json())).configured,false);
 assert.equal((await fetch(base+'/api/agent/config',{headers:{Origin:'https://bad.example'}})).status,403);
 }finally{await r.close();await rm(dir,{recursive:true,force:true});}
});
test('配置写入失败不替换服务端当前模型',{timeout:15000},async()=>{
 const r=await startDemo({mqttPort:0,httpPort:0,configStore:{save:async()=>{throw Error('config_save_failed')}},plannerOptions:{provider:'deepseek',model:'original',key:'test-secret'}}),base=`http://127.0.0.1:${r.httpPort}`;
 try{const {csrfToken}=await fetch(base+'/api/agent/config').then(r=>r.json());const res=await fetch(base+'/api/agent/config',{method:'POST',headers:{'Content-Type':'application/json','X-Pengan-Config-Token':csrfToken},body:JSON.stringify({provider:'qwen',model:'new',key:'new-test-secret'})});assert.equal(res.status,422);assert.equal((await fetch(base+'/api/agent/status').then(r=>r.json())).model,'original');}finally{await r.close();}
});

test('千问工作空间配置仅允许官方主机标签，保留/清除及切换服务商语义',()=>{
 const current={provider:'qwen',model:'test',key:'test-secret',workspaceId:'workspace-123'};
 assert.equal(validateConfig({provider:'qwen',model:'test',key:''},current).workspaceId,'workspace-123');
 assert.equal(validateConfig({provider:'qwen',model:'test',key:'',workspaceId:''},current).workspaceId,'');
 assert.equal(validateConfig({provider:'deepseek',model:'test',key:'test-secret'},current).workspaceId,'');
 for(const workspaceId of ['https://bad.example','a.b','a@b','../x','-prefix','x'.repeat(65)])assert.throws(()=>validateConfig({provider:'qwen',model:'test',key:'',workspaceId},current),/invalid_ai_config/);
});
