import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source='function resetImage'+readFileSync(new URL('../panel.js',import.meta.url),'utf8').split('function resetImage')[1].split('function invalidateReport')[0];
test('照片只在点击后读取上传，拒绝超大文件，清除后迟到结果不显示',async()=>{
 const nodes=new Map(),calls=[];let read=0,release;
 const element=()=>({value:'',textContent:'',children:[],listeners:{},addEventListener(k,f){this.listeners[k]=f;},replaceChildren(...v){this.children=v;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const result={mode:'hardware',kind:'crop_image_analysis',source:'user_photo',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',imageSha256:'a'.repeat(64),analyzedAt:1,summary:'叶片有斑点',findings:[],unknowns:['非确诊']};
 const context=vm.createContext({serviceContextEpoch:0,analysisContextValid:()=>true,modelTestBusy:false,reportBusy:false,imageEpoch:0,imageFile:null,imageBusy:false,configBusy:false,planning:false,sending:false,modelConfigured:true,serviceOnline:true,operationMode:'hardware',$:get,updateButtons(){},document:{createElement:element},Uint8Array,String,btoa:x=>Buffer.from(x,'binary').toString('base64'),timestamp:()=> 'time',message:e=>e.message,request:async(path,body)=>{calls.push({path,body});await new Promise(r=>release=r);return result;}});
 vm.runInContext(source,context);
 const file={name:'crop.png',type:'image/png',size:4,arrayBuffer:async()=>{read++;return new Uint8Array([1,2,3,4]).buffer;}};
 get('crop-file').files=[{...file,size:2097153}];get('crop-file').listeners.change();assert.match(get('image-status').textContent,/不超过/);assert.equal(calls.length,0);
 get('crop-file').files=[file];get('crop-file').listeners.change();assert.equal(read,0);assert.equal(calls.length,0);
 const pending=get('image-send').listeners.click();await new Promise(r=>setImmediate(r));assert.equal(read,1);assert.equal(calls[0].path,'/api/agent/inspect-image');assert.equal(calls[0].body.imageBase64,'AQIDBA==');
 get('image-clear').listeners.click();release();await pending;assert.equal(get('image-result').children.length,0);assert.match(get('image-status').textContent,/清除/);
 assert.throws(()=>vm.runInContext('validateImageAnalysis('+JSON.stringify({...result,imageSha256:'-'.repeat(64)})+')',context),/协议无效/);
});
