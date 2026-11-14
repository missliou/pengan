import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../panel.js',import.meta.url),'utf8'),tick=()=>new Promise(r=>setImmediate(r));
function runtime(){
 const nodes=new Map(),calls=[];let mode='hardware',analysisRelease;
 const element=()=>({value:'',textContent:'',children:[],listeners:{},addEventListener(k,f){this.listeners[k]=f;},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;}}),get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const result={mode:'hardware',simulated:false,executed:false,hardwareControl:false,realAdmission:'unknown_denied',steps:[],summary:'OLD ANALYSIS',findings:[],unknowns:[],deviceOnline:false,analyzedAt:1,observationReceivedAt:null};
 const config={provider:'deepseek',model:'saved-model',workspaceId:'',keySaved:true,configured:true,csrfToken:'token'};
 const context=vm.createContext({document:{hidden:false,getElementById:get,querySelectorAll:()=>[],createElement:element,addEventListener(){}},window:{addEventListener(){},confirm:()=>true},setInterval(){},AbortSignal,Date,Uint8Array,String,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(path,opts)=>{
  const body=opts?.body?JSON.parse(opts.body):undefined;calls.push({path,body});let data;
  if(path==='/api/health')data={mode,simulated:mode==='simulation',hardwareConnected:false};
  else if(path==='/api/device')data={simulated:true,deviceOnline:true};
  else if(path==='/api/agent/status')data={configured:true,provider:'deepseek',model:'saved-model'};
  else if(path==='/api/agent/config')data=config;
  else if(path==='/api/agent/analyze'){await new Promise(r=>analysisRelease=r);data=result;}
  else throw Error('offline fixture');return {ok:true,json:async()=>data};
 }});vm.runInContext(source,context);
 return {context,get,calls,setMode:v=>mode=v,releaseAnalysis:()=>analysisRelease(),refresh:()=>vm.runInContext('refresh()',context)};
}
test('模式变化丢弃迟到文字AI；文件读取期间变化后不发送照片',async()=>{
 const r=runtime();await tick();await tick();r.get('ai-prompt').value='分析';const pending=r.get('ai-send').listeners.click();await tick();r.setMode('simulation');await r.refresh();r.releaseAnalysis();await pending;assert.equal(r.get('ai-plan').children.length,0);assert.doesNotMatch(r.get('ai-status').textContent,/分析已完成/);
 r.setMode('hardware');await r.refresh();let releaseBytes;r.get('crop-file').files=[{name:'test.png',type:'image/png',size:4,arrayBuffer:()=>new Promise(resolve=>releaseBytes=resolve)}];r.get('crop-file').listeners.change();const image=r.get('image-send').listeners.click();await tick();r.setMode('simulation');await r.refresh();releaseBytes(new Uint8Array([1,2,3,4]).buffer);await image;assert.ok(!r.calls.some(c=>c.path==='/api/agent/inspect-image'));assert.doesNotMatch(r.get('image-status').textContent,/照片分析完成/);
});
test('清除密钥只使用已保存配置，不保存脏服务商模型表单',async()=>{
 const r=runtime();await tick();await tick();r.get('config-provider').value='qwen';r.get('config-model').value='dirty-model';r.get('config-workspace').value='dirty-workspace';await r.get('config-clear').listeners.click();
 const sent=r.calls.find(c=>c.path==='/api/agent/config'&&c.body);assert.deepEqual(sent.body,{provider:'deepseek',model:'saved-model',workspaceId:'',key:'',clearKey:true});
});
