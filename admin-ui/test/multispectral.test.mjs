import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDom,button,find,TestNode} from './helpers/dom.mjs';
import renderMultispectral from '../src/pages/multispectral.js';
import {PageScope,MutationGate} from '../src/lib/session.js';
import {createDataSource} from '../src/lib/data-source.js';
import {regionFromPoints} from '../src/lib/crop-marking.js';
test('manual drag maps both directions, clamps bounds and rejects accidental taps',()=>{
 assert.deepEqual(regionFromPoints({x:60,y:50},{x:20,y:10}),{x:20,y:10,width:40,height:40});
 assert.deepEqual(regionFromPoints({x:-20,y:90},{x:110,y:101}),{x:0,y:90,width:100,height:10});
 assert.equal(regionFromPoints({x:5,y:5},{x:5.1,y:5.1}),null);assert.equal(regionFromPoints({x:NaN,y:1},{x:2,y:3}),null);
});
test('multispectral demo has no fabricated bands/health or real reads',async t=>{
 installDom(t);const scope=new PageScope();t.after(()=>scope.dispose());let calls=0;
 const root=await renderMultispectral({scope,state:{gatewayId:'a',user:{role:'admin'}},demoMode:true,dataSource:new Proxy({},{get:()=>()=>{calls++;throw Error('unexpected');}})});
 assert.equal(calls,0);assert.match(root.textContent,/NDVI：不可计算/);assert.match(root.textContent,/不是AI或多光谱自动诊断/);assert.equal(button(root,'刷新影像列表').disabled,true);
});
test('crop review data source enforces mode/role and current gateway on writes',async t=>{
 const scope=new PageScope();t.after(()=>scope.dispose());let calls=0;
 const api={saveCropReview:async(body,options)=>{calls++;assert.equal(options.gatewayId,'a');return {saved:true};}};
 for(const extra of [{demoMode:true},{role:'viewer'}]){const ds=createDataSource({scope,gate:new MutationGate(),api,gatewayId:'a',...extra});await assert.rejects(ds.saveCropReview({}));}
 assert.equal(calls,0);const ds=createDataSource({scope,gate:new MutationGate(),api,gatewayId:'a',role:'admin'});await ds.saveCropReview({});assert.equal(calls,1);
});
test('crop image mark is explicit, saves revision and manual provenance, excludes automatic AI',async t=>{
 installDom(t);document.createElementNS=(_ns,tag)=>new TestNode(tag);
 const scope=new PageScope();t.after(()=>scope.dispose());let writes=0;
 const media={mediaId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',gatewayId:'a',category:'crop',label:'synthetic leaf',capturedAt:1000};
 let review={gatewayId:'a',mediaId:media.mediaId,revision:0,status:'unreviewed',plot:'',note:'',regions:[],source:'none'};
 const dataSource={listCropImages:async()=>({gatewayId:'a',items:[{media,review}],nextBeforeSeq:null}),getCropReview:async()=>({gatewayId:'a',media,review}),getCropReviewVersions:async()=>({gatewayId:'a',mediaId:media.mediaId,historical:true,isCurrent:false,items:[review]}),mediaContentUrl:()=>'/test-image',saveCropReview:async body=>{writes++;assert.equal(body.expectedRevision,0);assert.equal(body.status,'suspected');assert.equal(body.regions.length,1);review={...body,gatewayId:'a',revision:1,source:'manual',actor:'admin',reviewedAt:2000};return {saved:true,gatewayId:'a',media,review};}};
 const root=await renderMultispectral({scope,state:{gatewayId:'a',user:{role:'admin'}},demoMode:false,dataSource});
 assert.equal(writes,0);await button(root,'查看与标记').click();await button(root,'启用拖动框选').click();
 const imageWrap=find(root,n=>n.className.includes('spectral-image-wrap'));imageWrap.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});find(root,n=>n.tagName==='img').naturalWidth=100;
 const event=(x,y)=>({clientX:x,clientY:y,pointerId:1,button:0,preventDefault(){}});
 await imageWrap.listeners.pointerdown[0](event(10,10));await imageWrap.listeners.pointermove[0](event(40,40));await imageWrap.listeners.pointerup[0](event(40,40));
 await button(root,'查看与标记').click();assert.match(root.textContent,/有未保存修改/);
 await button(root,'保存人工复核').click();assert.equal(writes,0);assert.match(root.textContent,/请填写异常观察依据/);
 find(root,n=>n.tagName==='textarea').value='人工观察：局部叶色异常';await button(root,'保存人工复核').click();assert.equal(writes,1);assert.match(root.textContent,/服务端已保存人工复核/);assert.match(root.textContent,/版本 1/);
 await button(root,'查看最近20次复核').click();assert.match(root.textContent,/历史结论，不代表当前健康/);
});
