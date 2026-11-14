import { ApiError } from './api.js';
const fail = message => { throw new ApiError(message, { kind: 'validation' }); };
export class ModelEditor {
  constructor({ scope, dataSource, demoMode = false }) { Object.assign(this, { scope, dataSource, demoMode }); this.config = null; this.status = null; this.busy = false; this.errors = []; }
  async load() {
    const results = await Promise.allSettled([this.dataSource.getModelConfig(), this.dataSource.getModelStatus()]);
    this.scope.assertActive();
    this.errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
    this.config = results[0].status === 'fulfilled' ? results[0].value : null;
    this.status = results[1].status === 'fulfilled' ? results[1].value : null;
    if (this.config && (typeof this.config.keySaved !== 'boolean' || typeof this.config.csrfToken !== 'string')) { this.config = null; this.errors.push('配置协议无效'); }
  }
  async perform(kind, draft = {}) {
    this.scope.assertActive();
    if (this.demoMode) fail('演示模式只读，不会修改服务器或调用模型');
    if (this.busy) fail('已有操作进行中，请等待结束');
    if (!this.config?.csrfToken) fail('缺少已核验配置或配置令牌，请先刷新');
    this.busy = true;
    if (this.status) this.status = { ...this.status, connectionCheck: { state: 'never' } };
    try {
      let result;
      if (kind === 'test') {
        result = await this.dataSource.testModelConnection();
        if (result?.kind !== 'model_connection_check' || result.ok !== true || result.fieldDataSent !== false || result.imageSent !== false || result.executed !== false ||
            !['deepseek','qwen'].includes(result.provider) || typeof result.model !== 'string' || !result.model || !Number.isFinite(result.checkedAt) || !Number.isFinite(result.roundTripMs)) fail('模型测试响应未确认，不能视为通过');
      } else {
        let body;
        if (kind === 'clear') {
          if (!this.config.keySaved) fail('当前未保存密钥');
          body = { provider: this.config.provider, model: this.config.model, clearKey: true };
          if (this.config.provider === 'qwen' && this.config.workspaceId) body.workspaceId = this.config.workspaceId;
        } else if (kind === 'save') {
          const provider = draft.provider, model = draft.model?.trim(), key = draft.key || '';
          if (!['deepseek','qwen'].includes(provider) || typeof model !== 'string' || !/^[-A-Za-z0-9._:/]{1,150}$/.test(model)) fail('请选择服务商并填写合法模型名');
          if (!key && (!this.config.keySaved || provider !== this.config.provider)) fail('新增或切换服务商时需要填写该服务商密钥');
          body = { provider, model };
          if (key) body.key = key;
          if (provider === 'qwen' && draft.workspaceId?.trim()) body.workspaceId = draft.workspaceId.trim();
        } else fail('未知配置操作');
        result = await this.dataSource.saveModelConfig(body, this.config.csrfToken);
        if (typeof result?.configured !== 'boolean' || typeof result?.keySaved !== 'boolean') fail('保存响应未确认，请重新读取配置核对');
      }
      this.scope.assertActive();
      await this.load();
      return { kind, result, refreshed: this.errors.length === 0 };
    } catch (error) {
      if (this.scope.active) { this.config = null; this.status = null; this.errors = ['操作结果未确认，请刷新配置核对。']; }
      throw error;
    } finally { this.busy = false; }
  }
}
