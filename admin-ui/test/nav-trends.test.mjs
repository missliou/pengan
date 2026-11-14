import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDom,button,find} from './helpers/dom.mjs';
import {el} from '../src/lib/dom.js';
import {renderNavGroups} from '../src/lib/nav-groups.js';
import {historyTrend,trendQuestion} from '../src/lib/history-trend.js';
import renderTrends from '../src/pages/trends.js';
import {PageScope} from '../src/lib/session.js';

test('navigation groups collapse with ARIA, preserve page selection and reopen selected section',async t=>{
 installDom(t);const pages=[{id:'a',title:'A',sec:'日常监测'},{id:'b',title:'B',sec:'系统管理'}];
 const buttons=pages.map(p=>el('button',{dataset:{page:p.id},'aria-current':p.id==='b'?'page':null},[p.title]));let saved;
 const groups=renderNavGroups(pages,buttons,{currentPage:'b',collapsed:{系统管理:true},onToggle:(...v)=>saved=v});
 const toggle=find(groups[1],n=>n.className.includes('nav-group-toggle'));
 assert.equal(toggle['aria-expanded'],'true');assert.equal(button(groups[1],'B')['aria-current'],'page');
 await toggle.click();assert.equal(toggle['aria-expanded'],'false');assert.equal(find(groups[1],n=>n.id==='nav-group-1').hidden,true);assert.deepEqual(saved,['系统管理',true]);
 await toggle.click();assert.equal(toggle['aria-expanded'],'true');
});
const data=()=>({gatewayId:'dayu-a',simulated:false,historical:true,isCurrent:false,items:[
 {seq:2,sessionBootId:'a',observation:{receivedAt:2000,quality:{temperatureValid:true,humidityValid:true,gasValid:false},values:{temperatureC:30,humidityPct:70,gasRaw:200}}},
 {seq:1,sessionBootId:'a',replayed:true,observation:{receivedAt:1000,quality:{temperatureValid:true,humidityValid:true,gasValid:true},values:{temperatureC:20,humidityPct:60,gasRaw:300}}},
 {seq:3,sessionBootId:'b',observation:{receivedAt:3000,quality:{temperatureValid:false,humidityValid:true,gasValid:true},values:{temperatureC:0,humidityPct:null,gasRaw:4096}}},
]});
test('history trends sort original timestamps, exclude invalid channels, preserve gaps and replay provenance',()=>{
 const d=data();d.items.push(d.items[0]);const s=historyTrend(d,'dayu-a');assert.equal(s.total,3);assert.equal(s.replayed,1);assert.equal(s.sessions,2);
 assert.deepEqual(s.metrics[0].points.map(p=>p.seq),[1,2]);assert.equal(s.metrics[0].min,20);assert.equal(s.metrics[0].missing,1);assert.equal(s.metrics[2].count,1);
 assert.match(trendQuestion(s),/不是当前状态/);assert.ok(trendQuestion(s).length<=700);
 assert.throws(()=>historyTrend(d,'other'));assert.throws(()=>historyTrend({...d,simulated:true},'dayu-a'));assert.throws(()=>trendQuestion({total:1,from:null}));
});
test('trends demo makes no real reads, review only fills draft and does not overwrite it',async t=>{
 installDom(t);const scope=new PageScope();t.after(()=>scope.dispose());let calls=0,navigate='';
 const state={gatewayId:'dayu-a',user:{role:'admin'}};
 const source={getHardwareHistory:async()=>{calls++;return data();}};
 const demo=await renderTrends({scope,state,demoMode:true,dataSource:source});assert.equal(calls,0);assert.equal(button(demo,'带入农业问答复核').disabled,true);
 const root=await renderTrends({scope,state,demoMode:false,dataSource:source,navigate:id=>navigate=id});assert.equal(calls,1);
 await button(root,'带入农业问答复核').click();assert.equal(navigate,'agri-qa');const draft=Object.values(state.aiWorkspace)[0];assert.match(draft.question,/温度/);
 draft.question='existing draft';navigate='';await button(root,'带入农业问答复核').click();assert.equal(navigate,'');assert.equal(draft.question,'existing draft');assert.match(root.textContent,/已有未清空草稿/);
 draft.question='';draft.task={status:'running'};await button(root,'带入农业问答复核').click();assert.equal(navigate,'');assert.match(root.textContent,/处理中或未确认/);
 draft.task={status:'completed'};draft.taskId='old-task';await button(root,'带入农业问答复核').click();assert.equal(navigate,'agri-qa');assert.equal(draft.task,null);assert.equal(draft.taskId,'');
});
