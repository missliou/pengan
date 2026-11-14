import http from '@ohos.net.http';
import util from '@ohos.util';
import { EnvSnapshot } from '../model/Models';
import { ModelPlan, ModelStatus, PromptBody, HardwareAnalysis, CropImageAnalysis,
  AgentPipelineResult, PipelineCandidate, PipelineDecision, PipelineEvidence, PipelinePlan, PipelinePlanStep,
  PipelineRuleHit, PipelineStage } from '../model/AgentModels';
import { DEFAULT_GATEWAY, normalizeGatewayAddress } from './ConnectionSettings';

interface RunParameters { maxRunMs: number; }
interface CommandBody { action: string; parameters?: RunParameters; }
interface ScenarioBody { name: string; }
interface ImageAnalysisBody { prompt: string; mimeType: string; imageBase64: string; }
export class ModelConnectionCheck {
  kind: string = ''; ok: boolean = false; provider: string = ''; model: string = '';
  checkedAt: number = 0; roundTripMs: number = 0; fieldDataSent: boolean = true;
  imageSent: boolean = true; executed: boolean = true;
}
class GatewayFailure { error: string = ''; }
class GatewayHealth {
  mode: string = '';
  ok: boolean = false;
  simulated: boolean = false;
  transport: string = '';
  hardwareConnected: boolean = false;
}
class HardwareValues {
  coPpm: number | null = null;
  co2Ppm: number | null = null;
  temperatureC: number | null = null;
  humidityPct: number | null = null;
  gasRaw: number | null = null;
  gasMv: number | null = null;
}
class HardwareQuality {
  temperatureValid: boolean = false;
  humidityValid: boolean = false;
  gasValid: boolean = false;
  coValid: boolean = false;
  co2Valid: boolean = false;
}
class HardwareSnapshot {
  simulated: boolean = false;
  deviceId: string = '';
  deviceOnline: boolean = false;
  actuationAvailable: boolean = false;
  receivedAt: number | null = null;
  sampleAgeMs: number | null = null;
  climateAgeMs: number | null = null;
  gasAgeMs: number | null = null;
  values: HardwareValues = new HardwareValues();
  quality: HardwareQuality = new HardwareQuality();
}
class HardwareHistoryStorage {
  enabled: boolean = false;
  healthy: boolean = false;
  records: number = 0;
  bytes: number = 0;
  maxBytes: number = 0;
}
class HardwareHistoryItem {
  seq: number = 0;
  hash: string = '';
  historical: boolean = false;
  isCurrent: boolean = true;
  observation: HardwareSnapshot = new HardwareSnapshot();
}
class HardwareHistoryResponse {
  schemaVersion: number = 0;
  simulated: boolean = true;
  historical: boolean = false;
  isCurrent: boolean = true;
  storage: HardwareHistoryStorage = new HardwareHistoryStorage();
  retainedInMemory: number = 0;
  items: HardwareHistoryItem[] = [];
}
export class HardwareHistoryReading {
  status: string = '';
  rows: string[] = [];
}
class AnalysisHistoryItem {
  seq: number = 0;
  hash: string = '';
  prompt: string = '';
  analysis: HardwareAnalysis = new HardwareAnalysis();
  recordedAt: number = 0;
  historical: boolean = false;
  isCurrent: boolean = true;
}
class AnalysisHistoryResponse {
  schemaVersion: number = 0;
  simulated: boolean = true;
  historical: boolean = false;
  isCurrent: boolean = true;
  storage: HardwareHistoryStorage = new HardwareHistoryStorage();
  items: AnalysisHistoryItem[] = [];
}
class ReportCapabilities {
  readEnvironment: boolean = false;
  actuate: boolean = false;
  co: boolean = false;
  co2: boolean = false;
}
class ReportCurrent {
  schemaVersion: number = 0;
  mode: string = '';
  simulated: boolean = true;
  gatewayNow: number = 0;
  hardware: HardwareSnapshot = new HardwareSnapshot();
  capabilities: ReportCapabilities = new ReportCapabilities();
  admission: string = '';
}
class ReportScope {
  observationLimit: number = 0;
  analysisLimit: number = 0;
  completeHistory: boolean = true;
}
class RealSessionReport {
  schemaVersion: number = 0;
  kind: string = '';
  mode: string = '';
  simulated: boolean = true;
  hardwareActuation: boolean = true;
  realAdmission: string = '';
  generatedAt: number = 0;
  current: ReportCurrent = new ReportCurrent();
  observationHistory: HardwareHistoryResponse = new HardwareHistoryResponse();
  analysisHistory: AnalysisHistoryResponse = new AnalysisHistoryResponse();
  scope: ReportScope = new ReportScope();
  limitations: string[] = [];
}

