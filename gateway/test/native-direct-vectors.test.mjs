// 原生直采帧校验的可执行断言（主机侧，无需 SDK / 设备 / 网络）。
// 被测对象：openharmony/entry/src/main/ets/services/DirectTelemetry.ets
// 向量来源：docs/DAYU200遥测帧校验向量.md（F 段身份/质量/温湿度/ADC，T 段时效与 IP）
//
// 运行方式：
//   node --test gateway/test/native-direct-vectors.test.mjs
//
// .ets 在 Node 里跑起来的做法：Node 22 的 ESM 加载器只对 .ts/.mts/.cts/.js 做类型剥离，
// 对 .ets 会报 ERR_UNKNOWN_FILE_EXTENSION，对 data: URL 也不剥离。因此这里读源文本，
// 把 '@ohos.net.http' / '@ohos.util' 两条 import 改写成从 globalThis 取桩，写入 tmp 下的
// .mts 临时文件后用 pathToFileURL 动态 import —— 得到的模块就是被测实现的真实代码。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {validateHspFrame} from '../hsp-telemetry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(HERE, '../../openharmony/entry/src/main/ets/services/DirectTelemetry.ets');

const EXPECTED_DEVICE_ID = 'hh-hsp101-001';
const TTL_MS = 10000;
const REQUEST_TIMEOUT_MS = 3000;
const MAX_BODY_BYTES = 4096;

const REFERENCE_FRAME = {
  schemaVersion: 1,
  deviceId: EXPECTED_DEVICE_ID,
  simulated: false,
  uptime_ms: 123456,
  th_ok: true,
  temperature10: 256,
  humidity10: 640,
  gas_ok: true,
  gas_raw: 1234,
  gas_mv: 3210,
  th_sample_age_ms: 800,
  gas_sample_age_ms: 900,
  coValid: false,
  co2Valid: false,
  coPpm: null,
  co2Ppm: null,
  controlSupported: false,
};

const FRAME_KEYS = [
  'co2Ppm', 'co2Valid', 'coPpm', 'coValid', 'controlSupported', 'deviceId', 'gas_mv',
  'gas_ok', 'gas_raw', 'gas_sample_age_ms', 'humidity10', 'schemaVersion', 'simulated',
  'temperature10', 'th_ok', 'th_sample_age_ms', 'uptime_ms',
];

// 注意：json() 接收的是"帧对象本身"，空帧 undefined_ok 场景要在连接时序列化，
// 因此统一用 lazy 版本表达"键缺失"。
const frame = (patch) => ({ ...REFERENCE_FRAME, ...patch });
const without = (key) => {
  const copy = { ...REFERENCE_FRAME };
  delete copy[key];
  return copy;
};
const json = (frameValue) => ({ responseCode: 200, result: JSON.stringify(frameValue) });

// ---- 被测模块加载 -------------------------------------------------------

let lastRequestUrl = null;
let lastRequestOptions = null;
let httpRequests = 0;
let httpResponse = json(REFERENCE_FRAME);

globalThis.__hspUtilStub = {
  TextEncoder: class {
    encodeInto(text) {
      return { byteLength: Buffer.byteLength(text, 'utf8') };
    }
  }
};

globalThis.__hspHttpStub = {
  RequestMethod: { GET: 'GET' },
  HttpDataType: { STRING: 0 },
  createHttp() {
    return {
      async request(url, options) {
        httpRequests += 1;
        lastRequestUrl = url;
        lastRequestOptions = options;
        return httpResponse;
      },
      destroy() {}
    };
  }
};

function stripToHostModuleText(source) {
  // 文件以类的收尾 '}' 结束；取到最后一个 '}' 为止。
  let text = source.slice(0, source.lastIndexOf('}') + 1);
  text = text.replace(
    /import http from '@ohos\.net\.http';/,
    'const http = globalThis.__hspHttpStub;'
  );
  text = text.replace(
    /import util from '@ohos\.util';/,
    'const util = globalThis.__hspUtilStub;'
  );
  // 剥成非导出声明，末尾统一补一条 export，避免 .ets 顶层 export 与 .mts 的语义差异。
  text = text.replace(/export class /, 'class ');
  return text + '\nexport { DirectTelemetry };\n';
}

