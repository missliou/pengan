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

// 契约第 3 节的响应形状；测试只驱动真实 .ets，不启动服务、不碰设备。
const stage = (name, state, extra = {}) => ({ stage: name, state, startedAt: 1730000000000,
  finishedAt: 1730000000120, durationMs: 120, summary: name + ' 阶段摘要', error: null, ...extra });
const audit = (extra = {}) => ({ verdict: 'allow', reasons: ['低风险，无需人工确认'],
  ruleHits: [{ ruleId: 'R-CO', passed: true, detail: 'CO 5ppm 低于演示阈值 30ppm' }], missingEvidence: [],
  modelVerdict: 'allow', authoritative: 'rules', ...extra });
const response = (prompt = '现场 CO 偏高，现在该不该开风机', extra = {}) => ({
  kind: 'agent_pipeline', pipelineVersion: 1, traceId: 'trace-native-001', requestedAt: 1730000000000,
  prompt, mode: 'simulation', provider: 'deepseek', model: 'deepseek-chat', calls: 2,
  executed: false, hardwareControl: false,
  stages: [stage('decision', 'passed'), stage('generate', 'passed'), stage('verify', 'passed')],
  decision: { intent: '询问通风', situation: 'CO 读数偏低', confidence: 0.92, riskLevel: 'low',
    candidates: [{ action: 'ventilate', reason: '可降低 CO', riskLevel: 'low', requiresConfirmation: false, maxRunMs: 5000 }],
    openQuestions: [] },
  plan: { summary: '先查询环境再决定是否为模拟通风', steps: [{ action: 'query_environment',
    reason: '确认当前读数', requiresConfirmation: false, maxRunMs: 3000, processed: false }],
    evidence: [{ ref: 'env.co', value: 5, observedAt: 1730000000000, fresh: true }] },
  audit: audit(), memory: { used: 0, sources: [] }, ...extra,
});

// 只替换系统能力：网络、偏好、编码器。逻辑全部来自仓库里的真实 .ets。
function host() {
  let reply = { responseCode: 200, result: JSON.stringify(response()) }, transportError = null;
  const requestsLog = [], cache = new Map();
  const mocks = {
    '@ohos.data.preferences': { default: { async getPreferences() {
      let working;
      return { async get(_k, fallback) { return working ?? fallback; }, async put(_k, v) { working = v; }, async flush() {} };
    } } },
    '@ohos.app.ability.common': { default: {} },
    '@ohos.util': { default: { TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } } } },
    '@ohos.net.http': { default: { RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 0 },
      createHttp() { return { async request(url, opts) {
        if (transportError) throw transportError;
        requestsLog.push({ url, opts }); return reply;
      }, destroy() {} }; } } },
  };
  const clock = class extends Date { static now() { return 1730000000000; } };
  const context = vm.createContext({ Date: clock, console, Map, Set, JSON, Error, Number, Math, Array, Object });
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const scopedRequire = name => { if (mocks[name]) return mocks[name]; if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ets')); throw Error('Unmocked dependency: ' + name); };
    vm.runInContext('(function(require,module,exports){' + code + '\n})', context, { filename: file })(scopedRequire, module, module.exports);
    return module.exports;
  }
  return { load, context, requestsLog, respond: value => reply = value, transport: value => transportError = value };
}

test('三阶段管线只调用 POST /api/agent/pipeline，且请求体只有 prompt 字段', async () => {
  const h = host();
  const { GatewayLink } = h.load(path.join(services, 'GatewayLink.ets'));
  const link = new GatewayLink();
  const result = await link.pipeline('开风机吗');
  assert.equal(h.requestsLog.length, 1);
  assert.ok(h.requestsLog[0].url.endsWith('/api/agent/pipeline'), h.requestsLog[0].url);
  assert.equal(h.requestsLog[0].opts.method, 'POST');
  assert.deepEqual(Object.keys(JSON.parse(h.requestsLog[0].opts.extraData)), ['prompt']);
  assert.deepEqual(JSON.parse(h.requestsLog[0].opts.extraData), { prompt: '开风机吗' });
  assert.equal(h.requestsLog[0].opts.connectTimeout, 3000);
  assert.equal(h.requestsLog[0].opts.readTimeout, 30000);
  assert.equal(result.executed, false);
  assert.equal(result.hardwareControl, false);
});

