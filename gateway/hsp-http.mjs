import net from 'node:net';
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateHspFrame} from './hsp-telemetry.mjs';
export function hspHttpUrl(ip){
 if(net.isIP(ip)!==4||! /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip))throw Error('wifi_requires_private_ipv4');
 return `http://${ip}/api/pengan/telemetry`;
}
export class HspHttpReader{
 constructor({ip,file,fetchFn=fetch,now=Date.now}){this.url=hspHttpUrl(ip);this.file=file;this.fetchFn=fetchFn;this.now=now;this.lastUptime=null;this.busy=false;}
 async open(){
  try{const previous=JSON.parse(await readFile(this.file,'utf8'));validateHspFrame(previous.frame);this.lastUptime=previous.frame.uptime_ms;}
  catch(error){if(error.code!=='ENOENT')throw Error('existing_hardware_sample_invalid');}
  return this;
 }
 async poll(signal){
  if(this.busy)throw Error('wifi_poll_busy');this.busy=true;
  let temp;
  try{
   const receivedAt=this.now(),timeout=AbortSignal.timeout(3000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
   const response=await this.fetchFn(this.url,{redirect:'error',cache:'no-store',signal:requestSignal});
   if(!response.ok)throw Error('wifi_http_failed');
   if(!response.body?.getReader)throw Error('wifi_body_unavailable');
   const reader=response.body.getReader();let size=0;const parts=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw Error('wifi_frame_too_large');}parts.push(value);}}
   finally{reader.releaseLock();}
   const bytes=Buffer.concat(parts),raw=validateHspFrame(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
   if(this.now()-receivedAt>=3000)throw Error('wifi_sample_too_slow');
   requestSignal.throwIfAborted();
   if(raw.uptime_ms===this.lastUptime)return {accepted:false,duplicate:true};
   // Keep only the telemetry contract, never credentials or extra board-web fields.
   const keys=['schemaVersion','deviceId','simulated','controlSupported','coValid','co2Valid','coPpm','co2Ppm','uptime_ms','th_ok','gas_ok','th_sample_age_ms','gas_sample_age_ms','temperature10','humidity10','gas_raw','gas_mv'];
   const frame=Object.fromEntries(keys.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key]]));
   if(!frame.th_ok){frame.temperature10=null;frame.humidity10=null;}
   if(!frame.gas_ok){frame.gas_raw=null;frame.gas_mv=null;}
   await mkdir(path.dirname(this.file),{recursive:true});temp=path.join(path.dirname(this.file),'hsp-http-'+randomUUID()+'.tmp');
   await writeFile(temp,JSON.stringify({receivedAt,transport:'http',frame}),{encoding:'utf8',flag:'wx'});
   requestSignal.throwIfAborted();await rename(temp,this.file);this.lastUptime=raw.uptime_ms;
   return {accepted:true,duplicate:false};
  }finally{if(temp)await rm(temp,{force:true}).catch(()=>{});this.busy=false;}
 }
}