const tempDir = mkdtempSync(join(tmpdir(), 'hsp-direct-vectors-'));
const hostModulePath = join(tempDir, 'DirectTelemetry.mts');
writeFileSync(hostModulePath, stripToHostModuleText(readFileSync(SOURCE_PATH, 'utf8')), 'utf8');
const hostModule = await import(pathToFileURL(hostModulePath).href);
const DirectTelemetry = hostModule.DirectTelemetry;

async function manualClock(fn) {
  const original = Date.now;
  let time = 1700000000000;
  Date.now = () => time;
  try { return await fn(value => { time = 1700000000000 + value; }); }
  finally { Date.now = original; }
}

test('S-03: 缓存跨轮次自然老化，9999有效、10000归未知且不发新请求',async()=>{
 await manualClock(async setTime=>{
  const telemetry=newTelemetry();httpResponse=json(frame({th_sample_age_ms:0,gas_sample_age_ms:0}));
  const first=await telemetry.pollOnce(),requests=httpRequests;
  setTime(9999);assert.equal(telemetry.currentSnapshot().deviceOnline,true);
  setTime(10000);const stale=telemetry.currentSnapshot();
  assert.equal(stale.reason,'telemetry_stale');assert.equal(stale.values.temperatureC,null);assert.equal(stale.receivedAt,null);assert.equal(httpRequests,requests);
  assert.equal(first.sampleAgeMs,0,'后续读取不能修改调用者手中的历史快照');
 });
});

test('缓存通道独立过期，原始帧保留有效数值供对端重新校验',async()=>{
 await manualClock(async setTime=>{
  const telemetry=newTelemetry();httpResponse=json(frame({th_sample_age_ms:9000,gas_sample_age_ms:0}));await telemetry.pollOnce();
  setTime(1000);const current=telemetry.currentSnapshot();
  assert.equal(current.quality.temperatureValid,false);assert.equal(current.values.temperatureC,null);assert.equal(current.quality.gasValid,true);
  assert.doesNotThrow(()=>validateHspFrame(current.frame));assert.equal(current.frame.temperature10,256);
  current.frame.temperature10=999;current.values.gasRaw=999;
  assert.equal(telemetry.currentSnapshot().frame.temperature10,256,'调用者不得修改内部采样');assert.equal(telemetry.currentSnapshot().values.gasRaw,1234);
 });
});

test('运行十秒后新帧重置重复计时，冻结十秒再报未更新',async()=>{
 await manualClock(async setTime=>{
  const telemetry=newTelemetry();httpResponse=json(frame({uptime_ms:1}));await telemetry.pollOnce();
  setTime(20000);httpResponse=json(frame({uptime_ms:2}));await telemetry.pollOnce();
  setTime(20001);assert.equal((await telemetry.pollOnce()).reason,'board_duplicate_frame');
  assert.equal(telemetry.currentSnapshot().receivedAt,1700000020000);
  setTime(30000);assert.equal((await telemetry.pollOnce()).reason,'board_sample_not_updating');
 });
});

test('回退墙钟拒绝缓存与重复帧，invalidate清除可见缓存',async()=>{
 await manualClock(async setTime=>{
  const telemetry=newTelemetry();httpResponse=json(REFERENCE_FRAME);await telemetry.pollOnce();
  setTime(-1);assert.equal(telemetry.currentSnapshot().reason,'invalid_receive_time');assert.equal((await telemetry.pollOnce()).reason,'invalid_receive_time');
  httpResponse=json(frame({uptime_ms:REFERENCE_FRAME.uptime_ms+1}));assert.equal((await telemetry.pollOnce()).reason,'invalid_receive_time','墙钟回退时新帧也不能刷新接收时间');
  telemetry.invalidate();assert.equal(telemetry.currentSnapshot().reason,'board_no_sample');
 });
});

