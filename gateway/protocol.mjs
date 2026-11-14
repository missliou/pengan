export const DEVICE_ID='hsp-demo-001';
export const PREFIX=`pengan/v1/demo/${DEVICE_ID}`;
export const ACTIONS=new Set(['query_environment','request_access','ventilate','stop_ventilation']);
export function validateCommand(command,{now=Date.now(),retained=false}={}) {
  if(retained)return 'retained_command';
  if(!command||typeof command!=='object'||Array.isArray(command))return 'invalid_command';
  if(command.version!==1||command.deviceId!==DEVICE_ID||command.simulated!==true)return 'wrong_device_or_mode';
  if(typeof command.commandId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(command.commandId))return 'invalid_command_id';
  if(!ACTIONS.has(command.action))return 'unknown_action';
  if(!['manual','agent','test'].includes(command.source))return 'invalid_source';
  if(!Number.isFinite(command.issuedAt)||!Number.isFinite(command.expiresAt)||command.issuedAt>now+1000||command.expiresAt<=now||command.expiresAt<=command.issuedAt||command.expiresAt-command.issuedAt>10000)return 'expired_or_invalid_time';
  if(!command.parameters||typeof command.parameters!=='object'||Array.isArray(command.parameters))return 'invalid_parameters';
  if(command.action==='ventilate'&&(!Number.isInteger(command.parameters.maxRunMs)||command.parameters.maxRunMs<1000||command.parameters.maxRunMs>20000))return 'invalid_duration';
  return null;
}
export function validateTelemetry(frame) {
  if(!frame||frame.version!==1||frame.deviceId!==DEVICE_ID||frame.simulated!==true)return false;
  if(typeof frame.bootId!=='string'||frame.bootId.length<1||frame.bootId.length>100||!Number.isSafeInteger(frame.seq)||frame.seq<0)return false;
  if(!Number.isFinite(frame.sampleAgeMs)||frame.sampleAgeMs<0||frame.sampleAgeMs>86400000)return false;
  const v=frame.values,q=frame.quality,s=frame.state;
  if(!v||!q||!s)return false;
  return ['coPpm','co2Ppm','temperatureC','humidityPct','soilPct','lightLux'].every(k=>Number.isFinite(v[k]))&&
    typeof q.coValid==='boolean'&&typeof q.co2Valid==='boolean'&&typeof s.emergency==='boolean'&&typeof s.fan==='boolean';
}
