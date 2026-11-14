import {pipelinePromptCatalog} from '../agent-pipeline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startCloudServer} from '../cloud-server.mjs';
import {CloudSecurity} from '../cloud-security.mjs';
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-rag-cloud-test-'));let runtime;
 const password='test-only-rag-login-12345',passwordHash=await CloudSecurity.hashPassword(password);
 const options={dataDir:dir,publicOrigin:'http://127.0.0.1:0',users:[{username:'admin',role:'admin',passwordHash},{username:'reader',role:'viewer',passwordHash}],devices:['dayu-a','dayu-b'].map(gatewayId=>({gatewayId,tokenSha256:createHash('sha256').update('test-device-only-'+gatewayId).digest('hex')})),fetchFn:async()=>{throw Error('no_real_model');}};
 async function start(){runtime=await startCloudServer(options);}await start();
 t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
 async function request(route,{body,headers={}}={}){return fetch(runtime.publicOrigin+route,{method:body===undefined?'GET':'POST',headers:{origin:runtime.publicOrigin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 async function login(name='admin'){const r=await request('/admin-api/session/login',{body:{username:name,password}});assert.equal(r.status,200);const data=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],'x-pengan-csrf':data.csrfToken};}
 return {request,login,start,close:()=>runtime.close(),runtime:()=>runtime};
}
async function completed(h,id,headers){for(let i=0;i<100;i++){const response=await h.request('/admin-api/pipeline/tasks/'+id+'?gatewayId=dayu-a',{headers});assert.equal(response.status,200);const task=await response.json();if(task.status!=='running')return task;await new Promise(setImmediate);}throw Error('task_did_not_finish');}
test('RAG cloud permissions, device isolation, retrieval, observable blocked task and restart history',async t=>{
 const h=await fixture(t),admin=await h.login(),reader=await h.login('reader');
 const doc={title:'番茄温湿度养护',source:'测试文档，不是生产建议',text:'番茄温湿度管理：温度升高时先检查温度传感器，再由现场人员判断通风。知识不能替代安全规则。'};
 assert.equal((await h.request('/admin-api/agent/prompts')).status,401);
 assert.deepEqual(await (await h.request('/admin-api/agent/prompts',{headers:reader})).json(),pipelinePromptCatalog());
 assert.equal((await h.request('/admin-api/knowledge?gatewayId=dayu-a')).status,401);
 assert.equal((await h.request('/admin-api/knowledge?gatewayId=dayu-a',{body:doc,headers:reader})).status,403);
 assert.equal((await h.request('/admin-api/knowledge?gatewayId=dayu-a',{body:doc,headers:{cookie:admin.cookie}})).status,403);
 const saved=await h.request('/admin-api/knowledge?gatewayId=dayu-a',{body:doc,headers:admin});assert.equal(saved.status,200);assert.ok((await saved.json()).id);
 const listed=await(await h.request('/admin-api/knowledge?gatewayId=dayu-b',{headers:reader})).json();assert.equal(listed.items.length,0);
 const search=await(await h.request('/admin-api/knowledge/search?gatewayId=dayu-a',{body:{query:'番茄温湿度'},headers:admin})).json();assert.ok(search.items.length>0);assert.match(search.items[0].content,/知识不能替代安全规则/);
 assert.equal((await h.request('/api/agent/pipeline?gatewayId=dayu-a',{body:{prompt:'番茄温湿度检查'},headers:reader})).status,403);
 const launch=await h.request('/api/agent/pipeline?gatewayId=dayu-a',{body:{prompt:'番茄温湿度检查'},headers:admin});assert.equal(launch.status,202);const {taskId}=await launch.json();
 const task=await completed(h,taskId,reader);assert.deepEqual(task.promptPolicy,pipelinePromptCatalog());assert.equal(task.status,'completed');assert.equal(task.result.audit.verdict,'block');assert.equal(task.result.calls,0);assert.equal(task.result.executed,false);assert.ok(task.result.retrieval.items.length>0);assert.ok(task.events.some(e=>e.type==='retrieval_completed'));assert.ok(task.events.some(e=>e.type==='task_completed'));
 assert.equal((await h.request('/admin-api/pipeline/tasks/'+taskId+'?gatewayId=dayu-b',{headers:reader})).status,400);
 await h.close();await h.start();const renewed=await h.login('reader');const recovered=await(await h.request('/admin-api/pipeline/tasks/'+taskId+'?gatewayId=dayu-a',{headers:renewed})).json();assert.deepEqual(recovered.promptPolicy,task.promptPolicy);assert.equal(recovered.status,'completed');assert.ok(recovered.result.retrieval.items.length>0);
});
