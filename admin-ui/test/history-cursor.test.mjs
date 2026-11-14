import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyCursor} from '../src/lib/history-cursor.js';
import {PageScope} from '../src/lib/session.js';
import {installDom,button} from './helpers/dom.mjs';
import {API} from '../src/lib/api.js';
test('history cursor loads older pages and clearly distinguishes loaded rows',async t=>{
  installDom(t);const scope=new PageScope(),data={items:[{seq:3}],nextBeforeSeq:3};let request,rows;
  const root=historyCursor({scope},data,async opts=>{request=opts;return {items:[{seq:2},{seq:1}],nextBeforeSeq:null};},incoming=>rows=incoming);
  assert.match(root.textContent,/还有更早/);await button(root,'加载更早记录').click();
  assert.deepEqual(request,{limit:200,beforeSeq:3});assert.equal(data.items.length,3);assert.equal(rows.length,2);assert.match(root.textContent,/无更早/);assert.equal(button(root,'加载更早记录').disabled,true);
});
test('late history response cannot mutate rows after device/page scope disposal',async t=>{
  installDom(t);const scope=new PageScope(),data={items:[{seq:3}],nextBeforeSeq:3};let resolve,calls=0;
  const root=historyCursor({scope},data,()=>new Promise(r=>resolve=r),()=>calls++);
  const pending=button(root,'加载更早记录').click();scope.dispose();resolve({items:[{seq:2}],nextBeforeSeq:2});await pending;
  assert.equal(data.items.length,1);assert.equal(calls,0);
});
test('invalid/repeating cursors are rejected without silently dropping rows',async t=>{
  installDom(t);const data={items:[{seq:3}],nextBeforeSeq:3};
  const root=historyCursor({scope:new PageScope()},data,async()=>({items:[{seq:3}],nextBeforeSeq:3}),()=>assert.fail('invalid page applied'));
  await button(root,'加载更早记录').click();assert.equal(data.items.length,1);assert.match(root.textContent,/加载失败/);
});
test('AI history sends server cursor and selected gateway identity',async t=>{
  let url;t.mock.method(globalThis,'fetch',async value=>{url=value;return Response.json({items:[]});});
  await API.getAnalysisHistory({limit:200,beforeSeq:5},{gatewayId:'dayu-test'});
  assert.equal(url,'/api/agent/history?limit=200&beforeSeq=5&gatewayId=dayu-test');
});
