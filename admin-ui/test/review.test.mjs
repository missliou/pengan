// 人工审核中心前端回归（QWEN-HUMAN-REVIEW-20261103，执行者 Qwen-3.8）。
// 覆盖：队列筛选、详情展开、admin/viewer 权限、硬规则 block 不可通过、
//       版本校验、防重复提交、保存未确认、会话失效、演示模式隔离、无 null 泄漏。
// 使用最小 DOM 宿主执行真实页面模块，不作布局证据。
import test from 'node:test';
import assert from 'node:assert/strict';
import {installDom, button, input, find, flush} from './helpers/dom.mjs';
import renderReview from '../src/pages/review.js';
import {PageScope, MutationGate} from '../src/lib/session.js';

function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return {promise, resolve, reject}; }

function context(t, dataSource, extra = {}) {
  const scope = new PageScope(); t.after(() => scope.dispose());
  return {
    scope, gate: new MutationGate(), state: {gatewayId: 'dayu-a', user: {username: 'admin', role: 'admin'}},
    dataSource, demoMode: false, live: null, markStatus() {}, setConnection() {}, notify() {}, navigate() {}, ...extra,
  };
}

const queueOf = (items, counts = {}) => ({
  schemaVersion: 1, gatewayId: 'dayu-a', filter: {verdict: 'needs_human', reviewStatus: null, limit: 50},
  counts: {needs_human: items.length, block: 0, allow: 0, pending: items.length, reviewed: 0, unfinished: 0, ...counts},
  items, total: items.length, historical: true, isCurrent: false, executed: false,
  scope: 'recent-audit-window', note: '队列为最近审计窗口派生视图，不是全量归档。',
});

const queueItem = (over = {}) => ({
  taskId: 't-human', gatewayId: 'dayu-a', status: 'completed', verdict: 'needs_human', modelVerdict: 'needs_human',
  authoritative: 'rules', riskLevel: 'high', confidence: 0.42, prompt: '棚内闷热，是否可以通风',
  startedAt: 1_000, finishedAt: 2_000, version: 3, reviewStatus: 'pending', reviewCount: 0,
  humanDecision: null, historical: true, isCurrent: false, executed: false, ...over,
});

const detailOf = (over = {}) => ({
  schemaVersion: 1, taskId: 't-human', gatewayId: 'dayu-a', status: 'completed', actor: 'admin', sessionBootId: 'boot-1',
  prompt: '棚内闷热，是否可以通风', startedAt: 1_000, finishedAt: 2_000, error: null, version: 3, verdict: 'needs_human',
  audit: {verdict: 'needs_human', reasons: ['决策阶段风险等级为 high，需人工审核'], ruleHits: [
    {ruleId: 'R-ESTOP', passed: true, detail: '急停未触发'},
    {ruleId: 'R-CO-INVALID', passed: false, detail: 'CO 读数非法：缺失、非有限或为负；未接入按非法处理'},
  ], missingEvidence: [], modelVerdict: 'needs_human', authoritative: 'rules'},
  decision: {intent: '通风', situation: '棚内闷热', confidence: 0.42, riskLevel: 'high', candidates: [], openQuestions: ['是否已现场确认']},
  plan: {summary: '两步计划', steps: [{action: 'ventilate', reason: '换气', maxRunMs: 5_000, requiresConfirmation: true, processed: false}], evidence: []},
  stages: [{stage: 'decision', state: 'passed', startedAt: 1_000, finishedAt: 1_100, durationMs: 100, summary: '意图「通风」', error: null}],
  retrieval: {method: 'lexical', untrusted: true, items: [{chunkId: 'c1', documentId: 'd1', title: '通风规程', source: 'manual', content: '先测气体再通风', score: 1.5, contentSha256: 'b'.repeat(64)}]},
  memory: {used: 0, sources: []}, traceId: 'ap-test', provider: 'deepseek', model: 'deepseek-chat', calls: 3,
  events: [{seq: 1, type: 'task_started', at: 1_000, data: {readOnly: true}}, {seq: 2, type: 'retrieval_completed', at: 1_050, data: {method: 'lexical'}}],
  reviews: [], reviewStatus: 'pending', humanDecision: null, canApprove: true, canReject: true, blockedReason: null,
  historical: true, isCurrent: false, executed: false, hardwareControl: false, deviceCommandIssued: false, ...over,
});

const receiptOf = (over = {}) => ({
  schemaVersion: 1, ok: true, duplicate: false, taskId: 't-human', gatewayId: 'dayu-a',
  review: {seq: 12, recordedAt: 5_000, reviewSeq: 1, taskId: 't-human', gatewayId: 'dayu-a', decision: 'approve', comment: '现场确认', actor: 'admin', version: 3, originalVerdict: 'needs_human', fingerprint: 'f'.repeat(64)},
  originalVerdict: 'needs_human', finalVerdict: 'needs_human', modelConclusionUnchanged: true, reviewStatus: 'reviewed',
  humanDecision: 'approve', historical: true, isCurrent: false, executed: false, hardwareControl: false, deviceCommandIssued: false, ...over,
});