test('三阶段管线响应映射为契约模型对象，字段与枚举逐字一致', async () => {
  const h = host();
  const { GatewayLink } = h.load(path.join(services, 'GatewayLink.ets'));
  const wire = JSON.stringify(response());
  h.respond({ responseCode: 200, result: wire });
  const result = await new GatewayLink().pipeline(response().prompt);
  assert.equal(JSON.stringify(result), wire);
  assert.equal(result.kind, 'agent_pipeline');
  assert.equal(result.pipelineVersion, 1);
  assert.deepEqual(result.stages.map(item => item.stage), ['decision', 'generate', 'verify']);
  assert.deepEqual(result.stages.map(item => item.state), ['passed', 'passed', 'passed']);
  assert.equal(result.audit.verdict, 'allow');
  assert.equal(result.audit.authoritative, 'rules');
  assert.equal(result.decision.candidates[0].action, 'ventilate');
  assert.equal(result.plan.steps[0].processed, false);
  assert.equal(result.mode, 'simulation');
});

test('三阶段管线拒绝越界响应：阶段失败不得放行、计划不得已处理、不得执行设备', async () => {
  const h = host();
  const { GatewayLink } = h.load(path.join(services, 'GatewayLink.ets'));
  const link = new GatewayLink();
  h.respond({ responseCode: 200, result: JSON.stringify(response('问题', { executed: true })) });
  await assert.rejects(link.pipeline('问题'), /不得执行设备/);
  h.respond({ responseCode: 200, result: JSON.stringify(response('问题', {
    stages: [stage('decision', 'failed', { error: 'model_call_failed' }), stage('generate', 'passed'), stage('verify', 'passed')] })) });
  await assert.rejects(link.pipeline('问题'), /阶段失败时不得直接放行/);
  h.respond({ responseCode: 200, result: JSON.stringify(response('问题', {
    plan: { summary: '越界计划', steps: [{ action: 'ventilate', reason: '自动执行', requiresConfirmation: false, maxRunMs: 5000, processed: true }], evidence: [] } })) });
  await assert.rejects(link.pipeline('问题'), /不得标记已处理/);
});

test('HTTP 失败与 JSON 解析失败都返回可见错误态，不崩溃也不静默', async () => {
  const h = host();
  const { GatewayLink } = h.load(path.join(services, 'GatewayLink.ets'));
  const { AgentPipelineView } = h.load(path.join(services, 'AgentPipelineView.ets'));
  const link = new GatewayLink();
  h.respond({ responseCode: 500, result: '{"error":"internal"}' });
  const httpError = await link.pipeline('问题').then(() => null, error => error);
  assert.ok(httpError, '500 必须抛错');
  assert.match(httpError.message, /本地网关请求失败，HTTP 500/);
  const httpText = AgentPipelineView.errorText(httpError);
  assert.match(httpText, /三阶段管线未返回有效结果/);
  assert.match(httpText, /HTTP 500/);
  assert.match(httpText, /未执行设备操作/);
  h.respond({ responseCode: 200, result: '<html>not json</html>' });
  await assert.rejects(link.pipeline('问题'), /三阶段管线响应不是有效JSON/);
  h.transport(Error('connect time out'));
  const transportError = await link.pipeline('问题').then(() => null, error => error);
  assert.match(transportError.message, /网关请求失败/);
  h.transport(null);
  await assert.rejects(link.pipeline(''), /请输入1至2000字的意图/);
  await assert.rejects(link.pipeline('长'.repeat(2001)), /请输入1至2000字的意图/);
  assert.equal(h.requestsLog.length, 2);
});

test('verdict → 文案与颜色三分支：allow 绿、needs_human 琥珀、block 红', () => {
  const h = host();
  const { AgentPipelineView } = h.load(path.join(services, 'AgentPipelineView.ets'));
  assert.match(AgentPipelineView.verdictText('allow'), /直接通过/);
  assert.equal(AgentPipelineView.verdictColor('allow'), '#216E49');
  assert.match(AgentPipelineView.verdictText('needs_human'), /需人工确认/);
  assert.equal(AgentPipelineView.verdictColor('needs_human'), '#B26A00');
  assert.match(AgentPipelineView.verdictText('block'), /已拦截/);
  assert.equal(AgentPipelineView.verdictColor('block'), '#A8493B');
  assert.match(AgentPipelineView.verdictText('surprise'), /未识别/);
  assert.equal(AgentPipelineView.verdictColor('surprise'), '#7C8D7E');
  const blocked = AgentPipelineView.badge(audit({ verdict: 'block', reasons: ['命中 R-CO'], authoritative: 'rules' }));
  assert.match(blocked.text, /已拦截/);
  assert.equal(blocked.color, '#A8493B');
  assert.equal(blocked.reasons[0], '命中 R-CO');
  const human = AgentPipelineView.badge(audit({ verdict: 'needs_human', authoritative: 'model' }));
  assert.equal(human.color, '#B26A00');
  assert.match(human.authorityText, /模型复核/);
  const allow = AgentPipelineView.badge(audit({ reasons: [] }));
  assert.equal(allow.color, '#216E49');
  assert.match(allow.reasons[0], /未给出理由/);
});

