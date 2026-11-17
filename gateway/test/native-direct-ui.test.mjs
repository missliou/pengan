import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const ts = require(path.join(root, 'openharmony/node_modules/@ohos/hvigor/node_modules/typescript/lib/typescript.js'));
const services = path.join(root, 'openharmony/entry/src/main/ets/services');
const frame = (uptime_ms = 100, ages = 0) => ({ schemaVersion: 1, deviceId: 'hh-hsp101-001', simulated: false, controlSupported: false,
  coValid: false, co2Valid: false, coPpm: null, co2Ppm: null, uptime_ms, th_ok: true, gas_ok: true,
  temperature10: 256, humidity10: 638, gas_raw: 1234, gas_mv: 3210, th_sample_age_ms: ages, gas_sample_age_ms: ages });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

// Execute the actual non-UI ArkTS services with named OS mocks. This does not
// test ArkUI layout, preferences on-device, or physical network/hardware.
function host() {
  let committed, failFlush = false, response = { responseCode: 200, result: JSON.stringify(frame()) }, now = 100000, requests = 0;
  const requestsLog = [], cache = new Map();
  const mocks = {
    '@ohos.data.preferences': { default: { async getPreferences() {
      let working = committed;
      return { async get(_key, fallback) { return working ?? fallback; }, async put(_key, value) { working = value; }, async flush() { if (failFlush) throw Error('disk_full'); committed = working; } };
    } } },
    '@ohos.util': { default: { TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } } } },
    '@ohos.net.http': { default: { RequestMethod: { GET: 'GET' }, HttpDataType: { STRING: 0 }, createHttp() { return {
      async request(url, opts) { requests++; requestsLog.push({ url, opts }); return response; }, destroy() {},
    }; } } },
  };
  const clock = class extends Date { static now() { return now; } };
  const context = vm.createContext({ Date: clock, console, Map, Set, JSON, Error, Number, clearTimeout });
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const scopedRequire = name => { if (mocks[name]) return mocks[name]; if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ets')); throw Error('Unmocked dependency: ' + name); };
    vm.runInContext('(function(require,module,exports){' + code + '\n})', context, { filename: file })(scopedRequire, module, module.exports);
    return module.exports;
  }
  const settings = load(path.join(services, 'DirectConnectionSettings.ets'));
  const { DirectHardwareView } = load(path.join(services, 'DirectHardwareView.ets'));
  context.NativeWeather = load(path.join(services, 'NativeWeather.ets')).NativeWeather;
  return { ...settings, DirectHardwareView, load, context, now: value => now = value, respond: value => response = value,
    responseFrame: (...args) => response = { responseCode: 200, result: JSON.stringify(frame(...args)) },
    committed: () => committed, seed: value => committed = value, failFlush: value => failFlush = value, requests: () => requests, requestsLog };
}

test('direct settings default to unconfigured local collection, normalize bare private IPv4 only', async () => {
  const h = host(), settings = new h.DirectConnectionSettings();
  const defaults = await settings.open({}); assert.equal(defaults.mode, 'direct'); assert.equal(defaults.boardIp, '');
  await assert.rejects(settings.save('direct', ''), /IP/);
  for (const value of ['http://192.168.1.2', '192.168.1.2:80', '8.8.8.8', '127.0.0.1', '192.168.01.2', '10.2.3.999', '172.32.0.1', '192.168.1.2/path'])
    assert.throws(() => h.normalizeDirectConfig('direct', value));
  assert.throws(() => h.normalizeDirectConfig('unknown', ''));
  const saved = await settings.save('direct', ' 192.168.1.100 ');
  assert.equal(saved.boardIp, '192.168.1.100');
  assert.equal(Object.keys(JSON.parse(h.committed())).length, 3);
  assert.equal((await new h.DirectConnectionSettings().open({})).boardIp, saved.boardIp);
  assert.equal((await settings.save('direct', 'LAN 192.168.1.101')).boardIp, '192.168.1.101');
});