function source(extra = {}) {
  return {
    listReviewQueue: async () => queueOf([queueItem()]),
    readReviewTask: async () => detailOf(),
    submitReview: async () => receiptOf(),
    ...extra,
  };
}

// ---------- 队列 ----------

test('review: 队列渲染 needs_human 任务、筛选器与如实的范围说明', async t => {
  installDom(t);
  const root = await renderReview(context(t, source()));
  await flush();
  assert.match(root.textContent, /t-human/);
  assert.match(root.textContent, /棚内闷热，是否可以通风/);
  assert.match(root.textContent, /needs_human/);
  assert.match(root.textContent, /最近审计窗口/);
  // 筛选控件存在
  assert.ok(input(root, 'review-verdict'));
  assert.ok(input(root, 'review-status'));
  assert.ok(button(root, '刷新审核队列'));
});

test('review: 队列空时显示明确空态，不编造任务', async t => {
  installDom(t);
  const root = await renderReview(context(t, source({listReviewQueue: async () => queueOf([])})));
  await flush();
  assert.match(root.textContent, /暂无待人工审核任务|没有符合筛选条件的任务/);
  assert.doesNotMatch(root.textContent, /t-human/);
});

test('review: 切换筛选重新查询且带上筛选参数', async t => {
  installDom(t);
  const calls = [];
  const root = await renderReview(context(t, source({
    listReviewQueue: async (params) => { calls.push(params); return queueOf([]); },
  })));
  await flush();
  assert.deepEqual(calls.at(-1), {verdict: 'needs_human', reviewStatus: null});
  input(root, 'review-verdict').value = 'block';
  input(root, 'review-status').value = 'reviewed';
  await button(root, '刷新审核队列').click(); await flush();
  assert.deepEqual(calls.at(-1), {verdict: 'block', reviewStatus: 'reviewed'});
});

test('review: 队列读取失败给出分类提示，不显示 null', async t => {
  installDom(t);
  const root = await renderReview(context(t, source({listReviewQueue: async () => { throw Object.assign(Error('后端不可达'), {kind: 'offline'}); }})));
  await flush();
  assert.match(root.textContent, /后端未连接/);
  assert.doesNotMatch(root.textContent, /null/);
});

// ---------- 详情 ----------

test('review: 详情展示问题、阶段、风险原因、硬规则命中、RAG 引用与阶段事件', async t => {
  installDom(t);
  const root = await renderReview(context(t, source()));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  const text = root.textContent;
  assert.match(text, /棚内闷热，是否可以通风/);                    // 问题
  assert.match(text, /意图「通风」/);                             // 阶段结果
  assert.match(text, /R-CO-INVALID/);                             // 硬规则命中
  assert.match(text, /CO 读数非法/);
  assert.match(text, /决策阶段风险等级为 high/);                   // 风险原因
  assert.match(text, /通风规程/);                                  // RAG 引用标题
  assert.match(text, /先测气体再通风/);
  assert.match(text, /task_started/);                              // 阶段事件
  assert.match(text, /retrieval_completed/);
  assert.match(text, /riskLevel|high/);
  // 明确声明只读、不下发控制
  assert.match(text, /不下发设备控制|未下发设备控制|不会下发/);
  assert.doesNotMatch(text, /null/);
});

test('review: RAG 引用明确标注为未可信资料，不当作传感证据', async t => {
  installDom(t);
  const root = await renderReview(context(t, source()));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  assert.match(root.textContent, /未可信|不可信|仅供参考/);
  assert.match(root.textContent, /lexical/);
});

test('review: 历史人工意见按顺序展示，含作者与决策', async t => {
  installDom(t);
  const detail = detailOf({
    reviews: [
      {seq: 9, recordedAt: 4_000, reviewSeq: 1, taskId: 't-human', gatewayId: 'dayu-a', decision: 'reject', comment: '证据不足，先驳回', actor: 'admin-a', version: 3, originalVerdict: 'needs_human', fingerprint: 'f1'},
      {seq: 10, recordedAt: 4_500, reviewSeq: 2, taskId: 't-human', gatewayId: 'dayu-a', decision: 'approve', comment: '补充现场照片后同意', actor: 'admin-b', version: 3, originalVerdict: 'needs_human', fingerprint: 'f2'},
    ],
    reviewStatus: 'reviewed', humanDecision: 'approve',
  });
  const root = await renderReview(context(t, source({readReviewTask: async () => detail})));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  assert.match(root.textContent, /证据不足，先驳回/);
  assert.match(root.textContent, /补充现场照片后同意/);
  assert.match(root.textContent, /admin-a/);
  assert.match(root.textContent, /admin-b/);
});

