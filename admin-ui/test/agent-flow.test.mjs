import test from 'node:test';
import assert from 'node:assert/strict';
import render from '../src/pages/agent-flow.js';
import {installDom,button,flush} from './helpers/dom.mjs';
import {PageScope} from '../src/lib/session.js';
test('Chinese flow demo animates only replay and disposes without real calls',async t=>{
 installDom(t);let tick,cleared=0; t.mock.method(globalThis,'setInterval',f=>{tick=f;return 1;});t.mock.method(globalThis,'clearInterval',()=>cleared++);
 const scope=new PageScope();const root=await render({scope,demoMode:true,state:{},dataSource:new Proxy({},{get(){throw Error('unexpected network');}})});
 assert.match(root.textContent,/决策/);assert.match(root.textContent,/生成/);assert.match(root.textContent,/审核/);await button(root,'播放历史演示动画').click();
 tick();assert.match(root.textContent,/进行中/);for(let i=0;i<6;i++)tick();assert.match(root.textContent,/回放结束/);scope.dispose();assert.equal(cleared,1);
});
test('real flow refuses another device identity',async t=>{
 installDom(t);t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});const scope=new PageScope();
 const root=await render({scope,demoMode:false,state:{gatewayId:'a'},dataSource:{listPipelineTasks:async()=>({items:[{taskId:'t'}]}),readPipelineTask:async()=>({taskId:'t',gatewayId:'b',events:[]})}});
 assert.match(root.textContent,/身份不匹配/);scope.dispose();await flush();
});

test('terminal failed task never leaves an active running node',async t=>{
 installDom(t);t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});const scope=new PageScope();
 const root=await render({scope,demoMode:false,state:{gatewayId:'a'},dataSource:{listPipelineTasks:async()=>({items:[{taskId:'t'}]}),readPipelineTask:async()=>({taskId:'t',gatewayId:'a',status:'failed',events:[{type:'stage_started',data:{stage:'decision'}}]})}});
 assert.match(root.textContent,/失败/);assert.doesNotMatch(root.textContent,/进行中/);scope.dispose();
});

test('replay never reports execution or feedback as completed',async t=>{
 installDom(t);let tick;t.mock.method(globalThis,'setInterval',f=>{tick=f;return 1;});t.mock.method(globalThis,'clearInterval',()=>{});const scope=new PageScope();
 const root=await render({scope,demoMode:true,state:{},dataSource:{}});await button(root,'播放历史演示动画').click();for(let i=0;i<7;i++)tick();
 function walk(n,cls){if(n.className===cls)return n;for(const child of n.childNodes){const found=walk(child,cls);if(found)return found;}}
 assert.match(walk(root,'flow-node unavailable').textContent,/未接入/);assert.match(walk(root,'flow-node not_executed').textContent,/未执行/);scope.dispose();
});

test('workflow separates five software stages from two unavailable device nodes and supports paused replay',async t=>{
 installDom(t);let tick;t.mock.method(globalThis,'setInterval',f=>{tick=f;return 1;});t.mock.method(globalThis,'clearInterval',()=>{});const scope=new PageScope();
 const root=await render({scope,demoMode:true,state:{},dataSource:{}});
 function find(n,cls){if(n.className===cls)return n;for(const c of n.childNodes){const x=find(c,cls);if(x)return x;}}
 assert.equal(find(root,'agent-flow-track').children.length,5);assert.equal(find(root,'flow-device-branch').children.length,2);
 await button(root,'播放历史演示动画').click();tick();await button(root,'暂停回放').click();const paused=root.textContent;tick();tick();assert.equal(root.textContent,paused);
 await button(root,'继续回放').click();tick();assert.notEqual(root.textContent,paused);scope.dispose();
});
