import {readFile,stat} from 'node:fs/promises';
export const TELEMETRY_PREFIX='PENGAN_TELEMETRY ';
export const HSP_TTL_MS=10000;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export function validateHspFrame(f){
 if(!f||Array.isArray(f)||f.schemaVersion!==1||f.deviceId!=='hh-hsp101-001'||f.simulated!==false||f.controlSupported!==false||f.coValid!==false||f.co2Valid!==false||f.coPpm!==null||f.co2Ppm!==null)throw Error('invalid_hsp_identity');
 if(!integer(f.uptime_ms,0,4294967295)||typeof f.th_ok!=='boolean'||typeof f.gas_ok!=='boolean'||!integer(f.th_sample_age_ms,0,4294967295)||!integer(f.gas_sample_age_ms,0,4294967295))throw Error('invalid_hsp_quality');
 if(f.th_ok&&(!integer(f.temperature10,-400,850)||!integer(f.humidity10,0,1000)))throw Error('invalid_hsp_climate');
 if(f.gas_ok&&(!integer(f.gas_raw,0,4095)||!integer(f.gas_mv,0,7200)))throw Error('invalid_hsp_adc');
 return f;
}
export function parseHspLine(line){
 if(typeof line!=='string'||line.length>8192||!line.startsWith(TELEMETRY_PREFIX))throw Error('invalid_hsp_line');
 return validateHspFrame(JSON.parse(line.slice(TELEMETRY_PREFIX.length)));
}
export function hspSource(transport){if(transport===undefined||transport==='serial')return 'serial';if(transport==='http')return 'http';throw Error('invalid_hsp_transport');}
// A failed read cannot prove its transport: never let it inherit the historical 'serial' label.
export function hspSourceOrUnknown(transport){if(transport===undefined)return 'unknown';try{return hspSource(transport);}catch{return 'unknown';}}
function unknown(reason,source='serial'){return {schemaVersion:1,deviceId:'hh-hsp101-001',source,simulated:false,deviceOnline:false,reason,receivedAt:null,sampleAgeMs:null,values:{temperatureC:null,humidityPct:null,gasRaw:null,gasMv:null,coPpm:null,co2Ppm:null},quality:{temperatureValid:false,humidityValid:false,gasValid:false,coValid:false,co2Valid:false},actuationAvailable:false,controlSupported:false,admission:'unknown_denied'};}
export function hspSnapshot(envelope,now=Date.now()){
 let source=hspSourceOrUnknown(envelope?.transport);
 try{
 source=hspSource(envelope?.transport);
 if(!envelope||!Number.isSafeInteger(envelope.receivedAt)||envelope.receivedAt<0||!Number.isSafeInteger(now)||now<envelope.receivedAt)return unknown('invalid_receive_time',source);
 const f=validateHspFrame(envelope.frame),age=now-envelope.receivedAt;
 if(age>=HSP_TTL_MS)return unknown('telemetry_stale',source);
 const thAge=age+f.th_sample_age_ms,gasAge=age+f.gas_sample_age_ms;
 const th=f.th_ok&&thAge<HSP_TTL_MS,gas=f.gas_ok&&gasAge<HSP_TTL_MS;
 return {...unknown('read_only_hardware',source),deviceOnline:true,receivedAt:envelope.receivedAt,sampleAgeMs:age,uptimeMs:f.uptime_ms,climateAgeMs:thAge,gasAgeMs:gasAge,values:{temperatureC:th?f.temperature10/10:null,humidityPct:th?f.humidity10/10:null,gasRaw:gas?f.gas_raw:null,gasMv:gas?f.gas_mv:null,coPpm:null,co2Ppm:null},quality:{temperatureValid:th,humidityValid:th,gasValid:gas,coValid:false,co2Valid:false}};
 }catch{return unknown('invalid_hsp_sample',source);}
}
export async function readHspTelemetry(file,now=Date.now()){
 let transport;
 try{
 // Parse the envelope before validating the frame so the source label survives a corrupt frame.
 let envelope;
 try{envelope=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));transport=envelope?.transport;}catch(error){
  if(!error||typeof error!=='object'||!(error instanceof SyntaxError))throw error;
  if((await stat(file)).size>16384)return unknown('hardware_file_too_large',hspSourceOrUnknown(transport));
  return unknown('hardware_read_failed',hspSourceOrUnknown(transport));
 }
 if((await stat(file)).size>16384)return unknown('hardware_file_too_large',hspSourceOrUnknown(transport));
 return hspSnapshot(envelope,now);}
 catch(e){return unknown(e.code==='ENOENT'?'hardware_not_connected':'hardware_read_failed',hspSourceOrUnknown(transport));}
}
