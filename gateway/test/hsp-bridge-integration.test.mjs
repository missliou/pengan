import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {startDemo} from '../runtime.mjs';
import {existsSync} from 'node:fs';
const execute=promisify(execFile);
// read-hsp.ps1 declares "#requires -Version 7.0", so PowerShell 7 is mandatory and 5.1 is never a substitute.
const shell='pwsh.exe';
const skip=process.platform!=='win32'?'Windows only':(!pwshAvailable()?'需要 PowerShell 7 (pwsh.exe)：本机只有 Windows PowerShell 5.1，读板链路无法执行':'');
function pwshAvailable(){
 const wellKnown=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
 if(existsSync(wellKnown))return true;
 for(const dir of (process.env.PATH||'').split(path.delimiter))if(dir&&existsSync(path.join(dir,'pwsh.exe')))return true;
 return false;
}

test('离线协议串联：PowerShell分片接收→独立文件→HTTP只读→模型上下文及失效',{timeout:20000,skip},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-bridge-test-')),input=path.join(dir,'uart.txt'),hardwareFile=path.join(dir,'sample.json');
 const fixture={schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:20000,th_ok:true,temperature10:253,humidity10:621,gas_ok:true,gas_raw:550,gas_mv:967,th_sample_age_ms:100,gas_sample_age_ms:200,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false};
 let r,modelContext;
 try{
  await writeFile(input,'SDK boot log\r\nPENGAN_TELEMETRY '+JSON.stringify(fixture)+'\r\r\n');
  const {stdout}=await execute(shell,['-NoProfile','-File',fileURLToPath(new URL('../../tools/read-hsp.ps1',import.meta.url)),'-ReplayFile',input,'-ReplayOutput',hardwareFile,'-ChunkSize','7'],{windowsHide:true,timeout:10000});
  assert.match(stdout,/accepted=1/);
  const stored=JSON.parse(await readFile(hardwareFile,'utf8'));assert.deepEqual(stored.frame,fixture);
  r=await startDemo({mqttPort:0,httpPort:0,hardwareFile,plannerOptions:{provider:'deepseek',model:'offline-test',key:'test-key',fetchFn:async(url,options)=>{
   modelContext=JSON.parse(JSON.parse(options.body).messages[1].content).environment;
   return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'propose_plan',arguments:JSON.stringify({summary:'只读建议',steps:[]})}}]}}]}));
  }}});
  const base=`http://127.0.0.1:${r.httpPort}`;
  const snapshot=()=>fetch(base+'/api/hardware').then(response=>response.json());
  const propose=()=>fetch(base+'/api/agent/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'查询只读采集'})}).then(response=>response.json());
  const live=await snapshot();assert.equal(live.deviceOnline,true);assert.equal(live.values.temperatureC,25.3);assert.equal(live.values.gasRaw,550);assert.equal(live.values.coPpm,null);assert.equal(live.actuationAvailable,false);
  const plan=await propose();assert.equal(plan.executed,false);assert.equal(plan.hardwareControl,false);assert.equal(modelContext.simulated,true);assert.equal(modelContext.readOnlyHardware.simulated,false);assert.equal(modelContext.readOnlyHardware.values.temperatureC,25.3);
  stored.receivedAt=Date.now()-10001;await writeFile(hardwareFile,JSON.stringify(stored));
  const stale=await snapshot();assert.equal(stale.deviceOnline,false);assert.equal(stale.values.temperatureC,null);assert.equal(stale.admission,'unknown_denied');
  await propose();assert.equal(modelContext.readOnlyHardware.deviceOnline,false);assert.equal(modelContext.readOnlyHardware.values.gasRaw,null);
  // These frames are offline fixtures in system TEMP, never real runtime data.
 }finally{await r?.close();await rm(dir,{recursive:true,force:true});}
});
