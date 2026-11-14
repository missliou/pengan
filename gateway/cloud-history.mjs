import {mkdir,readFile,stat,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const hash=value=>createHash('sha256').update(value).digest('hex'),zero='0'.repeat(64),fail=code=>{throw Error(code);};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v);
function checkData(data){
 if(!data||typeof data!=='object'||Array.isArray(data))fail('invalid_history_data');
 const text=JSON.stringify(data);if(Buffer.byteLength(text)>262144)fail('history_record_too_large');
 JSON.parse(text, (key,value)=>{if(/password|passwd|secret|token|authorization|api.?key|wifi.?ssid/i.test(key))fail('sensitive_history_field');return value;});return JSON.parse(text);
}
export class CloudHistory {
 constructor({file,maxBytes=64*1024*1024,now=Date.now}={}){if(!path.isAbsolute(file||'')||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>256*1024*1024)fail('invalid_history_config');Object.assign(this,{file,maxBytes,now});this.rows=[];this.keys=new Map();this.bytes=0;this.ready=false;this.healthy=false;this.tail=Promise.resolve();}
 async open(){
  this.ready=false;this.healthy=false;this.rows=[];this.keys.clear();this.bytes=0;
  try{if((await stat(this.file)).size>this.maxBytes)fail('history_capacity_exceeded');const text=await readFile(this.file,'utf8');this.bytes=Buffer.byteLength(text);if(text&&!text.endsWith('\n'))fail('history_incomplete_tail');
   for(const line of text.split('\n').filter(Boolean)){const row=JSON.parse(line),{hash:claimed,...content}=row;
    if(row.seq!==this.rows.length+1||row.previousHash!==(this.rows.at(-1)?.hash||zero)||claimed!==hash(JSON.stringify(content))||!['telemetry','analysis','audit'].includes(row.kind)||!id(row.gatewayId)||!Number.isSafeInteger(row.recordedAt)||row.recordedAt<0||row.key!==null&&!id(row.key))fail('history_chain_invalid');
    checkData(row.data);if(row.key&&this.keys.has(row.kind+'|'+row.gatewayId+'|'+row.key))fail('history_duplicate_key');this.rows.push(row);if(row.key)this.keys.set(row.kind+'|'+row.gatewayId+'|'+row.key,row);
   }
  }catch(error){if(error.code!=='ENOENT'){this.rows=[];this.keys.clear();this.bytes=0;fail('cloud_history_unavailable');}}
  this.ready=true;this.healthy=true;return this;
 }
 append(input){const task=this.tail.then(()=>this.write(input));this.tail=task.catch(()=>{});return task;}
 async checkDisk(){
  try{const info=await stat(this.file);if(!info.isFile()||info.size!==this.bytes)throw Error('changed');}
  catch(error){if(error.code==='ENOENT'&&this.bytes===0)return;this.healthy=false;fail('history_file_changed');}
 }
 async write({kind,gatewayId,data,key=null}){
  if(!this.ready||!this.healthy)fail('cloud_history_unavailable');if(!['telemetry','analysis','audit'].includes(kind)||!id(gatewayId)||key!==null&&!id(key))fail('invalid_history_record');
  await this.checkDisk();
  const clean=checkData(data),index=kind+'|'+gatewayId+'|'+key,prior=key&&this.keys.get(index);
  if(prior){if(JSON.stringify(prior.data)!==JSON.stringify(clean))fail('history_key_conflict');return structuredClone(prior);}
  const content={seq:this.rows.length+1,kind,gatewayId,key,recordedAt:this.now(),previousHash:this.rows.at(-1)?.hash||zero,data:clean};
  if(!Number.isSafeInteger(content.recordedAt)||content.recordedAt<0)fail('invalid_history_time');const row={...content,hash:hash(JSON.stringify(content))},line=JSON.stringify(row)+'\n';
  if(this.bytes+Buffer.byteLength(line)>this.maxBytes)fail('history_capacity_exceeded');
  let handle;try{await mkdir(path.dirname(this.file),{recursive:true});handle=await open(this.file,'a',0o600);if((await handle.stat()).size!==this.bytes)fail('history_file_changed');await handle.writeFile(line);await handle.sync();if((await handle.stat()).size!==this.bytes+Buffer.byteLength(line))fail('history_file_changed');}
  catch{this.healthy=false;fail('history_write_failed');}finally{try{await handle?.close();}catch{this.healthy=false;fail('history_write_failed');}}
  this.rows.push(row);if(key)this.keys.set(index,row);this.bytes+=Buffer.byteLength(line);return structuredClone(row);
 }
 status(){return {enabled:true,healthy:this.ready&&this.healthy,records:this.rows.length,bytes:this.bytes,maxBytes:this.maxBytes,scope:'retained-file',externalCompletenessVerified:false};}
 query({kind,gatewayId,limit=50,beforeSeq=Number.MAX_SAFE_INTEGER}={}){
  if(!this.ready||!this.healthy)fail('cloud_history_unavailable');if(kind!==undefined&&!['telemetry','analysis','audit'].includes(kind)||gatewayId!==undefined&&!id(gatewayId)||!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(beforeSeq)||beforeSeq<1)fail('invalid_history_query');
  const rows=this.rows.filter(r=>r.seq<beforeSeq&&(!kind||r.kind===kind)&&(!gatewayId||r.gatewayId===gatewayId)).reverse(),items=structuredClone(rows.slice(0,limit));
  return {schemaVersion:1,historical:true,isCurrent:false,items,storage:this.status(),nextBeforeSeq:rows.length>limit?items.at(-1).seq:null};
 }
 async flush(){await this.tail;if(!this.healthy)fail('cloud_history_unavailable');}
}
