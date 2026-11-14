import {readFile,appendFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const MAX_BYTES=16*1024*1024;
const digest=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
const number=value=>Number.isFinite(value)?value:null;
const strings=(value,max)=>Array.isArray(value)&&value.length<=max&&value.every(item=>typeof item==='string'&&item.length<=1000);
function cleanObservation(input){
 if(input?.source!==undefined&&!['serial','http','unknown'].includes(input.source))throw Error('invalid_observation_source');
 if(!input||input.simulated!==false||input.deviceId!=='hh-hsp101-001'||input.actuationAvailable!==false||typeof input.deviceOnline!=='boolean'||!input.values||!input.quality||input.quality.coValid!==false||input.quality.co2Valid!==false)throw Error('invalid_analysis_observation');
 if(!(Number.isSafeInteger(input.receivedAt)&&input.receivedAt>0)&&!(input.receivedAt===null&&input.deviceOnline===false))throw Error('invalid_analysis_observation');
 for(const key of ['sampleAgeMs','climateAgeMs','gasAgeMs'])if(!(Number.isFinite(input[key])&&input[key]>=0)&&!(input[key]==null&&input.deviceOnline===false))throw Error('invalid_analysis_observation');
 const values={},quality={};
 for(const key of ['temperatureC','humidityPct','gasRaw','gasMv'])values[key]=number(input.values[key]);
 values.coPpm=null;values.co2Ppm=null;
 for(const key of ['temperatureValid','humidityValid','gasValid']){if(typeof input.quality[key]!=='boolean')throw Error('invalid_analysis_observation');quality[key]=input.quality[key];}
 if(quality.temperatureValid&&(values.temperatureC===null||values.temperatureC< -40||values.temperatureC>85)||quality.humidityValid&&(values.humidityPct===null||values.humidityPct<0||values.humidityPct>100)||quality.gasValid&&(!Number.isInteger(values.gasRaw)||values.gasRaw<0||values.gasRaw>4095||values.gasMv===null||values.gasMv<0||values.gasMv>7200))throw Error('invalid_analysis_observation');
 if(!quality.temperatureValid)values.temperatureC=null;if(!quality.humidityValid)values.humidityPct=null;if(!quality.gasValid){values.gasRaw=null;values.gasMv=null;}
 quality.coValid=false;quality.co2Valid=false;
 return {deviceId:'hh-hsp101-001',source:['serial','http','unknown'].includes(input.source)?input.source:'serial',simulated:false,deviceOnline:input.deviceOnline,receivedAt:number(input.receivedAt),sampleAgeMs:number(input.sampleAgeMs),climateAgeMs:number(input.climateAgeMs),gasAgeMs:number(input.gasAgeMs),values,quality,actuationAvailable:false,admission:'unknown_denied'};
}
export function cleanAnalysis(input){
 if(!input||input.mode!=='hardware'||input.simulated!==false||input.executed!==false||input.hardwareControl!==false||input.realAdmission!=='unknown_denied'||!Array.isArray(input.steps)||input.steps.length||typeof input.summary!=='string'||input.summary.length>2000||!strings(input.findings,10)||!strings(input.unknowns,12)||!['deepseek','qwen'].includes(input.provider)||typeof input.model!=='string'||!/^[-A-Za-z0-9._:/]{1,150}$/.test(input.model)||!Number.isSafeInteger(input.analyzedAt)||input.analyzedAt<0||input.kind==='crop_image_analysis'||input.source==='user_photo')throw Error('invalid_analysis_record');
 const trace=input.toolTrace||[];
 if(!Array.isArray(trace)||trace.length>6||trace.some(row=>!row||!['read_environment','read_recent_history'].includes(row.tool)||row.readOnly!==true||!Number.isSafeInteger(row.at)||row.at<=0||typeof row.resultSummary!=='string'||row.resultSummary.length>1000))throw Error('invalid_analysis_trace');
 return {mode:'hardware',simulated:false,executed:false,steps:[],hardwareControl:false,realAdmission:'unknown_denied',summary:input.summary,findings:input.findings.slice(),unknowns:input.unknowns.slice(),provider:input.provider,model:input.model,analyzedAt:input.analyzedAt,observationReceivedAt:number(input.observationReceivedAt),observationAgeMs:number(input.observationAgeMs),observationStale:input.observationStale!==false,deviceOnline:input.deviceOnline===true,observation:cleanObservation(input.observation),toolTrace:trace.map(row=>({tool:row.tool,at:row.at,readOnly:true,resultSummary:row.resultSummary,...(row.tool==='read_environment'?{observationReceivedAt:number(row.observationReceivedAt)}:{count:Number.isInteger(row.count)&&row.count>=0&&row.count<=20?row.count:0})}))};
}
export class AnalysisHistory{
 constructor(file){this.file=file;this.count=0;this.previous='GENESIS';this.bytes=0;this.rows=[];this.opened=false;this.healthy=true;this.queue=Promise.resolve();}
 async open(){
  if(this.opened)throw Error('analysis_history_already_open');
  try{
   await mkdir(path.dirname(this.file),{recursive:true});let text='';
   try{this.bytes=(await stat(this.file)).size;if(this.bytes>MAX_BYTES)throw Error('analysis_history_size_limit');text=await readFile(this.file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
   if(text&&!text.endsWith('\n'))throw Error('analysis_history_incomplete');
   for(const line of text.split('\n').filter(Boolean)){
    const row=JSON.parse(line),{hash,...body}=row;
    if(body.schemaVersion!==1||body.seq!==this.count+1||body.previous!==this.previous||hash!==digest(body)||typeof body.prompt!=='string'||body.prompt.length>1000||!body.prompt.trim()||!Number.isSafeInteger(body.recordedAt)||body.recordedAt<0||JSON.stringify(body.analysis)!==JSON.stringify(cleanAnalysis(body.analysis))||Object.keys(body).some(key=>!['schemaVersion','seq','previous','prompt','analysis','recordedAt'].includes(key)))throw Error('analysis_history_integrity_failed');
    this.commit(row);
   }
  }catch{this.healthy=false;this.rows=[];this.count=0;this.previous='GENESIS';}
  this.opened=true;return this;
 }
 commit(row){this.count=row.seq;this.previous=row.hash;this.rows.push(row);if(this.rows.length>200)this.rows.shift();}
 append(prompt,analysis){
  const task=this.queue.then(async()=>{
   if(!this.opened||!this.healthy)throw Error('analysis_history_unavailable');
   if(typeof prompt!=='string'||!prompt.trim()||prompt.length>1000)throw Error('invalid_analysis_prompt');
   const body={schemaVersion:1,seq:this.count+1,previous:this.previous,prompt,analysis:cleanAnalysis(analysis),recordedAt:Date.now()},row={...body,hash:digest(body)},line=JSON.stringify(row)+'\n';
   if(this.bytes+Buffer.byteLength(line)>MAX_BYTES)throw Error('analysis_history_size_limit');
   let diskBytes=0;try{const info=await stat(this.file);if(!info.isFile())throw Error('analysis_history_file_changed');diskBytes=info.size;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(diskBytes!==this.bytes)throw Error('analysis_history_file_changed');
   await appendFile(this.file,line,{encoding:'utf8',mode:0o600});this.bytes+=Buffer.byteLength(line);this.commit(row);return row.seq;
  });
  this.queue=task.catch(()=>{this.healthy=false;});return task;
 }
 status(){return {enabled:true,healthy:this.opened&&this.healthy,records:this.count,bytes:this.bytes,maxBytes:MAX_BYTES};}
 read({limit=20}={}){
  if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('invalid_history_query');
  return {schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:this.status(),items:this.rows.slice(-limit).reverse().map(row=>({seq:row.seq,hash:row.hash,prompt:row.prompt,analysis:JSON.parse(JSON.stringify(row.analysis)),recordedAt:row.recordedAt,historical:true,isCurrent:false}))};
 }
 async flush(){await this.queue;}
}