// ---------- 权限 ----------

test('review: viewer 只读——提交区禁用并说明原因，不发写请求', async t => {
  installDom(t);
  let calls = 0;
  const ctx = context(t, source({submitReview: async () => { calls += 1; return receiptOf(); }}),
    {state: {gatewayId: 'dayu-a', user: {username: 'reader', role: 'viewer'}}});
  const root = await renderReview(ctx); await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  assert.match(root.textContent, /只读|无写入权限/);
  assert.equal(button(root, '通过（人工确认）').disabled, true);
  assert.equal(button(root, '驳回').disabled, true);
  await button(root, '通过（人工确认）').click(); await flush();
  assert.equal(calls, 0);
});

test('review: admin 可提交通过，界面不谎称改变了模型结论', async t => {
  installDom(t);
  const submitted = [];
  const root = await renderReview(context(t, source({
    submitReview: async (body) => { submitted.push(body); return receiptOf(); },
  })));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  input(root, 'review-comment').value = '现场已确认通风口畅通，同意';
  await button(root, '通过（人工确认）').click(); await flush();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].decision, 'approve');
  assert.equal(submitted[0].comment, '现场已确认通风口畅通，同意');
  assert.equal(submitted[0].version, 3);          // 版本来自详情，防止基于过期快照
  assert.equal(submitted[0].taskId, 't-human');
  assert.match(root.textContent, /已保存|服务端已确认/);
  // 原模型结论保持不变，界面如实说明
  assert.match(root.textContent, /needs_human/);
  assert.match(root.textContent, /原结论|模型结论.*不变|保持不变/);
  assert.equal(input(root, 'review-comment').value, '');
});

// ---------- 硬规则 block 不可人工通过 ----------

test('review: block 任务禁用"通过"、保留"驳回"，并说明硬规则不可覆盖', async t => {
  installDom(t);
  const blocked = detailOf({
    taskId: 't-block',
    verdict: 'block', canApprove: false, canReject: true,
    audit: {verdict: 'block', reasons: ['CO 32 达到演示拒止阈值 30'], ruleHits: [{ruleId: 'R-CO', passed: false, detail: 'CO 32 达到演示拒止阈值 30'}], missingEvidence: [], modelVerdict: 'block', authoritative: 'rules'},
  });
  let calls = 0;
  const root = await renderReview(context(t, source({
    listReviewQueue: async () => queueOf([queueItem({taskId: 't-block', verdict: 'block'})]),
    readReviewTask: async () => blocked,
    submitReview: async () => { calls += 1; return receiptOf({originalVerdict: 'block', finalVerdict: 'block'}); },
  })));
  await flush();
  await button(root, 't-block · block').click(); await flush();
  assert.equal(button(root, '通过（人工确认）').disabled, true);
  assert.equal(button(root, '驳回').disabled, false);
  assert.match(root.textContent, /硬规则|不可被人工|不能通过人工/);
  await button(root, '通过（人工确认）').click(); await flush();
  assert.equal(calls, 0);
});

test('review: 未完成任务不可审核，界面说明原因而非静默禁用', async t => {
  installDom(t);
  const root = await renderReview(context(t, source({
    listReviewQueue: async () => queueOf([queueItem({taskId: 't-running', status: 'running', verdict: null})]),
    readReviewTask: async () => detailOf({taskId: 't-running', status: 'running', version: 1, verdict: null, audit: null, canApprove: false, canReject: false, blockedReason: 'review_task_not_finished'}),
  })));
  await flush();
  await button(root, 't-running · running').click(); await flush();
  assert.equal(button(root, '通过（人工确认）').disabled, true);
  assert.match(root.textContent, /未完成|尚未完成/);
});

// ---------- 防重复提交与并发 ----------

test('review: 连续点击只提交一次，提交中按钮锁定', async t => {
  installDom(t);
  const pending = deferred(); let calls = 0;
  const root = await renderReview(context(t, source({
    submitReview: () => { calls += 1; return pending.promise; },
  })));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  input(root, 'review-comment').value = '同意';
  const first = button(root, '通过（人工确认）').click();
  assert.equal(button(root, '通过（人工确认）').disabled, true);
  await button(root, '通过（人工确认）').click();
  await button(root, '驳回').click();
  assert.equal(calls, 1);
  pending.resolve(receiptOf()); await first; await flush();
  assert.equal(calls, 1);
});