test('saving the board address does not wait for an outstanding hardware probe', async () => {
  const h=host(),index=readFileSync(path.join(root,'openharmony/entry/src/main/ets/pages/Index.ets'),'utf8');
  const method=index.match(/  private async saveHardwareSource\([\s\S]*?\n  }/)[0];
  const code=ts.transpileModule('class SaveHarness{'+method+'};SaveHarness;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const Harness=vm.runInContext(code,h.context),ui=new Harness(),settings=new h.DirectConnectionSettings();
  await settings.open({});
  let configured='';
  Object.assign(ui,{directSettingsReady:true,hardwareTransportBusy:true,hardwareSourceDraft:'direct',boardIp:'LAN 192.168.1.101',directSettings:settings,directHardware:{configure:ip=>configured=ip},invalidateConnection(){},resetHardware(){},pollHardware(){}});
  await ui.saveHardwareSource();
  assert.equal(ui.savedBoardIp,'192.168.1.101');assert.equal(configured,ui.savedBoardIp);
  assert.equal((await new h.DirectConnectionSettings().open({})).boardIp,ui.savedBoardIp);
});

test('failed preferences flush does not report a saved config or permit another pending write', async () => {
  const h = host(), settings = new h.DirectConnectionSettings(); await settings.open({});
  await settings.save('gateway', ''); const original = h.committed(); h.failFlush(true);
  await assert.rejects(settings.save('direct', '10.0.0.2'), /未确认/);
  assert.equal(h.committed(), original); assert.equal(settings.isReady(), false);
  h.failFlush(false); await assert.rejects(settings.save('direct', '10.0.0.3'), /未载入/);
  assert.equal((await new h.DirectConnectionSettings().open({})).mode, 'gateway');
});

test('corrupt saved configuration is retained and cannot trigger a silent gateway fallback', async () => {
  const h = host(); h.seed('{corrupt'); const settings = new h.DirectConnectionSettings();
  await assert.rejects(settings.open({}), /未自动覆盖/); assert.equal(settings.isReady(), false); assert.equal(h.committed(), '{corrupt');
});

test('native UI projection displays real channels and expires at the original 10 second boundary', async () => {
  const h = host(), view = new h.DirectHardwareView();
  await view.poll(); assert.equal(h.requests(), 0); assert.match(view.read().text, /IP/);
  view.configure('192.168.1.100'); const reading = await view.poll();
  assert.equal(reading.source, 'dayu-direct'); assert.equal(reading.deviceOnline, true); assert.match(reading.text, /25.6℃/); assert.match(reading.text, /未上传云端/);
  assert.equal(h.requestsLog[0].url, 'http://192.168.1.100/api/pengan/telemetry');
  h.now(109999); assert.equal(view.read().deviceOnline, true);
  h.now(110000); assert.equal(view.read().deviceOnline, false); assert.doesNotMatch(view.read().text, /25.6℃/);
});

test('duplicate frames retain original expiry; a malformed response cannot resurrect cached data', async () => {
  const h = host(), view = new h.DirectHardwareView(); view.configure('10.0.0.2'); await view.poll();
  h.now(102000); await view.poll(); assert.match(view.read().text, /未收到新帧/); assert.equal(view.read().sampleAgeMs, 2000);
  h.respond({ responseCode: 200, result: '{}' }); await view.poll(); assert.equal(view.read().deviceOnline, false);
  h.now(103000); assert.equal(view.read().deviceOnline, false); h.responseFrame(); await view.poll();
  assert.equal(view.read().deviceOnline, false); // repeated old frame cannot undo the failed read
  h.responseFrame(101); await view.poll(); assert.equal(view.read().deviceOnline, true);
  h.now(113000); assert.equal(view.read().deviceOnline, false);
});

test('foreground refresh and assistant can await the same in-flight direct sample', async () => {
  const h = host(), view = new h.DirectHardwareView(); view.configure('10.0.0.2');
  const response = deferred(); h.respond(response.promise);
  const foreground = view.poll(), assistant = view.poll();
  assert.equal(h.requests(),1);
  response.resolve({responseCode:200,result:JSON.stringify(frame())});
  const readings = await Promise.all([foreground,assistant]);
  assert.ok(readings.every(reading=>reading.deviceOnline));
  assert.ok(view.uploadSample().frameJson.includes('"uptime_ms":100'));
});

test('channel expiry masks readings while frame is online, and configuration cancels late context', async () => {
  const h = host(), view = new h.DirectHardwareView(); view.configure('10.0.0.2'); h.responseFrame(100, 9999); await view.poll();
  h.now(100001); assert.equal(view.read().deviceOnline, true); assert.doesNotMatch(view.read().text, /25.6℃/);
  const pending = deferred(); h.respond(pending.promise); const request = view.poll(); view.configure('10.0.0.3');
  pending.resolve({ responseCode: 200, result: JSON.stringify(frame(101)) }); await request;
  assert.equal(view.read().deviceOnline, false); assert.equal(h.requestsLog.at(-1).url, 'http://10.0.0.2/api/pengan/telemetry');
  h.responseFrame(102); await view.poll(); assert.equal(h.requestsLog.at(-1).url, 'http://10.0.0.3/api/pengan/telemetry');
  view.invalidate(); assert.equal(view.read().deviceOnline, false);
});

test('real Index methods block old gateway analysis, histories and report in direct mode', async () => {
  const h = host(), index = readFileSync(path.join(root, 'openharmony/entry/src/main/ets/pages/Index.ets'), 'utf8');
  const names = ['requestHardwareAnalysis', 'refreshHistory', 'refreshAnalysisHistory', 'exportRealReport'];
  const methods = names.map(name => {
    const match = index.match(new RegExp('  private async ' + name + '\\([\\s\\S]*?\\n  }'));
    assert.ok(match, name + ' must be a real Index method'); return match[0];
  }).join('\n');
  const code = ts.transpileModule('class GuardHarness {\n' + methods + '\n}; GuardHarness;', { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  h.context.ChatMessage = h.load(path.join(root, 'openharmony/entry/src/main/ets/model/Models.ets')).ChatMessage;
  const Harness = vm.runInContext(code, h.context), ui = new Harness(); let calls = 0;
  Object.assign(ui, { hardwareSource: 'direct', hardwareVisible: true, settingsBusy: false, directSettingsBusy: false, settingsReady: true, messages: [],
    gateway: new Proxy({}, { get: () => async () => { calls++; throw Error('unexpected gateway request'); } }) });
  await ui.requestHardwareAnalysis('养护建议'); await ui.refreshHistory(); await ui.refreshAnalysisHistory(); await ui.exportRealReport();
  assert.equal(calls, 0); assert.match(ui.messages[0].text, /未向旧网关发送/);
  assert.match(ui.realReportStatus, /不能导出旧网关报告/);
});

test('real Index routes native history/export through authenticated cloud and never falls back after failure', async () => {
  const h=host(),index=readFileSync(path.join(root,'openharmony/entry/src/main/ets/pages/Index.ets'),'utf8');
  const methods=['refreshHistory','refreshAnalysisHistory','exportRealReport'].map(name=>index.match(new RegExp('  private async '+name+'\\([\\s\\S]*?\\n  }'))[0]).join('\n');
  const code=ts.transpileModule('class HistoryHarness {\n'+methods+'\n}; HistoryHarness;',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
  let gatewayCalls=0,saved='';h.context.NativeDocumentExport={saveJson:async(text,_name,isCurrent)=>{assert.equal(isCurrent(),true);saved=text;return true;}};
  const Harness=vm.runInContext(code,h.context),ui=new Harness();
  Object.assign(ui,{hardwareSource:'direct',cloudSessionReady:true,settingsReady:true,settingsBusy:false,demoMode:false,currentPage:4,historyBusy:false,analysisHistoryBusy:false,realReportBusy:false,historyEpoch:0,analysisHistoryEpoch:0,realReportEpoch:0,
    cloudUpload:{readHistory:async kind=>({rows:[kind+' scoped history'],status:'cloud scoped history'}),readRecentReport:async()=>'{"historical":true}'},
    gateway:new Proxy({},{get:()=>async()=>{gatewayCalls++;throw Error('old gateway');}})});
  await ui.refreshHistory();assert.equal(ui.historyRows[0],'telemetry scoped history');
  await ui.refreshAnalysisHistory();assert.equal(ui.analysisHistoryRows[0],'analysis scoped history');
  await ui.exportRealReport();assert.equal(saved,'{"historical":true}');assert.match(ui.realReportStatus,/各10条/);assert.equal(gatewayCalls,0);
  ui.cloudUpload.readHistory=async()=>{throw Error('authentication failed');};await ui.refreshHistory();assert.equal(ui.historyRows.length,0);assert.match(ui.historyStatus,/authentication failed/);assert.equal(gatewayCalls,0);
  const waiting=deferred();ui.cloudUpload.readHistory=()=>waiting.promise;const pending=ui.refreshHistory();ui.historyEpoch++;ui.historyRows=[];waiting.resolve({rows:['old device history'],status:'old'});await pending;assert.equal(ui.historyRows.length,0);
});

test('direct assistant refreshes actual board sample and awaits upload receipt before analysis after navigation', async () => {
 const h=host(),index=readFileSync(path.join(root,'openharmony/entry/src/main/ets/pages/Index.ets'),'utf8');
 const methods=['resetHardware','selectPage','pollHardware','requestHardwareAnalysis','requestAgentPipeline','sendLiveSample'].map(name=>index.match(new RegExp('  private (?:async )?'+name+'\\([\\s\\S]*?\\n  }'))[0]).join('\n');
 const code=ts.transpileModule('class Harness{'+methods+'};Harness;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 h.context.ChatMessage=h.load(path.join(root,'openharmony/entry/src/main/ets/model/Models.ets')).ChatMessage;
 const Harness=vm.runInContext(code,h.context),ui=new Harness(),view=new h.DirectHardwareView();view.configure('192.168.1.100');await view.poll();
 const calls=[],receipt=deferred();let expectedSession='';
 Object.assign(ui,{directHardware:view,currentPage:0,hardwareSource:'direct',cloudSessionReady:true,queueReady:true,offlineQueue:{enqueue:async()=> 'test-key',acknowledge:async()=>{},count:()=>0},cloudUpload:{queueTarget:()=> 'https://cloud.test|dayu-test',upload:async sample=>{calls.push('upload');expectedSession=sample.sessionBootId;return receipt.promise;},analyze:async(_text,session)=>{assert.equal(session,expectedSession);calls.push('analyze');return {deviceOnline:true,observationReceivedAt:100000,provider:'deepseek',model:'test',summary:'test advice',findings:[],unknowns:[]};}},
 speechEpoch:0,speechInput:{cancel(){}},directSettingsReady:true,settingsReady:true,hardwareVisible:true,settingsBusy:false,directSettingsBusy:false,hardwareBusy:false,hardwareTransportBusy:false,demoMode:false,modelBusy:false,connectionEpoch:1,hardwareEpoch:1,messages:[],gateway:{pipeline:async()=>{throw Error('old gateway called');}}});
 ui.selectPage(1);h.responseFrame(101);const pending=ui.requestHardwareAnalysis('温度建议');await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,['upload']);receipt.resolve('confirmed');await pending;
 assert.deepEqual(calls,['upload','analyze']);assert.match(ui.messages.at(-1).text,/test advice/);
 // A repeated frame after page invalidation falls back without using the old frame.
 const scopedAnalyze=ui.cloudUpload.analyze;
 ui.cloudUpload.analyze=async(_text,session,general)=>{if(!general)return scopedAnalyze(_text,session);assert.equal(session,'');calls.push('general');return {summary:'general advice',findings:[]};};
 ui.selectPage(0);ui.selectPage(1);const before=calls.length;await ui.requestHardwareAnalysis('重复帧');assert.deepEqual(calls.slice(before),['general']);assert.match(ui.messages.at(-1).text,/通用农业建议/);
 // Explicitly block unimplemented native async-pipeline transport in direct mode.
 ui.pipelineBusy=false;ui.remoteMode=false;ui.pipelineInput='只读任务';ui.addEvent=()=>{};h.context.AgentPipelineView=h.load(path.join(services,'AgentPipelineView.ets')).AgentPipelineView;h.context.PipelineVerdictBadge=h.load(path.join(services,'AgentPipelineView.ets')).PipelineVerdictBadge;ui.cloudUpload.pipeline=async()=>{calls.push('cloud-pipeline');throw Error('device_task_failed');};await ui.requestAgentPipeline();assert.ok(calls.includes('cloud-pipeline'));assert.match(ui.pipelineError,/device_task_failed|三阶段/);
 // A failed upload permits a general answer only.
 h.responseFrame(102);ui.cloudUpload.upload=async()=>{throw Error('upload_not_confirmed');};await ui.requestHardwareAnalysis('失败测试');assert.equal(calls.filter(c=>c==='analyze').length,1);assert.equal(calls.at(-1),'general');assert.match(ui.cloudUploadStatus,/upload_not_confirmed/);
 // Navigating while waiting for upload must not send analysis using the former page context.
 h.responseFrame(103);const late=deferred();ui.cloudUpload.upload=()=>late.promise;
 const navigating=ui.requestHardwareAnalysis('切页测试');await new Promise(r=>setImmediate(r));ui.selectPage(2);late.resolve('confirmed');await navigating;
 assert.equal(calls.filter(c=>c==='analyze').length,1);

});

test('native archive guards authorization, avoids model calls and rejects stale UI result',async()=>{
 const h=host(),index=readFileSync(path.join(root,'openharmony/entry/src/main/ets/pages/Index.ets'),'utf8');
 const method=index.match(/  private async saveCurrentPhoto\([\s\S]*?\n  }/)[0];
 h.context.NativePhotoUpload={readCapturedJpeg:()=> 'aGVsbG8='};
 const code=ts.transpileModule('class PhotoHarness {\n'+method+'\n}; PhotoHarness;',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
 const Harness=vm.runInContext(code,h.context),ui=new Harness();let calls=0;
 Object.assign(ui,{demoMode:false,photoUploadBusy:false,cameraBusy:false,cloudSessionReady:true,photoAuthorized:false,photoPath:'/private/crop-1000.jpg',photoSavedPath:'',photoDescription:'test leaf',photoCategory:'crop',photoCapturedAt:1000,connectionEpoch:1,requireAbilityContext:()=>({filesDir:'/private'}),cloudUpload:{configured:()=>true,savePhoto:async()=>{calls++;return {mediaId:'test-id'};}}});
 await ui.saveCurrentPhoto();assert.equal(calls,0);ui.photoAuthorized=true;await ui.saveCurrentPhoto();assert.equal(calls,1);assert.match(ui.photoUploadStatus,/未发送给AI/);await ui.saveCurrentPhoto();assert.equal(calls,1);
 const late=deferred();ui.photoSavedPath='';ui.photoAuthorized=true;ui.photoUploadStatus='new context';ui.cloudUpload.savePhoto=()=>late.promise;
 const pending=ui.saveCurrentPhoto();ui.connectionEpoch++;ui.photoUploadStatus='context switched';late.resolve({mediaId:'old-result'});await pending;assert.equal(ui.photoUploadStatus,'context switched');assert.equal(ui.photoUploadBusy,false);
});
