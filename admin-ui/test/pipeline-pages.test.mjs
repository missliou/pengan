import {test} from 'node:test';
import assert from 'node:assert/strict';
import renderTasks from '../src/pages/tasks.js';
import renderKnowledge from '../src/pages/knowledge.js';
import {createDataSource} from '../src/lib/data-source.js';
import {PageScope,MutationGate} from '../src/lib/session.js';
import {installDom,button,input,flush} from './helpers/dom.mjs';
function ctx(t,source,more={}){const scope=new PageScope();t.after(()=>scope.dispose());return {scope,state:{gatewayId:'dayu-a',user:{role:'admin'}},dataSource:source,demoMode:false,...more};}
test('pipeline and knowledge demo pages never access real APIs',async t=>{
 installDom(t);let calls=0;const source=new Proxy({},{get:()=>()=>{calls++;throw Error('unexpected');}});
 const tasks=await renderTasks(ctx(t,source,{demoMode:true})),knowledge=await renderKnowledge(ctx(t,source,{demoMode:true}));
 assert.equal(button(tasks,'开始决策→生成→审核').disabled,true);assert.equal(button(knowledge,'保存知识文档').disabled,true);assert.equal(calls,0);
 assert.match(tasks.textContent,/静态历史，不是当前设备/);assert.match(tasks.textContent,/实际模型调用 3 次/);await button(tasks,'查看安全测试回执').click();assert.match(tasks.textContent,/syntheticEnvironment/);assert.match(knowledge.textContent,/未向服务端保存或检索/);assert.equal(calls,0);
});
test('pipeline submits a prompt, displays scoped trace and does not repaint input on polling',async t=>{
 installDom(t);let tick; t.mock.method(globalThis,'setInterval',fn=>{tick=fn;return 1;});t.mock.method(globalThis,'clearInterval',()=>{});
 const body=[],source={listPipelineTasks:async()=>({items:[]}),startPipeline:async value=>{body.push(value);return {taskId:'task-a'};},readPipelineTask:async()=>({taskId:'task-a',gatewayId:'dayu-a',status:'completed',startedAt:1000,finishedAt:1200,events:[{seq:1,type:'rag_retrieved',at:1000,data:{count:1}}],retrieval:{items:[{title:'test-knowledge',content:'safe text'}]},result:{audit:{verdict:'block'}}})};
 const root=await renderTasks(ctx(t,source)),field=input(root,'pipeline-prompt');field.value='test question';await button(root,'开始决策→生成→审核').click();
 assert.equal(body[0].prompt,'test question');assert.match(root.textContent,/rag_retrieved/);assert.match(root.textContent,/test-knowledge/);assert.match(root.textContent,/block/);
 tick();await flush();assert.equal(input(root,'pipeline-prompt'),field);assert.equal(field.value,'test question');
});
test('new mutations keep gateway scope and reject demo/viewer before transport',async t=>{
 const scope=new PageScope();t.after(()=>scope.dispose());const calls=[],api={startPipeline:async(...args)=>{calls.push(args);return {};}};
 const source=createDataSource({scope,demoMode:false,gate:new MutationGate(),gatewayId:'dayu-a',role:'admin',api});await source.startPipeline({prompt:'q'});assert.equal(calls[0][1].gatewayId,'dayu-a');
 const viewer=createDataSource({scope,demoMode:false,gate:new MutationGate(),gatewayId:'dayu-b',role:'viewer',api});await assert.rejects(viewer.startPipeline({prompt:'q'}));assert.equal(calls.length,1);
});
