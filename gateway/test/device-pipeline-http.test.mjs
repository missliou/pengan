import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {CloudSecurity} from '../cloud-security.mjs';
import {startCloudServer} from '../cloud-server.mjs';
test('device pipeline uses Bearer, is observable after restart and cannot read other-device tasks/admin APIs',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-device-pipeline-'));let runtime;
 const token=id=>'test-device-pipeline-token-'+id;const options={dataDir:dir,publicOrigin:'http://127.0.0.1:0',users:[{username:'admin',role:'admin',passwordHash:await CloudSecurity.hashPassword('test-only-password-123')}],devices:['dayu-a','dayu-b'].map(gatewayId=>({gatewayId,tokenSha256:createHash('sha256').update(token(gatewayId)).digest('hex')})),fetchFn:async()=>{throw Error('no_real_models');}};
 runtime=await startCloudServer(options);t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
 const request=(route,id='dayu-a',body,extra={})=>fetch(runtime.publicOrigin+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token(id),'x-pengan-gateway-id':id,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await request('/api/v1/device/pipeline','dayu-a',{prompt:'温室巡检'},{authorization:'Bearer incorrect'})).status,401);
 assert.equal((await request('/api/v1/device/pipeline','dayu-a',{prompt:'温室巡检'},{origin:runtime.publicOrigin})).status,403);
 assert.equal((await request('/api/v1/device/pipeline','dayu-a',{prompt:'x',gatewayId:'dayu-b'})).status,400);
 const launch=await request('/api/v1/device/pipeline','dayu-a',{prompt:'温室巡检'});assert.equal(launch.status,202);const receipt=await launch.json();assert.equal(receipt.gatewayId,'dayu-a');
 let task;for(let i=0;i<100;i++){task=await(await request('/api/v1/device/pipeline/tasks/'+receipt.taskId)).json();if(task.status!=='running')break;await new Promise(setImmediate);}
 assert.equal(task.gatewayId,'dayu-a');assert.equal(task.result.executed,false);assert.equal(task.result.audit.verdict,'block');assert.ok(task.events.some(e=>e.type==='task_completed'));
 assert.equal((await request('/api/v1/device/pipeline/tasks/'+receipt.taskId,'dayu-b')).status,400);
 assert.equal((await request('/admin-api/pipeline/tasks/'+receipt.taskId+'?gatewayId=dayu-a')).status,401);
 await runtime.close();runtime=await startCloudServer(options);assert.equal((await(await request('/api/v1/device/pipeline/tasks/'+receipt.taskId)).json()).taskId,receipt.taskId);
});
