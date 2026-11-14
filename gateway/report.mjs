import {cleanAnalysis} from './analysis-history.mjs';
const MAX_REPORT_BYTES=1024*1024;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const reasons=new Set(['read_only_hardware','hardware_not_connected','hardware_read_failed','hardware_file_too_large','invalid_receive_time','telemetry_stale','invalid_hsp_sample']);
export function disabledReportHistory(maxBytes){return {schemaVersion:1,simulated:false,historical:true,isCurrent:false,retainedInMemory:0,storage:{enabled:false,healthy:false,records:0,bytes:0,maxBytes},items:[]};}
function hardware(input){
 if(input?.source!==undefined&&!['serial','http','unknown'].includes(input.source))throw Error('invalid_observation_source');
 if(!input||input.deviceId!=='hh-hsp101-001'||input.simulated!==false||input.actuationAvailable!==false||typeof input.deviceOnline!=='boolean'||!input.quality||!input.values||input.quality.coValid!==false||input.quality.co2Valid!==false)throw Error('report_unavailable');
 const q={},v={},online=input.deviceOnline;
 for(const key of ['temperatureValid','humidityValid','gasValid']){if(typeof input.quality[key]!=='boolean')throw Error('report_unavailable');q[key]=online&&input.quality[key];}
 const ranges=[['temperatureC','temperatureValid',-40,85],['humidityPct','humidityValid',0,100],['gasRaw','gasValid',0,4095],['gasMv','gasValid',0,7200]];
 for(const [key,quality,min,max] of ranges){const n=input.values[key];if(q[quality]&&(!finite(n)||n<min||n>max||key==='gasRaw'&&!Number.isInteger(n)))throw Error('report_unavailable');v[key]=q[quality]?n:null;}
 v.coPpm=null;v.co2Ppm=null;q.coValid=false;q.co2Valid=false;
 if(online&&(!count(input.receivedAt)||!finite(input.sampleAgeMs)||input.sampleAgeMs<0))throw Error('report_unavailable');
 const output={schemaVersion:1,deviceId:'hh-hsp101-001',source:['serial','http','unknown'].includes(input.source)?input.source:'serial',simulated:false,deviceOnline:online,reason:reasons.has(input.reason)?input.reason:'unknown',receivedAt:online?input.receivedAt:null,sampleAgeMs:online?input.sampleAgeMs:null,values:v,quality:q,actuationAvailable:false,controlSupported:false,admission:'unknown_denied'};
 for(const key of ['uptimeMs','climateAgeMs','gasAgeMs'])if(online&&finite(input[key])&&input[key]>=0)output[key]=input[key];
 return output;
}
function history(input,limit,maxBytes,type){
 if(!input||input.simulated!==false||input.historical!==true||input.isCurrent!==false||!Array.isArray(input.items)||input.items.length>limit||!input.storage)throw Error('report_unavailable');
 const s=input.storage;
 if(typeof s.enabled!=='boolean'||typeof s.healthy!=='boolean'||!count(s.records)||!count(s.bytes))throw Error('report_unavailable');
 if(type==='observations'&&(!Number.isInteger(input.retainedInMemory)||input.retainedInMemory<0||input.retainedInMemory>500||input.retainedInMemory<input.items.length))throw Error('report_unavailable');
 const items=input.items.map(row=>{
  if(!Number.isSafeInteger(row.seq)||row.seq<1||typeof row.hash!=='string'||! /^[a-f0-9]{64}$/.test(row.hash)||row.historical!==true||row.isCurrent!==false)throw Error('report_unavailable');
  if(type==='observations')return {seq:row.seq,hash:row.hash,historical:true,isCurrent:false,observation:hardware(row.observation)};
  if(typeof row.prompt!=='string'||row.prompt.length>1000||!count(row.recordedAt))throw Error('report_unavailable');
  return {seq:row.seq,hash:row.hash,prompt:row.prompt,analysis:cleanAnalysis(row.analysis),recordedAt:row.recordedAt,historical:true,isCurrent:false};
 });
 return {schemaVersion:1,simulated:false,historical:true,isCurrent:false,...(type==='observations'?{retainedInMemory:input.retainedInMemory}:{}),storage:{enabled:s.enabled,healthy:s.healthy,records:s.records,bytes:s.bytes,maxBytes},items};
}
export function createRealReport({current,observationHistory=disabledReportHistory(64*1024*1024),analysisHistory=disabledReportHistory(16*1024*1024),generatedAt=Date.now()}){
 if(!current||current.schemaVersion!==1||current.mode!=='hardware'||current.simulated!==false||!count(current.gatewayNow)||!count(generatedAt))throw Error('report_unavailable');
 const report={schemaVersion:1,kind:'pengan_real_session_report',mode:'hardware',simulated:false,hardwareActuation:false,realAdmission:'unknown_denied',generatedAt,current:{schemaVersion:1,mode:'hardware',simulated:false,gatewayNow:current.gatewayNow,hardware:hardware(current.hardware),capabilities:{readEnvironment:true,actuate:false,co:false,co2:false},admission:'unknown_denied'},observationHistory:history(observationHistory,50,64*1024*1024,'observations'),analysisHistory:history(analysisHistory,20,16*1024*1024,'analyses'),scope:{observationLimit:50,analysisLimit:20,completeHistory:false},limitations:['本报告仅为导出时间的快照，不代表之后的实时状态。','仅导出最近50条真实采集和20条文字AI分析窗口，不是完整历史。','历史观测和历史建议不代表当前状态；当前离线或过期时保持未知，不从历史补齐。','CO与CO₂未接入，MQ-2原始ADC和电压不能换算气体浓度，真实准入未知／拒止。','没有真实执行器控制，AI分析不代表设备动作或安全结论。','不导出作物照片，不自动上传任何图片或本报告。']};
 const body=JSON.stringify(report);if(Buffer.byteLength(body)>MAX_REPORT_BYTES)throw Error('report_too_large');
 const date=new Date(generatedAt).toISOString(),filename='pengan-real-report-'+date.slice(0,10).replaceAll('-','')+'-'+date.slice(11,19).replaceAll(':','')+'.json';
 return {report,body,filename};
}
