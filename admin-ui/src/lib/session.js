import { ApiError } from './api.js';

export class PageScope {
  constructor() { this.controller = new AbortController(); this.disposers = []; }
  get signal() { return this.controller.signal; }
  get active() { return !this.signal.aborted; }
  assertActive() { if (!this.active) throw new ApiError('页面或运行模式已变化，旧结果已作废', { kind: 'stale' }); }
  onDispose(fn) { if (!this.active) fn(); else this.disposers.push(fn); }
  dispose() {
    if (!this.active) return;
    this.controller.abort();
    for (const fn of this.disposers.splice(0)) { try { fn(); } catch { /* keep disposing */ } }
  }
}

// Held until the actual transport settles, including across navigation or logout.
export class MutationGate {
  busy = false;
  async run(scope, demoMode, fn) {
    scope.assertActive();
    if (demoMode) throw new ApiError('演示模式只读，不发送配置或模型测试请求', { kind: 'demo_read_only' });
    if (this.busy) throw new ApiError('上一项操作尚未结束，请稍后重试', { kind: 'busy' });
    this.busy = true;
    try { const result = await fn(); scope.assertActive(); return result; }
    catch (error) { scope.assertActive(); throw error; }
    finally { this.busy = false; }
  }
}