test('stage state → 色点三分支：passed 绿、blocked 红、failed 琥珀', () => {
  const h = host();
  const { AgentPipelineView } = h.load(path.join(services, 'AgentPipelineView.ets'));
  assert.equal(AgentPipelineView.stageDotColor('passed'), '#216E49');
  assert.equal(AgentPipelineView.stageDotColor('blocked'), '#A8493B');
  assert.equal(AgentPipelineView.stageDotColor('failed'), '#B26A00');
  assert.equal(AgentPipelineView.stageDotColor('mystery'), '#7C8D7E');
  assert.match(AgentPipelineView.stageStateText('passed'), /通过/);
  assert.match(AgentPipelineView.stageStateText('blocked'), /拦截/);
  assert.match(AgentPipelineView.stageStateText('failed'), /失败/);
  const cards = AgentPipelineView.stageCards(JSON.parse(JSON.stringify(response('问题', {
    stages: [stage('decision', 'passed'), stage('generate', 'failed', { error: 'model_call_failed' }), stage('verify', 'blocked')] }))));
  assert.equal(cards.length, 3);
  assert.equal(Array.from(cards, card => card.dotColor).join(','), '#216E49,#B26A00,#A8493B');
  assert.equal(Array.from(cards, card => card.title).join(','), '决策,生成,审核');
  assert.equal(cards[1].durationText, '120ms');
  assert.match(cards[1].error, /model_call_failed/);
});

test('Index 三阶段管线入口有加载/失败/成功可见文案，不静默失败', async () => {
  const h = host();
  const index = readFileSync(path.join(root, 'openharmony/entry/src/main/ets/pages/Index.ets'), 'utf8');
  const match = index.match(new RegExp('  private async requestAgentPipeline\\([\\s\\S]*?\\n  }'));
  assert.ok(match, 'requestAgentPipeline must be a real Index method');
  const code = ts.transpileModule('class PipelineHarness {\n' + match[0] + '\n}; PipelineHarness;',
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  h.context.AgentPipelineView = h.load(path.join(services, 'AgentPipelineView.ets')).AgentPipelineView;
  h.context.PipelineVerdictBadge = h.load(path.join(services, 'AgentPipelineView.ets')).PipelineVerdictBadge;
  const Harness = vm.runInContext(code, h.context);
  const ui = new Harness(); const events = []; let sent = 0;
  Object.assign(ui, { pipelineBusy: false, pipelineStatus: '', pipelineError: '', pipelineInput: '  开风机吗 ',
    pipelineStageCards: [], pipelineDetailRows: [], pipelineBadge: new h.context.PipelineVerdictBadge(),
    remoteMode: false, settingsReady: true, settingsBusy: false, connectionEpoch: 0,
    addEvent: (title, detail, source) => { events.push(title + '/' + detail + '/' + source); } });
  ui.gateway = { pipeline: async () => { sent++; throw Error('should not send'); } };
  await ui.requestAgentPipeline();
  assert.equal(sent, 0);
  assert.match(ui.pipelineError, /未连接服务端/);
  ui.remoteMode = true; ui.pipelineInput = '   ';
  await ui.requestAgentPipeline();
  assert.match(ui.pipelineError, /请输入1至2000字/);
  assert.equal(sent, 0);
  ui.pipelineInput = '开风机吗';
  ui.gateway = { pipeline: async prompt => { sent++; assert.equal(prompt, '开风机吗'); return JSON.parse(JSON.stringify(response('开风机吗', { audit: audit({ verdict: 'block', reasons: ['命中 R-CO'] }) }))); } };
  await ui.requestAgentPipeline();
  assert.equal(sent, 1);
  assert.equal(ui.pipelineBadge.verdict, 'block');
  assert.equal(ui.pipelineBadge.color, '#A8493B');
  assert.equal(ui.pipelineStageCards.length, 3);
  assert.ok(ui.pipelineDetailRows.length > 0);
  assert.match(ui.pipelineStatus, /模拟模式/);
  assert.match(ui.pipelineStatus, /未执行设备/);
  assert.equal(ui.pipelineError, '');
  assert.equal(events.length, 1);
  ui.gateway = { pipeline: async () => { throw Error('本地网关请求失败，HTTP 502'); } };
  await ui.requestAgentPipeline();
  assert.match(ui.pipelineError, /三阶段管线未返回有效结果/);
  assert.match(ui.pipelineError, /HTTP 502/);
  assert.equal(ui.pipelineStageCards.length, 0);
  assert.equal(ui.pipelineStatus, '三阶段管线未返回有效结果');
});
