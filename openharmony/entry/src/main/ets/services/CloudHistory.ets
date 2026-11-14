import { HardwareAnalysis } from '../model/AgentModels';

class Values { temperatureC: number | null = null; humidityPct: number | null = null; gasRaw: number | null = null; gasMv: number | null = null; coPpm: number | null = null; co2Ppm: number | null = null; }
class Quality { temperatureValid: boolean = false; humidityValid: boolean = false; gasValid: boolean = false; coValid: boolean = false; co2Valid: boolean = false; }
class HistoryHardware { schemaVersion: number = 0; deviceId: string = ''; source: string = ''; simulated: boolean = true; deviceOnline: boolean = false; actuationAvailable: boolean = true; controlSupported: boolean = true; admission: string = ''; receivedAt: number = 0; sampleAgeMs: number = 0; climateAgeMs: number = 0; gasAgeMs: number = 0; values: Values = new Values(); quality: Quality = new Quality(); }
class HistoryItem { replayed: boolean = false; seq: number = 0; hash: string = ''; recordedAt: number = 0; sessionBootId: string = ''; historical: boolean = false; isCurrent: boolean = true; observation: HistoryHardware = new HistoryHardware(); prompt: string = ''; analysis: HardwareAnalysis = new HardwareAnalysis(); }
class Storage { enabled: boolean = false; healthy: boolean = false; records: number = 0; bytes: number = 0; maxBytes: number = 0; scope: string = ''; externalCompletenessVerified: boolean = true; }
class HistoryPage { schemaVersion: number = 0; gatewayId: string = ''; simulated: boolean = true; historical: boolean = false; isCurrent: boolean = true; storage: Storage = new Storage(); nextBeforeSeq: number | null = null; items: HistoryItem[] = []; }
export class CloudHistoryReading { status: string = ''; rows: string[] = []; nextBeforeSeq: number | null = null; }
export class CloudRecentReport {
  schemaVersion: number = 1; kind: string = 'pengan_cloud_recent_history'; gatewayId: string = ''; generatedAt: number = 0;
  historical: boolean = true; isCurrent: boolean = false; completeHistory: boolean = false;
  telemetryLimit: number = 10; analysisLimit: number = 10; hardwareActuation: boolean = false; realAdmission: string = 'unknown_denied';
  telemetry: CloudHistoryReading = new CloudHistoryReading(); analysis: CloudHistoryReading = new CloudHistoryReading();
  limitations: string[] = ['每类最近10条，非全量；两次读取不保证同一时刻快照。', '历史不代表当前环境或人员安全；未执行设备；不包含照片。', '文件哈希校验不等于外部完整性证明，存储记录数包含其他类型及设备。'];
}
function integer(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function validValue(value: number | null, valid: boolean, min: number, max: number, whole: boolean = false): void {
  if (valid && (value === null || !Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value)))) throw new Error('云端历史有效读数无效');
}

