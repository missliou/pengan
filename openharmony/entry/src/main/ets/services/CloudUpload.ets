import http from '@ohos.net.http';
import {NativeWeather,parseNativeWeather,weatherAdviceText} from './NativeWeather';
import {NativeCropInbox,parseCropInbox} from './NativeCropReviews';
import util from '@ohos.util';
import { normalizeGatewayAddress } from './ConnectionSettings';
import { HardwareAnalysis, PromptBody, CropImageAnalysis, AgentPipelineResult } from '../model/AgentModels';
import { GatewayLink } from './GatewayLink';
import { CloudHistoryReading, CloudRecentReport, readCloudHistory } from './CloudHistory';
import {CredentialVault} from './CredentialVault';

class PipelineReceipt { taskId: string = ''; gatewayId: string = ''; }
class WeatherQuestion { question: string = ''; }
class PipelineTask extends PipelineReceipt { status: string = ''; error: string = ''; result: AgentPipelineResult = new AgentPipelineResult(); }
class Receipt { schemaVersion: number = 0; accepted: boolean = false; duplicate: boolean = false; }
class ScopedAnalysis extends HardwareAnalysis { gatewayId: string = ''; sessionBootId: string = ''; }
class ScopedImageAnalysis extends CropImageAnalysis { gatewayId: string = ''; }
class ImageBody { prompt: string = '请描述照片中可见作物现象、养护建议及不能确定的内容，不作病害确诊，不执行设备。'; mimeType: string = 'image/jpeg'; imageBase64: string = ''; }
class MediaBody { category: string = ''; label: string = ''; capturedAt: number = 0; base64: string = ''; authorized: boolean = false; uploadId: string = ''; }
export class CloudMediaItem { mediaId: string = ''; gatewayId: string = ''; category: string = ''; label: string = ''; capturedAt: number = 0; bytes: number = 0; mime: string = ''; sha256: string = ''; }
class MediaReceipt { saved: boolean = false; item: CloudMediaItem = new CloudMediaItem(); }
export class CloudModelCheck { gatewayId: string = ''; kind: string = ''; ok: boolean = false; provider: string = ''; model: string = ''; checkedAt: number = 0; roundTripMs: number = 0; fieldDataSent: boolean = true; imageSent: boolean = true; executed: boolean = true; }
export class CloudSample { sessionBootId: string = ''; sampleAgeMs: number = -1; frameJson: string = ''; }
export class QueuedSample extends CloudSample { target: string = ''; capturedAt: number = 0; key: string = ''; }
class ReplayAck { sessionBootId: string = ''; uptimeMs: number = -1; seq: number = 0; }
class ReplayReceipt { schemaVersion: number = 0; gatewayId: string = ''; historical: boolean = false; isCurrent: boolean = true; accepted: ReplayAck[] = []; }
class FrameTime { uptime_ms: number = -1; }
class SpeechBody { wavBase64: string = ''; authorized: boolean = false; }
class SpeechStatus { gatewayId: string = ''; configured: boolean = false; engine: string = ''; externalProvider: boolean = true; }
class SpeechReceipt { gatewayId: string = ''; text: string = ''; engine: string = ''; requiresConfirmation: boolean = false; executed: boolean = true; }

