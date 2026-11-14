import * as realApi from './api.js';
import { DEMO, demoCall } from '../demo.js';
import { ApiError } from './api.js';

// A page captures its mode once. Old promises cannot silently switch data sources.
export function createDataSource({ scope, demoMode, gate, live, api = realApi, now = Date.now, gatewayId = '', role = 'admin' }) {
  function write(fn) {
    if (!demoMode && role !== 'admin') return Promise.reject(new ApiError('当前账号只读，不能修改配置或调用模型测试',{kind:'forbidden',status:403}));
    return gate.run(scope,demoMode,fn);
  }
  async function read(name, args = [], sample) {
    scope.assertActive();
    const result = demoMode && sample ? await demoCall(sample) :
      demoMode ? await Promise.reject(new ApiError('演示模式不读取真实管理数据', { kind: 'demo_read_only' })) :
      await api[name](...args, { signal: scope.signal, gatewayId });
    scope.assertActive();
    return result;
  }
  const source = {
    getHealth: () => read('getHealth', [], () => DEMO.health()),
    getModelStatus: () => read('getModelStatus', [], () => DEMO.modelStatus()),
    getModelConfig: () => read('getModelConfig', [], () => ({ ...DEMO.modelStatus(), keySaved: false, csrfToken: '', workspaceId: '' })),
    getHardwareHistory: opts => read('getHardwareHistory', [opts], () => DEMO.hardwareHistory()),
    getAnalysisHistory: opts => read('getAnalysisHistory', [opts], () => DEMO.analysisHistory()),
    async getObservations() {
      const startedAt = now();
      try {
        const result = await read('getObservations', [], () => DEMO.observations());
        if (!demoMode) return live.ingest(result, startedAt);
        return result;
      } catch (error) { if (scope.active && !demoMode) live.invalidate(); throw error; }
    },
    // Writes are not aborted on navigation: their result may already be committed server-side.
    saveModelConfig: (body, token) => write(() => api.saveModelConfig(body, token)),
    testModelConnection: () => write(() => api.testModelConnection()),
  };
  for (const name of ['getRealReport', 'listDevices', 'getAgentTasks', 'getSystemStatus', 'getAuditEvents']) source[name] = () => read(name);
  source.listPipelineTasks = () => read('listPipelineTasks');
  source.listMedia = params => read('listMedia',[params]);
  source.getStorageStatus = () => read('getStorageStatus');
  source.listCropImages = params => read('listCropImages',[params]);
  source.getWeather = () => read('getWeather');
  source.generateWeatherAdvice = body => write(()=>api.generateWeatherAdvice(body,{gatewayId}));
  source.getCropReview = id => read('getCropReview',[id]);
  source.getCropReviewVersions = id => read('getCropReviewVersions',[id]);
  source.saveCropReview = body => write(()=>api.saveCropReview(body,{gatewayId}));
  source.getAgentPrompts = () => read('getAgentPrompts');
  source.uploadMedia = body => write(()=>api.uploadMedia(body,{gatewayId}));
  source.mediaContentUrl = id => { scope.assertActive(); if(demoMode)throw new ApiError('演示模式禁止读取真实图片',{kind:'demo_read_only'}); return api.mediaContentUrl(id,{gatewayId}); };
  source.readPipelineTask = id => read('readPipelineTask', [id]);
  source.listKnowledge = () => read('listKnowledge');
  for (const name of ['startPipeline','saveKnowledge','searchKnowledge']) source[name] = body => write(() => api[name](body, {gatewayId}));
  // 人工审核：队列与详情按当前设备读取；提交必须经 MutationGate 且仅 admin。
  source.listReviewQueue = params => read('listReviewQueue', [params]);
  source.readReviewTask = id => read('readReviewTask', [id]);
  source.submitReview = body => write(() => api.submitReview(body, {gatewayId}));
  // 告警中心：统计与列表/详情按当前设备读取（scope.signal 一并传入，切页即 abort）；
  // 确认与备注必须经 MutationGate 且仅 admin，viewer 与演示模式在发请求前就被拒绝。
  source.listAlerts = params => read('listAlerts', [params]);
  source.readAlert = id => read('readAlert', [id]);
  source.acknowledgeAlert = body => write(() => api.acknowledgeAlert(body, {gatewayId}));
  source.noteAlert = body => write(() => api.noteAlert(body, {gatewayId}));
  return source;
}