export function readCloudHistory(text: string, gatewayId: string, kind: string): CloudHistoryReading {
  const data = JSON.parse(text) as HistoryPage;
  if ((kind !== 'telemetry' && kind !== 'analysis') || !data || data.schemaVersion !== 1 || data.gatewayId !== gatewayId || data.simulated !== false || data.historical !== true || data.isCurrent !== false || !Array.isArray(data.items) || data.items.length > 10) throw new Error('设备云端历史协议无效');
  const s = data.storage;
  if (!s || s.enabled !== true || typeof s.healthy !== 'boolean' || !integer(s.records) || !integer(s.bytes) || !integer(s.maxBytes) || s.bytes > s.maxBytes || s.scope !== 'retained-file' || s.externalCompletenessVerified !== false) throw new Error('云端历史存储状态无效');
  if (data.nextBeforeSeq !== null && (!Number.isSafeInteger(data.nextBeforeSeq) || data.nextBeforeSeq <= 0)) throw new Error('云端历史游标无效');
  const result = new CloudHistoryReading(); result.nextBeforeSeq = data.nextBeforeSeq;
  result.status = '设备 ' + gatewayId + ' · 最近' + data.items.length.toString() + '条历史，非当前/非全量 · 存储' + (s.healthy ? '正常' : '异常') + ' · 全库' + s.records.toString() + '条（含其他设备/审计）' + (data.nextBeforeSeq === null ? ' · 此查询无更早记录' : ' · 还有更早记录');
  let previous = Number.MAX_SAFE_INTEGER;
  for (const item of data.items) {
    if (!item || !Number.isSafeInteger(item.seq) || item.seq <= 0 || item.seq >= previous || !/^[a-f0-9]{64}$/.test(item.hash) || !integer(item.recordedAt) || typeof item.sessionBootId !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(item.sessionBootId) || item.historical !== true || item.isCurrent !== false) throw new Error('云端历史记录身份无效');
    previous = item.seq;
    const heading = (item.replayed === true ? '历史补发（仅供回溯） · ' : '') + '#' + item.seq.toString() + ' · 保存 ' + new Date(item.recordedAt).toLocaleString() + '\n';
    if (kind === 'telemetry') {
      const h = item.observation, q = h?.quality, v = h?.values;
      if (!h || h.schemaVersion !== 1 || h.deviceId !== 'hh-hsp101-001' || h.source !== 'dayu-direct' || h.simulated !== false || h.deviceOnline !== true || h.actuationAvailable !== false || h.controlSupported !== false || h.admission !== 'unknown_denied' || !integer(h.receivedAt) || !integer(h.sampleAgeMs) || h.sampleAgeMs >= 10000 || !q || !v || q.coValid !== false || q.co2Valid !== false || v.coPpm !== null || v.co2Ppm !== null || typeof q.temperatureValid !== 'boolean' || typeof q.humidityValid !== 'boolean' || typeof q.gasValid !== 'boolean') throw new Error('云端采集历史来源无效');
      if (((q.temperatureValid || q.humidityValid) && (!integer(h.climateAgeMs) || h.climateAgeMs >= 10000)) || (q.gasValid && (!integer(h.gasAgeMs) || h.gasAgeMs >= 10000))) throw new Error('云端历史通道年龄无效');
      validValue(v.temperatureC, q.temperatureValid, -40, 85); validValue(v.humidityPct, q.humidityValid, 0, 100); validValue(v.gasRaw, q.gasValid, 0, 4095, true); validValue(v.gasMv, q.gasValid, 0, 7200);
      result.rows.push(heading + 'DAYU200直采 · 温度 ' + (q.temperatureValid ? v.temperatureC?.toString() + '℃' : '未知') + ' · 湿度 ' + (q.humidityValid ? v.humidityPct?.toString() + '%' : '未知') + ' · 气体ADC ' + (q.gasValid ? v.gasRaw?.toString() : '未知') + '\n历史记录，不代表当前；CO/CO₂未接入，禁止据此准入。');
    } else {
      const a = item.analysis;
      if (typeof item.prompt !== 'string' || item.prompt.length > 1000 || !a || a.mode !== 'hardware' || a.simulated !== false || a.executed !== false || a.hardwareControl !== false || a.realAdmission !== 'unknown_denied' || !Array.isArray(a.steps) || a.steps.length !== 0 || typeof a.summary !== 'string' || a.summary.length > 2000 || (a.provider !== 'deepseek' && a.provider !== 'qwen') || typeof a.model !== 'string' || a.model.length === 0 || a.model.length > 150 || !integer(a.analyzedAt) || typeof a.deviceOnline !== 'boolean' || !Array.isArray(a.findings) || !Array.isArray(a.unknowns) || a.findings.length > 10 || a.unknowns.length > 12 || !a.findings.concat(a.unknowns).every((value: string) => typeof value === 'string' && value.length <= 1000)) throw new Error('云端文字分析历史无效');
      result.rows.push(heading + '问题：' + item.prompt + '\n模型：' + a.provider + ' / ' + a.model + '\n' + a.summary + '\n发现：' + a.findings.join('；') + '\n未知：' + a.unknowns.join('；') + '\n历史分析，非当前安全结论，未执行设备；照片不包含在内。');
    }
  }
  if (data.nextBeforeSeq !== null && (data.items.length === 0 || data.nextBeforeSeq !== previous)) throw new Error('云端历史游标与记录不符');
  return result;
}
