import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/lib/api.js';
import {getEnv} from '../src/lib/env.js';
import {createDataSource} from '../src/lib/data-source.js';
import {PageScope,MutationGate} from '../src/lib/session.js';
import {LiveObservations} from '../src/lib/freshness.js';

test('cloud authentication is default; session proof is required and CSRF is carried only in requests',async t=>{
  assert.equal(getEnv().ALLOW_LOCAL_DEBUG,false);api.clearAdminSession();t.after(()=>api.clearAdminSession());
  const requests=[];t.mock.method(globalThis,'fetch',async(url,init)=>{requests.push({url,init});return Response.json({authenticated:true,user:{username:'test-admin',role:'admin'},csrfToken:'test-csrf'});});
  await api.adminLogin({username:'test-admin',password:'fixture-only'});await api.testModelConnection();
  assert.equal(requests[0].url,'/admin-api/session/login');assert.equal(requests[1].init.headers['x-pengan-csrf'],'test-csrf');
  await api.adminLogout();await api.testModelConnection();assert.equal(requests.at(-1).init.headers['x-pengan-csrf'],undefined);
});
test('invalid session responses never grant a remembered CSRF token',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({authenticated:true,user:{username:'x',role:'owner'},csrfToken:'bad'}));
  await assert.rejects(api.adminLogin({}),e=>e.kind==='parse');
});
test('viewer source blocks all configuration and model test calls before transport',async()=>{
  let calls=0;const ds=createDataSource({scope:new PageScope(),gate:new MutationGate(),live:new LiveObservations(),role:'viewer',api:{saveModelConfig:()=>calls++,testModelConnection:()=>calls++}});
  await assert.rejects(ds.saveModelConfig({}));await assert.rejects(ds.testModelConnection());assert.equal(calls,0);
});
test('device-scoped history and observations carry encoded identity and scope cancellation',async t=>{
  const requests=[];t.mock.method(globalThis,'fetch',async(url,init)=>{requests.push({url,init});return Response.json({items:[]});});
  const controller=new AbortController();await api.getObservations({gatewayId:'dayu/a b',signal:controller.signal});
  await api.getHardwareHistory({limit:10,beforeSeq:5},{gatewayId:'dayu/a b'});
  assert.equal(requests[0].url,'/api/observations?gatewayId=dayu%2Fa%20b');
  assert.equal(requests[1].url,'/api/hardware/history?limit=10&beforeSeq=5&gatewayId=dayu%2Fa%20b');
  controller.abort();assert.equal(requests[0].init.signal.aborted,true);
});