test('review: 空意见不发请求并就地提示', async t => {
  installDom(t);
  let calls = 0;
  const root = await renderReview(context(t, source({submitReview: async () => { calls += 1; return receiptOf(); }})));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  input(root, 'review-comment').value = '   ';
  await button(root, '通过（人工确认）').click(); await flush();
  assert.equal(calls, 0);
  assert.match(root.textContent, /请填写审核意见|意见不能为空/);
});

test('review: 提交失败显示"未确认"并保留意见，不谎报成功', async t => {
  installDom(t);
  const root = await renderReview(context(t, source({
    submitReview: async () => { throw Object.assign(Error('连接中断'), {kind: 'offline'}); },
  })));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  input(root, 'review-comment').value = '同意通风';
  await button(root, '通过（人工确认）').click(); await flush();
  assert.match(root.textContent, /未确认/);
  assert.doesNotMatch(root.textContent, /已保存/);
  assert.equal(input(root, 'review-comment').value, '同意通风');
  assert.equal(button(root, '通过（人工确认）').disabled, false);
});

test('review: 版本过期被服务端拒绝时提示重新载入，不重复提交', async t => {
  installDom(t);
  let calls = 0;
  const root = await renderReview(context(t, source({
    submitReview: async () => { calls += 1; throw Object.assign(Error('请求失败（review_stale_version）'), {kind: 'http', status: 400, code: 'review_stale_version'}); },
  })));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  input(root, 'review-comment').value = '基于旧快照的意见';
  await button(root, '通过（人工确认）').click(); await flush();
  assert.equal(calls, 1);
  assert.match(root.textContent, /版本|已变化|重新载入/);
  assert.match(root.textContent, /未确认|未保存/);
});

test('review: 会话失效（403）提示重新登录，不假装已保存', async t => {
  installDom(t);
  const root = await renderReview(context(t, source({
    submitReview: async () => { throw Object.assign(Error('请求失败（admin_forbidden）'), {kind: 'forbidden', status: 403, code: 'admin_forbidden'}); },
  })));
  await flush();
  await button(root, 't-human · needs_human').click(); await flush();
  input(root, 'review-comment').value = '同意';
  await button(root, '通过（人工确认）').click(); await flush();
  assert.match(root.textContent, /会话|权限|重新登录/);
  assert.doesNotMatch(root.textContent, /已保存/);
});

// ---------- 演示模式隔离 ----------

test('review: 演示模式明确标注样例数据且不调用任何真实写接口', async t => {
  installDom(t);
  let listCalls = 0, submitCalls = 0;
  const root = await renderReview(context(t, source({
    listReviewQueue: async () => { listCalls += 1; return queueOf([]); },
    submitReview: async () => { submitCalls += 1; return receiptOf(); },
  }), {demoMode: true}));
  await flush();
  assert.equal(listCalls, 0);
  assert.match(root.textContent, /演示|样例/);
  assert.match(root.textContent, /不会保存|不调用真实|未连接真实/);
  // 演示模式下仍可查看详情结构
  const demoTask = button(root, '演示任务 · needs_human');
  if (demoTask) { await demoTask.click(); await flush(); }
  const approve = button(root, '通过（人工确认）');
  if (approve) { assert.equal(approve.disabled, true); await approve.click(); await flush(); }
  assert.equal(submitCalls, 0);
  assert.doesNotMatch(root.textContent, /null/);
});

// ---------- 生命周期 ----------

test('review: 页面卸载后迟到结果不再写入 DOM', async t => {
  installDom(t);
  const pending = deferred();
  const ctx = context(t, source({listReviewQueue: () => pending.promise}));
  const root = await renderReview(ctx);
  ctx.scope.dispose();
  pending.resolve(queueOf([queueItem()])); await flush();
  assert.doesNotMatch(root.textContent, /t-human/);
});

test('review: late success/failure for A preserves B details and draft', async t => {
 installDom(t);
 for(const failed of [false,true]){
  const pending=deferred();let reads=0;const root=await renderReview(context(t,source({listReviewQueue:async()=>queueOf([queueItem({taskId:'a'}),queueItem({taskId:'b'})]),readReviewTask:async id=>{reads++;return detailOf({taskId:id});},submitReview:()=>pending.promise})));
  await flush();await button(root,'a · needs_human').click();await flush();input(root,'review-comment').value='A review';const writing=button(root,'通过（人工确认）').click();
  await button(root,'b · needs_human').click();await flush();const field=input(root,'review-comment');field.value='B draft';const before=reads;
  if(failed)pending.reject(Error('late A failure'));else pending.resolve(receiptOf({taskId:'a'}));
  await writing;await flush();assert.equal(input(root,'review-comment'),field);assert.equal(field.value,'B draft');assert.equal(reads,before);assert.doesNotMatch(root.textContent,/late A failure/);
 }
});
