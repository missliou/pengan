const fail=code=>{throw Error(code);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const states=new Set(['unreviewed','suspected','confirmed','clear']);
const mediaId=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
function validate(body){
 if(!object(body)||Object.keys(body).some(k=>!['mediaId','expectedRevision','status','plot','note','regions'].includes(k))||!mediaId(body.mediaId)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!states.has(body.status)||typeof body.plot!=='string'||body.plot.length>80||typeof body.note!=='string'||body.note.length>800||!Array.isArray(body.regions)||body.regions.length>10)fail('invalid_crop_review');
 if(['suspected','confirmed'].includes(body.status)&&!body.note.trim())fail('invalid_crop_review');
 for(const r of body.regions){if(!object(r)||Object.keys(r).some(k=>!['x','y','width','height'].includes(k))||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>100||r.y+r.height>100)fail('invalid_crop_review_region');}
 if(['unreviewed','clear'].includes(body.status)&&body.regions.length)fail('invalid_crop_review_region');
 return structuredClone(body);
}
export class CropReviews {
 constructor({history,database,now=Date.now}){Object.assign(this,{history,database,now});this.tail=Promise.resolve();this.latest=new Map();}
 open(){
  this.latest.clear();
  for(const row of this.history.rows){if(row.kind!=='audit'||row.data?.event!=='crop_review_saved')continue;
   const item=row.data.review;
   if(!item||item.gatewayId!==row.gatewayId||item.source!=='manual'||!Number.isSafeInteger(item.reviewedAt)||typeof item.actor!=='string')fail('crop_review_state_invalid');
   validate({mediaId:item.mediaId,expectedRevision:item.revision-1,status:item.status,plot:item.plot,note:item.note,regions:item.regions});
   const key=row.gatewayId+'/'+item.mediaId,previous=this.latest.get(key);
   if(item.revision!==(previous?.revision||0)+1)fail('crop_review_state_invalid');this.latest.set(key,structuredClone(item));
  }return this;
 }
 read(gatewayId,id,role){
  const media=this.database.detail(id,gatewayId,role);if(media.category!=='crop')fail('crop_image_not_found');
  const review=this.latest.get(gatewayId+'/'+id)||{gatewayId,mediaId:id,revision:0,status:'unreviewed',plot:'',note:'',regions:[],source:'none',actor:null,reviewedAt:null};
  return {schemaVersion:1,gatewayId,media,review:structuredClone(review),multispectralConnected:false,indicesAvailable:false};
 }
 list(gatewayId,role,params){
  const data=this.database.list({gatewayId,role,category:'crop',limit:20,beforeSeq:params.has('beforeSeq')?Number(params.get('beforeSeq')):undefined});
  return {gatewayId,...data,multispectralConnected:false,indicesAvailable:false,items:data.items.map(media=>({media,review:this.read(gatewayId,media.mediaId,role).review}))};
 }
 versions(gatewayId,id,role){
  this.read(gatewayId,id,role);
  const rows=this.history.rows.filter(row=>row.kind==='audit'&&row.gatewayId===gatewayId&&row.data?.event==='crop_review_saved'&&row.data.review?.mediaId===id);
  return {gatewayId,mediaId:id,historical:true,isCurrent:false,scope:'latest-20-revisions',items:rows.slice(-20).reverse().map(row=>structuredClone(row.data.review))};
 }
 deviceInbox(gatewayId){
  const rows=this.database.list({gatewayId,role:'viewer',category:'crop',limit:10});
  return {schemaVersion:1,gatewayId,readOnly:true,historical:true,isCurrent:false,multispectralConnected:false,indicesAvailable:false,scope:'latest-10-crop-images',readAt:this.now(),items:rows.items.map(media=>{
   const r=this.read(gatewayId,media.mediaId,'viewer').review;
   return {mediaId:media.mediaId,label:media.label,capturedAt:media.capturedAt,status:r.status,revision:r.revision,plot:r.plot,note:r.note,source:r.source,reviewedAt:r.reviewedAt,regionCount:r.regions.length};
  })};
 }
 save(gatewayId,body,actor,role){
  const work=this.tail.then(async()=>{
   if(role!=='admin')fail('forbidden');const clean=validate(body);
   const current=this.read(gatewayId,clean.mediaId,role);
   if(current.review.revision!==clean.expectedRevision)fail('crop_review_revision_conflict');
   const review={gatewayId,mediaId:clean.mediaId,revision:clean.expectedRevision+1,status:clean.status,plot:clean.plot.trim(),note:clean.note.trim(),regions:clean.regions,source:'manual',actor,reviewedAt:this.now()};
   try{await this.history.append({kind:'audit',gatewayId,data:{event:'crop_review_saved',actor,scope:'crop',review}});}
   catch(e){this.open();throw e;}
   this.latest.set(gatewayId+'/'+clean.mediaId,review);return {saved:true,...this.read(gatewayId,clean.mediaId,role)};
  });this.tail=work.catch(()=>{});return work;
 }
}
