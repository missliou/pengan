import {OfflineQueue} from '../services/OfflineQueue';
import {CredentialVault} from '../services/CredentialVault';
import {NativeSpeechInput} from '../services/NativeSpeechInput';
import {GreenhouseMotionImage, NativeBusyIndicator} from '../services/NativeMotion';
import {NativeCropReview,cropReviewLabel} from '../services/NativeCropReviews';
import {NativeWeather,WeatherRisk,relayWeather} from '../services/NativeWeather';
import { EnvSnapshot, EventRecord, ChatMessage } from '../model/Models';
import { SafetyEngine } from '../services/SafetyEngine';
import { DemoDevice } from '../services/DemoDevice';
import common from '@ohos.app.ability.common';
import { NativeAuditStore, AuditRecord } from '../services/NativeAuditStore';
import { GatewayLink } from '../services/GatewayLink';
import { ModelPlan, ModelPlanStep, AnalysisToolTrace, AgentPipelineResult } from '../model/AgentModels';
import { AgentPipelineView, PipelineStageCard, PipelineVerdictBadge } from '../services/AgentPipelineView';
import { NativePhotoUpload } from '../services/NativePhotoUpload';
import { NativeCamera } from '../services/NativeCamera';
import { TaskRecord, TaskStep, StepState } from '../model/TaskModels';
import { TaskFlow } from '../services/TaskFlow';
import { NativeVoiceAlert } from '../services/NativeVoiceAlert';
import { NativeDocumentExport } from '../services/NativeDocumentExport';
import deviceInfo from '@ohos.deviceInfo';
import { COMPILE_API, COMPILE_SDK } from '../model/AppBuildInfo';
import { ConnectionSettings, DEFAULT_GATEWAY } from '../services/ConnectionSettings';
import { DirectConnectionSettings, DirectConnectionConfig } from '../services/DirectConnectionSettings';
import { DirectHardwareView } from '../services/DirectHardwareView';
import { CloudUpload, CloudSample } from '../services/CloudUpload';

@Entry
@Component
struct Index {
  @State currentPage: number = 0;
  @State demoMode: boolean = false;
  // onAreaChange reports logical vp; 720px panels can expose much less than 720vp.
  @State compactLayout: boolean = true;
  @State motionEnabled: boolean = true;
  @State pressedShortcut: number = -1;
  @State cropViewMode: number = 0;
  @State cropReviewFilter: string = 'all';
  @State cropReviewItems: NativeCropReview[] = [];
  @State cropReviewBusy: boolean = false;
  @State cropReviewStatus: string = '尚未读取人工复核；记录不代表当前作物健康';
  private cropReviewEpoch: number = 0;
  @State agentViewMode: number = 0;
  @State selectedAgricultureScene: number = 0;
  @State weatherData: NativeWeather = new NativeWeather();
  @State weatherBusy: boolean = false;
  @State weatherStatus: string = '尚未读取天气；当前风险未知';
  @State weatherQuestion: string = '';
  @State weatherAdvice: string = '';
  private weatherEpoch: number = 0;
  private weatherTimer: number = -1;
  @State env: EnvSnapshot = new EnvSnapshot();
  @State fan: boolean = false;
  @State cloud: boolean = true;
  @State consoleOpen: boolean = false;
  @State events: EventRecord[] = [];
  @State messages: ChatMessage[] = [];
  @State input: string = '';
  @State feedback: string = '等待操作';
  @State showReport: boolean = false;
  @State auditRows: AuditRecord[] = [];
  @State auditStatus: string = '正在打开本地台账';
  @State remoteMode: boolean = false;
  @State gatewayAddress: string = DEFAULT_GATEWAY;
  @State savedGatewayAddress: string = DEFAULT_GATEWAY;
  @State connectionStatus: string = '连接配置正在载入';
  @State modelCheckBusy: boolean = false;
  @State modelCheckStatus: string = '尚未发送模型测试问题';
  private modelCheckEpoch: number = 0;
  @State hardwareStatus: string = 'HH-HSP101真实采集尚未读取';
  @State hardwareSource: string = 'direct';
  @State hardwareSourceDraft: string = 'direct';
  @State boardIp: string = '';
  @State savedBoardIp: string = '';
  @State directSettingsReady: boolean = false;
  @State directSettingsBusy: boolean = false;
  @State directSettingsStatus: string = '正在读取采集来源配置';
  private directSettings: DirectConnectionSettings = new DirectConnectionSettings();
  private directHardware: DirectHardwareView = new DirectHardwareView();
  private cloudUpload: CloudUpload = new CloudUpload();
  private lastUploadAttempt: string = '';
  private offlineQueue: OfflineQueue = new OfflineQueue();
  private credentialVault: CredentialVault = new CredentialVault();
  private speechInput: NativeSpeechInput = new NativeSpeechInput();
  private queueReady: boolean = false;
  private lastReplayAt: number = 0;
  private replayBusy: boolean = false;
  private speechEpoch: number = 0;
  @State queueStatus: string = '离线队列正在载入';
  @State credentialStatus: string = '凭据当前仅驻留内存；可选HUKS安全保存';
  @State speechStatus: string = '语音只回填文字，确认后再发送';
  @State speechBusy: boolean = false;
  @State cloudGatewayId: string = '';
  @State cloudTokenInput: string = '';
  @State cloudUploadStatus: string = '尚未启用设备云端会话';
  @State cloudSessionReady: boolean = false;
  @State analysisHistoryRows: string[] = [];
  @State analysisHistoryStatus: string = '尚未读取AI文字分析历史';
  @State analysisHistoryBusy: boolean = false;
  private analysisHistoryEpoch: number = 0;
  @State realReportBusy: boolean = false;
  @State realReportStatus: string = '设备云端报告每类最近10条；临时网关50/20条。均非全量；历史不是当前，不含照片。';
  private realReportEpoch: number = 0;
  @State historyRows: string[] = [];
  @State historyStatus: string = '尚未读取真实采集历史';
  @State historyBusy: boolean = false;
  private historyEpoch: number = 0;
  @State hardwareBusy: boolean = false;
  @State hardwareRefreshTime: string = '尚未刷新';
  private hardwareEpoch: number = 0;
  private hardwareVisible: boolean = true;
  private hardwareValidUntil: number = 0;
  private hardwarePollAt: number = 0;
  private hardwareTransportBusy: boolean = false;
  private hardwareTimer: number = -1;
  @State settingsReady: boolean = false;
  @State settingsBusy: boolean = false;
  private connectionSettings: ConnectionSettings = new ConnectionSettings();
  @State modelMode: boolean = false;
  @State modelBusy: boolean = false;
  @State modelPlan: ModelPlan = new ModelPlan();
  @State cameraEnabled: boolean = false;
  @State cameraBusy: boolean = false;
  @State cameraStatus: string = '尚未启用真实摄像头';
  @State photoPath: string = '';
  @State photoCategory: string = 'crop';
  @State photoDescription: string = '';
  @State photoAuthorized: boolean = false;
  @State photoCapturedAt: number = 0;
  @State photoUploadBusy: boolean = false;
  @State photoUploadStatus: string = '照片尚未保存到图片库';
  @State photoSavedPath: string = '';
  @State imageAnalysisText: string = '';
  @State imageAnalysisBusy: boolean = false;
  private imageAnalysisEpoch: number = 0;
  private cameraService: NativeCamera = new NativeCamera();
  private cameraController: XComponentController = new XComponentController();
  @State taskRecords: TaskRecord[] = [];
  private nextTaskId: number = 1;
  private activeVentTask: number = -1;
  @State soundEnabled: boolean = true;
  @State voiceStatus: string = '本地演示告警语音已启用';
  private voiceAlert: NativeVoiceAlert = new NativeVoiceAlert();
  private gateway: GatewayLink = new GatewayLink();
  private gatewayBusy: boolean = false;
  private connectionEpoch: number = 0;
  private auditStore: NativeAuditStore = new NativeAuditStore();
  private auditReady: Promise<void> = Promise.resolve();
  private device: DemoDevice = new DemoDevice();
  private timerId: number = -1;
  private titles: string[] = ['环境态势', '智能助手', '任务中心', '作物巡查', '操作台账', '设备诊断', '功能中心', '天气与预警'];
  private agricultureScenes: string[] = ['智慧农业问答', '环境分析', '农事建议', '巡检报告'];
  private agriculturePrompts: string[] = [
    '请结合已知观测与知识资料回答本次种植问题，并明确哪些信息还需要我补充。',
    '请分析当前环境观测、采样时效和缺失通道，区分已知事实、风险与待核查事项。',
    '请结合当前采集提出农事养护建议，列出依据、适用条件和需要人工确认的事项，不执行设备。',
    '请整理本次巡检报告：已知观测、缺失数据、作物人工复核注意事项和下一步检查清单；不要编造现场事实。'
  ];
  @State pipelineInput: string = '';
  @State pipelineBusy: boolean = false;
  @State pipelineStatus: string = '三阶段管线尚未运行';
  @State pipelineError: string = '';
  @State pipelineStageCards: PipelineStageCard[] = [];
  @State pipelineBadge: PipelineVerdictBadge = new PipelineVerdictBadge();
  @State pipelineDetailRows: string[] = [];

  aboutToAppear(): void {
    this.hardwareVisible = true;
    Promise.resolve().then(() => this.offlineQueue.open(this.requireAbilityContext())).then(() => { this.queueReady = true; this.queueStatus = '本地待发 '+this.offlineQueue.count().toString()+' 条'; }).catch(() => { this.queueStatus = '离线队列不可用，原数据保留'; });
    Promise.resolve().then(() => this.credentialVault.open(this.requireAbilityContext())).catch(() => { this.credentialStatus = '凭据保护不可用，仅使用内存会话'; });
    this.hardwareTimer = setInterval(() => {
      if (!this.hardwareVisible || (this.currentPage !== 0 && this.currentPage !== 5)) return;
      if (!this.demoMode && this.hardwareSource === 'direct' && this.directSettingsReady) {
        this.hardwareStatus = this.directHardware.read().text;
      }
      if (this.hardwareValidUntil > 0 && Date.now() >= this.hardwareValidUntil) {
        this.hardwareStatus = '真实样本已过期，温湿度/ADC均未知；禁止真实准入';
        this.hardwareValidUntil = 0;
      }
      if (Date.now() - this.hardwarePollAt >= 2000) this.pollHardware();
      if (!this.demoMode && this.cloudUpload.configured() && Date.now()-this.lastReplayAt>=10000) this.replayPending();
    }, 1000);
    Promise.resolve().then(() => this.directSettings.open(this.requireAbilityContext())).then((config: DirectConnectionConfig) => {
      this.invalidateConnection(); this.resetHardware('采集配置已载入');
      this.hardwareSource = config.mode; this.hardwareSourceDraft = config.mode;
      this.boardIp = config.boardIp; this.savedBoardIp = config.boardIp;
      this.directHardware.configure(config.boardIp); this.directSettingsReady = true;
      this.directSettingsStatus = '配置已载入；' + (config.mode === 'direct' ? 'DAYU200直接读取采集板，未上传云端' : '电脑临时网关采集，非正式端云链路');
      this.pollHardware();
    }).catch((error: Error) => { this.directSettingsReady = false; this.directSettingsStatus = error.message; });
    Promise.resolve().then(() => this.connectionSettings.open(this.requireAbilityContext())).then((address: string) => {
      this.resetHardware('服务地址已变化，等待读取真实采集');
      this.gateway.configure(address);
      this.gatewayAddress = address;
      this.savedGatewayAddress = address;
      this.settingsReady = true;
      this.connectionStatus = '已载入配置，尚未测试连接';
    }).catch(() => { this.settingsReady = false; this.connectionStatus = '配置未载入：上下文或存储不可用，请返回前台重试或重启应用'; });
    this.auditReady = Promise.resolve().then(() => this.auditStore.open(this.requireAbilityContext()));
    this.auditReady.then(() => {
      this.auditRows = this.auditStore.rows.slice().reverse();
      this.auditStatus = '本地台账已载入并校验';
    }).catch(() => { this.auditStatus = '台账打开或校验失败（上下文/存储不可用），保留原数据等待检查'; });
    this.env = this.device.snapshot();
    // Real mode does not append simulated snapshots to the audit.
    if (this.demoMode) this.addEvent('演示启动', '模拟设备就绪', '演示');
    this.timerId = setInterval(() => {
      if (!this.demoMode) return;
      if (this.remoteMode) {
        this.pollGateway();
        return;
      }
      this.device.tick();
      this.env = this.device.snapshot();
      if (this.device.fan) {
        const result = SafetyEngine.check(this.env);
        if (result.allowed) {
          this.device.stopFan();
          this.addEvent('通风复测完成', '模拟回采低于阈值，停止风机；不会自动开门', '规则引擎');
          this.settleVentTask('回采低于演示阈值，模拟风机已停止；未自动开门', true);
        } else if (Date.now() - this.device.fanStartedAt >= 20000) {
          this.device.stopFan();
          this.addEvent('通风超时停止', '超过 20 秒演示上限，转人工检查', '规则引擎', true);
          this.settleVentTask('超时停止，转人工检查', false);
        }
      }
      this.fan = this.device.fan;
    }, 2000);
  }

  onPageHide(): void {
    this.hardwareVisible = false;
    this.invalidateConnection();
    this.resetHardware('应用处于后台，真实采集未确认');
  }

  onPageShow(): void {
    this.hardwareVisible = true;
    this.pollHardware();
  }

  aboutToDisappear(): void {
    this.hardwareVisible = false;
    clearInterval(this.hardwareTimer);
    this.resetHardware('页面已关闭，真实采集未确认');
    this.invalidateConnection();
    this.remoteMode = false;
    clearInterval(this.timerId);
    this.device.stopFan();
    this.cameraService.stop();
    this.voiceAlert.stop();
  }

  private addEvent(title: string, detail: string, source: string, blocked: boolean = false): void {
    // This historical audit schema embeds a simulated EnvSnapshot. Real mode
    // must not append an actual event together with fabricated sensor values.
    if (!this.demoMode) return;
    const row = new EventRecord(this.events.length + 1, title, detail, source, blocked);
    this.events = [row, ...this.events];
    this.feedback = detail;
    const captured = this.remoteMode ? this.env : this.device.snapshot();
    this.auditReady.then(() => this.auditStore.append(row, captured)).then(() => {
      this.auditRows = this.auditStore.rows.slice().reverse();
      this.auditStatus = '已保存 ' + this.auditRows.length.toString() + ' 条本地记录';
    }).catch(() => { this.auditStatus = '台账写入失败；当前操作记录仅在内存中，请检查存储'; });
  }

  private access(source: string): string {
    if (!this.demoMode) return 'CO/CO₂未接入，真实准入未知／拒止';
    if (this.remoteMode) {
      this.sendGatewayCommand('request_access', source);
      return '已发送 MQTT 模拟准入请求，等待设备回执；结果查看任务中心。';
    }
    const taskId = this.createTask('入棚申请', source);
    this.taskStep(taskId, '读取环境快照', `CO ${this.env.co} ppm / CO₂ ${this.env.co2} ppm`, 'done');
    const result = SafetyEngine.check(this.device.snapshot());
    const detail = result.allowed ? '模拟环境条件通过；身份认证与真实门锁未接入' : '拒止：' + result.reasons.join('；');
    this.addEvent('入棚申请', detail, source, !result.allowed);
    this.taskStep(taskId, '本地安全规则核验', detail, result.allowed ? 'done' : 'blocked');
    if (!result.allowed) this.announceAlert();
    if (result.allowed) this.taskStep(taskId, '模拟准入回执', '身份认证与真实门锁待接入，没有实际开锁', 'done');
    return detail;
  }

