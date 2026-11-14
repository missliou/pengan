import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../panel.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
test('真实模式网页不请求模拟设备，采集离线也能AI分析且没有执行按钮',async()=>{
 const nodes=new Map(),calls=[],simulation=[{hidden:false}],actions=[{disabled:false,addEventListener(){}}];
 const element=()=>({textContent:'',value:'',disabled:false,children:[],listeners:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(name,fn){this.listeners[name]=fn;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const result={mode:'hardware',simulated:false,executed:false,steps:[],summary:'采集未连接，请检查USB',findings:[],unknowns:['温湿度未知'],observationReceivedAt:null,deviceOnline:false,analyzedAt:Date.now(),provider:'test',model:'test',hardwareControl:false,realAdmission:'unknown_denied'};
 const responses={'/api/health':{ok:true,mode:'hardware',simulated:false,hardwareConnected:false},'/api/agent/status':{configured:true,provider:'test',model:'test'},'/api/agent/config':{csrfToken:'token',keySaved:true},'/api/hardware':{simulated:false,deviceId:'hh-hsp101-001',deviceOnline:false,actuationAvailable:false,values:{},quality:{coValid:false,co2Valid:false}},'/api/agent/analyze':result};
 const context=vm.createContext({document:{hidden:false,getElementById:get,createElement:()=>element(),querySelectorAll:selector=>selector==='[data-action]'?actions:selector==='[data-simulation]'?simulation:[],addEventListener(){}},window:{addEventListener(){},confirm(){throw Error('Unexpected control confirmation');}},Date,AbortSignal,setInterval(){},fetch:async(path,options)=>{calls.push({path,options});if(!responses[path])throw Error('Unexpected endpoint '+path);return {ok:true,json:async()=>responses[path]};}});
 vm.runInContext(script,context);await tick();await tick();
 assert.ok(simulation.every(e=>e.hidden));assert.equal(get('ai-send').disabled,false);assert.equal(actions[0].disabled,true);assert.ok(!calls.some(c=>c.path==='/api/device'));
 get('ai-prompt').value='查看当前真实采集';await get('ai-send').listeners.click();
 assert.ok(calls.some(c=>c.path==='/api/agent/analyze')); assert.ok(!JSON.stringify(get('ai-plan').children).includes('确认执行此步骤'));
 assert.match(get('ai-status').textContent,/只读/);
 assert.throws(()=>vm.runInContext('validateAnalysis({...'+JSON.stringify(result)+',steps:[{action:"ventilate"}]})',context),/协议无效/);
 const trace={tool:'read_environment',at:Date.now(),readOnly:true,resultSummary:'当前采集离线'};
 const traced={...result,toolTrace:[trace]};
 vm.runInContext('renderAnalysis(validateAnalysis('+JSON.stringify(traced)+'))',context);
 assert.match(JSON.stringify(get('ai-plan').children),/只读工具溯源/);assert.match(JSON.stringify(get('ai-plan').children),/read_environment/);
 for(const toolTrace of [[{...trace,tool:'ventilate'}],[{...trace,readOnly:false}],[{...trace,at:null}],Array(7).fill(trace)])assert.throws(()=>vm.runInContext('validateAnalysis('+JSON.stringify({...result,toolTrace})+')',context),/溯源无效/);
 for(const [persistence,pattern] of [[{saved:true,recordId:8},/已保存文字分析 #8/],[{saved:false,error:'storage_unavailable'},/未保存/]]){vm.runInContext('renderAnalysis(validateAnalysis('+JSON.stringify({...result,persistence})+'))',context);assert.match(JSON.stringify(get('ai-plan').children),pattern);}
});
