import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../panel.js',import.meta.url),'utf8').split('// Persistent real observations')[1].split('async function refreshHistory')[1].split('function updateWorkspace')[0];
test('真实历史表：历史标记、质量无效未知、空表与失败清除旧成功状态',async()=>{
 const nodes=new Map();let response;
 const element=()=>({textContent:'',children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const ctx=vm.createContext({operationMode:'hardware',$:get,document:{createElement:element},timestamp:()=> 'sample-time',request:async()=>{if(response instanceof Error)throw response;return response;}});
 vm.runInContext('async function refreshHistory'+source,ctx);
 const payload={schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:{enabled:true,healthy:true,records:1,bytes:120,maxBytes:67108864},items:[{seq:1,historical:true,isCurrent:false,observation:{deviceId:'hh-hsp101-001',simulated:false,receivedAt:1,values:{temperatureC:25.3,humidityPct:62,gasRaw:500,gasMv:900},quality:{temperatureValid:true,humidityValid:false,gasValid:true}}}]};
 response=payload;await vm.runInContext('refreshHistory()',ctx);
 assert.match(get('history-storage').textContent,/存储可写/);const row=get('real-history-rows').children[0];assert.match(row.children[2].textContent,/25.3 ℃ \/ 未知/);assert.match(row.children[4].textContent,/历史快照/);
 response={...payload,items:[]};await vm.runInContext('refreshHistory()',ctx);assert.match(get('history-empty').textContent,/尚无真实采集记录/);
 response=Error('offline');await vm.runInContext('refreshHistory()',ctx);assert.equal(get('real-history-rows').children.length,0);assert.match(get('journal').textContent,/未知/);assert.doesNotMatch(get('history-storage').textContent,/存储可写/);
});
