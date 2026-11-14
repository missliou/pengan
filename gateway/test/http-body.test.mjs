import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startDemo} from '../runtime.mjs';

test('HTTP 分包中文提示保真，按字节限制请求且拒绝非对象 JSON',{timeout:15000},async()=>{
 let observedPrompt;
 const r=await startDemo({mqttPort:0,httpPort:0,plannerOptions:{provider:'deepseek',model:'test',key:'test-key',fetchFn:async(url,options)=>{
  observedPrompt=JSON.parse(JSON.parse(options.body).messages[1].content).request;
  return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'propose_plan',arguments:JSON.stringify({summary:'测试',steps:[]})}}]}}]}));
 }}});
 const base=`http://127.0.0.1:${r.httpPort}`;
 try{
  const prompt='棚内温度如何？先查询，不执行控制。',body=Buffer.from(JSON.stringify({prompt}));
  const split=body.indexOf(Buffer.from('棚'))+1;
  const result=await new Promise((resolve,reject)=>{
   const req=http.request(base+'/api/agent/plan',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}));});
   req.on('error',reject);req.flushHeaders();req.write(body.subarray(0,split));
   setTimeout(()=>req.end(body.subarray(split)),25);
  });
  assert.equal(result.status,200);assert.equal(observedPrompt,prompt);assert.equal(result.data.executed,false);
  const oversized=JSON.stringify({prompt:'棚'.repeat(2800)});
  assert.ok(oversized.length<8192&&Buffer.byteLength(oversized)>8192);
  const response=await fetch(base+'/api/agent/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:oversized});
  assert.equal(response.status,413);assert.equal((await response.json()).error,'body_too_large');
  for(const body of ['null','[]','42','"文本"']){
   const response=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body});
   assert.equal(response.status,400);assert.equal((await response.json()).error,'json_object_required');
  }
 }finally{await r.close();}
});