  private ventilate(source: string): string {
    if (!this.demoMode) return '没有真实执行器，不能启动通风';
    if (this.remoteMode) {
      this.sendGatewayCommand('ventilate', source);
      return '已发送 MQTT 模拟通风请求，等待终端回执。';
    }
    const taskId = this.createTask('通风与回采验证', source);
    if (this.device.env.emergency) {
      this.addEvent('通风请求', '急停锁定，执行器禁止启动', source, true);
      this.taskStep(taskId, '本地执行校验', '急停锁定，执行器禁止启动', 'blocked');
      return '急停锁定，执行器禁止启动';
    }
    if (!this.device.startFan()) {
      this.taskStep(taskId, '重复请求抑制', '已有通风任务，未重复启动', 'done');
      return '已有通风任务，未重复启动';
    }
    this.fan = true;
    this.addEvent('通风启动', '模拟风机运行，等待回采验证', source);
    this.taskStep(taskId, '模拟执行器回执', '风机已启动', 'done');
    this.taskStep(taskId, '等待环境复测', '最多运行20秒演示时间', 'waiting');
    this.activeVentTask = taskId;
    return '已启动模拟通风，复测结果在任务中心显示';
  }

  private async pollGateway(): Promise<void> {
    if (this.gatewayBusy || !this.remoteMode) return;
    this.gatewayBusy = true;
    const epoch = this.connectionEpoch;
    try {
      const reading = await this.gateway.read();
      if (this.remoteMode && epoch === this.connectionEpoch) {
        this.env = reading.env;
        this.connectionStatus = reading.env.sensorOnline ? '模拟服务已连接 · 模拟终端在线 · 未接真实执行器' : '模拟服务可达 · 模拟终端离线';
        this.fan = reading.fan;
        if (this.activeVentTask !== -1 && !reading.fan) {
          const check = SafetyEngine.check(reading.env);
          const detail = check.allowed ? '终端回采符合演示阈值，风机停止；未自动开门' : '风机停止，回采未通过或状态未知，转人工检查';
          this.settleVentTask(detail, check.allowed);
          this.addEvent('MQTT回采验证', detail, '终端回采', !check.allowed);
        }
      }
    } catch (error) {
      if (this.remoteMode && epoch === this.connectionEpoch) {
        const failed = new EnvSnapshot();
        this.connectionStatus = '模拟服务连接失败 · 执行结果未知';
        failed.sensorOnline = false;
        failed.sampledAt = 0;
        this.env = failed;
        this.fan = false;
        this.feedback = '网关失联，准入拒止；执行器实际状态未知';
        this.settleVentTask('网关失联，设备执行与复测结果未确认', false);
      }
    } finally {
      if (epoch === this.connectionEpoch) this.gatewayBusy = false;
    }
  }

  private async sendGatewayCommand(action: string, source: string, maxRunMs: number = 20000): Promise<void> {
    if (!this.remoteMode) return;
    const epoch = this.connectionEpoch;
    const taskId = this.createTask('MQTT / ' + action, source);
    this.taskStep(taskId, '等待终端执行回执', '经网关发送，尚未确认设备执行', 'waiting');
    try {
      const ack = await this.gateway.command(action, maxRunMs);
      if (epoch !== this.connectionEpoch || !this.remoteMode) return;
      this.addEvent('MQTT 执行回执', `${ack.commandId} / ${ack.status} / ${ack.reason}`, source, ack.status !== 'executed');
      this.settleTask(taskId, ack.commandId + ' / ' + ack.status + ' / ' + ack.reason, ack.status === 'executed');
      if (ack.status === 'rejected') this.announceAlert();
      if (ack.status === 'executed' && action === 'ventilate' && ack.reason !== 'already_running') {
        this.taskStep(taskId, '等待环境复测', '从终端遥测验证效果', 'waiting');
        this.activeVentTask = taskId;
      }
      await this.pollGateway();
    } catch (error) {
      if (epoch !== this.connectionEpoch || !this.remoteMode) return;
      this.addEvent('MQTT 命令失败', '结果未确认，禁止视为执行成功', source, true);
      this.settleTask(taskId, '执行结果未确认，转人工检查', false);
    }
  }

  private createTask(title: string, source: string): number {
    const record = new TaskRecord(this.nextTaskId++, title, source);
    this.taskRecords = [record, ...this.taskRecords];
    return record.id;
  }

  private taskStep(id: number, name: string, detail: string, state: StepState): void {
    this.taskRecords = this.taskRecords.map((task: TaskRecord) => task.id === id ? TaskFlow.append(task, name, detail, state) : task);
  }

  private settleTask(id: number, detail: string, success: boolean): void {
    this.taskRecords = this.taskRecords.map((task: TaskRecord) => task.id === id ? TaskFlow.settle(task, detail, success) : task);
  }

  private settleVentTask(detail: string, success: boolean): void {
    if (this.activeVentTask !== -1) this.settleTask(this.activeVentTask, detail, success);
    this.activeVentTask = -1;
  }

  private async setScenario(name: string): Promise<void> {
    if (this.remoteMode) {
      const epoch = this.connectionEpoch;
      try {
        await this.gateway.scenario(name);
        if (epoch !== this.connectionEpoch || !this.remoteMode) return;
        await this.pollGateway();
      } catch (error) { if (epoch === this.connectionEpoch && this.remoteMode) this.feedback = '网关场景设置失败'; }
    } else {
      this.device.scenario(name);
      this.env = this.device.snapshot();
    }
  }

