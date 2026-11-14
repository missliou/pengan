import {el,button,banner,sectionCard,chip,emptyState} from '../lib/dom.js';
import {fmtDateTime} from '../lib/format.js';
import {regionFromPoints} from '../lib/crop-marking.js';
const labels={unreviewed:'待复核',suspected:'疑似异常',confirmed:'确认异常',clear:'本次未见异常'};
const colors={unreviewed:'unknown',suspected:'warn',confirmed:'bad',clear:'ok'};
function svgNode(tag,attrs){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;}
export default async function renderMultispectral(ctx){
 const writable=!ctx.demoMode&&ctx.state.user?.role==='admin'&&Boolean(ctx.state.gatewayId),wrap=el('div',{class:'spectral-page'}),list=el('div',{class:'spectral-list'}),detail=el('div'),notice=el('p',{role:'status'});
 let version=0,cursor=null,selected=null,regions=[],busy=false,dirty=false;
 const next=button('下一页作物影像',()=>load(true),{variant:'secondary small',disabled:true});
 const refresh=button('刷新影像列表',()=>load(false),{variant:'secondary small',disabled:ctx.demoMode||!ctx.state.gatewayId});
 wrap.append(sectionCard('多光谱监测','当前阶段：作物影像人工复核；多光谱设备与波段数据尚未接入。',
  el('div',{class:'spectral-bands'},['可见光影像','红光：未接入','近红外：未接入','NDVI：不可计算'].map((s,i)=>chip(i===0?'info':'unknown',s))),
  banner('warn','普通JPEG/PNG照片不能计算真实植被指数。下方标记均为人工复核，不是AI或多光谱自动诊断。'),
  el('div',{class:'btn-row'},[refresh,next,button('上传作物图片',()=>ctx.navigate('media'),{variant:'secondary small'})]),notice),
  el('div',{class:'spectral-workbench'},[sectionCard('作物影像',null,list),detail]));
 async function load(older,keepNotice=false){
  if(ctx.demoMode||busy)return;const rev=++version;next.disabled=true;if(!keepNotice)notice.textContent='正在读取作物影像与标记…';
  try{const data=await ctx.dataSource.listCropImages(older&&cursor?{beforeSeq:cursor}:{});if(!ctx.scope.active||rev!==version)return;
   if(data.gatewayId!==ctx.state.gatewayId||!Array.isArray(data.items))throw Error('影像设备身份无效');
   list.replaceChildren(...(data.items.length?data.items.map(({media,review})=>{
    if(media.category!=='crop'||media.gatewayId!==ctx.state.gatewayId||review.mediaId!==media.mediaId)throw Error('作物影像协议无效');
    return el('div',{class:'spectral-list-item'},[chip(colors[review.status]||'unknown',labels[review.status]||'未知状态'),el('strong',{text:media.label}),
      el('small',{class:'muted',text:fmtDateTime(media.capturedAt)}),button('查看与标记',()=>select(media.mediaId),{variant:'secondary small'})]);
   }):[emptyState('暂无作物影像','请先到图片资料上传作物图片，人员图片不会进入此页。')]));
   cursor=data.nextBeforeSeq;next.disabled=!cursor;if(!keepNotice)notice.textContent='标记随图片保存；未复核不表示作物健康。';
  }catch(e){if(ctx.scope.active&&rev===version){list.replaceChildren(banner('bad','读取失败：'+e.message));notice.textContent='影像列表未确认。';}}
 }
 async function select(id){
  if(busy)return;if(dirty){notice.textContent='当前影像有未保存修改，请先保存，或点击“放弃未保存修改”后再切换。';return;}const rev=++version;notice.textContent='正在读取影像复核记录…';
  try{const value=await ctx.dataSource.getCropReview(id);if(!ctx.scope.active||rev!==version)return;
   if(value.gatewayId!==ctx.state.gatewayId||value.media?.category!=='crop'||value.media.mediaId!==id||value.review?.mediaId!==id||value.review.gatewayId!==ctx.state.gatewayId)throw Error('影像设备身份无效');
   selected=value;regions=value.review.regions.map(r=>({...r}));paint();notice.textContent='已载入影像，当前标记来源：'+(value.review.source==='manual'?'人工复核':'尚未复核');
  }catch(e){if(ctx.scope.active&&rev===version)notice.textContent='影像读取失败：'+e.message;}
 }
 function paint(){
  const {media,review}=selected,local=el('p',{role:'status'});
  let dragStart=null,dragId=null,dragMode=false,historyEpoch=0;
  const state=el('select',{'aria-label':'作物复核状态',disabled:!writable},Object.entries(labels).map(([value,text])=>el('option',{value,text,selected:value===review.status})));
  const plot=el('input',{type:'text',maxlength:80,value:review.plot,placeholder:'例如：东侧第3垄（可选）',disabled:!writable});
  const note=el('textarea',{rows:3,maxlength:800,placeholder:'记录叶片变色、萎蔫等观察依据；不要填写人员隐私',value:review.note,disabled:!writable});
  for(const input of [state,plot,note]){input.addEventListener('input',()=>{dirty=true;});input.addEventListener('change',()=>{dirty=true;});}
  const overlay=svgNode('svg',{viewBox:'0 0 1000 1000',preserveAspectRatio:'none',class:'spectral-overlay','aria-hidden':'true'});
  const image=el('img',{class:'spectral-image',src:ctx.dataSource.mediaContentUrl(media.mediaId),alt:media.label,draggable:false});
  image.addEventListener('dragstart',event=>event.preventDefault());
  const imageWrap=el('div',{class:'spectral-image-wrap'},[image,overlay]);
  const regionText=el('p',{class:'muted'});
  const inputs=['左侧位置X %','顶部位置Y %','宽度 %','高度 %'].map((s,i)=>el('input',{type:'number',min:0,max:100,step:0.1,value:i<2?'10':'25','aria-label':s,disabled:!writable}));
  function redraw(preview=null){overlay.replaceChildren(...[...regions,...(preview?[preview]:[])].map(r=>svgNode('rect',{x:r.x*10,y:r.y*10,width:r.width*10,height:r.height*10,class:'spectral-region'})));regionText.textContent='已标记 '+regions.length+' 个区域（百分比坐标，与原图对齐）。';}
  const dragToggle=button('启用拖动框选',()=>{dragMode=!dragMode;dragStart=null;dragId=null;imageWrap.classList.toggle('marking',dragMode);dragToggle.textContent=dragMode?'退出拖动框选':'启用拖动框选';dragToggle.setAttribute('aria-pressed',String(dragMode));redraw();},{variant:'secondary small',disabled:!writable});
  dragToggle.setAttribute('aria-pressed','false');
  const point=event=>{const rect=imageWrap.getBoundingClientRect();return {x:(event.clientX-rect.left)/rect.width*100,y:(event.clientY-rect.top)/rect.height*100};};
  imageWrap.addEventListener('pointerdown',event=>{if(!dragMode||!writable||busy||event.button!==0||!image.naturalWidth||regions.length>=10)return;dragStart=point(event);dragId=event.pointerId;imageWrap.setPointerCapture?.(dragId);event.preventDefault();});
  imageWrap.addEventListener('pointermove',event=>{if(dragStart&&dragId===event.pointerId)redraw(regionFromPoints(dragStart,point(event)));});
  imageWrap.addEventListener('pointerup',event=>{if(!dragStart||dragId!==event.pointerId)return;const region=regionFromPoints(dragStart,point(event));dragStart=null;dragId=null;if(region){regions.push(region);dirty=true;if(!['suspected','confirmed'].includes(state.value))state.value='suspected';local.textContent='框选尚未保存，请填写观察依据后保存。';}else local.textContent='框选区域太小，请重新拖动。';redraw();});
  imageWrap.addEventListener('pointercancel',()=>{dragStart=null;dragId=null;redraw();});
  const add=button('添加异常区域',()=>{
   if(!writable||busy)return;const [x,y,width,height]=inputs.map(n=>Number(n.value));
   if(inputs.some(n=>n.value==='')||![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>100||y+height>100||regions.length>=10){local.textContent='区域必须在图像范围内，宽高大于0；最多10个。';return;}
   regions.push({x,y,width,height});dirty=true;if(!['suspected','confirmed'].includes(state.value))state.value='suspected';redraw();local.textContent='区域尚未保存，请填写观察备注后保存。';
  },{variant:'secondary small',disabled:!writable});
  const remove=button('移除最后一个区域',()=>{if(busy)return;if(regions.length){regions.pop();dirty=true;}redraw();},{variant:'secondary small',disabled:!writable});
  const discard=button('放弃未保存修改',()=>{if(busy)return;dirty=false;void select(media.mediaId);},{variant:'secondary small',disabled:!writable});
  const save=button('保存人工复核',async()=>{
   if(!writable||busy||!ctx.scope.active)return;
   if(['suspected','confirmed'].includes(state.value)&&!note.value.trim()){local.textContent='请填写异常观察依据。';return;}
   if(['clear','unreviewed'].includes(state.value)&&regions.length){local.textContent='请先移除异常区域，或选择疑似/确认异常。';return;}
   busy=true;dragStart=null;dragId=null;dragToggle.disabled=true;save.disabled=true;add.disabled=true;remove.disabled=true;[state,plot,note,...inputs].forEach(n=>{n.disabled=true;});local.textContent='正在保存，等待服务端确认…';
   try{
    const response=await ctx.dataSource.saveCropReview({mediaId:media.mediaId,expectedRevision:review.revision,status:state.value,plot:plot.value.trim(),note:note.value.trim(),regions:regions.map(r=>({...r}))});
    if(!ctx.scope.active)return;
    if(response.saved!==true||response.gatewayId!==ctx.state.gatewayId||response.media?.mediaId!==media.mediaId||response.media.category!=='crop'||response.media.gatewayId!==ctx.state.gatewayId||response.review?.mediaId!==media.mediaId||response.review.gatewayId!==ctx.state.gatewayId||response.review.source!=='manual'||response.review.revision!==review.revision+1)throw Error('复核保存回执无效');
    selected=response;regions=response.review.regions.map(r=>({...r}));dirty=false;paint();notice.textContent='服务端已保存人工复核；未发送给AI。';
   }catch(e){if(ctx.scope.active)local.textContent='保存未确认：'+e.message+'。请重新选择该影像读取最新版本，避免覆盖他人修改。';}
   finally{busy=false;if(ctx.scope.active){dragToggle.disabled=!writable;save.disabled=!writable;add.disabled=!writable;remove.disabled=!writable;[state,plot,note,...inputs].forEach(n=>{n.disabled=!writable;});}}
   if(ctx.scope.active)void load(false,true);
  },{disabled:!writable});
  const historyHost=el('div');
  const historyButton=button('查看最近20次复核',async()=>{
   const epoch=++historyEpoch;historyButton.disabled=true;historyHost.replaceChildren(el('p',{text:'正在读取历史版本…'}));
   try{const data=await ctx.dataSource.getCropReviewVersions(media.mediaId);if(!ctx.scope.active||epoch!==historyEpoch||selected?.media.mediaId!==media.mediaId||selected.review.revision!==review.revision)return;
    if(data.gatewayId!==ctx.state.gatewayId||data.mediaId!==media.mediaId||data.historical!==true||data.isCurrent!==false||!Array.isArray(data.items)||data.items.length>20)throw Error('复核历史协议无效');
    historyHost.replaceChildren(...(data.items.length?data.items.map(r=>{
     if(r.mediaId!==media.mediaId||r.gatewayId!==ctx.state.gatewayId||r.source!=='manual')throw Error('复核历史身份无效');
     return el('details',{class:'crop-version'},[el('summary',{text:'版本 '+r.revision+' · '+(labels[r.status]||'未知')+' · '+fmtDateTime(r.reviewedAt)}),el('p',{text:'复核人 '+r.actor+' · 位置 '+(r.plot||'未填写')}),el('p',{text:r.note||'无备注'}),el('p',{class:'muted',text:'区域 '+r.regions.length+' 个；历史结论，不代表当前健康。'})]);
    }):[el('p',{text:'尚无人工复核版本'})]));
   }catch(e){if(ctx.scope.active&&selected?.media.mediaId===media.mediaId)historyHost.replaceChildren(banner('bad','版本读取失败：'+e.message));}
   finally{if(ctx.scope.active)historyButton.disabled=false;}
  },{variant:'secondary small'});
  detail.replaceChildren(sectionCard(media.label,'影像拍摄于 '+fmtDateTime(media.capturedAt),
   chip(colors[review.status]||'unknown',labels[review.status]||'未知状态'),
   imageWrap,dragToggle,el('p',{class:'muted',text:'先启用框选，再在图像上拖动；也可使用下方坐标表单。退出框选后可正常滚动页面。'}),
   el('p',{class:'muted',text:'标记来源：'+(review.source==='manual'?'人工复核':'尚未复核')+' · 版本 '+review.revision+' · 复核人 '+(review.actor||'暂无')+' · '+fmtDateTime(review.reviewedAt)}),
   el('label',{class:'field'},['复核结论',state]),el('label',{class:'field'},['作物位置',plot]),el('label',{class:'field'},['观察依据与处理备注',note]),
   el('div',{class:'spectral-coordinates'},inputs.map((n,i)=>el('label',{class:'field'},[['X %','Y %','宽 %','高 %'][i],n]))),
   el('div',{class:'btn-row'},[add,remove]),regionText,
   !writable?el('p',{class:'muted',text:'当前账号只读；修改需要管理员权限。'}):null,el('div',{class:'btn-row'},[save,discard]),local,historyButton,historyHost));redraw();
 }
 if(ctx.demoMode){notice.textContent='演示模式不读取真实作物照片或保存复核。';list.append(emptyState('等待作物影像','多光谱设备尚未接入，不显示虚构的植被指数。'));detail.append(sectionCard('异常标记工作台',null,el('p',{text:'登录后选择作物照片，可标记区域、填写观察依据和保存复核记录。'})));}
 else if(ctx.state.gatewayId)await load(false);else notice.textContent='请先选择设备。';
 ctx.scope.onDispose(()=>{version++;});return wrap;
}
