import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startDemo} from '../gateway/runtime.mjs';
import {HardwareHistory} from '../gateway/hardware-history.mjs';
import {AnalysisHistory} from '../gateway/analysis-history.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const ts=require(path.join(root,'openharmony/node_modules/@ohos/hvigor/node_modules/typescript/lib/typescript.js'));

// Actual non-UI ArkTS source + a named host HTTP adapter. This exercises real
// loopback HTTP and disk stores, not ArkUI, an OpenHarmony OS, or physical boards.
function loadNativeLink(){
 const cache=new Map();let destroyed=0;
 const http={RequestMethod:{GET:'GET',POST:'POST'},HttpDataType:{STRING:0},createHttp:()=>({
  async request(url,options){
   const response=await fetch(url,{method:options.method,headers:options.header,...(options.method==='POST'?{body:options.extraData}:{}),signal:AbortSignal.timeout(options.readTimeout)});
   return {responseCode:response.status,result:await response.text()};
  },destroy(){destroyed++;}
 })};
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const scopedRequire=name=>{
   if(name==='@ohos.net.http')return {default:http};
   if(name==='@ohos.data.preferences')return {default:{}};
   if(name==='@ohos.util')return {default:{TextEncoder:class{encodeInto(text){return new TextEncoder().encode(text);}}}};
   if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ets'));
   throw Error('Unmocked native dependency: '+name);
  };
  vm.runInThisContext('(function(require,module,exports){'+output+'\n})',{filename:file})(scopedRequire,module,module.exports);
  return module.exports;
 }
 const {GatewayLink}=load(path.join(root,'openharmony/entry/src/main/ets/services/GatewayLink.ets'));
 return {link:new GatewayLink(),destroyed:()=>destroyed};
}

test('实际GatewayLink→正式HTTP→真实格式采集及双持久历史；模型为明确测试桩',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'pengan-native-http-')),hardwareFile=path.join(dir,'sample.json');let runtime,round=0,testCalls=0,failTest=false;
 const frame={schemaVersion:1,deviceId:'hh-hsp101-001',simulated:false,uptime_ms:20000,th_ok:true,temperature10:253,humidity10:621,gas_ok:true,gas_raw:550,gas_mv:967,th_sample_age_ms:100,gas_sample_age_ms:200,coValid:false,co2Valid:false,coPpm:null,co2Ppm:null,controlSupported:false};
 try{
  const sample={receivedAt:Date.now(),frame};await writeFile(hardwareFile,JSON.stringify(sample));
  const historyStore=await new HardwareHistory(path.join(dir,'hardware.jsonl')).open();
  const analysisStore=await new AnalysisHistory(path.join(dir,'analysis.jsonl')).open();
  await historyStore.collect(hardwareFile);
  runtime=await startDemo({operationMode:'hardware',mqttPort:0,httpPort:0,hardwareFile,historyStore,analysisStore,plannerOptions:{provider:'deepseek',model:'offline-model-stub',key:'test-key',fetchFn:async(url,options)=>{
   assert.equal(url,'https://api.deepseek.com/chat/completions');
   const body=JSON.parse(options.body);assert.equal(body.model,'offline-model-stub');
   if(body.tools[0].function.name==='verify_connection'){
    testCalls++;assert.ok(!options.body.includes('25.3'));assert.ok(!options.body.includes('recentAnalyses'));
    if(failTest)return new Response('private provider error',{status:401});
    return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'verify',type:'function',function:{name:'verify_connection',arguments:'{}'}}]}}]}));
   }
   const name=['read_environment','read_recent_history','analyze_observations'][round++];assert.ok(name);
   const args=name==='analyze_observations'?{summary:'测试桩只读分析',findings:['测试采集温度25.3℃'],unknowns:['无CO/CO₂']}:{...name==='read_recent_history'?{limit:5}:{}};
   return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'read-'+round,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));
  }}});
  const {link,destroyed}=loadNativeLink();link.configure(`http://127.0.0.1:${runtime.httpPort}`);
  assert.match(await link.testHardware(),/真实服务可达/);assert.match(await link.readHardware(),/25.3/);
  const analysis=await link.analyze('测试真实采集和历史');assert.equal(analysis.persistence.saved,true);assert.equal(analysis.persistence.recordId,1);assert.deepEqual(analysis.toolTrace.map(item=>item.tool),['read_environment','read_recent_history']);
  assert.match(analysis.toolTrace[1].resultSummary,/历史/);assert.equal(analysis.hardwareControl,false);assert.deepEqual(analysis.steps,[]);
  const history=await link.readHardwareHistory();assert.equal(history.rows.length,1);assert.match(history.rows[0],/25.3 ℃/);assert.match(history.rows[0],/不代表当前/);
  const analyses=await link.readAnalysisHistory();assert.equal(analyses.rows.length,1);assert.match(analyses.rows[0],/测试桩只读分析/);assert.match(analyses.rows[0],/历史文字分析/);
  assert.match(await readFile(historyStore.file,'utf8'),/"simulated":false/);assert.match(await readFile(analysisStore.file,'utf8'),/测试真实采集和历史/);
  await writeFile(hardwareFile,JSON.stringify({...sample,receivedAt:Date.now()-10001}));
  assert.match(await link.readHardware(),/过期.*未知/);assert.equal(link.hardwareSampleAgeMs,-1);
  assert.match((await link.readHardwareHistory()).rows[0],/25.3 ℃/);assert.match((await link.readAnalysisHistory()).rows[0],/历史文字分析/);
  const report=JSON.parse(await link.readRealReport());
  assert.equal(report.kind,'pengan_real_session_report');assert.equal(report.simulated,false);assert.equal(report.hardwareActuation,false);
  assert.equal(report.current.hardware.deviceOnline,false);assert.equal(report.current.hardware.values.temperatureC,null);assert.equal(report.current.hardware.values.gasRaw,null);
  assert.deepEqual(report.scope,{observationLimit:50,analysisLimit:20,completeHistory:false});
  assert.equal(report.observationHistory.items.length,1);assert.equal(report.observationHistory.isCurrent,false);assert.equal(report.observationHistory.items[0].historical,true);assert.equal(report.observationHistory.items[0].observation.values.temperatureC,25.3);
  assert.equal(report.analysisHistory.items.length,1);assert.equal(report.analysisHistory.isCurrent,false);assert.equal(report.analysisHistory.items[0].historical,true);assert.equal(report.analysisHistory.items[0].analysis.summary.includes('测试桩只读分析'),true);
  assert.equal(round,3,'报告只读已保存数据，不再调用模型');
  const modelCheck=await link.testModel();assert.equal(modelCheck.ok,true);assert.equal(modelCheck.fieldDataSent,false);assert.equal(modelCheck.imageSent,false);assert.equal(modelCheck.executed,false);
  assert.equal(analysisStore.status().records,1,'合成测试不存入真实分析历史');assert.equal(round,3);failTest=true;
  await assert.rejects(link.testModel(),/密钥校验失败/);assert.equal(testCalls,2);assert.equal(analysisStore.status().records,1);
  await assert.rejects(link.read(),/网关请求失败/);assert.equal(destroyed(),12,'十二次真实HTTP请求完成或失败均回收对象');
 }finally{await runtime?.close();await rm(dir,{recursive:true,force:true});}
});