// Plaintext token stays in memory. Optional CredentialVault persists HUKS ciphertext only.
export class CloudUpload {
  private base: string = '';
  private id: string = '';
  private token: string = '';
  private revision: number = 0;
  private busy: boolean = false;
  private pipelineRunning: boolean = false;
  configured(): boolean { return this.token.length > 0; }
  async readCropReviews(): Promise<NativeCropInbox> {
    return parseCropInbox(await this.request('/api/v1/device/crop-reviews','',5000,true),this.id);
  }
  queueTarget(): string { if(!this.configured())throw new Error('云端未配置');return this.base+'|'+this.id; }
  async protect(vault: CredentialVault): Promise<void> { if(!this.configured())throw new Error('请先启用会话');const revision=this.revision;await vault.save(this.base,this.id,this.token);if(revision!==this.revision)throw new Error('云端上下文已变化，保存的凭据需核对'); }
  async replay(rows: QueuedSample[]): Promise<void> {
    if(!rows.length||rows.length>10||rows.some((r: QueuedSample)=>r.target!==this.queueTarget()))throw new Error('补发目标不匹配');
    const items=rows.map((r: QueuedSample)=>'{"sessionBootId":'+JSON.stringify(r.sessionBootId)+',"capturedAt":'+r.capturedAt.toString()+',"sampleAgeMs":'+r.sampleAgeMs.toString()+',"frame":'+r.frameJson+'}');
    const receipt=JSON.parse(await this.request('/api/v1/telemetry/replay','{"items":['+items.join(',')+']}')) as ReplayReceipt;
    if(receipt.schemaVersion!==1||receipt.gatewayId!==this.id||receipt.historical!==true||receipt.isCurrent!==false||!Array.isArray(receipt.accepted)||receipt.accepted.length!==rows.length)throw new Error('历史补发回执无效');
    for(let i=0;i<rows.length;i++){const ack=receipt.accepted[i],frame=JSON.parse(rows[i].frameJson) as FrameTime;
      if(ack.sessionBootId!==rows[i].sessionBootId||ack.uptimeMs!==frame.uptime_ms||!Number.isSafeInteger(ack.seq)||ack.seq<1)throw new Error('补发回执样本不匹配');}
  }
  async checkSpeech(): Promise<void> { const status=JSON.parse(await this.request('/api/v1/device/speech/status','',3000,true)) as SpeechStatus; if(status.gatewayId!==this.id||status.configured!==true||status.engine!=='whisper.cpp-local'||status.externalProvider!==false)throw new Error('服务端尚未配置本地语音识别，未开始录音'); }
  async transcribe(wavBase64: string): Promise<string> {
    if(!wavBase64||wavBase64.length>430000)throw new Error('语音大小无效');
    const body: SpeechBody={wavBase64:wavBase64,authorized:true};
    const receipt=JSON.parse(await this.request('/api/v1/device/speech',JSON.stringify(body),35000)) as SpeechReceipt;
    if(receipt.gatewayId!==this.id||receipt.engine!=='whisper.cpp-local'||receipt.executed!==false||receipt.requiresConfirmation!==true||typeof receipt.text!=='string'||!receipt.text.trim()||receipt.text.length>1000)throw new Error('语音转写回执无效');
    return receipt.text.trim();
  }
  configure(base: string, id: string, token: string): void {
    const checked = normalizeGatewayAddress(base);
    if (!checked.startsWith('https://')) throw new Error('设备令牌只允许发送到HTTPS云端');
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('云端登记ID或设备令牌格式无效');
    this.base = checked; this.id = id; this.token = token; this.revision++;
  }
  invalidate(): void { this.revision++; }
  async savePhoto(base64: string, category: string, label: string, capturedAt: number, authorized: boolean, uploadId: string): Promise<CloudMediaItem> {
    if (!authorized || (category !== 'crop' && category !== 'person')) throw new Error('请确认照片分类及保存授权');
    if (!label.trim() || label.trim().length > 120 || !Number.isSafeInteger(capturedAt) || capturedAt <= 0 || capturedAt > Date.now() + 300000) throw new Error('照片说明或拍摄时间无效');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(uploadId)) throw new Error('照片上传标识无效');
    if (!base64 || base64.length > 2796204 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('照片编码无效或超过2MiB');
    const body: MediaBody = { category: category, label: label.trim(), capturedAt: capturedAt, base64: base64, authorized: true, uploadId: uploadId };
    const receipt = JSON.parse(await this.request('/api/v1/device/media', JSON.stringify(body), 35000, false, 201)) as MediaReceipt;
    const item = receipt.item;
    if (receipt.saved !== true || !item || item.gatewayId !== this.id || item.category !== category || item.label !== label.trim() || item.capturedAt !== capturedAt ||
      typeof item.mediaId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.mediaId) ||
      item.mime !== 'image/jpeg' || !Number.isSafeInteger(item.bytes) || item.bytes < 32 || item.bytes > 2097152 || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('照片保存回执协议无效');
    return item;
  }
  clear(): void { this.invalidate(); this.token = ''; this.id = ''; this.base = ''; }
  async readWeather(): Promise<NativeWeather> {
    return parseNativeWeather(await this.request('/api/v1/device/weather','',10000,true),this.id);
  }
  async generateWeatherAdvice(question: string): Promise<string> {
    if (question.length > 500) throw new Error('天气问题最多500字');
    const body: WeatherQuestion = {question:question};
    return weatherAdviceText(await this.request('/api/v1/device/weather/advice',JSON.stringify(body),35000),this.id);
  }
  private async request(path: string, body: string, timeout: number = 3000, get: boolean = false, expectedStatus: number = 200, responseLimit: number = 65536): Promise<string> {
    if (!this.configured()) throw new Error('设备云端会话未配置');
    if (this.busy) throw new Error('云端请求仍在进行');
    this.busy = true; const revision = this.revision; const started = Date.now();
    let client: http.HttpRequest | undefined = undefined;
    try {
      client = http.createHttp();
      const response = await client.request(this.base + path, {
        method: get ? http.RequestMethod.GET : http.RequestMethod.POST, header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token,
          'X-Pengan-Gateway-Id': this.id, 'X-Pengan-Sent-At': started.toString() },
        extraData: get ? undefined : body, expectDataType: http.HttpDataType.STRING, connectTimeout: 3000, readTimeout: timeout,
        maxRedirects: 0, maxLimit: responseLimit
      });
      if (revision !== this.revision) throw new Error('云端上下文已变化，旧结果作废');
      if (Date.now() < started || Date.now() - started >= timeout) throw new Error('云端请求超时，结果未确认');
      if (response.responseCode !== expectedStatus || typeof response.result !== 'string') throw new Error('云端请求未确认，请检查认证或服务状态');
      if (new util.TextEncoder().encodeInto(response.result).byteLength > responseLimit) throw new Error('云端响应超过限制');
      return response.result;
    } finally { try { if (client) client.destroy(); } finally { this.busy = false; } }
  }
  async pipeline(prompt: string): Promise<AgentPipelineResult> {
    if (!prompt.trim() || prompt.length > 2000) throw new Error('请输入1至2000字的意图');
    if (this.pipelineRunning) throw new Error('三阶段任务仍在进行');
    this.pipelineRunning = true;
    const started = Date.now(), revision = this.revision, id = this.id;
    try {
      const body: PromptBody = { prompt: prompt.trim() };
      const receipt = JSON.parse(await this.request('/api/v1/device/pipeline', JSON.stringify(body), 3000, false, 202)) as PipelineReceipt;
      if (!receipt || receipt.gatewayId !== id || typeof receipt.taskId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(receipt.taskId)) throw new Error('设备三阶段启动回执无效');
      while (true) {
        const elapsed = Date.now() - started;
        if (revision !== this.revision) throw new Error('云端上下文已变化，三阶段结果作废');
        if (elapsed < 0 || elapsed >= 45000) throw new Error('三阶段轮询超时；服务端任务结果未确认，可在Web查看');
        const task = JSON.parse(await this.request('/api/v1/device/pipeline/tasks/' + receipt.taskId, '', Math.min(3000, 45000 - elapsed), true, 200, 262144)) as PipelineTask;
        if (revision !== this.revision || Date.now() < started || Date.now() - started >= 45000) throw new Error('三阶段结果上下文或预算已失效');
        if (!task || task.taskId !== receipt.taskId || task.gatewayId !== id) throw new Error('三阶段任务设备身份不符');
        if (task.status === 'failed') throw new Error('服务端三阶段任务失败，请在Web查看审计与失败状态');
        if (task.status === 'completed') {
          const result = task.result;
          if (!result || result.mode !== 'hardware') throw new Error('设备三阶段响应模式无效');
          if (result.calls === 0) { if (result.provider === null) result.provider = ''; if (result.model === null) result.model = ''; }
          if ((result.provider !== '' && result.provider !== 'deepseek' && result.provider !== 'qwen') || typeof result.model !== 'string' || result.model.length > 150 || (result.calls > 0 && (!result.provider || !result.model))) throw new Error('设备三阶段模型标识无效');
          return new GatewayLink().validatePipeline(result);
        }
        if (task.status !== 'running') throw new Error('三阶段任务状态无效');
        await new Promise<void>((resolve) => { setTimeout(resolve, Math.min(500, Math.max(1, 45000 - (Date.now() - started)))); });
      }
    } finally { this.pipelineRunning = false; }
  }
  async readHistory(kind: string): Promise<CloudHistoryReading> {
    if (kind !== 'telemetry' && kind !== 'analysis') throw new Error('历史类别无效');
    const revision = this.revision, id = this.id;
    const text = await this.request('/api/v1/device/history?kind=' + kind + '&limit=10', '', 3000, true);
    if (revision !== this.revision) throw new Error('云端上下文已变化，历史作废');
    return readCloudHistory(text, id, kind);
  }
  async readRecentReport(): Promise<string> {
    const revision = this.revision, report = new CloudRecentReport(); report.gatewayId = this.id;
    report.telemetry = await this.readHistory('telemetry');
    if (revision !== this.revision) throw new Error('报告上下文已变化');
    report.analysis = await this.readHistory('analysis');
    if (revision !== this.revision) throw new Error('报告上下文已变化');
    report.generatedAt = Date.now(); return JSON.stringify(report);
  }
  async upload(sample: CloudSample): Promise<string> {
    if (!Number.isSafeInteger(sample.sampleAgeMs) || sample.sampleAgeMs < 0 || sample.sampleAgeMs >= 8000 || !/^[A-Za-z0-9_.:-]{1,80}$/.test(sample.sessionBootId) || sample.frameJson.length === 0) throw new Error('无新鲜有效的直采帧可上传');
    const body = '{"schemaVersion":1,"gatewayId":' + JSON.stringify(this.id) + ',"sessionBootId":' + JSON.stringify(sample.sessionBootId) + ',"sampleAgeMs":' + sample.sampleAgeMs.toString() + ',"frame":' + sample.frameJson + '}';
    if (new util.TextEncoder().encodeInto(body).byteLength > 4096) throw new Error('上报体超过限制');
    const receipt = JSON.parse(await this.request('/api/v1/telemetry/current', body)) as Receipt;
    if (!receipt || receipt.schemaVersion !== 1 || typeof receipt.accepted !== 'boolean' || typeof receipt.duplicate !== 'boolean' || receipt.accepted === receipt.duplicate) throw new Error('上报回执无效，结果未确认');
    return receipt.accepted ? '云端已确认接收本次帧' : '云端确认重复帧，未更新原失效时间';
  }
  async analyze(prompt: string, expectedSession: string = ''): Promise<HardwareAnalysis> {
    if (prompt.trim().length === 0 || prompt.length > 1000) throw new Error('请输入1至1000字问题');
    const body: PromptBody = { prompt: prompt.trim() };
    const result = JSON.parse(await this.request('/api/v1/device/analyze', JSON.stringify(body), 35000)) as ScopedAnalysis;
    if (!result || result.gatewayId !== this.id || result.mode !== 'hardware' || result.simulated !== false || result.executed !== false || result.hardwareControl !== false || result.realAdmission !== 'unknown_denied' || typeof result.summary !== 'string' || result.summary.length > 2000 || !Array.isArray(result.findings) || !Array.isArray(result.unknowns) || !result.findings.every((v: string) => typeof v === 'string') || !result.unknowns.every((v: string) => typeof v === 'string') || (result.provider !== 'deepseek' && result.provider !== 'qwen') || typeof result.model !== 'string' || typeof result.deviceOnline !== 'boolean') throw new Error('设备隔离分析协议无效');
    if (result.findings.length > 10 || result.unknowns.length > 12 || !result.findings.concat(result.unknowns).every((v: string) => v.length <= 1000)) throw new Error('分析条目超过限制');
    if (result.deviceOnline && (expectedSession.length === 0 || result.sessionBootId !== expectedSession)) throw new Error('云端观测会话与本地直采不符，未显示分析');
    return result;
  }
  async testModel(): Promise<CloudModelCheck> {
    const result = JSON.parse(await this.request('/api/v1/device/test', '{}', 35000)) as CloudModelCheck;
    if (!result || result.gatewayId !== this.id || result.kind !== 'model_connection_check' || result.ok !== true ||
      (result.provider !== 'deepseek' && result.provider !== 'qwen') || typeof result.model !== 'string' || result.model.length === 0 || result.model.length > 150 ||
      !Number.isSafeInteger(result.checkedAt) || result.checkedAt <= 0 || !Number.isFinite(result.roundTripMs) || result.roundTripMs < 0 ||
      result.fieldDataSent !== false || result.imageSent !== false || result.executed !== false) throw new Error('云端模型测试协议无效');
    return result;
  }
  async inspectImage(imageBase64: string): Promise<CropImageAnalysis> {
    if (imageBase64.length < 8 || imageBase64.length > 2796204 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) throw new Error('照片编码无效');
    const body = new ImageBody(); body.imageBase64 = imageBase64;
    const result = JSON.parse(await this.request('/api/v1/device/inspect-image', JSON.stringify(body), 35000)) as ScopedImageAnalysis;
    if (!result || result.gatewayId !== this.id || result.mode !== 'hardware' || result.kind !== 'crop_image_analysis' || result.source !== 'user_photo' ||
      result.simulated !== false || result.executed !== false || result.hardwareControl !== false || result.realAdmission !== 'unknown_denied' ||
      !Array.isArray(result.steps) || result.steps.length !== 0 || typeof result.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.imageSha256) ||
      !Number.isSafeInteger(result.analyzedAt) || result.analyzedAt <= 0 || (result.provider !== 'deepseek' && result.provider !== 'qwen') ||
      typeof result.model !== 'string' || result.model.length === 0 || result.model.length > 150 || typeof result.summary !== 'string' || result.summary.length > 4000 ||
      !Array.isArray(result.findings) || !Array.isArray(result.unknowns) || result.findings.length > 12 || result.unknowns.length > 12 ||
      !result.findings.concat(result.unknowns).every((v: string) => typeof v === 'string' && v.length <= 1000)) throw new Error('云端照片分析协议无效');
    return result;
  }
}
