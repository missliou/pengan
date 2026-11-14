import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateImageInput,MAX_IMAGE_BYTES} from '../crop-image.mjs';
import {AgentPlanner} from '../agent.mjs';
import {startDemo} from '../runtime.mjs';
const image=(size=64)=>{const bytes=Buffer.alloc(size);bytes.set([255,216,255]);return bytes;};
const input=()=>({prompt:'请描述照片中的作物现象',mimeType:'image/jpeg',imageBase64:image().toString('base64')});
const response=result=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'inspect_crop_image',arguments:JSON.stringify(result)}}]}}]}));
test('照片输入仅接受有界规范base64及对应图片magic，拒绝路径URL和伪格式',()=>{
 assert.equal(validateImageInput(input()).imageSha256,createHash('sha256').update(image()).digest('hex'));
 for(const patch of [{url:'https://example.com/image.jpg'},{path:'C:/secret.jpg'},{mimeType:'image/gif'},{imageBase64:'https://example.com'},{imageBase64:'data:image/jpeg;base64,AA=='},{imageBase64:'AAA='},{imageBase64:'!!!!'},{imageBase64:image().toString('base64')+'\n'},{mimeType:'image/png'}])assert.throws(()=>validateImageInput({...input(),...patch}));
 const png=Buffer.alloc(32);png.set([137,80,78,71,13,10,26,10]);assert.equal(validateImageInput({...input(),mimeType:'image/png',imageBase64:png.toString('base64')}).mimeType,'image/png');
 assert.doesNotThrow(()=>validateImageInput({...input(),imageBase64:image(MAX_IMAGE_BYTES).toString('base64')}));
 assert.throws(()=>validateImageInput({...input(),imageBase64:image(MAX_IMAGE_BYTES+1).toString('base64')}),/image_too_large/);
});
test('真实图片适配：使用实际base64调用模型，结果绑定SHA且不回传图片或进入建议记忆',async()=>{
 let body;const planner=new AgentPlanner({provider:'qwen',model:'vision-test',key:'test-key',fetchFn:async(url,options)=>{body=JSON.parse(options.body);return response({summary:'叶片有斑点',findings:['可见斑点，原因待核实'],unknowns:['缺少叶背照片']});}});
 const result=await planner.inspectImage(input());assert.equal(body.messages[1].content[1].image_url.url,'data:image/jpeg;base64,'+input().imageBase64);assert.equal(body.enable_thinking,false);assert.equal(body.tool_choice.function.name,'inspect_crop_image');assert.equal(result.imageSha256,createHash('sha256').update(image()).digest('hex'));assert.equal(result.hardwareControl,false);assert.equal(result.simulated,false);assert.deepEqual(result.steps,[]);assert.match(result.summary,/不能据此确诊/);assert.equal(JSON.stringify(result).includes(input().imageBase64),false);assert.equal(planner.recentAnalyses.length,0);assert.equal(planner.recentProposals.length,0);
 for(const bad of [{summary:'x',findings:[],unknowns:[],action:'spray'},{summary:'x',findings:[1],unknowns:[]}]){planner.fetchFn=async()=>response(bad);await assert.rejects(planner.inspectImage(input()),/invalid_image_analysis/);}
 planner.fetchFn=async()=>new Response('private provider error and configuration',{status:400});await assert.rejects(planner.inspectImage(input()),error=>error.message==='ai_provider_http_400');
});
test('千问北京工作空间限定为合法主机前缀，所有图片请求拒绝重定向',async()=>{
 let seenUrl,redirect;
 const planner=new AgentPlanner({provider:'qwen',workspaceId:'workspace-123',model:'vision-test',key:'test-key',fetchFn:async(url,options)=>{seenUrl=url;redirect=options.redirect;return response({summary:'观察',findings:[],unknowns:[]});}});
 await planner.inspectImage(input());assert.equal(seenUrl,'https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');assert.equal(redirect,'error');assert.equal(planner.status().workspaceId,'workspace-123');
 for(const workspaceId of ['bad.example.com','../x','https://example.com','a'.repeat(65),null])assert.throws(()=>new AgentPlanner({workspaceId}),/invalid_workspace_id/);
});
test('图片HTTP路由具有独立限长，与AI分析/配置互斥，不写事件日志',{timeout:15000},async()=>{
 let release,calls=0;const events=[];
 const runtime=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,journal:{append:async row=>events.push(row),flush:async()=>{}},plannerOptions:{provider:'deepseek',model:'vision-test',key:'test-key',fetchFn:async()=>{calls++;await new Promise(resolve=>{release=resolve;});return response({summary:'只读观察',findings:[],unknowns:[]});}}});
 const base=`http://127.0.0.1:${runtime.httpPort}`,post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  const malformed=await fetch(base+'/api/agent/inspect-image',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"imageBase64":"'+input().imageBase64+'",broken}'});assert.equal(malformed.status,400);assert.deepEqual((await malformed.json()).error,'invalid_json');
  assert.equal((await post('/api/agent/inspect-image',{...input(),imageBase64:'AAA='})).status,422);assert.equal(calls,0);
  const pending=post('/api/agent/inspect-image',{...input(),imageBase64:image(9000).toString('base64')});
  for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(typeof release,'function');
  assert.equal((await post('/api/agent/analyze',{prompt:'查询'})).status,429);assert.equal((await post('/api/agent/inspect-image',input())).status,429);release();
  const done=await pending;assert.equal(done.status,200);assert.equal((await done.json()).source,'user_photo');assert.equal(events.length,0);
  assert.equal((await post('/api/agent/analyze',{prompt:'x'.repeat(9000)})).status,413);
  assert.equal((await post('/api/agent/inspect-image',{...input(),imageBase64:'A'.repeat(3*1024*1024)})).status,413);
 }finally{release?.();await runtime.close();}
});
