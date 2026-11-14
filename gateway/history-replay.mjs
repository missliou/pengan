import {createHash} from 'node:crypto';
import {validateHspFrame,hspSnapshot} from './hsp-telemetry.mjs';
const fail=code=>{throw Error(code);};
const fields=new Set(['schemaVersion','deviceId','simulated','controlSupported','coValid','co2Valid','coPpm','co2Ppm','uptime_ms','th_ok','gas_ok','th_sample_age_ms','gas_sample_age_ms','temperature10','humidity10','gas_raw','gas_mv']);
export async function replayHistory(history,gatewayId,body,now=Date.now()){
 if(!body||Object.keys(body).some(k=>k!=='items')||!Array.isArray(body.items)||!body.items.length||body.items.length>20)fail('invalid_replay_batch');
 const rows=body.items.map(item=>{
  if(!item||Object.keys(item).some(k=>!['sessionBootId','capturedAt','sampleAgeMs','frame'].includes(k))||typeof item.sessionBootId!=='string'||!/^[A-Za-z0-9_.:-]{1,80}$/.test(item.sessionBootId)||!Number.isSafeInteger(item.capturedAt)||item.capturedAt<0||item.capturedAt>now+1000||now-item.capturedAt>7*86400000||!Number.isSafeInteger(item.sampleAgeMs)||item.sampleAgeMs<0||item.sampleAgeMs>=10000)fail('invalid_replay_sample');
  validateHspFrame(item.frame);if(Object.keys(item.frame).some(k=>!fields.has(k)))fail('invalid_replay_frame');
  if(item.capturedAt<item.sampleAgeMs)fail('invalid_replay_sample');
  const observation=hspSnapshot({transport:'http',receivedAt:item.capturedAt-item.sampleAgeMs,frame:item.frame},item.capturedAt);observation.source='dayu-direct';
  const key=createHash('sha256').update(gatewayId+'/'+item.sessionBootId+'/'+item.frame.uptime_ms).digest('hex');
  return {kind:'telemetry',gatewayId,key,data:{sessionBootId:item.sessionBootId,observation,historical:true,isCurrent:false,replayed:true,capturedAt:item.capturedAt}};
 });
 const accepted=[];for(const row of rows){const prior=history.keys.get('telemetry|'+gatewayId+'|'+row.key);if(prior&&JSON.stringify(prior.data.observation.values)!==JSON.stringify(row.data.observation.values))fail('history_key_conflict');const saved=prior||await history.append(row);accepted.push({sessionBootId:row.data.sessionBootId,uptimeMs:row.data.observation.uptimeMs,seq:saved.seq});}
 return {schemaVersion:1,gatewayId,historical:true,isCurrent:false,accepted};
}