  private sendMessage(): void {
    const text = this.input.trim();
    if (text.length === 0) return;
    this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, true, text)];
    this.input = '';
    if (!this.demoMode) { this.requestHardwareAnalysis(text); return; }
    if (this.modelMode) {
      this.requestModelPlan(text);
      return;
    }
    let reply = '当前脚本支持“查询环境”“申请入棚”“启动通风”，真实大模型尚未接入。';
    if (!this.cloud) reply = '模拟云端断开，助手暂停。本地核验与通风仍可操作。';
    else if (text.includes('通风') || text.includes('风机')) reply = this.ventilate('助手脚本');
    else if (text.includes('入棚') || text.includes('进棚') || text.includes('开门')) reply = this.access('助手脚本');
    else if (text.includes('环境') || text.includes('温度')) {
      reply = `模拟 CO ${this.env.co} ppm，CO₂ ${this.env.co2} ppm，温度 ${this.env.temperature} °C。`;
    }
    this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, false, reply)];
  }

  private async requestHardwareAnalysis(text: string): Promise<void> {
    if (this.settingsBusy || this.directSettingsBusy || !this.hardwareVisible) return;
    if (this.hardwareSource === 'direct' && !this.cloudSessionReady) {
      this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, false, '当前为DAYU200本地直采，认证端云上报尚未接通，未向旧网关发送环境分析请求。照片分析和合成模型测试可独立使用；本地读数未上传云端。')];
      return;
    }
    if (this.modelBusy || !this.settingsReady) return;
    const epoch = this.connectionEpoch;
    const hardwareEpoch = this.hardwareEpoch;
    this.modelBusy = true;
    try {
      // Page changes deliberately clear visible samples. Fetch a genuine frame
      // here, then require its upload receipt before analyzing this device session.
      let expectedSession: string = '';
      if (this.hardwareSource === 'direct') {
        await this.directHardware.poll();
        if (epoch !== this.connectionEpoch || hardwareEpoch !== this.hardwareEpoch || !this.hardwareVisible || this.demoMode) return;
        const sample = this.directHardware.uploadSample();
        const receipt = await this.sendLiveSample(sample);
        if (epoch !== this.connectionEpoch || hardwareEpoch !== this.hardwareEpoch || !this.hardwareVisible || this.demoMode) return;
        expectedSession = sample.sessionBootId;
        this.cloudUploadStatus = receipt;
      }
      const analysis = this.hardwareSource === 'direct' ? await this.cloudUpload.analyze(text, expectedSession) : await this.gateway.analyze(text);
      if (epoch !== this.connectionEpoch || hardwareEpoch !== this.hardwareEpoch || this.demoMode) return;
      const basis = analysis.deviceOnline ? '分析时采集在线，网关接收：' + new Date(analysis.observationReceivedAt as number).toLocaleString() : '分析时设备离线或样本过期，没有有效现场读数';
      const traceText = analysis.toolTrace === undefined ? '服务端未提供工具读取记录' : analysis.toolTrace.map((trace: AnalysisToolTrace) => (trace.tool === 'read_environment' ? '已读取真实当前观测' : '已读取真实历史') + ' · ' + new Date(trace.at).toLocaleString() + ' · ' + trace.resultSummary).join('\n');
      const savedText = analysis.persistence === undefined ? '服务端未提供保存状态，不能视为已保存' : analysis.persistence.saved ? '文字分析已保存到服务端历史' + (analysis.persistence.recordId === undefined ? '' : ' · #' + analysis.persistence.recordId.toString()) : '文字分析未保存，可稍后检查服务端存储状态';
      const reply = savedText + '\n' + '真实数据分析 · ' + analysis.provider + ' / ' + analysis.model + '\n' + basis + '\n' + traceText + '\n' + analysis.summary + '\n' + analysis.findings.join('；') + '\n待补数据：' + analysis.unknowns.join('；') + '\n分析为该时刻的历史建议，不代表当前安全；CO/CO₂未知，未执行设备。';
      this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, false, reply)];
    } catch (error) {
      if (epoch !== this.connectionEpoch || hardwareEpoch !== this.hardwareEpoch || this.demoMode) return;
      this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, false, '真实AI请求失败：' + (error as Error).message + '。请在独立Web管理平台配置服务商、模型及密钥，并检查服务端连接；未生成或执行设备指令。')];
    } finally { if (epoch === this.connectionEpoch) this.modelBusy = false; }
  }

  private async requestModelPlan(text: string): Promise<void> {
    const epoch = this.connectionEpoch;
    if (this.modelBusy) return;
    if (!this.remoteMode || !this.cloud) {
      this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, false, '请连接模拟网关并恢复模拟云端后再请求模型。')];
      return;
    }
    this.modelBusy = true;
    this.modelPlan = new ModelPlan();
    try {
      const plan = await this.gateway.plan(text);
      if (epoch !== this.connectionEpoch || !this.remoteMode) return;
      this.modelPlan = plan;
      this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, false, this.modelPlan.summary + '。计划尚未执行，请逐步确认。')];
      this.addEvent('模型生成计划', this.modelPlan.provider + ' / ' + this.modelPlan.steps.length.toString() + ' 步，未执行', 'AI建议');
    } catch (error) {
      if (epoch !== this.connectionEpoch || !this.remoteMode) return;
      this.messages = [...this.messages, new ChatMessage(this.messages.length + 1, false, '模型请求失败，没有执行任何设备操作。')];
    } finally {
      if (epoch === this.connectionEpoch) this.modelBusy = false;
    }
  }

  private async confirmModelStep(index: number): Promise<void> {
    if (!this.demoMode) return;
    const epoch = this.connectionEpoch;
    if (this.modelBusy || !this.remoteMode || index < 0 || index >= this.modelPlan.steps.length) return;
    const selected = this.modelPlan.steps[index];
    if (selected.processed) return;
    this.modelBusy = true;
    const updated = new ModelPlan();
    updated.summary = this.modelPlan.summary;
    updated.provider = this.modelPlan.provider;
    updated.model = this.modelPlan.model;
    updated.steps = this.modelPlan.steps.map((step: ModelPlanStep, position: number) => {
      const copy = new ModelPlanStep();
      copy.action = step.action; copy.reason = step.reason; copy.maxRunMs = step.maxRunMs;
      copy.processed = step.processed || position === index;
      return copy;
    });
    this.modelPlan = updated;
    try { await this.sendGatewayCommand(selected.action, 'AI计划 / 人工确认', selected.maxRunMs); }
    finally { if (epoch === this.connectionEpoch) this.modelBusy = false; }
  }

  private async requestAgentPipeline(): Promise<void> {
    if (this.pipelineBusy) return;
    const directCloud = !this.demoMode && this.hardwareSource === 'direct';
    if (!this.settingsReady || this.settingsBusy || (directCloud ? !this.cloudSessionReady : !this.remoteMode)) {
      this.pipelineError = '未连接服务端：请先启用已登记的设备云端会话；临时模拟模式需先连接对应服务';
      return;
    }
    const prompt = this.pipelineInput.trim();
    if (prompt.length === 0 || prompt.length > 2000) {
      this.pipelineError = '请输入1至2000字的意图，再运行三阶段管线';
      return;
    }
    const epoch = this.connectionEpoch;
    const hardwareEpoch = this.hardwareEpoch;
    this.pipelineBusy = true;
    this.pipelineError = '';
    this.pipelineStatus = '三阶段管线处理中：决策 → 生成 → 审核；未执行设备';
    try {
      const result: AgentPipelineResult = directCloud ? await this.cloudUpload.pipeline(prompt) : await this.gateway.pipeline(prompt);
      if (epoch !== this.connectionEpoch || hardwareEpoch !== this.hardwareEpoch || (!directCloud && !this.remoteMode)) return;
      this.pipelineBadge = AgentPipelineView.badge(result.audit);
      this.pipelineStageCards = AgentPipelineView.stageCards(result);
      this.pipelineDetailRows = AgentPipelineView.detailRows(result);
      this.pipelineStatus = AgentPipelineView.statusLine(result) + (result.calls === 0 && result.provider.length === 0 ? ' · 模型尚未配置，未调用模型' : '');
      this.addEvent('三阶段管线', '结论 ' + result.audit.verdict + '；三阶段已返回，未执行设备', 'AI建议');
    } catch (error) {
      if (epoch !== this.connectionEpoch) return;
      this.pipelineBadge = new PipelineVerdictBadge();
      this.pipelineStageCards = [];
      this.pipelineDetailRows = [];
      this.pipelineError = AgentPipelineView.errorText(error as Error);
      this.pipelineStatus = '三阶段管线未返回有效结果';
    } finally {
      if (epoch === this.connectionEpoch) this.pipelineBusy = false;
    }
  }

  private requireAbilityContext(): common.UIAbilityContext {
    // This @Entry page is hosted by EntryAbility. getHostContext can return
    // undefined while its window is being created or destroyed.
    const context = this.getUIContext().getHostContext();
    if (context === undefined) throw new Error('应用上下文暂不可用，请回到前台后重试');
    return context as common.UIAbilityContext;
  }

  private async enableCamera(): Promise<void> {
    if (this.cameraBusy) return;
    this.cameraBusy = true;
    try {
      await this.cameraService.start(this.requireAbilityContext(), this.cameraController.getXComponentSurfaceId());
      this.cameraEnabled = true;
      this.cameraStatus = '真实摄像头已启动，图像仅在本地预览';
    } catch (error) {
      this.cameraEnabled = false;
      this.cameraStatus = '摄像头启动失败：请检查权限、接线和镜像相机能力';
    } finally { this.cameraBusy = false; }
  }

  private async takePhoto(): Promise<void> {
    if (this.cameraBusy || this.photoUploadBusy || !this.cameraEnabled) return;
    this.cameraBusy = true;
    this.imageAnalysisEpoch++; this.imageAnalysisText = ''; this.imageAnalysisBusy = false;
    try {
      this.photoPath = await this.cameraService.capture();
      this.photoCapturedAt = Date.now(); this.photoAuthorized = false; this.photoSavedPath = ''; this.photoUploadStatus = '新照片仅保存在本地，尚未上传';
      this.cameraStatus = '抓拍已保存在应用本地，没有上传';
      this.addEvent('作物抓拍', '图片保存到应用私有目录，未上传', '人工操作');
    } catch (error) { this.cameraEnabled = false; this.cameraStatus = '抓拍失败，相机会话已关闭，可重新启用'; }
    finally { this.cameraBusy = false; }
  }

  private async saveCurrentPhoto(): Promise<void> {
    if (this.demoMode || this.photoUploadBusy || this.cameraBusy || !this.cloudSessionReady || !this.cloudUpload.configured() ||
      !this.photoAuthorized || !this.photoPath || this.photoSavedPath === this.photoPath || !this.photoDescription.trim()) return;
    const path = this.photoPath, epoch = this.connectionEpoch, category = this.photoCategory;
    const capturedAt = this.photoCapturedAt, label = this.photoDescription.trim();
    this.photoUploadBusy = true; this.photoUploadStatus = '正在保存到云端图片库，等待确认…';
    try {
      const encoded = NativePhotoUpload.readCapturedJpeg(path, this.requireAbilityContext().filesDir);
      const receipt = await this.cloudUpload.savePhoto(encoded, category, label, capturedAt, true, 'photo-' + capturedAt.toString() + '-' + category);
      if (epoch !== this.connectionEpoch || path !== this.photoPath || this.demoMode) return;
      this.photoSavedPath = path; this.photoAuthorized = false;
      this.photoUploadStatus = '图片库已保存：' + receipt.mediaId + '。未发送给AI；可在Web图片资料中查看。';
    } catch (error) {
      if (epoch === this.connectionEpoch && path === this.photoPath && !this.demoMode) this.photoUploadStatus = '保存未确认：' + (error as Error).message + '。请先核对Web图片资料；原照片保留。';
    } finally { this.photoUploadBusy = false; }
  }

  private async inspectCurrentPhoto(): Promise<void> {
    if (this.photoCategory !== 'crop' || this.demoMode || this.imageAnalysisBusy || this.cameraBusy || !this.settingsReady || this.settingsBusy || this.photoPath.length === 0) return;
    const path = this.photoPath, epoch = ++this.imageAnalysisEpoch;
    this.imageAnalysisBusy = true; this.imageAnalysisText = '正在读取并发送本张照片给已配置模型…';
    try {
      const encoded = NativePhotoUpload.readCapturedJpeg(path, this.requireAbilityContext().filesDir);
      const result = this.cloudSessionReady ? await this.cloudUpload.inspectImage(encoded) : await this.gateway.inspectImage(encoded);
      if (epoch !== this.imageAnalysisEpoch || path !== this.photoPath || this.demoMode) return;
      this.imageAnalysisText = '真实照片模型分析 · ' + result.provider + ' / ' + result.model + '\n' + new Date(result.analyzedAt).toLocaleString() + ' · SHA256 ' + result.imageSha256.slice(0, 16) + '\n' + result.summary + '\n可见现象：' + result.findings.join('；') + '\n不能确定：' + result.unknowns.join('；') + '\n仅作可见现象和养护建议，不是病害确诊；未执行设备。';
    } catch (error) {
      if (epoch === this.imageAnalysisEpoch) this.imageAnalysisText = '照片分析未完成：' + (error as Error).message + '。请在电脑服务端模型设置选择支持图片的模型；本地照片保留，没有生成诊断。';
    } finally { if (epoch === this.imageAnalysisEpoch) this.imageAnalysisBusy = false; }
  }

  private async announceAlert(test: boolean = false): Promise<void> {
    if (!this.soundEnabled) return;
    const clip = test ? 'voice_test' : this.env.emergency ? 'emergency' :
      this.env.co >= 30 ? 'co_high' : this.env.co2 >= 1500 ? 'co2_high' : 'sensor_invalid';
    try {
      const played = await this.voiceAlert.play(this.requireAbilityContext(), clip);
      this.voiceStatus = played ? '本地语音已播放' : '语音未播放（忙、冷却中或音频不可用），请查看界面';
    } catch (error) {
      this.voiceStatus = '语音未播放：应用上下文或音频服务不可用，请查看文字告警';
    }
  }

  private async exportAudit(): Promise<void> {
    try {
      await this.auditReady;
      const json = await this.auditStore.exportJson();
      const saved = await NativeDocumentExport.saveJson(json);
      this.auditStatus = saved ? '台账已导出到你选择的位置，请留意文件内的完整性校验说明' : '已取消导出';
    } catch (error) {
      this.auditStatus = '导出未成功：请检查台账状态及镜像文件选择器能力';
    }
  }

  @Builder
  metric(title: string, value: string, unit: string) {
    Column({ space: 14 }) {
      Text(title).fontSize(15.5).fontWeight(FontWeight.Medium).fontColor('#64748B').width('100%')
      Row({ space: 8 }) {
        Text(value).fontSize(this.compactLayout ? 28 : 34).minFontSize(18).maxFontSize(34).maxLines(1).layoutWeight(1).fontWeight(FontWeight.Bold).fontColor('#0F766E')
          .animation({ duration: 260, curve: Curve.FastOutSlowIn })
        Text(unit).fontSize(14.5).fontColor('#64748B')
      }.width('100%')
      Text('模拟传感采样').fontSize(12.5).fontColor('#7D8F82').width('100%')
    }
    .padding(this.compactLayout ? 16 : 22)
    .backgroundColor(Color.White)
    .borderRadius(14)
    .border({ width: 1, color: '#DCE5EA' })
    .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
    .layoutWeight(1)
    .transition(TransitionEffect.OPACITY.animation({ duration: 260, curve: Curve.EaseOut }))
  }

  @Builder
  artworkCard(title: string, caption: string) {
    Stack({ alignContent: Alignment.TopStart }) {
      GreenhouseMotionImage({imageHeight: this.compactLayout ? 124 : 156, motionEnabled: this.motionEnabled})
      Column({ space: 8 }) {
        Text('棚安 · 智慧农业').fontSize(12).fontWeight(FontWeight.Medium).fontColor('#0F766E').width('100%')
        Text(title).fontSize(this.compactLayout ? 20 : 22).fontWeight(FontWeight.Bold).fontColor('#0F172A').lineHeight(26).width('100%')
        Text(caption).fontSize(12).fontColor('#475569').width('100%')
      }.padding(this.compactLayout ? 14 : 18).width('66%').height(this.compactLayout ? 124 : 156).alignItems(HorizontalAlign.Start)
        .linearGradient({ angle: 90, colors: [['#F5F8F7', 0], ['#E6F5F8F7', 0.75], ['#00F5F8F7', 1]] })
    }.width('100%').height(this.compactLayout ? 124 : 156).clip(true).borderRadius(18)
      .border({ width: 1, color: '#DCE5EA' })
  }

  @Builder
  homeShortcuts() {
    Row({ space: 12 }) {
      Button({ type: ButtonType.Normal }) {
        Column({ space: 8 }) {
          Text('智慧农业问答 →').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#0F766E').width('100%')
          Text('输入问题 · 查看依据').fontSize(12).fontColor('#64748B').width('100%')
        }.padding(16).width('100%')
      }.layoutWeight(1).backgroundColor(Color.White).borderRadius(14).stateEffect(true)
        .scale({ x: this.pressedShortcut === 0 ? 0.97 : 1, y: this.pressedShortcut === 0 ? 0.97 : 1 })
        .animation({ duration: this.motionEnabled ? 140 : 0, curve: Curve.EaseOut })
        .onTouch((event: TouchEvent) => { this.pressedShortcut = event.type === TouchType.Down ? 0 : -1; })
        .onClick(() => { this.agentViewMode = 1; this.selectPage(1); })
      Button({ type: ButtonType.Normal }) {
        Column({ space: 8 }) {
          Text('设备与连接 →').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text('采集来源 · 云端配置').fontSize(12).fontColor('#64748B').width('100%')
        }.padding(16).width('100%')
      }.layoutWeight(1).backgroundColor(Color.White).borderRadius(14).stateEffect(true)
        .scale({ x: this.pressedShortcut === 1 ? 0.97 : 1, y: this.pressedShortcut === 1 ? 0.97 : 1 })
        .animation({ duration: this.motionEnabled ? 140 : 0, curve: Curve.EaseOut })
        .onTouch((event: TouchEvent) => { this.pressedShortcut = event.type === TouchType.Down ? 1 : -1; })
        .onClick(() => { this.selectPage(5); })
    }.width('100%')
  }

  @Builder
  homePage() {
    Column({ space: 20 }) {
      this.artworkCard('让每一次巡棚\n都有据可依', '主题插画 · 非现场照片')
      Column({ space: 14 }) {
        Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Center }) {
          Text('◌').fontSize(16).fontColor('#64748B')
          Text('实物采集 · 只读').fontSize(this.compactLayout ? 18 : 21).fontWeight(FontWeight.Bold).fontColor('#0F172A').margin({ left: 8 }).width('86%')
          Text(this.hardwareSource === 'direct' ? 'DAYU200 直采' : '临时网关')
            .fontSize(13.5).fontWeight(FontWeight.Medium).fontColor('#0F766E')
            .backgroundColor('#E6F4F1').padding({ left: 12, right: 12, top: 5, bottom: 5 }).borderRadius(12).margin({ top: 8 })
        }.width('100%')
        Text(this.hardwareStatus).fontSize(16.5).lineHeight(25).fontColor('#1E293B').width('100%')
          .padding(14).backgroundColor('#F1F5F9').borderRadius(10)
          .animation({ duration: 240, curve: Curve.EaseOut })
        Text('最近完成刷新：' + this.hardwareRefreshTime).fontSize(14.5).fontColor('#64748B').width('100%')
        Text(this.demoMode ? '以下卡片与控制为独立软件模拟，不是实物安全判定' : 'CO、CO₂尚未接入；ADC仅为原始信号，真实准入未知／拒止，无执行器控制')
          .fontSize(14.5).fontWeight(FontWeight.Medium).fontColor('#B45309').width('100%')
          .padding(12).backgroundColor('#FEF3C7').borderRadius(10)
      }
      .padding(this.compactLayout ? 18 : 26)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: '#DCE5EA' })
      .shadow({ radius: 18, color: '#14183328', offsetX: 0, offsetY: 6 })
      .width('100%')
      .transition(TransitionEffect.OPACITY.animation({ duration: 260, curve: Curve.EaseOut }))

      this.homeShortcuts()
      if (this.demoMode) {
        Row({ space: 14 }) {
          this.metric('一氧化碳 CO', this.env.co.toString(), 'ppm')
          this.metric('二氧化碳 CO₂', this.env.co2.toString(), 'ppm')
        }.width('100%')
        Row({ space: 14 }) {
          this.metric('空气温度', this.env.temperature.toFixed(1), '°C')
          this.metric('土壤湿度', this.env.soil.toString(), '%')
        }.width('100%')
        Column({ space: 16 }) {
          Text('入棚安全核验').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text(SafetyEngine.check(this.env).allowed ? '模拟环境条件通过' : '禁止入棚')
            .fontSize(30).fontWeight(FontWeight.Bold)
            .fontColor(SafetyEngine.check(this.env).allowed ? '#0F766E' : '#DC2626').width('100%')
            .animation({ duration: 260, curve: Curve.FastOutSlowIn })
          Text(SafetyEngine.check(this.env).reasons.join('；') || 'CO / CO₂ 低于演示阈值，每次申请将重新核验。')
            .fontSize(15.5).lineHeight(23).fontColor('#475569').width('100%')
          Text(!this.env.sensorOnline ? '终端离线 · 执行器状态未知' : this.fan ? '模拟风机运行中 · 等待回采' : '模拟风机待机')
            .fontSize(15.5).fontWeight(FontWeight.Medium).fontColor('#1E293B').width('100%')
          Flex({ wrap: FlexWrap.Wrap }) {
            Button('模拟准入申请').fontSize(15.5).height(44).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).backgroundColor('#0F766E').onClick(() => { this.access('人工操作'); })
            Button('启动通风').fontSize(15.5).height(44).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).backgroundColor('#E6F4F1').fontColor('#0F766E').onClick(() => { this.ventilate('人工操作'); })
          }.width('100%')
          Text('演示阈值：CO ≥ 30 ppm / CO₂ ≥ 1500 ppm；不作为真实安全标准。')
            .fontSize(13.5).fontColor('#64748B').width('100%')
        }
        .padding(this.compactLayout ? 18 : 26)
        .backgroundColor(Color.White)
        .borderRadius(14)
        .border({ width: 1, color: '#DCE5EA' })
        .shadow({ radius: 18, color: '#14183328', offsetX: 0, offsetY: 6 })
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .transition(TransitionEffect.OPACITY.animation({ duration: 260, curve: Curve.EaseOut }))
      }
      Text('先核验环境，再执行动作。真实身份认证、门锁与紧急出棚回路待接入。')
        .fontSize(14.5).fontColor('#64748B').width('100%')
    }.width('100%')
  }

  @Builder
  pipelinePanel() {
    Column({ space: 14 }) {
      if (this.pipelineBusy) {
        NativeBusyIndicator({label: '正在检索与运行智能体管线，请等待服务端回执', motionEnabled: this.motionEnabled})
      }
      Text('三阶段智能体管线 · 决策 → 生成 → 审核').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
      Text('规则命中优先拦截；风险高或把握不足转人工确认；其余直接通过。只出建议，不下发设备指令。')
        .fontSize(14).lineHeight(22).fontColor('#64748B').width('100%')
      Row({ space: 10 }) {
        TextInput({ placeholder: '例如：现场 CO 偏高，现在该不该开风机', text: this.pipelineInput })
          .fontSize(16).height(46).borderRadius(10)
          .maxLength(300).layoutWeight(1).onChange((value: string) => { this.pipelineInput = value; })
        Button(this.pipelineBusy ? '处理中' : '运行三阶段管线').fontSize(15.5).height(46).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 })
          .backgroundColor('#0F766E').enabled(!this.pipelineBusy).onClick(() => { this.requestAgentPipeline(); })
      }.width('100%')
      Text(this.pipelineStatus).fontSize(14.5).fontColor('#475569').width('100%')
      if (this.pipelineError.length > 0) {
        Text(this.pipelineError).fontSize(14.5).fontColor('#DC2626').padding(12).backgroundColor('#FEE2E2').borderRadius(10).width('100%')
      }
      if (this.pipelineBadge.verdict.length > 0) {
        Row({ space: 12 }) {
          Text(this.pipelineBadge.text).fontSize(14.5).fontWeight(FontWeight.Bold).fontColor(Color.White)
            .backgroundColor(this.pipelineBadge.color).padding({ left: 14, right: 14, top: 8, bottom: 8 }).borderRadius(8)
          Text('结论来源：' + this.pipelineBadge.authorityText).fontSize(14).fontColor('#475569').layoutWeight(1)
        }.width('100%')
        ForEach(this.pipelineBadge.reasons, (reason: string, index: number) => {
          Text('理由 ' + (index + 1).toString() + '：' + reason).fontSize(14).fontColor('#475569').width('100%')
        }, (reason: string, index: number) => 'pipeline-reason-' + index.toString())
      }
      ForEach(this.pipelineStageCards, (card: PipelineStageCard, index: number) => {
        Column({ space: 8 }) {
          Row({ space: 10 }) {
            Text('●').fontSize(16).fontColor(card.dotColor)
            Text(card.title + '阶段').fontSize(16.5).fontWeight(FontWeight.Bold).fontColor('#0F172A').layoutWeight(1)
            Text(card.stateText).fontSize(14).fontWeight(FontWeight.Medium).fontColor(card.dotColor)
            Text(card.durationText).fontSize(13.5).fontColor('#64748B')
          }.width('100%')
          Text(card.summary).fontSize(15).lineHeight(22).fontColor('#334155').width('100%')
          if (card.error.length > 0) {
            Text(card.error).fontSize(13.5).fontColor('#DC2626').width('100%')
          }
        }
        .padding(this.compactLayout ? 14 : 18)
        .backgroundColor('#F8FAFC')
        .borderRadius(10)
        .border({ width: 1, color: '#E2E8F0' })
        .width('100%')
        .transition(TransitionEffect.OPACITY.combine(TransitionEffect.translate({ y: 10 })).animation({ duration: this.motionEnabled ? 300 : 0, delay: this.motionEnabled ? index * 55 : 0, curve: Curve.EaseOut }))
      }, (card: PipelineStageCard, index: number) => card.stage + '-' + card.state + '-' + index.toString())
      if (this.pipelineDetailRows.length > 0) {
        Column({ space: 6 }) {
          ForEach(this.pipelineDetailRows, (row: string, index: number) => {
            Text(row).fontSize(14).lineHeight(21).fontWeight(row.startsWith('【') ? FontWeight.Bold : FontWeight.Normal)
              .fontColor(row.startsWith('【') ? '#0F766E' : '#334155').width('100%')
          }, (row: string, index: number) => 'pipeline-row-' + index.toString())
        }.padding(this.compactLayout ? 14 : 18).backgroundColor('#F0FDF4').borderRadius(10).width('100%')
      }
    }
    .padding(this.compactLayout ? 18 : 26)
    .backgroundColor(Color.White)
    .borderRadius(14)
    .border({ width: 1, color: '#DCE5EA' })
    .shadow({ radius: 18, color: '#14183328', offsetX: 0, offsetY: 6 })
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .transition(TransitionEffect.OPACITY.animation({ duration: 260, curve: Curve.EaseOut }))
  }

  @Builder
  agentPage() {
    Column({ space: 18 }) {
      if (this.modelBusy || this.speechBusy) {
        NativeBusyIndicator({label: this.speechBusy ? '正在录音或转写，完成后请确认文字' : '正在分析问题，等待模型回执', motionEnabled: this.motionEnabled})
      }
      Column({ space: 10 }) {
        Text('从一个好问题开始').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        Text('选择场景只填入问题，确认后再发送。').fontSize(13).fontColor('#64748B').width('100%')
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          ForEach(['当前环境有哪些数据缺失？', '请结合当前采集提出养护建议。', '巡棚时应优先核查哪些事项？', '请整理本次观察的已知与未知项。'], (prompt: string, index: number) => {
            Button(['环境分析', '农事建议', '巡检要点', '整理观察'][index]).fontSize(14).height(40).width('48%').borderRadius(10)
              .backgroundColor('#E7F3F0').fontColor('#0F766E').margin({ bottom: 8 })
              .onClick(() => { this.input = prompt; this.agentViewMode = 1; })
          }, (prompt: string) => prompt)
        }.width('100%')
      }.padding(18).backgroundColor(Color.White).borderRadius(16).width('100%')
      // 视图切换条：支持全览 / 仅看对话 / 仅看三阶段管线，带平滑过渡动效
      Row({ space: 8 }) {
        Button('同屏全览').fontSize(14).height(38).borderRadius(8).layoutWeight(1)
          .backgroundColor(this.agentViewMode === 0 ? '#0F766E' : '#E6F4F1')
          .fontColor(this.agentViewMode === 0 ? Color.White : '#0F766E')
          .onClick(() => { animateTo({ duration: 240, curve: Curve.FastOutSlowIn }, () => { this.agentViewMode = 0; }); })
        Button('自由对话').fontSize(14).height(38).borderRadius(8).layoutWeight(1)
          .backgroundColor(this.agentViewMode === 1 ? '#0F766E' : '#E6F4F1')
          .fontColor(this.agentViewMode === 1 ? Color.White : '#0F766E')
          .onClick(() => { animateTo({ duration: 240, curve: Curve.FastOutSlowIn }, () => { this.agentViewMode = 1; }); })
        Button('三阶段管线').fontSize(14).height(38).borderRadius(8).layoutWeight(1)
          .backgroundColor(this.agentViewMode === 2 ? '#0F766E' : '#E6F4F1')
          .fontColor(this.agentViewMode === 2 ? Color.White : '#0F766E')
          .onClick(() => { animateTo({ duration: 240, curve: Curve.FastOutSlowIn }, () => { this.agentViewMode = 2; }); })
      }.width('100%')

      if (this.agentViewMode !== 2) {
        Column({ space: 14 }) {
          if (this.demoMode) {
            Text(this.modelMode ? '服务端模型接口 · 计划逐步确认' : '脚本演示 · 未接入云端模型').fontSize(14.5).fontColor('#64748B').width('100%')
            Button(this.modelMode ? '返回脚本演示' : '切换服务端模型').fontSize(15).height(42).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => {
              if (this.modelMode) { this.modelMode = false; this.modelPlan = new ModelPlan(); return; }
              if (!this.remoteMode) { this.feedback = '请先连接模拟服务'; return; }
              const epoch = this.connectionEpoch;
              this.modelBusy = true;
              this.gateway.modelStatus().then((status) => {
                if (epoch !== this.connectionEpoch || !this.remoteMode) return;
                if (status.configured && status.executesDevices === false) this.modelMode = true;
                else this.feedback = '服务端未配置模型，继续脚本演示';
              }).catch(() => { if (epoch === this.connectionEpoch) this.feedback = '模型状态接口不可用'; })
                .finally(() => { if (epoch === this.connectionEpoch) this.modelBusy = false; });
            }).enabled(!this.modelBusy)
            if (this.modelMode) {
              Text('发送时会将输入及模拟环境交给已配置的模型服务商。密钥仅在服务端，模型不能直接执行设备。')
                .fontSize(13.5).fontColor('#64748B').width('100%')
            }
          } else {
            Text('真实采集 AI 分析').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
            Text(this.hardwareSource === 'direct' ? (this.cloudSessionReady ? '使用已登记设备的云端观测分析，核对本地会话；请先在设备诊断确认上报成功，未执行设备。' : '请先在设备诊断启用HTTPS设备云端会话；未配置时不会向旧网关请求环境分析。') : '临时网关模式：输入及服务端当前温湿度/ADC观测交给已配置模型；不是DAYU200本地直采数据，不执行设备。')
              .fontSize(14.5).lineHeight(22).fontColor('#475569').width('100%')
          }
          if (this.messages.length === 0) {
            Text(this.demoMode ? '演示：查询环境或模拟通风。' : '可以问：当前温湿度如何？有哪些数据缺失？请结合真实采集给出养护建议。')
              .fontSize(15.5).lineHeight(24).padding(18).backgroundColor('#E6F4F1').fontColor('#0F766E').borderRadius(12).width('100%')
          }
          ForEach(this.messages, (message: ChatMessage) => {
            Column({ space: 8 }) {
              Text(message.user ? '你 · 提问' : '棚安助手 · 分析回执').fontSize(13.5).fontWeight(FontWeight.Medium).fontColor(message.user ? '#0F766E' : '#475569').width('100%')
              Text(message.text).fontSize(16.5).lineHeight(25).fontColor('#0F172A').width('100%')
            }
            .padding(18)
            .width('100%')
            .backgroundColor(message.user ? '#E6F4F1' : '#F8FAFC')
            .borderRadius(12)
            .border({ width: 1, color: message.user ? '#99F6E4' : '#E2E8F0' })
            .transition(TransitionEffect.OPACITY.animation({ duration: 240, curve: Curve.EaseOut }))
          }, (message: ChatMessage) => message.id.toString())
          Row({ space: 10 }) {
            TextInput({ placeholder: '分析当前采集 / 养护建议 / 数据缺失原因', text: this.input })
              .fontSize(16).height(46).borderRadius(10).layoutWeight(1)
              .maxLength(300).onChange((value: string) => { this.input = value; })
            Button(this.modelBusy ? '处理中' : '发送').fontSize(15.5).height(46).borderRadius(10).constraintSize({ maxWidth: '96%' }).backgroundColor('#0F766E').enabled(!this.modelBusy).onClick(() => { this.sendMessage(); })
          }.width('100%')
          if (!this.demoMode) {
            Text('语音转写只回填，不自动提交；请确认现场人员同意录音。').fontSize(14).fontColor('#475569').width('100%')
            Button(this.speechBusy ? '录音/转写进行中' : '录音8秒并转为文字').fontSize(14).height(42).enabled(this.cloudSessionReady && !this.speechBusy && !this.modelBusy).onClick(() => { this.recognizeSpeech(); })
            Button('取消语音').fontSize(14).height(40).enabled(this.speechBusy).onClick(() => { this.speechEpoch++; this.speechInput.cancel(); this.speechStatus = '已取消，不回填文字'; })
            Text(this.speechStatus).fontSize(14).fontColor('#475569').width('100%')
          }
          if (this.demoMode && this.modelMode && this.modelPlan.steps.length > 0) {
            Text('待确认计划').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#0F172A')
            ForEach(this.modelPlan.steps, (step: ModelPlanStep, index: number) => {
              Column({ space: 10 }) {
                Text(step.action).fontSize(16.5).fontWeight(FontWeight.Bold).width('100%')
                Text(step.reason).fontSize(14.5).fontColor('#475569').width('100%')
                Button(step.processed ? '已处理' : '确认此步骤').fontSize(15).height(42).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).enabled(!step.processed && !this.modelBusy)
                  .onClick(() => { this.confirmModelStep(index); })
              }.padding(18).backgroundColor('#F8FAFC').borderRadius(12).width('100%')
            }, (step: ModelPlanStep, index: number) => index.toString() + step.action)
          }
        }
        .padding(this.compactLayout ? 18 : 26)
        .backgroundColor(Color.White)
        .borderRadius(14)
        .border({ width: 1, color: '#DCE5EA' })
        .shadow({ radius: 18, color: '#14183328', offsetX: 0, offsetY: 6 })
        .width('100%')
      }

      if (this.agentViewMode !== 1) {
        this.pipelinePanel()
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  taskPage() {
    Column({ space: 18 }) {
      if (!this.demoMode) {
        Column({ space: 12 }) {
          Text('真实运行任务边界').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text('真实运行只提供观测与AI建议；执行器未接入，暂无真实控制任务。演示任务仅在演示模式中显示。')
            .fontSize(16).lineHeight(25).fontColor('#334155').width('100%')
        }
        .padding(this.compactLayout ? 18 : 26)
        .backgroundColor(Color.White)
        .borderRadius(14)
        .border({ width: 1, color: '#DCE5EA' })
        .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
        .width('100%')
      } else {
        Text('计划 → 规则核验 → 执行回执 → 环境复测').fontSize(15.5).fontWeight(FontWeight.Medium).fontColor('#64748B').width('100%')
        if (this.taskRecords.length === 0) {
          Text('还没有任务。在首页申请入棚或启动通风。').fontSize(16).padding(26).backgroundColor(Color.White).borderRadius(14).fontColor('#64748B').width('100%')
        }
        ForEach(this.taskRecords, (task: TaskRecord) => {
          Column({ space: 14 }) {
            Text(task.title).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
            Text(`#${task.id} / ${task.time} / ${task.source}`).fontSize(13.5).fontColor('#64748B').width('100%')
            ForEach(task.steps, (step: TaskStep, index: number) => {
              Row({ space: 14 }) {
                Text((index + 1).toString()).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#0F766E').width(28)
                Column({ space: 6 }) {
                  Text(step.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#0F172A').width('100%')
                  Text(step.detail).fontSize(14.5).fontColor('#475569').width('100%')
                }.layoutWeight(1)
                Text(step.state === 'done' ? '已完成' : step.state === 'blocked' ? '已拦截' : '等待中')
                  .fontSize(14).fontWeight(FontWeight.Bold).fontColor(step.state === 'blocked' ? '#DC2626' : '#0F766E')
              }.padding({ top: 12, bottom: 12 }).width('100%')
            }, (step: TaskStep, index: number) => index.toString() + step.name)
          }
          .padding(this.compactLayout ? 18 : 26)
          .backgroundColor(Color.White)
          .borderRadius(14)
          .border({ width: 1, color: '#DCE5EA' })
          .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
          .width('100%')
          .transition(TransitionEffect.OPACITY.animation({ duration: 240, curve: Curve.EaseOut }))
        }, (task: TaskRecord) => task.id.toString() + '-' + task.version.toString())
      }
    }.width('100%')
  }

  @Builder
  recordsPage(taskOnly: boolean) {
    Column({ space: 16 }) {
      if (!this.demoMode) {
        Column({ space: 14 }) {
          Text('真实记录导出').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text(this.realReportStatus).fontSize(15).lineHeight(23).fontColor('#475569').width('100%')
          Button(this.realReportBusy ? '正在准备报告' : '导出最近真实记录(JSON)').fontSize(15.5).height(44).borderRadius(10).backgroundColor('#0F766E')
            .enabled(this.settingsReady && !this.settingsBusy && !this.historyBusy && !this.analysisHistoryBusy && !this.realReportBusy).onClick(() => { this.exportRealReport(); })
        }
        .padding(this.compactLayout ? 18 : 24)
        .backgroundColor(Color.White)
        .borderRadius(14)
        .border({ width: 1, color: '#DCE5EA' })
        .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
        .width('100%')

        Column({ space: 14 }) {
          Text('真实采集历史 · 记录时刻的观测，不代表当前环境').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text(this.historyStatus).fontSize(15).fontColor('#475569').width('100%')
          Button(this.historyBusy ? '读取中' : '刷新真实历史').fontSize(15).height(42).borderRadius(10).backgroundColor('#E6F4F1').fontColor('#0F766E')
            .enabled(this.settingsReady && !this.settingsBusy && !this.realReportBusy && !this.analysisHistoryBusy && !this.historyBusy).onClick(() => { this.refreshHistory(); })
          if (this.historyRows.length === 0) { Text('暂无已核验的真实历史记录').fontSize(15).fontColor('#64748B').width('100%') }
          ForEach(this.historyRows, (row: string) => {
            Text(row).fontSize(15.5).lineHeight(23).padding(16).backgroundColor('#F8FAFC').borderRadius(10).border({ width: 1, color: '#E2E8F0' }).width('100%')
          }, (row: string) => row)
        }
        .padding(this.compactLayout ? 18 : 24)
        .backgroundColor(Color.White)
        .borderRadius(14)
        .border({ width: 1, color: '#DCE5EA' })
        .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
        .width('100%')

        Column({ space: 14 }) {
          Text('AI文字分析历史 · 非当前状态').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text(this.analysisHistoryStatus).fontSize(15).fontColor('#475569').width('100%')
          Button(this.analysisHistoryBusy ? '读取中' : '刷新AI分析历史').fontSize(15).height(42).borderRadius(10).backgroundColor('#E6F4F1').fontColor('#0F766E')
            .enabled(this.settingsReady && !this.settingsBusy && !this.realReportBusy && !this.historyBusy && !this.analysisHistoryBusy).onClick(() => { this.refreshAnalysisHistory(); })
          if (this.analysisHistoryRows.length === 0) { Text('暂无已核验的文字分析历史；照片分析不自动保存。').fontSize(15).fontColor('#64748B').width('100%') }
          ForEach(this.analysisHistoryRows, (row: string) => {
            Text(row).fontSize(15.5).lineHeight(23).padding(16).backgroundColor('#F8FAFC').borderRadius(10).border({ width: 1, color: '#E2E8F0' }).width('100%')
          }, (row: string) => row)
        }
        .padding(this.compactLayout ? 18 : 24)
        .backgroundColor(Color.White)
        .borderRadius(14)
        .border({ width: 1, color: '#DCE5EA' })
        .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
        .width('100%')
      } else {
        Text('此页为历史原型演示台账，包含模拟环境；不是正式采集数据或真实设备执行凭证。').fontSize(15).fontColor('#B45309').padding(14).backgroundColor('#FEF3C7').borderRadius(10).width('100%')
        Text(taskOnly ? '计划与执行事件 · 本次会话' : this.auditStatus)
          .fontSize(14.5).fontColor('#64748B').width('100%')
        if (!taskOnly) {
          Flex({ wrap: FlexWrap.Wrap }) {
            Button('校验本地哈希链').fontSize(15).height(42).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).backgroundColor('#0F766E').onClick(() => {
              this.auditStore.verify().then((count: number) => {
                this.auditStatus = '校验通过：' + count.toString() + ' 条。仅证明本地链一致，不能防止整链重写。';
              }).catch(() => { this.auditStatus = '校验失败，已停止追加，保留数据等待检查'; });
            })
            Button('导出台账JSON').fontSize(15).height(42).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).backgroundColor('#E6F4F1').fontColor('#0F766E').onClick(() => { this.exportAudit(); })
          }
          Text('Preferences 持久保存 / SHA-256 串联 / 原型最多 1000 条；未配置独立云端存证。')
            .fontSize(13.5).fontColor('#64748B').width('100%')
        }
        ForEach(taskOnly ? this.events : this.auditRows, (event: EventRecord) => {
          Column({ space: 10 }) {
            Row() {
              Text(event.title).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#0F172A').layoutWeight(1)
              Text(event.blocked ? '已拦截' : '已记录').fontSize(13.5).fontWeight(FontWeight.Bold).fontColor(event.blocked ? '#DC2626' : '#0F766E')
            }.width('100%')
            Text(event.detail).fontSize(15.5).fontColor('#334155').width('100%')
            Text(`${new Date(event.at).toLocaleString()} · ${event.source} · #${event.id}`).fontSize(13).fontColor('#64748B').width('100%')
          }
          .padding(20)
          .width('100%')
          .backgroundColor(Color.White)
          .borderRadius(14)
          .border({ width: 1, color: '#DCE5EA' })
          .shadow({ radius: 14, color: '#10183328', offsetX: 0, offsetY: 4 })
        }, (event: EventRecord) => event.id.toString())
      }
    }.width('100%')
  }

  @Builder
  cropReviewPanel() {
    Column({ space: 14 }) {
      Text('云端作物复核').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
      Text('读取本设备最近10张作物影像的人工结论；不包含人员照片，不是多光谱或AI自动检测。').fontSize(14).lineHeight(22).fontColor('#64748B').width('100%')
      Button(this.cropReviewBusy ? '正在读取' : '刷新人工复核').fontSize(15).height(42).borderRadius(10).backgroundColor('#0F766E')
        .enabled(!this.demoMode && this.cloudSessionReady && !this.cropReviewBusy).onClick(() => { this.refreshCropReviews(); })
      Text(this.demoMode ? '演示模式不读取真实复核记录' : !this.cloudSessionReady ? '请先在设备诊断启用HTTPS设备云端会话，再刷新复核记录' : this.cropReviewStatus).fontSize(14).fontColor('#475569').width('100%')
      if (!this.demoMode && !this.cloudSessionReady) {
        Button('前往设备诊断').fontSize(14).height(38).borderRadius(10).backgroundColor('#E7F3F0').fontColor('#0F766E').onClick(() => { this.selectPage(5); })
      }
      if (this.cropReviewBusy) { NativeBusyIndicator({label:'正在读取云端人工记录',motionEnabled:this.motionEnabled}) }
      Row({ space: 8 }) {
        ForEach(['all','issue','unreviewed'], (filter: string, index: number) => {
          Button(['全部','异常记录','待复核'][index]).layoutWeight(1).fontSize(13).height(36).borderRadius(10)
            .backgroundColor(this.cropReviewFilter === filter ? '#0F766E' : '#E7F3F0').fontColor(this.cropReviewFilter === filter ? Color.White : '#0F766E')
            .onClick(() => { this.cropReviewFilter = filter; })
        }, (filter: string) => filter)
      }.width('100%')
      if (this.cropReviewItems.length === 0) {
        Text('尚无已载入的复核记录。先在Web上传作物照片并人工标记，再刷新。').fontSize(15).lineHeight(23).fontColor('#64748B').width('100%')
      }
      ForEach(this.cropReviewItems.filter((row: NativeCropReview) => this.cropReviewFilter === 'all' || (this.cropReviewFilter === 'issue' ? row.status === 'suspected' || row.status === 'confirmed' : row.status === 'unreviewed')), (row: NativeCropReview) => {
        Column({ space: 10 }) {
          Text(cropReviewLabel(row.status)).fontSize(15).fontWeight(FontWeight.Bold).fontColor(row.status === 'confirmed' ? '#B42318' : row.status === 'suspected' ? '#B45309' : '#475569').width('100%')
          Text(row.label).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text('位置：' + (row.plot || '未填写') + ' · 异常区域 ' + row.regionCount.toString() + ' 个').fontSize(14).fontColor('#475569').width('100%')
          Text(row.note || '暂无人工观察备注').fontSize(15).lineHeight(23).fontColor('#334155').width('100%')
          Text('人工记录版本 ' + row.revision.toString() + ' · 拍摄 ' + new Date(row.capturedAt).toLocaleString()).fontSize(12).fontColor('#64748B').width('100%')
          Text(row.reviewedAt === null ? '尚未人工复核' : '复核 ' + new Date(row.reviewedAt as number).toLocaleString()).fontSize(12).fontColor('#64748B').width('100%')
        }.padding(16).width('100%').backgroundColor('#F8FAFC').borderRadius(12).border({width:1,color:'#DCE5EA'})
      }, (row: NativeCropReview) => row.mediaId + '-' + row.revision.toString())
    }.padding(18).width('100%').backgroundColor(Color.White).borderRadius(16)
  }

  @Builder
  monitorPage() {
    Column({ space: 20 }) {
      Row({ space: 10 }) {
        Button('拍照巡查').layoutWeight(1).fontSize(15).height(40).borderRadius(10).backgroundColor(this.cropViewMode === 0 ? '#0F766E' : '#E7F3F0').fontColor(this.cropViewMode === 0 ? Color.White : '#0F766E')
          .enabled(!this.cameraBusy && !this.photoUploadBusy && !this.imageAnalysisBusy).onClick(() => { this.cropViewMode = 0; })
        Button('云端人工复核').layoutWeight(1).fontSize(15).height(40).borderRadius(10).backgroundColor(this.cropViewMode === 1 ? '#0F766E' : '#E7F3F0').fontColor(this.cropViewMode === 1 ? Color.White : '#0F766E')
          .enabled(!this.cameraBusy && !this.photoUploadBusy && !this.imageAnalysisBusy).onClick(() => { this.cropViewMode = 1; this.cameraStatus = '预览已停止，回到拍照巡查可重新启用'; })
      }.width('100%')
      if (this.cropViewMode === 1) {
        this.cropReviewPanel()
      } else {
      this.artworkCard('先记录现场\n再核对建议', '主题插画 · 非现场照片')
      Column({ space: 16 }) {
        Text('作物视觉巡查 · 本地相机').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        Text(this.cameraStatus).fontSize(15.5).fontColor('#475569').width('100%')
        XComponent({ id: 'crop-preview', type: XComponentType.SURFACE, controller: this.cameraController })
          .height(290).width('100%').backgroundColor('#0F172A').borderRadius(12)
          .onDestroy(() => { this.cameraEnabled = false; this.cameraService.stop(); })
        Flex({ wrap: FlexWrap.Wrap }) {
          Button('启用真实摄像头').fontSize(15).height(44).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).enabled(!this.cameraEnabled && !this.cameraBusy).backgroundColor('#0F766E').onClick(() => { this.enableCamera(); })
          Button('本地抓拍').fontSize(15).height(44).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).enabled(this.cameraEnabled && !this.cameraBusy).backgroundColor('#E6F4F1').fontColor('#0F766E').onClick(() => { this.takePhoto(); })
          Button('停止预览').fontSize(15).height(44).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).enabled(this.cameraEnabled).backgroundColor('#FEE2E2').fontColor('#DC2626').onClick(() => {
            this.cameraService.stop(); this.cameraEnabled = false; this.cameraStatus = '摄像头已停止';
          })
        }
        if (this.photoPath.length > 0) {
          Image('file://' + this.photoPath).width('100%').height(230).objectFit(ImageFit.Contain).borderRadius(10)
        }
        if (!this.demoMode) {
          Text('图片库归档').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Flex({ wrap: FlexWrap.Wrap }) {
            Button('作物图片').fontSize(14).height(40).borderRadius(10).margin({ right: 8, bottom: 8 })
              .backgroundColor(this.photoCategory === 'crop' ? '#0F766E' : '#E6F4F1').fontColor(this.photoCategory === 'crop' ? Color.White : '#0F766E')
              .enabled(!this.photoUploadBusy).onClick(() => { this.photoCategory = 'crop'; this.photoAuthorized = false; })
            Button('现场人员图片').fontSize(14).height(40).borderRadius(10).margin({ bottom: 8 })
              .backgroundColor(this.photoCategory === 'person' ? '#0F766E' : '#E6F4F1').fontColor(this.photoCategory === 'person' ? Color.White : '#0F766E')
              .enabled(!this.photoUploadBusy).onClick(() => { this.photoCategory = 'person'; this.photoAuthorized = false; })
          }.width('100%')
          TextInput({ placeholder: '填写现场照片说明（不超过120字）', text: this.photoDescription }).maxLength(120).fontSize(15).width('100%')
            .enabled(!this.photoUploadBusy).onChange((value: string) => { this.photoDescription = value; this.photoAuthorized = false; })
          Row({ space: 8 }) {
            Checkbox().select(this.photoAuthorized).enabled(!this.photoUploadBusy).onChange((value: boolean) => { this.photoAuthorized = value; })
            Text('我有权保存本张照片；涉及人员已取得相应授权').fontSize(14).fontColor('#475569').layoutWeight(1)
          }.width('100%')
          Text(this.photoCapturedAt > 0 ? '拍摄：' + new Date(this.photoCapturedAt).toLocaleString() : '请先启用摄像头并本地抓拍')
            .fontSize(14).fontColor('#64748B').width('100%')
          Text('图片库需要HTTPS设备云端会话。人员图片仅管理员可见，不用于模型分析。').fontSize(14).fontColor('#475569').width('100%')
          Button(this.photoUploadBusy ? '正在保存照片' : '保存本张照片到图片库').fontSize(15).height(44).borderRadius(10).backgroundColor('#0F766E').constraintSize({ maxWidth: '96%' })
            .enabled(this.cloudSessionReady && this.photoAuthorized && this.photoDescription.trim().length > 0 && this.photoPath.length > 0 && this.photoSavedPath !== this.photoPath && !this.cameraBusy && !this.photoUploadBusy)
            .onClick(() => { this.saveCurrentPhoto(); })
          Text(this.photoUploadStatus).fontSize(14.5).fontColor('#475569').width('100%')
          Text('作物照片分析需另行点击下方按钮，才发送给已配置模型；最大2MiB。人员分类禁用模型分析。')
            .fontSize(14.5).lineHeight(22).fontColor('#475569').width('100%')
          Button(this.imageAnalysisBusy ? '照片分析中' : '发送本张照片给已配置模型分析').fontSize(15.5).height(44).borderRadius(10).backgroundColor('#0F766E').constraintSize({ maxWidth: '96%' })
            .enabled(this.photoCategory === 'crop' && !this.imageAnalysisBusy && !this.cameraBusy && this.photoPath.length > 0 && this.settingsReady && !this.settingsBusy).onClick(() => { this.inspectCurrentPhoto(); })
          if (this.imageAnalysisText.length > 0) {
            Text(this.imageAnalysisText).fontSize(15.5).lineHeight(24).padding(16).backgroundColor('#F8FAFC').borderRadius(10).width('100%')
          }
        }
        if (this.demoMode) {
          Button('查看报告结构示例').fontSize(15).height(42).borderRadius(10).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).backgroundColor('#0F766E').onClick(() => { this.showReport = true; })
          if (this.showReport) {
            Text('示例报告结构\n\n观察结论：待真实图像分析\n数据依据：抓拍图像与环境快照\n养护建议：由视觉模型提供，设备执行经规则核验\n置信说明：待实际验证，无虚构置信度')
              .fontSize(16).lineHeight(28).padding(22).backgroundColor('#F8FAFC').borderRadius(12).width('100%')
          }
        }
      }
      .padding(this.compactLayout ? 18 : 26)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: '#DCE5EA' })
      .shadow({ radius: 18, color: '#14183328', offsetX: 0, offsetY: 6 })
      .width('100%')
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  diagnosticsPage() {
    Column({ space: 18 }) {
      Row({ space: 12 }) {
        Column({ space: 6 }) {
          Text('首页与助手动态效果').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
          Text('装饰动画有限播放；处理状态以真实回执为准').fontSize(12).fontColor('#64748B').width('100%')
        }.layoutWeight(1)
        Button(this.motionEnabled ? '关闭动效' : '开启动效').fontSize(13).height(38).borderRadius(10)
          .backgroundColor('#E7F3F0').fontColor('#0F766E').onClick(() => { this.motionEnabled = !this.motionEnabled; })
      }.padding(16).backgroundColor(Color.White).borderRadius(14).width('100%')
      // 卡片 1：设备云端会话（HTTPS）
      Column({ space: 14 }) {
        Text('1. 设备云端会话（HTTPS）').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        TextInput({ text: this.cloudGatewayId, placeholder: '管理员登记的DAYU200 ID' })
          .fontSize(16).height(46).borderRadius(10).onChange((v: string) => { this.cloudGatewayId = v; })
        TextInput({ text: this.cloudTokenInput, placeholder: '设备令牌（可选HUKS保护）' })
          .fontSize(16).height(46).borderRadius(10).type(InputType.Password).onChange((v: string) => { this.cloudTokenInput = v; })
        Text('云端地址使用下方已保存服务端地址。令牌仅驻留内存，可选HUKS密文保存并手动恢复；不要输入模型API密钥。')
          .fontSize(14).lineHeight(21).fontColor('#64748B').width('100%')
        Flex({ wrap: FlexWrap.Wrap }) {
          Button(this.cloudSessionReady ? '替换设备云端会话' : '启用设备云端会话').fontSize(15).height(44).borderRadius(10).backgroundColor('#0F766E').margin({ right: 8, bottom: 8 }).enabled(!this.modelBusy && !this.settingsBusy).onClick(() => {
            const token = this.cloudTokenInput; this.cloudTokenInput = '';
            try { this.cloudUpload.configure(this.savedGatewayAddress, this.cloudGatewayId.trim(), token); this.invalidateConnection(); this.resetHardware('设备云端会话已变化'); this.lastUploadAttempt = ''; this.cloudSessionReady = true; this.cloudUploadStatus = '已配置会话，尚未确认服务器接收；新有效帧自动上报一次'; }
            catch (error) { this.cloudUploadStatus = (error as Error).message; }
          })
          Button('关闭设备云端会话').fontSize(15).height(44).borderRadius(10).backgroundColor('#FEE2E2').fontColor('#DC2626').margin({ right: 8, bottom: 8 }).onClick(() => { this.cloudUpload.clear(); this.invalidateConnection(); this.resetHardware('设备云端会话已关闭'); this.cloudSessionReady = false; this.cloudTokenInput = ''; this.cloudUploadStatus = '设备云端会话已关闭'; })
        }
        Text(this.queueStatus).fontSize(14).fontColor('#475569').width('100%')
        Text(this.credentialStatus).fontSize(14).fontColor('#475569').width('100%')
        Flex({ wrap: FlexWrap.Wrap }) {
          Button('HUKS安全保存当前凭据').fontSize(14).height(42).margin({ right: 6, bottom: 6 }).enabled(this.cloudSessionReady).onClick(() => { this.protectCredentials(); })
          Button('恢复安全保存的凭据').fontSize(14).height(42).margin({ bottom: 6 }).onClick(() => { this.restoreCredentials(); })
          Button('忘记已保存凭据').fontSize(14).height(42).onClick(async () => { try { await this.credentialVault.forget(); this.credentialStatus = '已移除保存的密文；当前内存会话可单独关闭'; } catch { this.credentialStatus = '移除未确认'; } })
          Button('补发历史队列').fontSize(14).height(42).enabled(this.cloudSessionReady).onClick(() => { this.replayPending(); })
        }.width('100%')
        Text(this.cloudUploadStatus).fontSize(15).fontColor('#0F766E').padding(12).backgroundColor('#F0FDF4').borderRadius(10).width('100%')
      }
      .padding(this.compactLayout ? 18 : 24)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: '#DCE5EA' })
      .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
      .width('100%')

      // 卡片 2：真实采集来源与板卡配置
      Column({ space: 14 }) {
        Text('2. 真实采集来源').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        Text('当前保存：' + (this.hardwareSource === 'direct' ? 'DAYU200直连HH-HSP101' : '电脑临时网关') + '；修改下列选项后需保存。')
          .fontSize(15).fontColor('#334155').width('100%')
        Flex({ wrap: FlexWrap.Wrap }) {
          Button(this.hardwareSourceDraft === 'direct' ? '已选择：采集板直连' : '采集板直连').fontSize(15).height(42).borderRadius(10)
            .backgroundColor(this.hardwareSourceDraft === 'direct' ? '#0F766E' : '#E6F4F1')
            .fontColor(this.hardwareSourceDraft === 'direct' ? Color.White : '#0F766E')
            .constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 })
            .enabled(this.directSettingsReady && !this.directSettingsBusy).onClick(() => { this.hardwareSourceDraft = 'direct'; })
          Button(this.hardwareSourceDraft === 'gateway' ? '已选择：临时网关' : '临时网关').fontSize(15).height(42).borderRadius(10)
            .backgroundColor(this.hardwareSourceDraft === 'gateway' ? '#0F766E' : '#E6F4F1')
            .fontColor(this.hardwareSourceDraft === 'gateway' ? Color.White : '#0F766E')
            .constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 })
            .enabled(this.directSettingsReady && !this.directSettingsBusy).onClick(() => { this.hardwareSourceDraft = 'gateway'; })
        }
        TextInput({ text: this.boardIp, placeholder: 'HH-HSP101裸私网IP，例如192.168.1.100' })
          .fontSize(16).height(46).borderRadius(10)
          .onChange((value: string) => { this.boardIp = value; }).enabled(this.directSettingsReady && !this.directSettingsBusy)
        Text('已保存采集板IP：' + (this.savedBoardIp || '未配置') + '。两块板子需在同一局域网；固定HTTP 80端口与遥测路径，不填密码。')
          .fontSize(14).lineHeight(21).fontColor('#64748B').width('100%')
        Button(this.directSettingsBusy ? '保存中' : '保存采集来源').fontSize(15.5).height(44).borderRadius(10).backgroundColor('#0F766E').constraintSize({ maxWidth: '96%' })
          .enabled(this.directSettingsReady && !this.directSettingsBusy && !this.settingsBusy && !this.modelBusy && !this.hardwareTransportBusy && !this.imageAnalysisBusy && !this.realReportBusy && !this.remoteMode)
          .onClick(() => { this.saveHardwareSource(); })
        Text(this.directSettingsStatus).fontSize(15).fontColor('#334155').width('100%')
      }
      .padding(this.compactLayout ? 18 : 24)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: '#DCE5EA' })
      .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
      .width('100%')

      // 卡片 3：服务端连接与模型测试
      Column({ space: 14 }) {
        Text('3. 服务端连接与模型测试').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        TextInput({ text: this.gatewayAddress, placeholder: 'http://127.0.0.1:5187' })
          .fontSize(16).height(46).borderRadius(10)
          .onChange((value: string) => { this.gatewayAddress = value; })
          .enabled(this.settingsReady && !this.settingsBusy && !this.remoteMode)
        Text('当前保存地址：' + this.savedGatewayAddress).fontSize(15).fontColor('#334155').width('100%')
        Text('填写云端HTTPS地址或电脑临时测试地址。直采不依赖此地址；认证上报未实现，当前服务端照片分析/合成测试独立使用此连接。')
          .fontSize(14).lineHeight(21).fontColor('#64748B').width('100%')
        Flex({ wrap: FlexWrap.Wrap }) {
          Button('保存地址').fontSize(15).height(42).borderRadius(10).backgroundColor('#0F766E').constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).enabled(this.settingsReady && !this.settingsBusy && !this.remoteMode && !this.modelBusy && !this.gatewayBusy)
            .onClick(() => { this.saveConnection(); })
          Button('测试已保存地址').fontSize(15).height(42).borderRadius(10).backgroundColor('#E6F4F1').fontColor('#0F766E').constraintSize({ maxWidth: '96%' }).margin({ right: 8, bottom: 8 }).enabled(this.settingsReady && !this.settingsBusy && !this.remoteMode)
            .onClick(() => { this.testConnection(); })
        }
        Text(this.connectionStatus).fontSize(15.5).fontColor('#0F766E').width('100%')
        Text('模型测试只发送合成问题，不发送本地直采环境、历史或照片；服务端配置在独立Web管理平台保存。')
          .fontSize(14).lineHeight(21).fontColor('#64748B').width('100%')
        Button(this.modelCheckBusy ? '模型测试中' : '发送模型测试问题').fontSize(15).height(44).borderRadius(10).backgroundColor('#0F766E')
          .constraintSize({ maxWidth: '96%' }).enabled(!this.demoMode && this.settingsReady && !this.settingsBusy && !this.modelBusy && !this.imageAnalysisBusy && !this.realReportBusy)
          .onClick(() => { this.testModelConfiguration(); })
        Text(this.modelCheckStatus).fontSize(15).fontColor('#334155').width('100%')
        Button(this.remoteMode ? '断开模拟服务' : '连接模拟服务').fontSize(15).height(42).borderRadius(10).backgroundColor('#E6F4F1').fontColor('#0F766E').constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).enabled(this.demoMode && this.settingsReady && !this.settingsBusy)
          .onClick(() => { this.toggleGateway(); })
      }
      .padding(this.compactLayout ? 18 : 24)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: '#DCE5EA' })
      .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
      .width('100%')

      // 卡片 4：运行时设备信息
      Column({ space: 12 }) {
        Text('4. 运行时设备信息').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        Text(this.hardwareStatus).fontSize(15.5).lineHeight(23).padding(12).backgroundColor('#F8FAFC').borderRadius(10).width('100%')
        Text('最近完成刷新：' + this.hardwareRefreshTime + ' · 前台每2秒只读刷新').fontSize(14).fontColor('#64748B').width('100%')
        Button(this.hardwareBusy ? '读取中' : '立即刷新真实采集').fontSize(15).height(42).borderRadius(10).backgroundColor('#0F766E').enabled(this.settingsReady && !this.settingsBusy && !this.hardwareBusy)
          .onClick(() => { this.pollHardware(); })
        Text('设备型号：' + deviceInfo.productModel).fontSize(15.5).width('100%')
        Text('显示版本：' + deviceInfo.displayVersion).fontSize(15.5).width('100%')
        Text('系统全名：' + deviceInfo.osFullName).fontSize(15).width('100%')
        Text('运行时API：' + deviceInfo.sdkApiVersion.toString() + ' / 编译目标API：' + COMPILE_API).fontSize(15.5).width('100%')
        Text('编译SDK：' + COMPILE_SDK).fontSize(15).width('100%')
        Text(!this.demoMode ? '数据来源：HH-HSP101真实只读采集' : this.remoteMode ? '数据来源：电脑调试网关 / MQTT软件模拟终端' : '数据来源：应用内软件模拟').fontSize(15.5).width('100%')
        Text(!this.demoMode ? '执行器：未接入；CO/CO₂：未知' : this.env.sensorOnline ? '模拟终端：在线' : '模拟终端：离线 / 状态未知').fontSize(15.5).width('100%')
        Text('台账：' + this.auditStatus).fontSize(15).width('100%')
        Text('摄像头：' + this.cameraStatus).fontSize(15).width('100%')
        Text('语音：' + this.voiceStatus).fontSize(15).width('100%')
        Text('真实采集为独立只读通道；CO/CO₂及执行器未接入。相机与音频以实际运行结果为准。')
          .fontSize(14).fontColor('#64748B').width('100%')
      }
      .padding(this.compactLayout ? 18 : 24)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: '#DCE5EA' })
      .shadow({ radius: 16, color: '#12183328', offsetX: 0, offsetY: 5 })
      .width('100%')
    }.width('100%')
  }

  @Builder
  demoConsole() {
    Column({ space: 12 }) {
      Flex({ wrap: FlexWrap.Wrap }) {
        Button('正常').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => { this.setScenario('normal'); })
        Button('CO 超标').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => { this.setScenario('co'); })
        Button('CO₂ 超标').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => { this.setScenario('co2'); })
        Button('过期').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => { this.setScenario('stale'); })
      }
      Flex({ wrap: FlexWrap.Wrap }) {
        Button(this.cloud ? '断开模拟云端' : '恢复模拟云端').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => { this.cloud = !this.cloud; })
        Button(this.env.sensorOnline ? '断开终端' : '恢复终端').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => {
          if (this.remoteMode) {
            this.setScenario(this.env.sensorOnline ? 'offline' : 'online');
            return;
          }
          this.device.env.sensorOnline = !this.device.env.sensorOnline;
          this.env = this.device.snapshot();
        })
        Button(this.env.emergency ? '解除急停' : '触发急停').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).backgroundColor('#DC2626').onClick(() => {
          if (this.remoteMode) {
            this.setScenario(this.env.emergency ? 'clear_emergency' : 'emergency');
            return;
          }
          this.device.env.emergency = !this.device.env.emergency;
          if (this.device.env.emergency) this.device.stopFan();
          if (this.device.env.emergency) this.settleVentTask('急停触发，执行器已停止', false);
          if (this.device.env.emergency) this.announceAlert();
          this.env = this.device.snapshot(); this.fan = this.device.fan;
          this.addEvent('急停状态', this.env.emergency ? '执行器停止' : '人工解除，须重新核验', '人工操作');
        })
      }
      Button(this.remoteMode ? '断开 MQTT 模拟网关' : '连接 MQTT 模拟网关').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => {
        this.toggleGateway();
      }).enabled(this.settingsReady && !this.settingsBusy)
      Flex({ wrap: FlexWrap.Wrap }) {
        Button(this.soundEnabled ? '关闭演示告警语音' : '开启演示告警语音').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).onClick(() => {
          this.soundEnabled = !this.soundEnabled;
          if (!this.soundEnabled) this.voiceAlert.stop();
        })
        Button('试听提示').fontSize(14.5).height(40).borderRadius(8).constraintSize({ maxWidth: '96%' }).margin({ right: 6, bottom: 6 }).enabled(this.soundEnabled).onClick(() => { this.announceAlert(true); })
      }
      Text(this.voiceStatus).fontSize(13.5).fontColor('#475569').width('100%')
    }.padding(18).backgroundColor('#E6F4F1').borderRadius(12).width('100%')
      .transition(TransitionEffect.OPACITY.animation({ duration: 240, curve: Curve.EaseOut }))
  }

  private resetHardware(message: string): void {
    this.weatherEpoch++;this.weatherBusy = false;this.weatherData = new NativeWeather();this.weatherAdvice = '';this.weatherStatus = '上下文已变化，请重新读取天气';
    if (this.weatherTimer !== -1) { clearTimeout(this.weatherTimer); this.weatherTimer = -1; }
    this.cropReviewEpoch++; this.cropReviewBusy = false; this.cropReviewItems = []; this.cropReviewStatus = '复核上下文已变化，请重新读取';
    this.speechEpoch++; this.speechInput.cancel(); this.speechStatus = '页面或连接变化，语音结果未确认';
    this.directHardware.invalidate();
    this.modelCheckEpoch++;
    if (this.modelCheckBusy) this.modelBusy = false;
    this.modelCheckBusy = false; this.modelCheckStatus = '模型测试状态尚未确认：' + message;
    this.realReportEpoch++; this.realReportBusy = false; this.realReportStatus = '报告上下文未确认；云端各10条、临时网关50/20条，均非全量、非当前。';
    this.analysisHistoryEpoch++; this.analysisHistoryRows = []; this.analysisHistoryBusy = false; this.analysisHistoryStatus = 'AI历史尚未核验：' + message;
    this.imageAnalysisEpoch++; this.imageAnalysisText = ''; this.imageAnalysisBusy = false;
    this.historyEpoch++; this.historyRows = []; this.historyBusy = false; this.historyStatus = '历史尚未核验：' + message;
    this.hardwareEpoch++;
    this.hardwareBusy = false;
    this.hardwareValidUntil = 0;
    this.hardwarePollAt = 0;
    this.hardwareStatus = message + '；温湿度/ADC未知，禁止真实准入';
  }

  private selectPage(index: number): void {
    if (index !== this.currentPage) this.resetHardware('页面已切换，等待读取');
    this.currentPage = index;
    if (index === 4 && !this.demoMode) { const recordEpoch = this.hardwareEpoch; this.refreshHistory().then(() => { if (recordEpoch === this.hardwareEpoch && this.currentPage === 4 && !this.demoMode) this.refreshAnalysisHistory(); }); }
    this.pollHardware();
  }

  private async refreshCropReviews(): Promise<void> {
    if (this.demoMode || !this.cloudSessionReady || this.cropReviewBusy || this.currentPage !== 3) return;
    const epoch = ++this.cropReviewEpoch;
    this.cropReviewBusy = true; this.cropReviewItems = []; this.cropReviewStatus = '正在读取，不显示上一设备或旧页面记录';
    try {
      const result = await this.cloudUpload.readCropReviews();
      if (epoch !== this.cropReviewEpoch || this.currentPage !== 3 || this.demoMode || !this.cloudSessionReady) return;
      this.cropReviewItems = result.items;
      this.cropReviewStatus = '最近10张范围内读取 ' + result.items.length.toString() + ' 条 · ' + new Date(result.readAt).toLocaleString() + '；历史人工记录，非实时健康判断';
    } catch (error) {
      if (epoch === this.cropReviewEpoch) this.cropReviewStatus = '读取未确认：' + (error as Error).message + '；请检查设备云端会话';
    } finally { if (epoch === this.cropReviewEpoch) this.cropReviewBusy = false; }
  }

  private async testModelConfiguration(): Promise<void> {
    if (this.demoMode || !this.settingsReady || this.settingsBusy || this.modelBusy || this.imageAnalysisBusy || this.realReportBusy) return;
    const epoch = ++this.modelCheckEpoch;
    this.modelCheckBusy = true; this.modelBusy = true; this.modelCheckStatus = '正在发送合成测试问题，尚未确认通过';
    try {
      const result = this.cloudSessionReady ? await this.cloudUpload.testModel() : await this.gateway.testModel();
      if (epoch !== this.modelCheckEpoch || this.currentPage !== 5 || this.demoMode) return;
      this.modelCheckStatus = '单次测试通过 · ' + result.provider + ' / ' + result.model + ' · ' + new Date(result.checkedAt).toLocaleString() + ' · ' + result.roundTripMs.toString() + 'ms；不代表持续在线';
    } catch (error) {
      if (epoch === this.modelCheckEpoch && this.currentPage === 5 && !this.demoMode) this.modelCheckStatus = '测试未通过：' + (error as Error).message;
    } finally { if (epoch === this.modelCheckEpoch) { this.modelCheckBusy = false; this.modelBusy = false; } }
  }

  private async exportRealReport(): Promise<void> {
    if (this.hardwareSource === 'direct' && !this.cloudSessionReady) { this.realReportStatus = '请先启用设备云端会话，不能导出旧网关报告冒充当前来源'; return; }
    if (this.demoMode || !this.settingsReady || this.settingsBusy || this.realReportBusy || this.historyBusy || this.analysisHistoryBusy) return;
    const epoch = ++this.realReportEpoch;
    this.realReportBusy = true; this.realReportStatus = '正在读取最近真实记录；不会调用模型或上传照片';
    try {
      const report = this.hardwareSource === 'direct' ? await this.cloudUpload.readRecentReport() : await this.gateway.readRealReport();
      if (epoch !== this.realReportEpoch || this.demoMode || this.currentPage !== 4) return;
      const saved = await NativeDocumentExport.saveJson(report, '棚安-最近真实记录', () => epoch === this.realReportEpoch && !this.demoMode && this.currentPage === 4);
      if (epoch !== this.realReportEpoch || this.demoMode || this.currentPage !== 4) return;
      this.realReportStatus = saved ? (this.hardwareSource === 'direct' ? '设备云端最近记录已保存；采集/AI各10条，非全量，历史非当前，未导出照片。' : '最近真实记录已保存到所选位置；仅最近50/20条，历史非当前，未导出照片。') : '已取消导出，没有报告保存成功';
    } catch (error) {
      if (epoch === this.realReportEpoch) this.realReportStatus = '真实报告导出失败：' + (error as Error).message;
    } finally { if (epoch === this.realReportEpoch) this.realReportBusy = false; }
  }

  private async refreshAnalysisHistory(): Promise<void> {
    if (this.hardwareSource === 'direct' && !this.cloudSessionReady) { this.analysisHistoryRows = []; this.analysisHistoryStatus = '请先启用设备云端会话，未读取旧网关AI历史'; return; }
    if (this.demoMode || !this.settingsReady || this.settingsBusy || this.analysisHistoryBusy || this.historyBusy || this.realReportBusy) return;
    const epoch = ++this.analysisHistoryEpoch;
    this.analysisHistoryBusy = true; this.analysisHistoryRows = []; this.analysisHistoryStatus = '正在读取AI文字分析历史';
    try {
      const history = this.hardwareSource === 'direct' ? await this.cloudUpload.readHistory('analysis') : await this.gateway.readAnalysisHistory();
      if (epoch !== this.analysisHistoryEpoch || this.demoMode) return;
      this.analysisHistoryRows = history.rows; this.analysisHistoryStatus = history.status;
    } catch (error) {
      if (epoch === this.analysisHistoryEpoch) { this.analysisHistoryRows = []; this.analysisHistoryStatus = 'AI历史读取失败：' + (error as Error).message; }
    } finally { if (epoch === this.analysisHistoryEpoch) this.analysisHistoryBusy = false; }
  }

  private async refreshHistory(): Promise<void> {
    if (this.hardwareSource === 'direct' && !this.cloudSessionReady) { this.historyRows = []; this.historyStatus = '请先启用设备云端会话，未读取旧网关采集记录'; return; }
    if (this.demoMode || !this.settingsReady || this.settingsBusy || this.historyBusy || this.analysisHistoryBusy || this.realReportBusy) return;
    const epoch = ++this.historyEpoch;
    this.historyBusy = true; this.historyRows = []; this.historyStatus = '正在读取真实采集历史';
    try {
      const history = this.hardwareSource === 'direct' ? await this.cloudUpload.readHistory('telemetry') : await this.gateway.readHardwareHistory();
      if (epoch !== this.historyEpoch || this.demoMode) return;
      this.historyRows = history.rows; this.historyStatus = history.status;
    } catch (error) {
      if (epoch === this.historyEpoch) { this.historyRows = []; this.historyStatus = '真实历史读取失败：' + (error as Error).message; }
    } finally { if (epoch === this.historyEpoch) this.historyBusy = false; }
  }

  private async pollHardware(): Promise<void> {
    if (this.demoMode || (this.hardwareSource === 'direct' ? !this.directSettingsReady : !this.settingsReady) || this.settingsBusy || this.directSettingsBusy || this.hardwareBusy || this.hardwareTransportBusy || !this.hardwareVisible || (this.currentPage !== 0 && this.currentPage !== 5)) return;
    const epoch = this.hardwareEpoch;
    this.hardwareBusy = true;
    this.hardwareTransportBusy = true;
    this.hardwarePollAt = Date.now();
    try {
      if (this.hardwareSource === 'direct') {
        const direct = await this.directHardware.poll();
        if (epoch !== this.hardwareEpoch || !this.hardwareVisible || this.demoMode) return;
        this.hardwareStatus = direct.text;
        this.hardwareRefreshTime = new Date().toLocaleString() + (direct.deviceOnline ? '' : '（未确认有效帧）');
        this.hardwareValidUntil = 0; // DirectHardwareView locally ages each channel on every render.
        if (direct.deviceOnline && this.cloudUpload.configured() && !this.modelBusy) this.uploadCurrentFrame();
        return;
      }
      const status = await this.gateway.readHardware();
      if (epoch !== this.hardwareEpoch || !this.hardwareVisible) return;
      this.hardwareStatus = status;
      this.hardwareRefreshTime = new Date().toLocaleString();
      this.hardwareValidUntil = this.gateway.hardwareSampleAgeMs >= 0 ? Date.now() + 10000 - this.gateway.hardwareSampleAgeMs : 0;
    } catch (error) {
      if (epoch !== this.hardwareEpoch || !this.hardwareVisible) return;
      this.hardwareStatus = '真实采集读取失败或样本无效，温湿度/ADC均未知；禁止真实准入';
      this.hardwareValidUntil = 0;
      this.hardwareRefreshTime = new Date().toLocaleString() + '（失败）';
    } finally {
      this.hardwareTransportBusy = false;
      if (epoch === this.hardwareEpoch) this.hardwareBusy = false;
    }
  }

  private async saveConnection(): Promise<void> {
    if (!this.settingsReady || this.settingsBusy || this.remoteMode || this.gatewayBusy || this.modelBusy) return;
    this.settingsBusy = true;
    try {
      const address = await this.connectionSettings.save(this.gatewayAddress);
      this.cloudUpload.clear(); this.cloudSessionReady = false;
      this.invalidateConnection();
      this.resetHardware('服务地址已变化，等待读取真实采集');
      this.gateway.configure(address);
      this.savedGatewayAddress = address;
      this.gatewayAddress = address;
      this.modelMode = false;
      this.modelPlan = new ModelPlan();
      this.connectionStatus = '地址已保存，尚未测试连接';
    } catch (error) { this.connectionStatus = '保存失败：' + (error as Error).message; }
    finally { this.settingsBusy = false; }
  }

  private async sendLiveSample(sample: CloudSample): Promise<string> {
    if(!this.queueReady)throw new Error('离线队列尚未就绪');
    const target=this.cloudUpload.queueTarget(),epoch=this.connectionEpoch;
    const key=await this.offlineQueue.enqueue(sample,target);
    this.queueStatus='本地待发 '+this.offlineQueue.count().toString()+' 条';
    if(epoch!==this.connectionEpoch||target!==this.cloudUpload.queueTarget())throw new Error('云端目标变化，原帧留在原目标队列');
    const status=await this.cloudUpload.upload(sample);
    await this.offlineQueue.acknowledge(target,[key]);
    this.queueStatus='本地待发 '+this.offlineQueue.count().toString()+' 条';return status;
  }

  private async uploadCurrentFrame(): Promise<void> {
    const epoch = this.connectionEpoch; let queued = false;
    try {
      const sample = this.directHardware.uploadSample(), target = this.cloudUpload.queueTarget();
      const key = sample.sessionBootId + '/' + sample.frameJson;
      if (key === this.lastUploadAttempt || !this.hardwareVisible || this.demoMode || this.hardwareSource !== 'direct') return;
      if (!this.queueReady) throw new Error('离线队列尚未就绪');
      await this.offlineQueue.enqueue(sample,target); queued = true; this.lastUploadAttempt = key;
      this.queueStatus = '本地待发 '+this.offlineQueue.count().toString()+' 条';
      if(epoch!==this.connectionEpoch||!this.hardwareVisible||this.demoMode)return;
      const status = await this.sendLiveSample(sample);
      await this.offlineQueue.acknowledge(target,[key]);
      if (epoch === this.connectionEpoch && this.hardwareVisible) { this.cloudUploadStatus = status; this.queueStatus = '本地待发 '+this.offlineQueue.count().toString()+' 条'; }
    } catch (error) { if (epoch === this.connectionEpoch) this.cloudUploadStatus = '实时上报未确认：' + (error as Error).message + (queued ? '；已持久化，等待历史补发' : '；本帧未确认入队，请检查队列状态'); }
  }

  private async replayPending(): Promise<void> {
    if(this.replayBusy||!this.queueReady||!this.hardwareVisible||this.demoMode||!this.cloudUpload.configured()||this.modelBusy||this.photoUploadBusy||this.speechBusy)return;
    this.replayBusy=true;this.lastReplayAt=Date.now();const epoch=this.connectionEpoch;
    try{
      const target=this.cloudUpload.queueTarget(),rows=this.offlineQueue.batch(target);
      if(!rows.length)return;
      await this.cloudUpload.replay(rows);
      await this.offlineQueue.acknowledge(target,rows.map((row)=>row.key));
      if(epoch===this.connectionEpoch)this.queueStatus='历史补发已确认；本地剩余 '+this.offlineQueue.count().toString()+' 条。没有更新实时准入。';
    }catch(error){if(epoch===this.connectionEpoch)this.queueStatus='历史补发未确认：'+(error as Error).message+'；原队列保留';}
    finally{this.replayBusy=false;}
  }

  private async protectCredentials(): Promise<void> {
    try{await this.cloudUpload.protect(this.credentialVault);this.credentialStatus='已用HUKS AES-GCM保护；未保存明文令牌';}
    catch(error){this.credentialStatus=(error as Error).message;}
  }
  private async restoreCredentials(): Promise<void> {
    try{const saved=await this.credentialVault.restore();if(saved.base!==this.savedGatewayAddress)throw new Error('保存的HTTPS地址不匹配，请先核对连接配置');
      this.cloudUpload.configure(saved.base,saved.id,saved.token);this.invalidateConnection();this.resetHardware('安全会话已恢复');this.cloudGatewayId=saved.id;this.cloudSessionReady=true;this.lastUploadAttempt='';this.credentialStatus='已恢复HUKS保护的会话';}
    catch(error){this.credentialStatus=(error as Error).message;}
  }
  private async recognizeSpeech(): Promise<void> {
    if(this.speechBusy||this.demoMode||!this.cloudSessionReady||this.currentPage!==1)return;
    this.speechBusy=true;const epoch=++this.speechEpoch;this.speechStatus='正在录音（最多8秒），将送本机/自有服务器转写；可取消';
    try{await this.cloudUpload.checkSpeech();if(epoch!==this.speechEpoch||this.currentPage!==1||this.demoMode)return;const wav=await this.speechInput.capture(this.requireAbilityContext());if(epoch!==this.speechEpoch||this.currentPage!==1||this.demoMode)return;
      this.speechStatus='正在转写；音频不保存、不发送给大模型服务商';const text=await this.cloudUpload.transcribe(wav);
      if(epoch===this.speechEpoch&&this.currentPage===1&&!this.demoMode){this.input=text.slice(0,300);this.speechStatus=text.length>300?'转写较长，前300字已回填，请核对后发送':'转写已回填，请核对文字后点击发送';}}
    catch(error){if(epoch===this.speechEpoch)this.speechStatus='语音未完成：'+(error as Error).message;}
    finally{this.speechBusy=false;}
  }

  private async saveHardwareSource(): Promise<void> {
    if (!this.directSettingsReady || this.directSettingsBusy || this.settingsBusy || this.modelBusy || this.hardwareTransportBusy || this.imageAnalysisBusy || this.realReportBusy || this.remoteMode) return;
    this.directSettingsBusy = true;
    this.directSettingsStatus = '正在保存，当前来源尚未切换';
    try {
      const config = await this.directSettings.save(this.hardwareSourceDraft, this.boardIp);
      this.invalidateConnection(); this.resetHardware('采集来源已切换');
      this.hardwareSource = config.mode; this.hardwareSourceDraft = config.mode;
      this.boardIp = config.boardIp; this.savedBoardIp = config.boardIp;
      this.directHardware.configure(config.boardIp);
      this.messages = [];
      this.directSettingsStatus = '保存完成；' + (config.mode === 'direct' ? '仅本地直采，尚未认证上报云端' : '电脑临时网关模式，使用服务端观测/历史');
    } catch (error) {
      this.directSettingsReady = this.directSettings.isReady();
      this.directSettingsStatus = (error as Error).message;
    } finally { this.directSettingsBusy = false; }
    this.pollHardware();
  }

  private async testConnection(): Promise<void> {
    if (!this.settingsReady || this.settingsBusy || this.remoteMode) return;
    this.settingsBusy = true;
    this.connectionStatus = '正在测试已保存的服务地址';
    try { this.connectionStatus = this.demoMode ? await this.gateway.testConnection() : await this.gateway.testHardware(); }
    catch (error) { this.connectionStatus = '连接测试失败：' + (error as Error).message; }
    finally { this.settingsBusy = false; }
  }

  private invalidateConnection(): void {
    this.cloudUpload.invalidate(); this.cloudTokenInput = '';
    this.settleVentTask('连接或页面已切换，执行与回采结果未确认', false);
    this.connectionEpoch++;
    this.gateway.invalidateSession();
    this.gatewayBusy = false;
    this.modelBusy = false;
    this.modelMode = false;
    this.modelPlan = new ModelPlan();
    this.taskRecords = this.taskRecords.map((task: TaskRecord) => task.title.startsWith('MQTT / ')
      ? TaskFlow.settle(task, '连接已切换，执行与回采结果未确认', false) : task);
    this.activeVentTask = -1;
  }

  private toggleGateway(): void {
    if (!this.demoMode) { this.connectionStatus = '正式数据模式无需连接模拟终端，请使用真实采集或AI分析'; return; }
    if (!this.settingsReady || this.settingsBusy) return;
    this.invalidateConnection();
    this.modelMode = false;
    this.modelPlan = new ModelPlan();
    this.remoteMode = !this.remoteMode;
    if (this.remoteMode) {
      this.connectionStatus = '正在连接模拟服务，等待读数';
      this.device.stopFan();
      this.settleVentTask('切换数据源，本地模拟通风已结束', false);
      const pending = new EnvSnapshot();
      pending.sensorOnline = false;
      pending.sampledAt = 0;
      this.env = pending;
      this.fan = false;
      this.pollGateway();
    } else {
      this.connectionStatus = '已断开模拟服务 · 设备执行结果未知';
      this.settleVentTask('已断开网关联调，任务结果未确认', false);
      this.env = this.device.snapshot();
      this.fan = false;
    }
  }

  @Builder
  weatherPage() {
    Column({ space: 14 }) {
      Text('乌兰察布市 · 集宁城区参考点').fontSize(19).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
      Text('室外预报与棚内观测分开。以下是平台规则风险提示，不是气象部门正式预警，不参与准入或设备执行。').fontSize(14).lineHeight(22).fontColor('#64748B').width('100%')
      Button('读取天气与预警').fontSize(15).height(42).width('100%').backgroundColor('#0F766E').fontColor(Color.White)
        .enabled(!this.demoMode && this.cloudSessionReady && !this.weatherBusy).onClick(() => { this.refreshWeather(); })
      Text(!this.cloudSessionReady ? '请先在设备诊断配置HTTPS设备云端会话。' : this.weatherStatus).fontSize(14).fontColor('#475569').width('100%')
      if (this.weatherData.available) {
        Text('未来24小时：' + this.weatherData.summary.minTemperatureC.toString() + '～' + this.weatherData.summary.maxTemperatureC.toString() + '℃\n最大阵风 ' + this.weatherData.summary.maxGustMs.toString() + 'm/s · 累计降水 ' + this.weatherData.summary.totalRainMm.toString() + 'mm')
          .fontSize(17).lineHeight(26).fontColor('#0F172A').width('100%')
        Text('数据：Open-Meteo · 有效至 ' + new Date(this.weatherData.expiresAt).toLocaleString()).fontSize(13).fontColor('#64748B').width('100%')
        ForEach(this.weatherData.risks,(risk: WeatherRisk) => {
          Column({ space: 8 }) {
            Text(risk.title).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#B45309').width('100%')
            Text(risk.advice).fontSize(15).lineHeight(23).fontColor('#334155').width('100%')
          }.padding(16).backgroundColor('#FFF7ED').borderRadius(12).width('100%')
        },(risk: WeatherRisk) => risk.code)
        if (this.weatherData.risks.length === 0) { Text('未命中预设阈值，不代表没有气象风险。').fontSize(14).fontColor('#475569').width('100%') }
        Text('仅向已保存的采集板IP发送天气摘要。此局域网显示链路尚无设备身份认证，OLED会标记LAN UNVERIFIED；不发送云端令牌，不控制硬件。提示最多有效10分钟。').fontSize(13).lineHeight(21).fontColor('#64748B').width('100%')
        Button('将提示发送至HSP屏幕').fontSize(14).height(42).width('100%').backgroundColor('#E7F3F0').fontColor('#0F766E')
          .enabled(!this.weatherBusy && this.hardwareSource === 'direct' && this.savedBoardIp.length > 0)
          .onClick(() => { this.sendWeatherToBoard(); })
        Text('AI天气农事建议').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        Text('输入作物、生育期及想核查的事项；点击后天气与问题发送给已配置模型，缺失的棚内事实保持未知。').fontSize(13).lineHeight(21).fontColor('#64748B').width('100%')
        TextArea({text:this.weatherQuestion,placeholder:'例如：番茄开花期，低温来临前需要人工核查哪些项目？'}).maxLength(500).height(100)
          .onChange((value: string) => { this.weatherQuestion = value; })
        Button('生成天气农事建议').fontSize(14).height(42).width('100%').backgroundColor('#0F766E').fontColor(Color.White)
          .enabled(!this.weatherBusy && this.cloudSessionReady).onClick(() => { this.requestWeatherAdvice(); })
        if (this.weatherAdvice.length > 0) { Text(this.weatherAdvice).fontSize(15).lineHeight(24).fontColor('#334155').width('100%') }
      }
      Button('前往设备诊断').fontSize(14).height(40).width('100%').backgroundColor('#E7F3F0').fontColor('#0F766E').onClick(() => { this.selectPage(5); })
    }.padding(16).backgroundColor(Color.White).borderRadius(16).width('100%')
  }

  private async refreshWeather(): Promise<void> {
    if (this.weatherBusy || this.demoMode || !this.cloudSessionReady || this.currentPage !== 7) return;
    if (this.weatherTimer !== -1) { clearTimeout(this.weatherTimer); this.weatherTimer = -1; }
    const epoch = ++this.weatherEpoch;this.weatherBusy = true;this.weatherData = new NativeWeather();this.weatherAdvice = '';this.weatherStatus = '正在读取天气…';
    try {
      const data = await this.cloudUpload.readWeather();
      if (epoch !== this.weatherEpoch || this.currentPage !== 7 || this.demoMode) return;
      this.weatherData = data;this.weatherStatus = '天气已读取；预报为室外参考，棚内情况请核对现场。';
      this.weatherTimer = setTimeout(() => { if (epoch === this.weatherEpoch) { this.weatherData = new NativeWeather();this.weatherAdvice = '';this.weatherStatus = '天气已过期，风险未知，请重新读取'; } },Math.max(0,data.expiresAt - Date.now()));
    } catch(error) { if (epoch === this.weatherEpoch) this.weatherStatus = '读取失败：' + (error as Error).message; }
    finally { if (epoch === this.weatherEpoch) this.weatherBusy = false; }
  }

  private async sendWeatherToBoard(): Promise<void> {
    if (this.weatherBusy || this.demoMode || !this.weatherData.available || this.currentPage !== 7) return;
    const epoch = this.weatherEpoch;this.weatherBusy = true;
    try { await relayWeather(this.savedBoardIp,this.weatherData);if (epoch === this.weatherEpoch) this.weatherStatus = 'HSP已确认收到局域网天气摘要；屏幕实际显示尚需目视核验。'; }
    catch(error) { if (epoch === this.weatherEpoch) this.weatherStatus = 'HSP未确认：' + (error as Error).message; }
    finally { if (epoch === this.weatherEpoch) this.weatherBusy = false; }
  }
  private async requestWeatherAdvice(): Promise<void> {
    if (this.weatherBusy || this.demoMode || !this.cloudSessionReady || !this.weatherData.available || this.currentPage !== 7) return;
    const epoch = this.weatherEpoch;this.weatherBusy = true;this.weatherAdvice = '';this.weatherStatus = '正在请求天气建议；不执行设备…';
    try {
      const text = await this.cloudUpload.generateWeatherAdvice(this.weatherQuestion);
      if (epoch === this.weatherEpoch && this.weatherData.available) { this.weatherAdvice = text;this.weatherStatus = '天气建议已保存，请人工核对。'; }
    } catch(error) { if (epoch === this.weatherEpoch) this.weatherStatus = '建议未确认：' + (error as Error).message + '。请核对Web审计后再决定是否重试。'; }
    finally { if (epoch === this.weatherEpoch) this.weatherBusy = false; }
  }

  @Builder
  featureLink(title: string, description: string, page: number, mode: number = 0) {
    Column({ space: 7 }) {
      Row() {
        Text(title).fontSize(17).fontWeight(FontWeight.Bold).fontColor('#0F172A').layoutWeight(1)
        Button('进入 →').fontSize(13).height(34).borderRadius(8).backgroundColor('#E7F3F0').fontColor('#0F766E')
          .onClick(() => {
            if (page === 1) this.agentViewMode = mode;
            if (page === 3) this.cropViewMode = mode;
            this.selectPage(page);
          })
      }.width('100%')
      Text(description).fontSize(14).fontColor('#64748B').lineHeight(21).width('100%')
    }.padding(15).backgroundColor(Color.White).borderRadius(12).width('100%')
  }

  @Builder
  featureCenter() {
    Column({ space: 14 }) {
      Text('农业助手').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
      Text('先选场景，再核对问题并发送。以下场景共用已接入的只读分析管线，缺失现场数据可能阻止分析。')
        .fontSize(14).lineHeight(22).fontColor('#64748B').width('100%')
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
        ForEach(this.agricultureScenes, (title: string, index: number) => {
          Button(title).width('48%').height(44).fontSize(14).margin({ bottom: 8 }).borderRadius(10)
            .backgroundColor(this.selectedAgricultureScene === index ? '#0F766E' : '#E7F3F0')
            .fontColor(this.selectedAgricultureScene === index ? Color.White : '#0F766E')
            .onClick(() => { this.selectedAgricultureScene = index; })
        }, (title: string) => title)
      }.width('100%')
      Column({ space: 10 }) {
        Text(this.agricultureScenes[this.selectedAgricultureScene] + ' · 问题模板').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
        Text(this.agriculturePrompts[this.selectedAgricultureScene]).fontSize(15).lineHeight(23).fontColor('#334155').width('100%')
        if (this.input.trim().length > 0) {
          Text('助手已有草稿。替换需点击下方明确按钮，原有对话记录保留。').fontSize(13).fontColor('#B45309').width('100%')
          Button('保留草稿，进入助手').fontSize(14).height(40).width('100%').backgroundColor('#E7F3F0').fontColor('#0F766E')
            .onClick(() => { this.agentViewMode = 1; this.selectPage(1); })
        }
        Button(this.input.trim().length > 0 ? '替换草稿，使用此模板' : '填入助手，编辑后发送')
          .fontSize(14).height(42).width('100%').backgroundColor('#0F766E').fontColor(Color.White)
          .enabled(!this.modelBusy && !this.pipelineBusy && !this.speechBusy)
          .onClick(() => { this.input = this.agriculturePrompts[this.selectedAgricultureScene]; this.agentViewMode = 1; this.selectPage(1); })
      }.padding(16).backgroundColor(Color.White).borderRadius(12).width('100%')
      Text('现场与协作').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
      this.featureLink('天气与预警', '乌兰察布室外预报与六类平台风险提示，可手动转发至HSP屏幕。', 7)
      this.featureLink('拍照巡查', '原生相机采集作物照片；照片由你主动选择和提交。', 3, 0)
      this.featureLink('作物复核', '读取本设备最近10张作物图的人工结论，不代表多光谱检测或当前健康。', 3, 1)
      this.featureLink('智能体流程', '查看决策、生成、审核的依据与状态；未接执行器时不显示真实执行成功。', 1, 2)
      this.featureLink('任务中心', '查看任务步骤、待确认事项与结果。', 2)
      this.featureLink('数据与报告', '查看采集和AI历史，导出最近记录；不是全量历史导出。', 4)
      Text('连接与维护').fontSize(21).fontWeight(FontWeight.Bold).fontColor('#0F172A').width('100%')
      this.featureLink('离线补发与连接', this.queueStatus + '；前往诊断核对云端连接、补发与凭据。', 5)
      this.featureLink('语音输入', '在助手中录音、核对识别文字后发送；需要麦克风权限及云端识别服务。', 1, 1)
    }.width('100%')
  }

  @Builder
  compactNavigation() {
    Column({ space: 10 }) {
      Row({ space: 10 }) {
        Text('棚').fontSize(18).fontWeight(FontWeight.Bold).fontColor(Color.White)
          .width(32).height(32).textAlign(TextAlign.Center).backgroundColor('#348E83').borderRadius(10)
        Text('棚安 · 智慧农业').fontSize(17).fontWeight(FontWeight.Bold).fontColor('#F8FAFC').layoutWeight(1)
        Button('更多功能').fontSize(12).height(30).borderRadius(8).backgroundColor(this.currentPage === 6 ? '#348E83' : '#202E42').fontColor(Color.White)
          .onClick(() => { this.selectPage(6); })
      }.width('100%')
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
        ForEach(this.titles.slice(0, 6), (title: string, index: number) => {
          Button(title).width('31.8%').height(34).fontSize(13).borderRadius(10)
            .margin({ bottom: 6 }).fontWeight(this.currentPage === index ? FontWeight.Bold : FontWeight.Medium)
            .backgroundColor(this.currentPage === index ? '#348E83' : '#202E42')
            .fontColor(this.currentPage === index ? Color.White : '#C2CEDD')
            .animation({ duration: 220, curve: Curve.FastOutSlowIn })
            .onClick(() => { animateTo({ duration: 220, curve: Curve.EaseOut }, () => { this.selectPage(index); }); })
        }, (title: string) => title)
      }.width('100%')
    }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 4 }).backgroundColor('#111C2D')
  }

  build() {
    Row() {
      if (!this.compactLayout) {
        Column({ space: 14 }) {
          Text('棚安').fontSize(34).fontWeight(FontWeight.Bold).fontColor(Color.White).margin({ bottom: 8 })
          Text('智慧农业 · 原生终端').fontSize(13).fontColor('#A8B9CB').margin({ bottom: 26 })
          ForEach(this.titles, (title: string, index: number) => {
            Button(title)
              .constraintSize({ maxWidth: '96%' })
              .margin({ right: 6, bottom: 6 })
              .width('92%')
              .height(50)
              .borderRadius(10)
              .backgroundColor(this.currentPage === index ? '#0F766E' : '#202E42')
              .fontColor(this.currentPage === index ? Color.White : '#CBD5E1')
              .fontSize(16.5)
              .fontWeight(this.currentPage === index ? FontWeight.Bold : FontWeight.Medium)
              .animation({ duration: 220, curve: Curve.FastOutSlowIn })
              .onClick(() => {
                animateTo({ duration: 260, curve: Curve.FastOutSlowIn }, () => {
                  this.selectPage(index);
                });
              })
          }, (title: string) => title)
          Blank()
          Text('真实采集 0.1\nDAYU200 + HH-HSP\n执行器未接入').fontSize(13.5).fontColor('#94A3B8').lineHeight(24)
        }.padding({ top: 32, bottom: 24 }).width(210).height('100%').backgroundColor('#111C2D')
      }
      Column() {
        if (this.compactLayout) {
          this.compactNavigation()
        }
        Row() {
          Text('工作台 / ' + this.titles[this.currentPage]).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#475569').layoutWeight(1)
          Button(this.demoMode ? '退出演示模式' : '进入演示模式')
            .constraintSize({ maxWidth: '96%' })
            .margin({ right: 6, bottom: 6 })
            .fontSize(14.5)
            .height(40)
            .borderRadius(10)
            .backgroundColor(this.demoMode ? '#FEF3C7' : '#E6F4F1')
            .fontColor(this.demoMode ? '#B45309' : '#0F766E')
            .onClick(() => {
              animateTo({ duration: 260, curve: Curve.FastOutSlowIn }, () => {
                this.demoMode = !this.demoMode;
                this.consoleOpen = this.demoMode;
                this.messages = [];
                this.modelPlan = new ModelPlan();
                this.modelMode = false;
                this.connectionEpoch++;
                this.modelBusy = false;
                this.remoteMode = false;
                this.gateway.configure(this.savedGatewayAddress);
                this.resetHardware('运行模式已切换');
                if (this.currentPage === 4 && !this.demoMode) {
                  const recordEpoch = this.hardwareEpoch;
                  this.refreshHistory().then(() => {
                    if (recordEpoch === this.hardwareEpoch && this.currentPage === 4 && !this.demoMode) this.refreshAnalysisHistory();
                  });
                }
              });
            })
        }.padding(this.compactLayout ? 14 : 20).backgroundColor(Color.White).width('100%')
        Scroll() {
          Column({ space: 20 }) {
            if (this.demoMode && this.consoleOpen) {
              this.demoConsole()
            }
            Text(!this.demoMode ? '真实采集与AI分析 · 缺失数据为未知' : this.remoteMode ? 'MQTT 网关联调 · 终端与执行器模拟 · 摄像头可按需启用' : '环境与执行器为模拟 · 摄像头可按需启用')
              .fontSize(14).fontColor('#64748B').width('100%')
            Row({ space: 8 }) {
              Text(this.titles[this.currentPage]).fontSize(this.compactLayout ? 24 : 30).fontWeight(FontWeight.Bold).fontColor('#0F172A').layoutWeight(1)
              Text(!this.demoMode ? '真实数据模式' : this.cloud ? '模拟云在线' : '本地自治')
                .fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.demoMode ? '#B45309' : '#475569')
                .padding({ left: 8, right: 8, top: 5, bottom: 5 }).backgroundColor(this.demoMode ? '#FEF3C7' : '#E2E8F0').borderRadius(8)
            }.width('100%')
            if (this.currentPage === 0) {
              this.homePage()
            } else if (this.currentPage === 1) {
              this.agentPage()
            } else if (this.currentPage === 2) {
              this.taskPage()
            } else if (this.currentPage === 3) {
              this.monitorPage()
            } else if (this.currentPage === 4) {
              this.recordsPage(false)
            } else if (this.currentPage === 6) {
              this.featureCenter()
            } else if (this.currentPage === 7) {
              this.weatherPage()
            } else {
              this.diagnosticsPage()
            }
            Text(this.feedback).fontSize(14.5).fontColor('#64748B').width('100%')
          }.padding(this.compactLayout ? 16 : 28).width('100%')
        }.layoutWeight(1).width('100%').align(Alignment.Top)
      }.layoutWeight(1).height('100%').backgroundColor('#EEF2F6')
    }.width('100%').height('100%')
      .onAreaChange((oldArea: Area, newArea: Area) => {
        this.compactLayout = Number(newArea.width) < 840 || Number(newArea.height) > Number(newArea.width);
      })
  }
}
