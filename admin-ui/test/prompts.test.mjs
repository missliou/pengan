import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDom,flush} from './helpers/dom.mjs';
import {PageScope} from '../src/lib/session.js';
import renderPrompts from '../src/pages/prompts.js';
import {DEMO_PROMPTS} from '../src/demo-prompts.js';
import {pipelinePromptCatalog} from '../../gateway/agent-pipeline.mjs';
test('demo prompt reference is synchronized with actual model policy source',()=>{assert.deepEqual(DEMO_PROMPTS,pipelinePromptCatalog());});
test('demo renders three Chinese agents and schemas without backend request',async t=>{
 installDom(t);const scope=new PageScope();t.after(()=>scope.dispose());let calls=0;
 const root=await renderPrompts({scope,demoMode:true,dataSource:{getAgentPrompts:()=>{calls++;}}});
 assert.equal(calls,0);for(const text of ['决策智能体','生成智能体','审核智能体','report_decision','audit_plan','SHA256','不是历史任务实际调用证据'])assert.ok(root.textContent.includes(text));
});
test('disposed real prompt response cannot paint stale page',async t=>{
 installDom(t);const scope=new PageScope();let resolve;const request=new Promise(r=>resolve=r);const pending=renderPrompts({scope,demoMode:false,dataSource:{getAgentPrompts:()=>request}});scope.dispose();resolve(pipelinePromptCatalog());const root=await pending;assert.doesNotMatch(root.textContent,/固定系统规则/);await flush();
});
