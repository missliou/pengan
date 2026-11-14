import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDom,button,input,flush} from './helpers/dom.mjs';
import {PageScope} from '../src/lib/session.js';
import renderAssistant from '../src/pages/assistant.js';
import {ASSISTANTS,assistantPrompt,assistantSession,checkedTask} from '../src/lib/assistant.js';
const context=(t,extra={})=>{const scope=new PageScope();t.after(()=>scope.dispose());return {scope,state:{gatewayId:'dayu-a',user:{role:'admin'}},demoMode:false,navigate:()=>{},dataSource:{},...extra};};
test('scenario prompts preserve user context, remain bounded and do not grant actions',()=>{
 for(const key of Object.keys(ASSISTANTS)){
  const prompt=assistantPrompt(key,{question:'检查温湿度',crop:'番茄',growth:'结果期'});
  assert.match(prompt,/番茄/);assert.match(prompt,/不执行设备/);assert.ok(prompt.length<=1000);
 }
 assert.throws(()=>assistantPrompt('agri-qa',{question:' '}));assert.throws(()=>assistantPrompt('agri-qa',{question:'x'.repeat(701)}));
 const state={gatewayId:'a'};assert.notEqual(assistantSession(state,'agri-qa',true),assistantSession(state,'agri-qa',false));
 state.gatewayId='b';assert.equal(assistantSession(state,'agri-qa',false).question,'');
 assert.throws(()=>checkedTask({taskId:'x',gatewayId:'other',status:'completed'},'x','a'));
});
test('demo, viewer and missing device never submit; examples only fill drafts',async t=>{
 installDom(t);let calls=0;
 for(const extra of [{demoMode:true},{state:{gatewayId:'a',user:{role:'viewer'}}},{state:{gatewayId:'',user:{role:'admin'}}}]){
  const root=renderAssistant(context(t,{...extra,dataSource:{startPipeline(){calls++;}}}));
  await button(root,ASSISTANTS['agri-qa'].examples[0]).click();assert.ok(input(root,'assistant-question').value.includes('番茄'));
  assert.equal(button(root,'提交农业问题').disabled,true);await button(root,'提交农业问题').click();
 }assert.equal(calls,0);
});
test('real task displays grounded summary and evidence, resists repeated submission and resumes on return',async t=>{
 installDom(t);let calls=0;const state={gatewayId:'dayu-a',user:{role:'admin'}};
 const dataSource={startPipeline:async body=>{calls++;assert.match(body.prompt,/现场问题/);return {taskId:'task-1'};},readPipelineTask:async()=>({taskId:'task-1',gatewayId:'dayu-a',status:'completed',startedAt:1000,events:[],result:{audit:{verdict:'block'},stages:[{stage:'decision',state:'blocked',summary:'缺少实时采集依据'}],retrieval:{items:[{title:'番茄资料',source:'文档A',chunkId:'1',content:'参考原文'}]}}})};
 const ctx=context(t,{state,dataSource});const root=renderAssistant(ctx);input(root,'assistant-question').value='现场问题';await button(root,'提交农业问题').click();
 assert.equal(calls,1);assert.match(root.textContent,/规则已拦截/);assert.match(root.textContent,/参考原文/);assert.match(root.textContent,/缺少实时采集依据/);
 ctx.scope.dispose();const resumed=renderAssistant(context(t,{state,dataSource}));await flush();assert.equal(input(resumed,'assistant-question').value,'现场问题');assert.equal(calls,1);assert.match(resumed.textContent,/规则已拦截/);
});
test('uncertain submission requires task list check before retry, even after navigation',async t=>{
 installDom(t);let reject;const state={gatewayId:'dayu-a',user:{role:'admin'}};
 const ctx=context(t,{state,dataSource:{startPipeline:()=>new Promise((_,r)=>{reject=r;})}});const root=renderAssistant(ctx);
 input(root,'assistant-question').value='测试';const pending=button(root,'提交农业问题').click();await flush();ctx.scope.dispose();reject(Error('页面变化'));await pending;
 const again=renderAssistant(context(t,{state}));assert.equal(button(again,'提交农业问题').disabled,true);
 await button(again,'我已核对任务列表，允许重新提交').click();assert.equal(button(again,'提交农业问题').disabled,false);
});
test('mismatched task identity is never painted and does not allow automatic resubmit',async t=>{
 installDom(t);const root=renderAssistant(context(t,{dataSource:{startPipeline:async()=>({taskId:'t'}),readPipelineTask:async()=>({taskId:'t',gatewayId:'wrong',status:'completed',result:{plan:{summary:'secret other device'}}})}}));
 input(root,'assistant-question').value='问题';await button(root,'提交农业问题').click();assert.doesNotMatch(root.textContent,/secret other device/);assert.match(root.textContent,/任务身份或状态无效/);assert.equal(button(root,'提交农业问题').disabled,true);
});
