import {readFile,appendFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {hspSnapshot,hspSource} from './hsp-telemetry.mjs';
const MAX_BYTES=64*1024*1024;
const digest=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
// Records validated serial or HTTP envelopes only. History is never a current observation.
export class HardwareHistory {
 constructor(file){this.file=file;this.count=0;this.previous='GENESIS';this.bytes=0;this.lastReceivedAt=-1;this.rows=[];this.queue=Promise.resolve();this.healthy=true;this.opened=false;}
 async open(){
  if(this.opened)throw Error('hardware_history_already_open');
  await mkdir(path.dirname(this.file),{recursive:true});
  let text='';
  try{if((await stat(this.file)).size>MAX_BYTES)throw Error('hardware_history_size_limit');text=await readFile(this.file,'utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(text&&!text.endsWith('\n'))throw Error('hardware_history_incomplete');
  for(const line of text.split('\n').filter(Boolean)){
   const row=JSON.parse(line),{hash,...body}=row;
   if(body.schemaVersion!==1||body.simulated!==false||!['serial','http'].includes(body.source)||body.source!==hspSource(body.sample?.transport)||body.seq!==this.count+1||body.previous!==this.previous||hash!==digest(body)||!this.validSample(body.sample)||body.sample.receivedAt<=this.lastReceivedAt)throw Error('hardware_history_integrity_failed');
   this.commit(row);
  }
  this.bytes=Buffer.byteLength(text);this.opened=true;return this;
 }
 validSample(sample){return sample&&hspSnapshot(sample,sample.receivedAt).deviceOnline===true;}
 commit(row){this.count=row.seq;this.previous=row.hash;this.lastReceivedAt=row.sample.receivedAt;this.rows.push(row);if(this.rows.length>500)this.rows.shift();}
 collect(hardwareFile,now=Date.now()){
  const task=this.queue.then(async()=>{
   if(!this.opened||!this.healthy)throw Error('hardware_history_unavailable');
   let sample;
   try{if((await stat(hardwareFile)).size>16384)return false;sample=JSON.parse((await readFile(hardwareFile,'utf8')).replace(/^\uFEFF/,''));}
   catch(error){if(['ENOENT','EACCES','EPERM'].includes(error.code)||error instanceof SyntaxError)return false;throw error;}
   if(!hspSnapshot(sample,now).deviceOnline||sample.receivedAt<=this.lastReceivedAt)return false;
   // Keep the schema fields only; do not persist arbitrary log text or config.
   const fields=['schemaVersion','deviceId','simulated','uptime_ms','th_ok','temperature10','humidity10','gas_ok','gas_raw','gas_mv','th_sample_age_ms','gas_sample_age_ms','coValid','co2Valid','coPpm','co2Ppm','controlSupported'];
   const source=hspSource(sample.transport);
   const stored={receivedAt:sample.receivedAt,...(source==='http'?{transport:'http'}:{}),frame:Object.fromEntries(fields.map(key=>[key,sample.frame[key]]))};
   const body={schemaVersion:1,seq:this.count+1,previous:this.previous,source,simulated:false,sample:stored};
   const row={...body,hash:digest(body)},line=JSON.stringify(row)+'\n';
   let diskBytes=0;try{const info=await stat(this.file);if(!info.isFile())throw Error('hardware_history_file_changed');diskBytes=info.size;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(diskBytes!==this.bytes)throw Error('hardware_history_file_changed');
   if(this.bytes+Buffer.byteLength(line)>MAX_BYTES)throw Error('hardware_history_size_limit');
   await appendFile(this.file,line,{encoding:'utf8',mode:0o600});this.bytes+=Buffer.byteLength(line);this.commit(row);return true;
  });
  this.queue=task.catch(()=>{this.healthy=false;});return task;
 }
 status(){return {enabled:true,healthy:this.opened&&this.healthy,records:this.count,bytes:this.bytes,maxBytes:MAX_BYTES,simulated:false};}
 read({limit=50,beforeSeq=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(beforeSeq)||beforeSeq<1)throw Error('invalid_history_query');
  return {schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:this.status(),retainedInMemory:this.rows.length,items:this.rows.filter(row=>row.seq<beforeSeq).slice(-limit).reverse().map(row=>({seq:row.seq,hash:row.hash,historical:true,isCurrent:false,observation:hspSnapshot(row.sample,row.sample.receivedAt)}))};
 }
 async flush(){await this.queue;}
}
