import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../panel.js',import.meta.url),'utf8').split('// Manual model connection check')[1];
test('手动模型测试仅点击发送空请求，成功限定单次，配置变化丢弃迟到结果',async()=>{
 const nodes=new Map(),calls=[];let release,defer=false;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',listeners:{},addEventListener(k,f){this.listeners[k]=f;}});return nodes.get(id);};
 const result={kind:'model_connection_check',ok:true,provider:'deepseek',model:'account-model',checkedAt:1,roundTripMs:10,fieldDataSent:false,imageSent:false,executed:false};
 const context=vm.createContext({modelTestBusy:false,modelTestEpoch:0,reportBusy:false,imageBusy:false,configBusy:false,planning:false,sending:false,modelConfigured:true,serviceOnline:true,$:get,updateButtons(){},timestamp:()=> 'time',message:e=>e.message,request:async(path,body)=>{calls.push({path,body});if(defer)await new Promise(r=>release=r);return result;}});
 vm.runInContext('// Manual model connection check'+source,context);assert.equal(calls.length,0);
 await get('model-test').listeners.click();assert.deepEqual(calls.map(c=>c.path),['/api/agent/test']);assert.equal(JSON.stringify(calls[0].body),'{}');assert.match(get('model-test-status').textContent,/仅代表这一次请求/);
 defer=true;const pending=get('model-test').listeners.click();vm.runInContext("invalidateModelCheck('配置已变化，请重新测试')",context);release();await pending;assert.match(get('model-test-status').textContent,/配置已变化/);
 for(const patch of [{fieldDataSent:true},{imageSent:true},{executed:true},{ok:false}])assert.throws(()=>vm.runInContext('validateModelCheck('+JSON.stringify({...result,...patch})+')',context),/协议无效/);
});