test('页面与后台失效不伪造重启会话，也不能给冻结帧续期',async()=>{
 await manualClock(async setTime=>{
  const telemetry=newTelemetry();httpResponse=json(frame({uptime_ms:100}));const first=await telemetry.pollOnce();
  for(let i=1;i<=140;i++){
   setTime(i*10);telemetry.invalidate();assert.equal(telemetry.currentSnapshot().deviceOnline,false);
   assert.equal((await telemetry.pollOnce()).reason,'board_duplicate_frame');
   httpResponse=json(frame({uptime_ms:100+i}));const next=await telemetry.pollOnce();
   assert.equal(next.sessionBootId,first.sessionBootId);httpResponse=json(frame({uptime_ms:100+i}));
  }
  setTime(20000);telemetry.invalidate();assert.equal((await telemetry.pollOnce()).reason,'board_sample_not_updating');
  assert.equal(telemetry.currentSnapshot().deviceOnline,false);
 });
});

test('重复保存同一IP保留会话，真实换IP隔离旧会话',async()=>{
 await manualClock(async setTime=>{
  const telemetry=newTelemetry();httpResponse=json(frame({uptime_ms:100}));const first=await telemetry.pollOnce();
  setTime(1);telemetry.configure('192.168.1.50');
  assert.equal((await telemetry.pollOnce()).reason,'board_duplicate_frame');
  httpResponse=json(frame({uptime_ms:101}));assert.equal((await telemetry.pollOnce()).sessionBootId,first.sessionBootId);
  setTime(2);telemetry.configure('192.168.1.51');const moved=await telemetry.pollOnce();
  assert.notEqual(moved.sessionBootId,first.sessionBootId);assert.equal(moved.deviceOnline,true);
 });
});

test('物理请求串行，配置变化后迟到结果不能写入新上下文',async()=>{
 await manualClock(async ()=>{
  const telemetry=newTelemetry();let release;
  httpResponse=new Promise(resolve=>{release=resolve;});
  const before=httpRequests,pending=telemetry.pollOnce();
  assert.equal((await telemetry.pollOnce()).reason,'board_request_busy');assert.equal(httpRequests,before+1);
  telemetry.configure('192.168.1.51');assert.equal(telemetry.currentSnapshot().deviceOnline,false);
  assert.equal((await telemetry.pollOnce()).reason,'board_request_busy');
  release(json(REFERENCE_FRAME));assert.equal((await pending).reason,'board_address_changed');
  assert.equal(telemetry.currentSnapshot().reason,'board_no_sample');
  httpResponse=json(REFERENCE_FRAME);await telemetry.pollOnce();assert.equal(lastRequestUrl,'http://192.168.1.51/api/pengan/telemetry');
 });
});

