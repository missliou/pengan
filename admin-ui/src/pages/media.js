import {el,button,sectionCard,banner,emptyState} from '../lib/dom.js';
import {fmtDateTime,fmtBytes} from '../lib/format.js';
const LIMIT=2*1024*1024;
export default async function renderMedia(ctx){
 const wrap=el('div',{class:'media-page'}),status=el('p',{role:'status'}),list=el('div',{class:'grid cols-2'}),storage=el('p',{class:'muted'});
 const admin=ctx.state.user?.role==='admin',writable=admin&&!ctx.demoMode;
 const category=el('select',{'aria-label':'上传图片分类'},[el('option',{value:'crop',text:'作物图片'}),admin?el('option',{value:'person',text:'现场人员图片（仅管理员）'}):null]);
 const file=el('input',{type:'file',accept:'image/jpeg,image/png','aria-label':'选择图片',disabled:!writable});
 const label=el('input',{type:'text',maxlength:120,placeholder:'例如：一号棚番茄叶片巡检','aria-label':'图片说明'});
 const captured=el('input',{type:'datetime-local','aria-label':'拍摄时间'});
 const seq=el('input',{type:'number',min:1,step:1,placeholder:'可选：关联本设备采集记录序号','aria-label':'采集记录序号'});
 const authorized=el('input',{type:'checkbox','aria-label':'确认有权保存该图片'});
 let busy=false,cursor=null,generation=0;
 const save=button('上传并保存',async()=>{
  if(!writable||busy||!ctx.scope.active)return;
  if(!authorized.checked){status.textContent='请先确认有权保存该图片。';return;}
  const selected=file.files?.[0],capturedAt=new Date(captured.value).getTime();
  if(!selected||!['image/jpeg','image/png'].includes(selected.type)||selected.size>LIMIT||selected.size<1){status.textContent='请选择不超过2 MB的JPEG或PNG图片。';return;}
  if(!label.value.trim()||!Number.isSafeInteger(capturedAt)){status.textContent='请填写图片说明和实际拍摄时间。';return;}
  busy=true;save.disabled=true;status.textContent='正在上传，等待服务器保存确认…';
  try{
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(selected);});
   if(!ctx.scope.active)return;
   const result=await ctx.dataSource.uploadMedia({category:category.value,label:label.value.trim(),capturedAt,telemetrySeq:seq.value?Number(seq.value):null,authorized:true,base64});
   if(!ctx.scope.active)return;
   if(result?.saved!==true||!result.item?.mediaId)throw Error('保存回执无效');
   status.textContent='服务器已保存，记录 '+result.item.mediaId+'；未发送给AI。';file.value='';authorized.checked=false;cursor=null;await refresh(false);
  }catch(e){if(ctx.scope.active)status.textContent='保存未确认：'+e.message+'。请先刷新列表核对，避免重复上传。';}
  finally{busy=false;if(ctx.scope.active)save.disabled=!writable;}
 },{disabled:!writable});
 const filter=el('select',{'aria-label':'查询图片分类'},[el('option',{value:'',text:'全部可见图片'}),el('option',{value:'crop',text:'作物图片'}),admin?el('option',{value:'person',text:'现场人员图片'}):null]);
 const next=button('下一页',()=>refresh(true),{variant:'secondary small',disabled:true});
 async function refresh(older=false){
  if(ctx.demoMode){list.replaceChildren(emptyState('演示模式没有真实图片','登录真实服务后上传；这里不展示虚构人员图片。'));return;}
  const version=++generation;next.disabled=true;
  try{
   const data=await ctx.dataSource.listMedia({category:filter.value,limit:20,...(older&&cursor?{beforeSeq:cursor}:{})});
   if(!ctx.scope.active||version!==generation)return;
   if(!Array.isArray(data.items))throw Error('图片列表协议无效');
   list.replaceChildren(...(data.items.length?data.items.map(item=>{
    const image=el('img',{class:'media-image',alt:item.label,hidden:true});
    const view=button('查看图片',()=>{image.src=ctx.dataSource.mediaContentUrl(item.mediaId);image.hidden=false;},{variant:'secondary small'});
    return sectionCard(item.label,item.category==='person'?'现场人员 · 仅管理员':'作物图片',
     el('p',{text:'拍摄 '+fmtDateTime(item.capturedAt)+' · 保存 '+fmtDateTime(item.createdAt)}),
     el('p',{class:'muted',text:item.width+' × '+item.height+' · '+fmtBytes(item.bytes)+' · 采集记录 '+(item.telemetrySeq??'未关联')}),
     el('p',{class:'muted',text:'登记人 '+item.actor+' · SHA256 '+item.sha256.slice(0,16)}),view,image);
   }):[emptyState('暂无图片','当前设备尚未保存符合筛选条件的图片。')]));
   cursor=data.nextBeforeSeq;next.disabled=!cursor;
   if(admin){try{const s=await ctx.dataSource.getStorageStatus();if(ctx.scope.active&&version===generation)storage.textContent='SQLite · 记录 '+s.historyRecords+' 条 · 图片 '+s.images+' 张 / '+fmtBytes(s.imageBytes)+' · 私有文件存储';}catch(e){if(ctx.scope.active&&version===generation)storage.textContent='存储状态未确认：'+e.message;}}
  }catch(e){if(ctx.scope.active&&version===generation)list.replaceChildren(banner('bad','图片读取失败：'+e.message));}
 }
 filter.addEventListener('change',()=>{cursor=null;void refresh(false);});
 wrap.append(banner('warn','图片按设备保存。人员图片仅管理员可见；上传不会自动发送给模型。请使用有权保存的现场照片。'),
  sectionCard('图片资料','当前设备：'+(ctx.state.gatewayId||'未选择'),storage,
   el('div',{class:'toolbar'},[filter,button('刷新列表',()=>{cursor=null;void refresh(false);},{variant:'secondary small',disabled:ctx.demoMode}),next])),
  sectionCard('新增图片','JPEG / PNG，单张最大2 MB；拍摄时间请按实际填写。',
   el('label',{class:'field'},['图片分类',category]),el('label',{class:'field'},['图片说明',label]),
   el('label',{class:'field'},['拍摄时间',captured]),el('label',{class:'field'},['关联采集记录（可选）',seq]),file,
   el('label',{class:'media-consent'},[authorized,'我确认有权将该图片保存到本系统；人员图片已获得相应授权。']),
   !writable?el('p',{class:'muted',text:ctx.demoMode?'演示模式禁止上传。':'当前账号只读，人员图片不可访问。'}):null,save,status),list);
 ctx.scope.onDispose(()=>{generation++;file.value='';});void refresh(false);return wrap;
}
