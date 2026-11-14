import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const all=readFileSync(new URL('../panel.js',import.meta.url),'utf8');
const source='async function refreshAiHistory'+all.split('async function refreshAiHistory')[1].split("$('ai-history-refresh').addEventListener")[0];
test('文字AI历史独立显示、异常状态可见，失败清除旧成功状态',async()=>{
 const nodes=new Map();let response;
 const element=()=>({textContent:'',children:[],append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context=vm.createContext({operationMode:'hardware',aiHistoryBusy:false,$:get,document:{createElement:element},timestamp:()=> 'time',validateAnalysis:p=>p,request:async()=>{if(response instanceof Error)throw response;return response;}});
 vm.runInContext(source,context);
 const row={seq:2,historical:true,isCurrent:false,prompt:'温度如何',recordedAt:1,analysis:{summary:'历史温度偏高',provider:'test',model:'test',analyzedAt:1,observationReceivedAt:1,toolTrace:[{tool:'read_environment',at:1,resultSummary:'已读取历史时刻观测'}]}};
 const payload={schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:{enabled:true,healthy:true,records:2,bytes:1000,maxBytes:16777216},items:[row]};
 response=payload;await vm.runInContext('refreshAiHistory()',context);assert.match(JSON.stringify(get('ai-history-items').children),/历史分析，不代表当前环境/);assert.doesNotMatch(JSON.stringify(get('ai-history-items').children),/button/);
 response={...payload,items:[],storage:{...payload.storage,healthy:false}};await vm.runInContext('refreshAiHistory()',context);assert.match(get('ai-history-status').textContent,/已停止记录/);assert.match(get('ai-history-status').textContent,/尚无已保存/);
 response=Error('offline');await vm.runInContext('refreshAiHistory()',context);assert.equal(get('ai-history-items').children.length,0);assert.match(get('ai-history-status').textContent,/未知/);
});