test('官方API26请求参数禁止重定向并限制接收大小',async()=>{
 httpResponse=json(REFERENCE_FRAME);await newTelemetry().pollOnce();
 assert.equal(lastRequestOptions.maxRedirects,0);assert.equal(lastRequestOptions.maxLimit,4096);assert.equal(lastRequestOptions.usingCache,false);
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- 工具 ---------------------------------------------------------------

// 固定墙钟：首次 Date.now 返回基准（= startedAt），此后每次返回基准 + offset。
// 用它可以稳定地落在 3000ms 超时守卫的两侧。
// 必须 await：pollOnce 是 async 的，若同步返回 Promise，finally 会在第一个 await 处就把
// Date.now 还原，后续读数全部走真实时钟。
async function withClock(offsetMs, fn) {
  const realNow = Date.now;
  const base = 1700000000000;
  let calls = 0;
  Date.now = () => base + (calls++ === 0 ? 0 : offsetMs);
  try {
    return await fn();
  } finally {
    Date.now = realNow;
  }
}

// 关键：configure() 会重置会话状态，必须在冻结时钟之前调用，否则 startedAt 与后续
// Date.now 读数会错位（时钟桩的首次读数会被 configure 消费掉）。
function newTelemetry(ip = '192.168.1.50') {
  const telemetry = new DirectTelemetry();
  telemetry.configure(ip);
  return telemetry;
}

function makeResponse(frameValue) {
  return { responseCode: 200, result: JSON.stringify(frameValue) };
}

// 单次失败的轮询：新建实例 -> configure -> 冻结时钟 -> pollOnce。
async function pollWith(response, offsetMs = 0) {
  httpResponse = response;
  const telemetry = newTelemetry();
  return withClock(offsetMs, async () => telemetry.pollOnce());
}

async function poll(patch, offsetMs = 0) {
  return pollWith(makeResponse(frame(patch)), offsetMs);
}

// 帧被接受时 reason 恒为 'read_only_hardware'（投放受限，但仍是一帧已接收的合法数据）；
// 任何被拒绝的帧 reason 都是别的值。不要用"是否有 reason"判断成败。
const ACCEPTED_REASON = 'read_only_hardware';

function isRejected(snapshot) {
  return snapshot.reason !== ACCEPTED_REASON;
}

// ---- 模块身份 -----------------------------------------------------------

test('被测模块可被加载且导出 DirectTelemetry 类', () => {
  assert.ok(DirectTelemetry, 'DirectTelemetry 未导出（改写后必须补 export 语句）');
  assert.equal(typeof DirectTelemetry, 'function');
  assert.equal(typeof new DirectTelemetry().pollOnce, 'function');
});

// ---- F 段：身份 ---------------------------------------------------------

test('F: 身份段任一条件不满足都抛 invalid_hsp_identity', async () => {
  const cases = {
    schemaVersion: frame({ schemaVersion: 2 }),
    deviceId: frame({ deviceId: 'HH-HSP101-001' }),
    simulated: frame({ simulated: true }),
    controlSupported: frame({ controlSupported: true }),
    coValid: frame({ coValid: true }),
    co2Valid: frame({ co2Valid: true }),
    coPpm: frame({ coPpm: 5 }),
    co2Ppm: frame({ co2Ppm: 5 }),
    coPpmAbsent: without('coPpm'),
    coValidAbsent: without('coValid')
  };
  for (const [label, bad] of Object.entries(cases)) {
    const snapshot = await pollWith(makeResponse(bad));
    assert.equal(snapshot.reason, 'invalid_hsp_identity', 'identity 用例 ' + label + ' 未拒绝');
    assert.equal(snapshot.deviceOnline, false, 'identity 用例 ' + label + ' 仍标记在线');
    assert.equal(snapshot.frame, null, 'identity 用例 ' + label + ' 仍带 frame');
  }
});

// ---- F 段：质量 ---------------------------------------------------------

test('F: 质量段非 uint / 非 boolean 都抛 invalid_hsp_quality', async () => {
  const cases = {
    uptimeNotUint: frame({ uptime_ms: 4294967296 }),
    uptimeNegative: frame({ uptime_ms: -1 }),
    uptimeFloat: frame({ uptime_ms: 1.5 }),
    thOkNotBoolean: frame({ th_ok: 0 }),
    gasOkNotBoolean: frame({ gas_ok: 'true' }),
    thAgeNotUint: frame({ th_sample_age_ms: 4294967296 }),
    gasAgeNotUint: frame({ gas_sample_age_ms: -5 })
  };
  for (const [label, bad] of Object.entries(cases)) {
    const snapshot = await poll(bad);
    assert.equal(snapshot.reason, 'invalid_hsp_quality', 'quality 用例 ' + label + ' 未拒绝');
  }
});

// ---- F 段：温湿度 -------------------------------------------------------

test('F: th_ok=true 时温湿度越界抛 invalid_hsp_climate', async () => {
  const cases = {
    temperatureHigh: frame({ th_ok: true, temperature10: 851 }),
    temperatureLow: frame({ th_ok: true, temperature10: -401 }),
    temperatureNotNumber: frame({ th_ok: true, temperature10: '256' }),
    humidityHigh: frame({ th_ok: true, humidity10: 1001 }),
    humidityNegative: frame({ th_ok: true, humidity10: -1 }),
    humidityNotNumber: frame({ th_ok: true, humidity10: '640' })
  };
  for (const [label, bad] of Object.entries(cases)) {
    const snapshot = await poll(bad);
    assert.equal(snapshot.reason, 'invalid_hsp_climate', 'climate 用例 ' + label + ' 未拒绝');
  }
});

test('F: th_ok=false 时越界温湿度必须放行', async () => {
  const snapshot = await poll({
    th_ok: false,
    temperature10: 9999,
    humidity10: 9999,
    th_sample_age_ms: 0
  });
  assert.equal(isRejected(snapshot), false, 'th_ok=false 的越界值被误判为失败');
  assert.equal(snapshot.reason, 'read_only_hardware');
  assert.equal(snapshot.quality.temperatureValid, false, 'th_ok=false 通道不应被判有效');
});

// ---- F 段：ADC ----------------------------------------------------------

test('F: gas_ok=true 时 ADC 越界抛 invalid_hsp_adc', async () => {
  const cases = {
    gasRawHigh: frame({ gas_ok: true, gas_raw: 4096 }),
    gasRawNegative: frame({ gas_ok: true, gas_raw: -1 }),
    gasMvHigh: frame({ gas_ok: true, gas_mv: 7201 }),
    gasMvNegative: frame({ gas_ok: true, gas_mv: -1 }),
    gasRawNotNumber: frame({ gas_ok: true, gas_raw: '1234' })
  };
  for (const [label, bad] of Object.entries(cases)) {
    const snapshot = await poll(bad);
    assert.equal(snapshot.reason, 'invalid_hsp_adc', 'adc 用例 ' + label + ' 未拒绝');
  }
});

test('F: gas_ok=false 时越界 ADC 必须放行并可缺失', async () => {
  const overflow = await poll({ gas_ok: false, gas_raw: 9999, gas_mv: 9999, gas_sample_age_ms: 0 });
  assert.equal(isRejected(overflow), false, 'gas_ok=false 的越界值被误判为失败');
  assert.equal(overflow.values.gasMv, null, 'gas_ok=false 时 gas_mv 应置空');

  const missing = await poll({ gas_ok: false, gas_raw: undefined, gas_mv: undefined, gas_sample_age_ms: 0 });
  assert.equal(isRejected(missing), false, 'gas_ok=false 时缺字段被误判为失败');
});

// ---- F 段：白名单 -------------------------------------------------------

test('F: Snapshot.frame 只保留白名单键', async () => {
  const polluted = frame({
    wifi_ssid: 'pengan-lab',
    wifi_ip: '192.168.1.99',
    page: 'home',
    trend: 'rising',
    nfc_text: 'A1B2C3',
    th_sample_age_ms: 0,
    gas_sample_age_ms: 0
  });
  const snapshot = await poll(polluted);
  assert.notEqual(snapshot.frame, null);
  assert.deepEqual(Object.keys(snapshot.frame).sort(), FRAME_KEYS);
  const extra = ['wifi_ssid', 'wifi_ip', 'page', 'trend', 'nfc_text'];
  for (const key of extra) {
    assert.equal(key in snapshot.frame, false, 'frame 泄漏了非白名单键 ' + key);
  }
});

// ---- T 段：时效 ---------------------------------------------------------

test('T: 样本年龄 + 接收年龄 >= 10000 该通道失效，9999 仍有效', async () => {
  const boundary = await poll({ th_sample_age_ms: 7001, gas_sample_age_ms: 7001 }, 2999);
  assert.equal(boundary.sampleAgeMs, 2999);
  assert.equal(boundary.climateAgeMs, TTL_MS, 'climateAgeMs 应为 7001 + 2999');
  assert.equal(boundary.gasAgeMs, TTL_MS);
  assert.equal(boundary.quality.temperatureValid, false, '恰好 10000 必须失效');
  assert.equal(boundary.quality.gasValid, false, '恰好 10000 必须失效');
  assert.equal(boundary.values.temperatureC, null);
  assert.equal(boundary.values.humidityPct, null);
  assert.equal(boundary.values.gasRaw, null);

  const below = await poll({ th_sample_age_ms: 7000, gas_sample_age_ms: 7000 }, 2999);
  assert.equal(below.climateAgeMs, TTL_MS - 1, 'climateAgeMs 应为 7000 + 2999');
  assert.equal(below.quality.temperatureValid, true, '9999 必须仍有效（严格小于才算过期）');
  assert.equal(below.quality.gasValid, true);
  assert.equal(below.values.temperatureC, 25.6);
});

test('T: 两通道年龄各自独立裁剪', async () => {
  const climateStale = await poll({ th_sample_age_ms: 9000, gas_sample_age_ms: 0 }, 2999);
  assert.equal(climateStale.climateAgeMs, 11999);
  assert.equal(climateStale.quality.temperatureValid, false);
  assert.equal(climateStale.quality.gasValid, true, 'gas 通道被 climate 通道拖累');
  assert.equal(climateStale.values.gasRaw, 1234);
});

test('T: 请求耗时达到 3000ms 判 board_sample_too_slow，2999ms 仍接受', async () => {
  const slow = await poll(REFERENCE_FRAME, REQUEST_TIMEOUT_MS);
  assert.equal(slow.reason, 'board_sample_too_slow');
  assert.equal(slow.deviceOnline, false);
  assert.equal(slow.sampleAgeMs, null);

  const fast = await poll(REFERENCE_FRAME, REQUEST_TIMEOUT_MS - 1);
  assert.equal(fast.reason, 'read_only_hardware');
  assert.equal(fast.sampleAgeMs, 2999);
});

// ---- T 段：会话与重复帧 -------------------------------------------------

test('T: uptime_ms 相同判 board_duplicate_frame 且不刷新 receivedAt', async () => {
  await withClock(0, async () => {
    httpResponse = json(frame({ th_sample_age_ms: 0, gas_sample_age_ms: 0 }));
    const telemetry = newTelemetry();

    const first = await telemetry.pollOnce();
    assert.equal(first.reason, 'read_only_hardware');
    assert.equal(first.receivedAt, 1700000000000);

    const duplicate = await telemetry.pollOnce();
    assert.equal(duplicate.reason, 'board_duplicate_frame');
    assert.equal(duplicate.receivedAt, null, '重复帧不得刷新 receivedAt');
    assert.equal(duplicate.uptimeMs, null);
    assert.equal(duplicate.sessionBootId, first.sessionBootId);
    assert.equal(duplicate.frame, null);
  });
});

test('T: uptime_ms 增长后接受新帧并保持 sessionBootId', async () => {
  await withClock(0, async () => {
    httpResponse = json(frame({ uptime_ms: 123456 }));
    const telemetry = newTelemetry();
    const first = await telemetry.pollOnce();

    httpResponse = json(frame({ uptime_ms: 654321 }));
    const second = await telemetry.pollOnce();
    assert.equal(second.reason, 'read_only_hardware');
    assert.equal(second.uptimeMs, 654321);
    assert.equal(second.sessionBootId, first.sessionBootId, '单调增长不应换 boot id');
  });
});

test('T: uptime_ms 回绕导致 sessionBootId 变化', async () => {
  await withClock(0, async () => {
    httpResponse = json(frame({ uptime_ms: 1000 }));
    const telemetry = newTelemetry();
    const before = await telemetry.pollOnce();

    httpResponse = json(frame({ uptime_ms: 100 }));
    const after = await telemetry.pollOnce();
    assert.equal(after.reason, 'read_only_hardware');
    assert.notEqual(after.sessionBootId, before.sessionBootId, '回绕必须换 boot id');
    assert.ok(after.sessionBootId.includes('-100'), 'boot id 应内含新 uptime：' + after.sessionBootId);
  });
});

// ---- HTTP 段 ------------------------------------------------------------

test('H: 非 200 响应按状态码映射失败原因', async () => {
  const cases = [
    [{ responseCode: 503, result: 'busy' }, 'board_telemetry_unavailable'],
    [{ responseCode: 500, result: 'boom' }, 'board_http_failed'],
    [{ responseCode: 404, result: 'nope' }, 'board_http_failed'],
    [{ responseCode: 200, result: 42 }, 'board_http_failed'],
    [{ responseCode: 200, result: undefined }, 'board_http_failed']
  ];
  for (const [response, expected] of cases) {
    const snapshot = await pollWith(response);
    assert.equal(snapshot.reason, expected, '响应 ' + JSON.stringify(response) + ' 映射错误');
  }
});

test('H: 响应体超过 4096 字节判 board_frame_too_large，按字节而非字符计', async () => {
  const tooLarge = await pollWith({ responseCode: 200, result: 'x'.repeat(MAX_BODY_BYTES + 1) });
  assert.equal(tooLarge.reason, 'board_frame_too_large');

  // 1400 个多字节字符 = 4200 UTF-8 字节，但只有 1400 个 UTF-16 单元：能抓住按字符计数的错误。
  const multiByte = await pollWith({ responseCode: 200, result: '中'.repeat(1400) });
  assert.equal(multiByte.reason, 'board_frame_too_large');

  // 3900 字节未超限，应落到 JSON 解析失败而不是体积失败。
  const withinLimit = await pollWith({ responseCode: 200, result: '中'.repeat(1300) });
  assert.notEqual(withinLimit.reason, 'board_frame_too_large');
});

test('H: 非法 JSON 与非法帧结构分别抛 invalid_hsp_sample / invalid_hsp_identity', async () => {
  const broken = await pollWith({ responseCode: 200, result: 'not json' });
  assert.equal(broken.reason, 'invalid_hsp_sample');

  const nullBody = await pollWith({ responseCode: 200, result: 'null' });
  assert.equal(nullBody.reason, 'invalid_hsp_sample');

  const arrayBody = await pollWith({ responseCode: 200, result: '[]' });
  assert.equal(arrayBody.reason, 'invalid_hsp_identity');
});

test('H: 未配置 IP 返回 board_not_configured 且不发请求', async () => {
  const before = httpRequests;
  const snapshot = await withClock(0, async () => new DirectTelemetry().pollOnce());
  assert.equal(snapshot.reason, 'board_not_configured');
  assert.equal(httpRequests, before, '未配置时不应发出 HTTP 请求');
});

test('H: 请求地址固定为 /api/pengan/telemetry 且指向已配置 IP', async () => {
  await poll({ th_sample_age_ms: 0, gas_sample_age_ms: 0 });
  assert.equal(lastRequestUrl, 'http://192.168.1.50/api/pengan/telemetry');
});

// ---- T 段：IP 准入 ------------------------------------------------------

test('T: assertPrivateIpv4 只放行 RFC1918 三段', () => {
  const accepted = ['10.0.0.1', '10.255.255.254', '192.168.1.1', '172.16.0.1', '172.31.255.255'];
  for (const ip of accepted) {
    const telemetry = new DirectTelemetry();
    assert.doesNotThrow(() => telemetry.configure(ip), ip + ' 应被接受');
  }

  // 草案只放行 10/192.168/172.16-31，回环地址 127.0.0.1 也被拒（这是草案的实际行为）。
  const rejected = ['8.8.8.8', '169.254.1.1', '127.0.0.1', '172.32.0.1', '1.2.3.256', '01.2.3.4', '10.0.0.1.5', ''];
  for (const ip of rejected) {
    const telemetry = new DirectTelemetry();
    assert.throws(
      () => telemetry.configure(ip),
      (error) => {
        assert.equal(error.message, 'board_requires_private_ipv4');
        return true;
      },
      ip + ' 应被拒绝'
    );
  }
});

test('T: 被拒绝的 IP 不会让 pollOnce 发出请求', async () => {
  const telemetry = new DirectTelemetry();
  assert.throws(() => telemetry.configure('8.8.8.8'));
  const before = httpRequests;
  const snapshot = await withClock(0, async () => telemetry.pollOnce());
  assert.equal(snapshot.reason, 'board_not_configured');
  assert.equal(httpRequests, before);
});

// ---- 来源标记不变量 -----------------------------------------------------

test('所有失败路径的 Snapshot.source 恒为 dayu-direct', async () => {
  const scenarios = [
    json(frame({ schemaVersion: 2 })),
    json(frame({ uptime_ms: -1 })),
    json(frame({ temperature10: 999, th_ok: true })),
    json(frame({ gas_raw: 9999, gas_ok: true })),
    { responseCode: 503, result: 'busy' },
    { responseCode: 500, result: 'boom' },
    { responseCode: 200, result: 'x'.repeat(MAX_BODY_BYTES + 1) },
    { responseCode: 200, result: 'not json' }
  ];
  for (const response of scenarios) {
    const snapshot = await pollWith(response);
    assert.equal(snapshot.source, 'dayu-direct', '失败路径 source 错误：' + JSON.stringify(response));
    assert.notEqual(snapshot.source, 'serial');
    assert.notEqual(snapshot.source, 'unknown');
    assert.notEqual(snapshot.reason, 'read_only_hardware');
  }

  const unconfigured = await withClock(0, async () => new DirectTelemetry().pollOnce());
  assert.equal(unconfigured.source, 'dayu-direct');
});
