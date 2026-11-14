import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alertPendingTotal} from '../src/pages/alerts.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
for(const [name,method] of [['probeReviewPending','listReviewQueue'],['probeAlertPending','listAlerts']]){
 test('actual app '+name+' sends the selected gateway to badge API',async()=>{
  const body=app.match(new RegExp('async function '+name+'\\(\\) \\{[\\s\\S]*?\\n\\}'))?.[0];assert.ok(body);
  const calls=[],state={demoMode:false,user:{role:'admin'},gatewayId:'dayu-b'};
  const invoke=new Function('state','api','alertPendingTotal','markNavDots','contextRevision',body+'; return '+name+'();');
  await invoke(state,{[method]:async(...args)=>{calls.push(args);return {counts:{pending:4,open:2,acknowledged:1}};}},alertPendingTotal,()=>{},1);
  assert.equal(calls.length,1);assert.equal(calls[0][1].gatewayId,'dayu-b');assert.equal(name==='probeReviewPending'?state.reviewPending:state.alertPending,name==='probeReviewPending'?4:3);
 });
}