class WireValues {
  coPpm: number = 0;
  co2Ppm: number = 0;
  temperatureC: number = 0;
  humidityPct: number = 0;
  soilPct: number = 0;
  lightLux: number = 0;
}
class WireQuality { coValid: boolean = false; co2Valid: boolean = false; }
class WireState { emergency: boolean = false; fan: boolean = false; }
class WireFrame {
  simulated: boolean = false;
  deviceId: string = '';
  sampleAgeMs: number = 0;
  values: WireValues = new WireValues();
  quality: WireQuality = new WireQuality();
  state: WireState = new WireState();
}
class WireSnapshot {
  simulated: boolean = false;
  deviceOnline: boolean = false;
  receivedAt: number = 0;
  gatewayNow: number = 0;
  frame: WireFrame = new WireFrame();
}
export class GatewayReading {
  env: EnvSnapshot = new EnvSnapshot();
  fan: boolean = false;
}
export class GatewayAck {
  commandId: string = '';
  status: string = '';
  reason: string = '';
  simulated: boolean = false;
  deviceId: string = '';
}

// Only the simulation protocol is supported; real HH-HSP needs a separate adapter.
export class GatewayLink {
  async testModel(): Promise<ModelConnectionCheck> {
    const data = JSON.parse(await this.request('/api/agent/test', '{}')) as ModelConnectionCheck;
    if (!data || data.kind !== 'model_connection_check' || data.ok !== true ||
      (data.provider !== 'deepseek' && data.provider !== 'qwen') || typeof data.model !== 'string' || data.model.length === 0 || data.model.length > 150 ||
      !Number.isSafeInteger(data.checkedAt) || data.checkedAt <= 0 || !Number.isFinite(data.roundTripMs) || data.roundTripMs < 0 ||
      data.fieldDataSent !== false || data.imageSent !== false || data.executed !== false) throw new Error('模型测试协议无效');
    return data;
  }
  async readRealReport(): Promise<string> {
    const text = await this.request('/api/reports/latest');
    if (new util.TextEncoder().encodeInto(text).byteLength > 1048576) throw new Error('真实报告超过1MiB');
    const report = JSON.parse(text) as RealSessionReport;
    if (!report || report.schemaVersion !== 1 || report.kind !== 'pengan_real_session_report' || report.mode !== 'hardware' || report.simulated !== false || report.hardwareActuation !== false || report.realAdmission !== 'unknown_denied' || !Number.isSafeInteger(report.generatedAt) || report.generatedAt <= 0 || !report.scope || report.scope.observationLimit !== 50 || report.scope.analysisLimit !== 20 || report.scope.completeHistory !== false || !Array.isArray(report.limitations) || report.limitations.length > 20 || report.limitations.some((item: string) => typeof item !== 'string' || item.length > 1000)) throw new Error('真实报告协议无效');
    const current = report.current;
    if (!current || current.schemaVersion !== 1 || current.mode !== 'hardware' || current.simulated !== false || !Number.isSafeInteger(current.gatewayNow) || current.gatewayNow <= 0 || current.admission !== 'unknown_denied' || !current.capabilities || current.capabilities.readEnvironment !== true || current.capabilities.actuate !== false || current.capabilities.co !== false || current.capabilities.co2 !== false) throw new Error('真实报告当前来源无效');
    const h = current.hardware;
    if (!h || h.simulated !== false || h.deviceId !== 'hh-hsp101-001' || h.actuationAvailable !== false || typeof h.deviceOnline !== 'boolean' || !h.values || !h.quality || h.quality.coValid !== false || h.quality.co2Valid !== false) throw new Error('真实报告硬件来源无效');
    const q = h.quality, v = h.values;
    if (v.coPpm !== null || v.co2Ppm !== null || (!q.temperatureValid && v.temperatureC !== null) || (!q.humidityValid && v.humidityPct !== null) || (!q.gasValid && (v.gasRaw !== null || v.gasMv !== null))) throw new Error('真实报告缺失通道补值无效');
    if (typeof q.temperatureValid !== 'boolean' || typeof q.humidityValid !== 'boolean' || typeof q.gasValid !== 'boolean' || (h.receivedAt !== null && (!Number.isSafeInteger(h.receivedAt) || (h.receivedAt as number) <= 0))) throw new Error('真实报告采样质量无效');
    if (h.deviceOnline && h.receivedAt === null) throw new Error('真实报告缺少采样时间');
    if (!h.deviceOnline && (q.temperatureValid || q.humidityValid || q.gasValid || v.temperatureC !== null || v.humidityPct !== null || v.gasRaw !== null || v.gasMv !== null)) throw new Error('真实报告离线补值无效');
    if (q.temperatureValid && (!Number.isFinite(v.temperatureC) || (v.temperatureC as number) < -40 || (v.temperatureC as number) > 85)) throw new Error('真实报告温度无效');
    if (q.humidityValid && (!Number.isFinite(v.humidityPct) || (v.humidityPct as number) < 0 || (v.humidityPct as number) > 100)) throw new Error('真实报告湿度无效');
    if (q.gasValid && (!Number.isInteger(v.gasRaw) || (v.gasRaw as number) < 0 || (v.gasRaw as number) > 4095 || !Number.isFinite(v.gasMv) || (v.gasMv as number) < 0 || (v.gasMv as number) > 7200)) throw new Error('真实报告ADC无效');
    this.validateObservationHistory(report.observationHistory);
    this.validateAnalysisHistory(report.analysisHistory);
    return text;
  }
  async readAnalysisHistory(): Promise<HardwareHistoryReading> {
    const data = JSON.parse(await this.request('/api/agent/history?limit=20')) as AnalysisHistoryResponse;
    return this.validateAnalysisHistory(data);
  }
  private validateAnalysisHistory(data: AnalysisHistoryResponse): HardwareHistoryReading {
    if (!data || data.schemaVersion !== 1 || data.simulated !== false || data.historical !== true || data.isCurrent !== false || !data.storage || !Array.isArray(data.items) || data.items.length > 20) throw new Error('AI历史协议无效');
    const s = data.storage;
    if (typeof s.enabled !== 'boolean' || typeof s.healthy !== 'boolean' || !Number.isSafeInteger(s.records) || s.records < 0 || !Number.isSafeInteger(s.bytes) || s.bytes < 0 || !Number.isSafeInteger(s.maxBytes) || s.maxBytes < 0) throw new Error('AI历史存储状态无效');
    const result = new HardwareHistoryReading();
    result.status = (s.enabled ? '服务端文字分析存储' : '未启用持久存储') + ' · ' + (s.healthy ? '正常' : '写入或恢复异常') + ' · ' + s.records.toString() + ' 条 · ' + s.bytes.toString() + '/' + s.maxBytes.toString() + ' 字节';
    for (const item of data.items) {
      if (!item || !Number.isSafeInteger(item.seq) || item.seq <= 0 || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || typeof item.prompt !== 'string' || item.prompt.length > 1000 || !Number.isSafeInteger(item.recordedAt) || item.recordedAt <= 0 || item.historical !== true || item.isCurrent !== false) throw new Error('AI历史记录无效');
      const analysis = this.validateHardwareAnalysis(item.analysis);
      result.rows.push('#' + item.seq.toString() + ' · 保存 ' + new Date(item.recordedAt).toLocaleString() + '\n问题：' + item.prompt + '\n来源：' + analysis.provider + ' / ' + analysis.model + '\n采集依据：' + (analysis.observationReceivedAt === null ? '无有效现场读数' : new Date(analysis.observationReceivedAt).toLocaleString()) + '\n' + analysis.summary + '\n发现：' + analysis.findings.join('；') + '\n未知：' + analysis.unknowns.join('；') + '\n历史文字分析，不代表当前安全，不包含设备执行；图片不自动保存到此历史。');
    }
    return result;
  }
  async inspectImage(imageBase64: string): Promise<CropImageAnalysis> {
    if (imageBase64.length < 8 || imageBase64.length > 2796204 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) throw new Error('照片编码无效');
    const body: ImageAnalysisBody = { prompt: '请描述照片中可见作物现象、养护建议及不能确定的内容，不作病害确诊，不执行设备。', mimeType: 'image/jpeg', imageBase64: imageBase64 };
    const data = JSON.parse(await this.request('/api/agent/inspect-image', JSON.stringify(body))) as CropImageAnalysis;
    if (!data || data.mode !== 'hardware' || data.kind !== 'crop_image_analysis' || data.source !== 'user_photo' || data.simulated !== false || data.executed !== false || data.hardwareControl !== false || data.realAdmission !== 'unknown_denied' || !Array.isArray(data.steps) || data.steps.length !== 0 || typeof data.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.imageSha256) || !Number.isSafeInteger(data.analyzedAt) || data.analyzedAt <= 0 || typeof data.provider !== 'string' || typeof data.model !== 'string' || typeof data.summary !== 'string' || data.summary.length > 4000) throw new Error('照片分析协议无效');
    if (!Array.isArray(data.findings) || !Array.isArray(data.unknowns) || data.findings.length > 12 || data.unknowns.length > 12) throw new Error('照片分析条目无效');
    for (const item of data.findings.concat(data.unknowns)) { if (typeof item !== 'string' || item.length > 1000) throw new Error('照片分析条目无效'); }
    return data;
  }
  async readHardwareHistory(): Promise<HardwareHistoryReading> {
    const data = JSON.parse(await this.request('/api/hardware/history?limit=50')) as HardwareHistoryResponse;
    return this.validateObservationHistory(data);
  }
  private validateObservationHistory(data: HardwareHistoryResponse): HardwareHistoryReading {
    if (!data || data.schemaVersion !== 1 || data.simulated !== false || data.historical !== true || data.isCurrent !== false || !data.storage || !Array.isArray(data.items) || data.items.length > 50) throw new Error('历史采集协议无效');
    const storage = data.storage;
    if (typeof storage.enabled !== 'boolean' || typeof storage.healthy !== 'boolean' || !Number.isSafeInteger(storage.records) || storage.records < 0 || !Number.isSafeInteger(storage.bytes) || storage.bytes < 0 || !Number.isSafeInteger(storage.maxBytes) || storage.maxBytes < 0 || !Number.isSafeInteger(data.retainedInMemory) || data.retainedInMemory < 0) throw new Error('历史存储状态无效');
    const result = new HardwareHistoryReading();
    result.status = storage.enabled ? '服务端持久存储 · ' + (storage.healthy ? '状态正常' : '写入或恢复异常') + ' · 已记录 ' + storage.records.toString() + ' 条 · ' + storage.bytes.toString() + '/' + storage.maxBytes.toString() + ' 字节' : '真实历史存储未启用，没有已确认的持久记录';
    for (const item of data.items) {
      const h = item.observation;
      if (!Number.isSafeInteger(item.seq) || item.seq <= 0 || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || item.historical !== true || item.isCurrent !== false || !h || h.simulated !== false || h.deviceId !== 'hh-hsp101-001' || h.actuationAvailable !== false || typeof h.deviceOnline !== 'boolean' || !h.values || !h.quality) throw new Error('历史采集身份无效');
      const q = h.quality, v = h.values;
      if (!Number.isSafeInteger(h.receivedAt) || (h.receivedAt as number) <= 0 || q.coValid !== false || q.co2Valid !== false || typeof q.temperatureValid !== 'boolean' || typeof q.humidityValid !== 'boolean' || typeof q.gasValid !== 'boolean') throw new Error('历史采集质量无效');
      if (q.temperatureValid && (!Number.isFinite(v.temperatureC) || (v.temperatureC as number) < -40 || (v.temperatureC as number) > 85)) throw new Error('历史温度无效');
      if (q.humidityValid && (!Number.isFinite(v.humidityPct) || (v.humidityPct as number) < 0 || (v.humidityPct as number) > 100)) throw new Error('历史湿度无效');
      if (q.gasValid && (!Number.isInteger(v.gasRaw) || (v.gasRaw as number) < 0 || (v.gasRaw as number) > 4095 || !Number.isFinite(v.gasMv) || (v.gasMv as number) < 0 || (v.gasMv as number) > 7200)) throw new Error('历史ADC无效');
      result.rows.push('#' + item.seq.toString() + ' · 网关接收 ' + new Date(h.receivedAt as number).toLocaleString() + '\n温度：' + (q.temperatureValid ? v.temperatureC!.toString() + ' ℃' : '未知') + ' / 湿度：' + (q.humidityValid ? v.humidityPct!.toString() + ' %' : '未知') + '\nADC：' + (q.gasValid ? v.gasRaw!.toString() + ' counts / ' + v.gasMv!.toString() + ' mV' : '未知') + '\n历史记录，不代表当前环境；CO/CO₂未知，无执行回执');
    }
    return result;
  }
  async testHardware(): Promise<string> {
    const data = JSON.parse(await this.request('/api/health')) as GatewayHealth;
    if (!data || data.ok !== true || data.mode !== 'hardware' || data.simulated !== false || typeof data.hardwareConnected !== 'boolean') throw new Error('服务端不是正式数据模式');
    return data.hardwareConnected ? '真实服务可达，采集在线' : '真实服务可达，采集未连接或过期';
  }
  async analyze(prompt: string): Promise<HardwareAnalysis> {
    if (prompt.trim().length === 0 || prompt.length > 1000) throw new Error('请输入1至1000字的问题');
    const body: PromptBody = { prompt: prompt };
    const data = JSON.parse(await this.request('/api/agent/analyze', JSON.stringify(body))) as HardwareAnalysis;
    return this.validateHardwareAnalysis(data);
  }

  private validateHardwareAnalysis(data: HardwareAnalysis): HardwareAnalysis {
    if (!data || data.mode !== 'hardware' || data.simulated !== false || data.executed !== false ||
      data.hardwareControl !== false || data.realAdmission !== 'unknown_denied' || !Array.isArray(data.steps) || data.steps.length !== 0 ||
      typeof data.summary !== 'string' || data.summary.length > 4000 || typeof data.deviceOnline !== 'boolean' ||
      !Number.isFinite(data.analyzedAt) || data.analyzedAt <= 0 || typeof data.provider !== 'string' || typeof data.model !== 'string') throw new Error('真实分析协议无效');
    if (data.observationReceivedAt !== null && (!Number.isFinite(data.observationReceivedAt) || data.observationReceivedAt <= 0)) throw new Error('真实分析时间无效');
    if (data.deviceOnline && data.observationReceivedAt === null) throw new Error('真实分析缺少采样时间');
    if (!Array.isArray(data.findings) || !Array.isArray(data.unknowns) || data.findings.length > 12 || data.unknowns.length > 12) throw new Error('真实分析条目无效');
    for (const item of data.findings.concat(data.unknowns)) { if (typeof item !== 'string' || item.length > 1000) throw new Error('真实分析文字无效'); }
    if (data.toolTrace !== undefined) {
      if (!Array.isArray(data.toolTrace) || data.toolTrace.length > 12) throw new Error('真实分析工具记录无效');
      for (const trace of data.toolTrace) {
        if (!trace || (trace.tool !== 'read_environment' && trace.tool !== 'read_recent_history') || trace.readOnly !== true || !Number.isSafeInteger(trace.at) || trace.at <= 0 || typeof trace.resultSummary !== 'string' || trace.resultSummary.length > 1000) throw new Error('真实分析工具记录无效');
      }
    }
    if (data.persistence !== undefined) {
      const p = data.persistence;
      if (!p || typeof p.saved !== 'boolean' || (p.recordId !== undefined && (!Number.isSafeInteger(p.recordId) || p.recordId <= 0)) || (p.error !== undefined && (typeof p.error !== 'string' || !/^[a-z0-9_]{1,80}$/.test(p.error)))) throw new Error('真实分析保存状态无效');
    }
    return data;
  }
  private base: string = DEFAULT_GATEWAY;
  private revision: number = 0;
  private hardwareReceivedAt: number = -1;
  private hardwareFirstSeen: number = 0;

  configure(address: string): void {
    this.base = normalizeGatewayAddress(address);
    this.hardwareReceivedAt = -1;
    this.hardwareFirstSeen = 0;
    this.revision++;
  }

  invalidateSession(): void {
    this.revision++;
  }

  async testConnection(): Promise<string> {
    const health = JSON.parse(await this.request('/api/health')) as GatewayHealth;
    if (health.ok !== true || health.simulated !== true || health.hardwareConnected !== false || health.transport !== 'mqtt') {
      throw new Error('服务协议不匹配：此版本仅支持MQTT模拟网关');
    }
    return '服务可达 · MQTT模拟网关 · 未接真实执行器';
  }

  hardwareSampleAgeMs: number = -1;

  async readHardware(): Promise<string> {
    const started = Date.now();
    this.hardwareSampleAgeMs = -1;
    const data = JSON.parse(await this.request('/api/hardware')) as HardwareSnapshot;
    if (data.simulated !== false || data.deviceId !== 'hh-hsp101-001' || typeof data.deviceOnline !== 'boolean' ||
      data.actuationAvailable !== false || !data.values || !data.quality || data.quality.coValid !== false || data.quality.co2Valid !== false ||
      typeof data.quality.temperatureValid !== 'boolean' || typeof data.quality.humidityValid !== 'boolean' || typeof data.quality.gasValid !== 'boolean') {
      throw new Error('真实采集协议不匹配');
    }
    if (!data.deviceOnline) return 'HH-HSP101离线或样本过期；温湿度/ADC均未知，禁止真实准入';
    if (data.receivedAt === null || !Number.isFinite(data.receivedAt) || data.receivedAt <= 0) throw new Error('真实采样时间缺失');
    if (data.receivedAt !== this.hardwareReceivedAt) {
      this.hardwareReceivedAt = data.receivedAt;
      this.hardwareFirstSeen = Date.now();
    }
    const repeatedAge = Date.now() - this.hardwareFirstSeen;
    if (repeatedAge >= 10000) throw new Error('真实样本长时间未更新');
    const age = data.sampleAgeMs;
    if (age === null || !Number.isFinite(age) || age < 0 || age + Date.now() - started >= 10000) throw new Error('真实样本过期或年龄无效');
    const v = data.values;
    const q = data.quality;
    if ((v.temperatureC !== null && !Number.isFinite(v.temperatureC)) || (v.humidityPct !== null && !Number.isFinite(v.humidityPct)) ||
      (v.gasRaw !== null && !Number.isFinite(v.gasRaw)) || (v.gasMv !== null && !Number.isFinite(v.gasMv))) throw new Error('真实读数字段缺失');
    if ((q.temperatureValid && (v.temperatureC === null || !Number.isFinite(v.temperatureC) || v.temperatureC < -40 || v.temperatureC > 85)) ||
      (q.humidityValid && (v.humidityPct === null || !Number.isFinite(v.humidityPct) || v.humidityPct < 0 || v.humidityPct > 100)) ||
      (q.gasValid && (v.gasRaw === null || !Number.isInteger(v.gasRaw) || v.gasRaw < 0 || v.gasRaw > 4095 || v.gasMv === null || !Number.isFinite(v.gasMv) || v.gasMv < 0 || v.gasMv > 7200))) throw new Error('真实读数字段无效');
    if ((q.temperatureValid || q.humidityValid) && (data.climateAgeMs === null || !Number.isFinite(data.climateAgeMs) || data.climateAgeMs < 0 || data.climateAgeMs + Date.now() - started >= 10000)) throw new Error('温湿度样本过期');
    if (q.gasValid && (data.gasAgeMs === null || !Number.isFinite(data.gasAgeMs) || data.gasAgeMs < 0 || data.gasAgeMs + Date.now() - started >= 10000)) throw new Error('ADC样本过期');
    const temperature = q.temperatureValid && v.temperatureC !== null ? v.temperatureC.toFixed(1) + '℃' : '未知/质量无效';
    const humidity = q.humidityValid && v.humidityPct !== null ? v.humidityPct.toFixed(1) + '%' : '未知/质量无效';
    const gas = q.gasValid && v.gasRaw !== null && v.gasMv !== null ? v.gasRaw.toString() + ' / ' + v.gasMv.toString() + 'mV' : '未知/质量无效';
    this.hardwareSampleAgeMs = Math.max(age, q.temperatureValid || q.humidityValid ? data.climateAgeMs as number : age, q.gasValid ? data.gasAgeMs as number : age) + Date.now() - started;
    this.hardwareSampleAgeMs = Math.max(this.hardwareSampleAgeMs, repeatedAge);
    return 'HH-HSP101真实采集（只读）\n温度：' + temperature + ' / 湿度：' + humidity + '\nMQ-2原始ADC：' + gas + '\n样本年龄：' + (this.hardwareSampleAgeMs / 1000).toFixed(1) + '秒\nCO / CO₂缺失：禁止真实准入；未接真实执行器';
  }

  private async request(path: string, body: string = ''): Promise<string> {
    const revision = this.revision;
    let client: http.HttpRequest | undefined = undefined;
    try {
      client = http.createHttp();
      const response = await client.request(this.base + path, {
        method: body.length > 0 ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: { 'Content-Type': 'application/json' },
        extraData: body,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 3000,
        readTimeout: (path === '/api/agent/plan' || path === '/api/agent/analyze' || path === '/api/agent/inspect-image' ||
          path === '/api/agent/test' || path === '/api/agent/pipeline') ? 30000 : 6000
      });
      if (revision !== this.revision) throw new Error('连接配置已变化，忽略旧服务响应');
      if (response.responseCode !== 200 || typeof response.result !== 'string') {
        let message = '本地网关请求失败，HTTP ' + response.responseCode.toString();
        if (typeof response.result === 'string' && response.result.length < 4096) {
          try {
            const failure = JSON.parse(response.result) as GatewayFailure;
            if (failure.error === 'ai_not_configured') message = '请先在电脑网页的模型设置保存配置';
            else if (failure.error === 'ai_provider_http_401') message = '模型密钥校验失败，请检查电脑端配置';
            else if (failure.error === 'ai_provider_http_403') message = '模型账户没有当前调用权限';
            else if (failure.error === 'ai_provider_http_404') message = '模型或服务接口不存在，请检查配置';
            else if (failure.error === 'ai_provider_http_429') message = '模型服务限流，请稍后重试';
            else if (failure.error === 'ai_provider_http_400') message = '模型请求不被支持，请核对工具调用或图像能力';
            else if (failure.error === 'ai_analysis_timeout') message = '模型请求超时，未获得有效分析';
            else if (failure.error === 'ai_busy_try_later') message = '模型服务正在处理其他请求，请稍后再试';
            else if (failure.error === 'ai_connection_failed') message = '模型连接失败，请检查电脑网络和服务商配置';
            else if (failure.error === 'ai_missing_connection_tool' || failure.error === 'ai_invalid_tool_arguments') message = '未获得有效工具回执，请检查模型的工具调用能力';
            else if (failure.error === 'ai_invalid_json' || failure.error === 'ai_response_too_large') message = '模型返回格式异常，未获得有效分析';
            else if (failure.error === 'report_too_large') message = '报告超过1MiB限制，本次未导出';
          } catch (parseError) {}
        }
        throw new Error(message);
      }
      const responseLimit = path.startsWith('/api/agent/history?') ? 2097152 : path === '/api/reports/latest' ? 1048576 : 100000;
      if (response.result.length > responseLimit || (responseLimit > 100000 && new util.TextEncoder().encodeInto(response.result).byteLength > responseLimit)) throw new Error('网关响应过长');
      return response.result;
    } catch (error) {
      throw new Error('网关请求失败：' + (error as Error).message);
    } finally {
      if (client) client.destroy();
    }
  }

  async read(): Promise<GatewayReading> {
    const wire = JSON.parse(await this.request('/api/device')) as WireSnapshot;
    if (wire.simulated !== true || !wire.frame || wire.frame.simulated !== true || wire.frame.deviceId !== 'hsp-demo-001') throw new Error('设备模式或标识不匹配');
    const f = wire.frame;
    if (!f.values || !f.quality || !f.state || !Number.isFinite(f.sampleAgeMs) || f.sampleAgeMs < 0 ||
      !Number.isFinite(wire.receivedAt) || !Number.isFinite(wire.gatewayNow) || wire.gatewayNow < wire.receivedAt ||
      typeof wire.deviceOnline !== 'boolean' || typeof f.quality.coValid !== 'boolean' || typeof f.quality.co2Valid !== 'boolean' ||
      typeof f.state.emergency !== 'boolean' || typeof f.state.fan !== 'boolean' ||
      !Number.isFinite(f.values.coPpm) || !Number.isFinite(f.values.co2Ppm)) throw new Error('遥测字段无效');
    const result = new GatewayReading();
    result.env.co = f.quality.coValid ? f.values.coPpm : Number.NaN;
    result.env.co2 = f.quality.co2Valid ? f.values.co2Ppm : Number.NaN;
    result.env.temperature = f.values.temperatureC;
    result.env.humidity = f.values.humidityPct;
    result.env.soil = f.values.soilPct;
    result.env.light = f.values.lightLux;
    result.env.sampledAt = Date.now() - (wire.gatewayNow - wire.receivedAt + f.sampleAgeMs);
    result.env.sensorOnline = wire.deviceOnline === true;
    result.env.emergency = f.state.emergency === true;
    result.fan = f.state.fan === true;
    return result;
  }

  async command(action: string, maxRunMs: number = 20000): Promise<GatewayAck> {
    if (!['request_access', 'ventilate', 'stop_ventilation', 'query_environment'].includes(action)) throw new Error('工具不在允许清单中');
    const command: CommandBody = { action: action };
    if (action === 'ventilate') {
      if (!Number.isInteger(maxRunMs) || maxRunMs < 1000 || maxRunMs > 20000) throw new Error('运行时长无效');
      command.parameters = { maxRunMs: maxRunMs };
    }
    const ack = JSON.parse(await this.request('/api/command', JSON.stringify(command))) as GatewayAck;
    if (ack.simulated !== true || ack.deviceId !== 'hsp-demo-001' || !['executed', 'rejected', 'failed'].includes(ack.status) || typeof ack.commandId !== 'string') throw new Error('执行回执无效');
    return ack;
  }

  async scenario(name: string): Promise<void> {
    if (!['normal', 'co', 'co2', 'stale', 'emergency', 'clear_emergency', 'offline', 'online'].includes(name)) throw new Error('未知模拟场景');
    const scenario: ScenarioBody = { name: name };
    await this.request('/api/demo/scenario', JSON.stringify(scenario));
  }

  async modelStatus(): Promise<ModelStatus> {
    return JSON.parse(await this.request('/api/agent/status')) as ModelStatus;
  }

  async plan(prompt: string): Promise<ModelPlan> {
    if (prompt.trim().length === 0 || prompt.length > 1000) throw new Error('输入长度无效');
    const body: PromptBody = { prompt: prompt };
    const plan = JSON.parse(await this.request('/api/agent/plan', JSON.stringify(body))) as ModelPlan;
    if (plan.simulated !== true || plan.executed !== false || typeof plan.summary !== 'string' ||
      !Array.isArray(plan.steps) || plan.steps.length > 4) throw new Error('模型计划无效');
    for (const step of plan.steps) {
      if (!['query_environment', 'request_access', 'ventilate', 'stop_ventilation'].includes(step.action) ||
        typeof step.reason !== 'string') throw new Error('模型工具无效');
      if (step.action === 'ventilate' && (!Number.isInteger(step.maxRunMs) || step.maxRunMs < 1000 || step.maxRunMs > 20000)) throw new Error('模型运行时长无效');
    }
    return plan;
  }

  // 三阶段智能体管线（契约第 2、7 节）：POST /api/agent/pipeline，请求体只有 prompt。
  // 只读：不下发设备指令；失败必须以可见文案抛给界面，不能静默返回空结果。
  async pipeline(prompt: string): Promise<AgentPipelineResult> {
    if (prompt.trim().length === 0 || prompt.length > 2000) throw new Error('请输入1至2000字的意图');
    const body: PromptBody = { prompt: prompt };
    const text = await this.request('/api/agent/pipeline', JSON.stringify(body));
    let data: AgentPipelineResult = new AgentPipelineResult();
    try {
      data = JSON.parse(text) as AgentPipelineResult;
    } catch (error) {
      throw new Error('三阶段管线响应不是有效JSON，未获有效结果');
    }
    return this.validatePipeline(data);
  }

  validatePipeline(data: AgentPipelineResult): AgentPipelineResult {
    if (!data || data.kind !== 'agent_pipeline' || data.pipelineVersion !== 1) throw new Error('三阶段管线协议无效');
    if (typeof data.traceId !== 'string' || data.traceId.length === 0 || data.traceId.length > 120) throw new Error('三阶段管线追踪标识无效');
    if (!Number.isFinite(data.requestedAt) || data.requestedAt <= 0) throw new Error('三阶段管线时间无效');
    if (typeof data.prompt !== 'string' || data.prompt.length > 2000) throw new Error('三阶段管线意图回显无效');
    if (data.mode !== 'simulation' && data.mode !== 'hardware') throw new Error('三阶段管线模式无效');
    if (typeof data.provider !== 'string' || typeof data.model !== 'string') throw new Error('三阶段管线模型标识无效');
    if (!Number.isInteger(data.calls) || data.calls < 0 || data.calls > 3) throw new Error('三阶段管线调用次数无效');
    if (data.executed !== false || data.hardwareControl !== false) throw new Error('三阶段管线不得执行设备');
    if (!Array.isArray(data.stages) || data.stages.length !== 3) throw new Error('三阶段管线阶段必须恰好3条');
    const order: string[] = ['decision', 'generate', 'verify'];
    let failedStage: string = '';
    for (let index = 0; index < data.stages.length; index++) {
      const stage = data.stages[index];
      if (!stage || stage.stage !== order[index]) throw new Error('三阶段管线阶段顺序无效');
      if (stage.state !== 'passed' && stage.state !== 'blocked' && stage.state !== 'failed') throw new Error('三阶段管线阶段状态无效');
      if (!Number.isFinite(stage.startedAt) || !Number.isFinite(stage.finishedAt) || stage.startedAt < 0 || stage.finishedAt < 0 ||
        !Number.isFinite(stage.durationMs) || stage.durationMs < 0) throw new Error('三阶段管线阶段耗时无效');
      if (typeof stage.summary !== 'string' || stage.summary.length > 300) throw new Error('三阶段管线阶段摘要无效');
      if (stage.error !== null && (typeof stage.error !== 'string' || !/^[a-z0-9_]{1,60}$/.test(stage.error))) throw new Error('三阶段管线阶段错误码无效');
      if (stage.state === 'failed') failedStage = stage.stage;
    }
    const audit = data.audit;
    if (!audit) throw new Error('三阶段管线缺少审核结论');
    if (audit.verdict !== 'allow' && audit.verdict !== 'needs_human' && audit.verdict !== 'block') throw new Error('三阶段管线结论无效');
    if (!Array.isArray(audit.reasons) || audit.reasons.length > 6) throw new Error('三阶段管线理由无效');
    for (const reason of audit.reasons) {
      if (typeof reason !== 'string' || reason.length > 300) throw new Error('三阶段管线理由无效');
    }
    if (!Array.isArray(audit.ruleHits)) throw new Error('三阶段管线规则明细无效');
    for (const hit of audit.ruleHits) {
      const rule = hit as PipelineRuleHit;
      if (!rule || typeof rule.ruleId !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(rule.ruleId) ||
        typeof rule.passed !== 'boolean' || typeof rule.detail !== 'string' || rule.detail.length > 200) throw new Error('三阶段管线规则明细无效');
    }
    if (!Array.isArray(audit.missingEvidence) || audit.missingEvidence.length > 5) throw new Error('三阶段管线缺失依据无效');
    for (const item of audit.missingEvidence) {
      if (typeof item !== 'string' || item.length > 200) throw new Error('三阶段管线缺失依据无效');
    }
    if (!['allow', 'block', 'needs_human', 'unknown'].includes(audit.modelVerdict)) throw new Error('三阶段管线模型结论无效');
    if (audit.authoritative !== 'rules' && audit.authoritative !== 'model') throw new Error('三阶段管线结论来源无效');
    if (failedStage.length > 0 && audit.verdict === 'allow') throw new Error('三阶段管线阶段失败时不得直接放行');
    if (data.decision !== null) this.validatePipelineDecision(data.decision);
    if (data.plan !== null) this.validatePipelinePlan(data.plan);
    if (!data.memory || !Number.isInteger(data.memory.used) || data.memory.used < 0 || !Array.isArray(data.memory.sources) ||
      data.memory.sources.length > 20) throw new Error('三阶段管线记忆无效');
    for (const source of data.memory.sources) {
      if (typeof source !== 'string' || source.length > 120) throw new Error('三阶段管线记忆来源无效');
    }
    return data;
  }

  private validatePipelineDecision(decision: PipelineDecision): void {
    if (typeof decision.intent !== 'string' || decision.intent.length > 200) throw new Error('三阶段管线决策意图无效');
    if (typeof decision.situation !== 'string' || decision.situation.length > 500) throw new Error('三阶段管线决策判读无效');
    if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) throw new Error('三阶段管线置信度无效');
    if (!['low', 'medium', 'high'].includes(decision.riskLevel)) throw new Error('三阶段管线风险等级无效');
    if (!Array.isArray(decision.candidates) || decision.candidates.length > 4) throw new Error('三阶段管线候选动作无效');
    for (const item of decision.candidates) {
      const candidate = item as PipelineCandidate;
      if (!candidate || !['query_environment', 'request_access', 'ventilate', 'stop_ventilation'].includes(candidate.action) ||
        typeof candidate.reason !== 'string' || candidate.reason.length > 500 ||
        !['low', 'medium', 'high'].includes(candidate.riskLevel) || typeof candidate.requiresConfirmation !== 'boolean') {
        throw new Error('三阶段管线候选动作无效');
      }
      if (candidate.maxRunMs !== null && (!Number.isInteger(candidate.maxRunMs) || candidate.maxRunMs < 1000 || candidate.maxRunMs > 20000)) {
        throw new Error('三阶段管线候选运行时长无效');
      }
    }
    if (!Array.isArray(decision.openQuestions) || decision.openQuestions.length > 3) throw new Error('三阶段管线待确认问题无效');
    for (const question of decision.openQuestions) {
      if (typeof question !== 'string' || question.length > 300) throw new Error('三阶段管线待确认问题无效');
    }
  }

  private validatePipelinePlan(plan: PipelinePlan): void {
    if (typeof plan.summary !== 'string' || plan.summary.length > 2000) throw new Error('三阶段管线计划摘要无效');
    if (!Array.isArray(plan.steps) || plan.steps.length > 4) throw new Error('三阶段管线计划步骤无效');
    for (const item of plan.steps) {
      const step = item as PipelinePlanStep;
      if (!step || !['query_environment', 'request_access', 'ventilate', 'stop_ventilation'].includes(step.action) ||
        typeof step.reason !== 'string' || step.reason.length > 1000 || typeof step.requiresConfirmation !== 'boolean') {
        throw new Error('三阶段管线计划步骤无效');
      }
      if (step.processed !== false) throw new Error('三阶段管线计划步骤不得标记已处理');
      if (!Number.isInteger(step.maxRunMs) || step.maxRunMs < 1000 || step.maxRunMs > 20000) throw new Error('三阶段管线计划运行时长无效');
    }
    if (!Array.isArray(plan.evidence) || plan.evidence.length > 8) throw new Error('三阶段管线依据无效');
    for (const item of plan.evidence) {
      const evidence = item as PipelineEvidence;
      if (!evidence || typeof evidence.ref !== 'string' || evidence.ref.length === 0 || evidence.ref.length > 120 ||
        typeof evidence.fresh !== 'boolean') throw new Error('三阶段管线依据无效');
      const value = evidence.value;
      if (!(value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) throw new Error('三阶段管线依据取值无效');
      if (evidence.observedAt !== null && (!Number.isFinite(evidence.observedAt) || evidence.observedAt <= 0)) throw new Error('三阶段管线依据时间无效');
    }
  }
}
