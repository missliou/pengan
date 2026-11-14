import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDom,button,find,flush} from './helpers/dom.mjs';
import {PageScope,MutationGate} from '../src/lib/session.js';
import {createDataSource} from '../src/lib/data-source.js';
import renderMedia from '../src/pages/media.js';
function context(t,extra={}){const scope=new PageScope();t.after(()=>scope.dispose());return {scope,state:{gatewayId:'dayu-a',user:{role:'admin'}},demoMode:false,...extra};}
test('media demo never reads real images or enables upload',async t=>{
 installDom(t);let reads=0;const root=await renderMedia(context(t,{demoMode:true,dataSource:{listMedia(){reads++;throw Error('unexpected');}}}));await flush();
 assert.equal(reads,0);assert.equal(button(root,'上传并保存').disabled,true);assert.match(root.textContent,/没有真实图片/);
});
test('media viewer sees crop records without upload and opens only an explicit preview',async t=>{
 installDom(t);let urls=0;const dataSource={listMedia:async()=>({items:[{mediaId:'test-image',category:'crop',label:'test leaf',capturedAt:1000,createdAt:2000,width:1,height:1,bytes:68,actor:'admin',sha256:'a'.repeat(64)}],nextBeforeSeq:null}),mediaContentUrl:()=>{urls++;return '/admin-api/media/test/content?gatewayId=dayu-a';}};
 const root=await renderMedia(context(t,{state:{gatewayId:'dayu-a',user:{role:'viewer'}},dataSource}));await flush();
 assert.equal(urls,0);assert.equal(button(root,'上传并保存').disabled,true);assert.doesNotMatch(root.textContent,/现场人员图片/);
 const image=find(root,n=>n.tagName==='img');assert.equal(image.hasAttribute('hidden'),true);await button(root,'查看图片').click();assert.equal(urls,1);assert.equal(image.hidden,false);
});
test('media source blocks demo and viewer writes and preserves selected device on real calls',async t=>{
 const scope=new PageScope();t.after(()=>scope.dispose());let calls=0;
 const api={uploadMedia:async(body,opts)=>{calls++;assert.equal(opts.gatewayId,'dayu-a');return {saved:true};}};
 for(const extra of [{demoMode:true},{role:'viewer'}]){const ds=createDataSource({scope,gate:new MutationGate(),gatewayId:'dayu-a',api,...extra});await assert.rejects(ds.uploadMedia({}));}
 assert.equal(calls,0);const ds=createDataSource({scope,gate:new MutationGate(),gatewayId:'dayu-a',api,role:'admin'});await ds.uploadMedia({});assert.equal(calls,1);
});
