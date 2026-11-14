// 人工审核中心回归（QWEN-HUMAN-REVIEW-20261103，执行者 Qwen-3.8）。
// 覆盖：队列派生与筛选、详情、硬规则 block 不可人工通过、原模型结论不变、
//       防重复提交、版本校验、并发冲突、重启恢复、设备隔离、只读不下发控制。
// 使用真实 CloudHistory（哈希链 + 原子落盘），不 mock 持久化。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CloudHistory} from '../cloud-history.mjs';
import {HumanReview} from '../human-review.mjs';

const SHA = 'a'.repeat(64);

// 写入一条与 PipelineTasks.record 同形状的 pipeline_state 审计行。
async function seedTask(history, {gatewayId = 'dayu-a', taskId, verdict = 'needs_human', status = 'completed', events = 3, riskLevel = 'high', confidence = 0.5, prompt = '棚内闷热，是否可以通风', ruleHits = [], modelVerdict = verdict, authoritative = 'rules'} = {}) {
  const task = {
    taskId, gatewayId, prompt, actor: 'admin', sessionBootId: 'boot-1', status,
    startedAt: 1_000, finishedAt: status === 'completed' ? 2_000 : undefined,
    events: [], historical: true, isCurrent: false, executed: false,
  };
  for (let i = 1; i <= events; i += 1) task.events.push({seq: i, type: 'stage_started', at: 1_000 + i, data: {stage: 'decision'}});
  if (status === 'completed') {
    task.result = {
      kind: 'agent_pipeline', pipelineVersion: 1, traceId: 'ap-test', requestedAt: 1_000,
      prompt, mode: 'hardware', provider: 'deepseek', model: 'deepseek-chat',
      executed: false, hardwareControl: false, calls: 3,
      retrieval: {method: 'lexical', untrusted: true, items: [{chunkId: 'c1', documentId: 'd1', title: '通风规程', source: 'manual', content: '先测气体再通风', score: 1.5, contentSha256: SHA}]},
      decision: {intent: '通风', situation: '棚内闷热', confidence, riskLevel, candidates: [], openQuestions: []},
      plan: {summary: '两步计划', steps: [{action: 'ventilate', reason: '换气', maxRunMs: 5_000, requiresConfirmation: true, processed: false}], evidence: []},
      audit: {verdict, reasons: ['需人工审核'], ruleHits, missingEvidence: [], modelVerdict, authoritative},
      memory: {used: 0, sources: []},
      stages: [{stage: 'decision', state: 'passed', startedAt: 1_000, finishedAt: 1_100, durationMs: 100, summary: 'ok', error: null}],
    };
  }
  await history.append({kind: 'audit', gatewayId, data: {event: 'pipeline_state', actor: 'admin', task}});
  return task;
}

async function env() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pengan-review-'));
  const history = await new CloudHistory({file: path.join(dir, 'history.jsonl')}).open();
  const review = await new HumanReview({history}).open();
  return {
    dir, history, review,
    // 模拟服务重启：丢弃内存态，只从同一保留文件重建。
    async restart() {
      await history.flush();
      const reopened = await new CloudHistory({file: path.join(dir, 'history.jsonl')}).open();
      return {history: reopened, review: await new HumanReview({history: reopened}).open()};
    },
    async close() { await rm(dir, {recursive: true, force: true}); },
  };
}

// ---------- 队列派生与筛选 ----------

test('队列默认只列 needs_human，block 与 allow 不混入', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    await seedTask(ctx.history, {taskId: 't-block', verdict: 'block', ruleHits: [{ruleId: 'R-CO', passed: false, detail: 'CO 超限'}], modelVerdict: 'block'});
    await seedTask(ctx.history, {taskId: 't-allow', verdict: 'allow', riskLevel: 'low', confidence: 0.95, modelVerdict: 'allow'});
    const queue = ctx.review.queue({gatewayId: 'dayu-a'});
    assert.deepEqual(queue.items.map(i => i.taskId), ['t-human']);
    assert.equal(queue.items[0].verdict, 'needs_human');
    assert.equal(queue.counts.needs_human, 1);
    assert.equal(queue.counts.block, 1);
    assert.equal(queue.counts.allow, 1);
    assert.equal(queue.counts.pending, 1);
    assert.equal(queue.counts.reviewed, 0);
  } finally { await ctx.close(); }
});

test('队列可按 verdict 显式查看 block 任务', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-block', verdict: 'block'});
    await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    const queue = ctx.review.queue({gatewayId: 'dayu-a', verdict: 'block'});
    assert.deepEqual(queue.items.map(i => i.taskId), ['t-block']);
    assert.equal(queue.filter.verdict, 'block');
  } finally { await ctx.close(); }
});

test('队列可按审核状态筛选待审与已审', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '已现场确认，同意通风', version: task.events.length, actor: 'admin'});
    await seedTask(ctx.history, {taskId: 't-other', verdict: 'needs_human'});
    const reviewed = ctx.review.queue({gatewayId: 'dayu-a', reviewStatus: 'reviewed'});
    assert.deepEqual(reviewed.items.map(i => i.taskId), ['t-human']);
    assert.equal(reviewed.items[0].reviewStatus, 'reviewed');
    assert.equal(reviewed.items[0].reviewCount, 1);
    const pending = ctx.review.queue({gatewayId: 'dayu-a', reviewStatus: 'pending'});
    assert.deepEqual(pending.items.map(i => i.taskId), ['t-other']);
  } finally { await ctx.close(); }
});

test('同一任务只保留最新快照，不把中间态当多条队列项', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-1', verdict: 'needs_human', events: 1});
    await seedTask(ctx.history, {taskId: 't-1', verdict: 'needs_human', events: 2});
    await seedTask(ctx.history, {taskId: 't-1', verdict: 'needs_human', events: 3});
    const queue = ctx.review.queue({gatewayId: 'dayu-a'});
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].version, 3);
  } finally { await ctx.close(); }
});

test('非法筛选值被拒绝而不是静默忽略', async () => {
  const ctx = await env();
  try {
    assert.throws(() => ctx.review.queue({gatewayId: 'dayu-a', verdict: 'maybe'}), /invalid_review_query/);
    assert.throws(() => ctx.review.queue({gatewayId: 'dayu-a', reviewStatus: 'done'}), /invalid_review_query/);
    assert.throws(() => ctx.review.queue({gatewayId: 'dayu-a', limit: 0}), /invalid_review_query/);
    assert.throws(() => ctx.review.queue({gatewayId: 'dayu-a', limit: 5000}), /invalid_review_query/);
  } finally { await ctx.close(); }
});

test('队列如实标注范围是最近窗口而非全量', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    const queue = ctx.review.queue({gatewayId: 'dayu-a'});
    assert.equal(queue.historical, true);
    assert.equal(queue.isCurrent, false);
    assert.equal(queue.scope, 'recent-audit-window');
    assert.equal(queue.executed, false);
  } finally { await ctx.close(); }
});

// ---------- 设备隔离 ----------

test('队列与详情按 gatewayId 隔离，跨设备读取报未找到', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {gatewayId: 'dayu-a', taskId: 't-a', verdict: 'needs_human'});
    await seedTask(ctx.history, {gatewayId: 'dayu-b', taskId: 't-b', verdict: 'needs_human'});
    assert.deepEqual(ctx.review.queue({gatewayId: 'dayu-a'}).items.map(i => i.taskId), ['t-a']);
    assert.deepEqual(ctx.review.queue({gatewayId: 'dayu-b'}).items.map(i => i.taskId), ['t-b']);
    // 用 A 的设备身份读 B 的任务：不得泄露存在性。
    assert.throws(() => ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-b'}), /review_task_not_found/);
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-b', decision: 'approve', comment: '越权审核', version: 3, actor: 'admin'}),
      /review_task_not_found/,
    );
  } finally { await ctx.close(); }
});

// ---------- 详情 ----------

test('详情给出问题、阶段结果、风险原因、RAG 引用、阶段事件与审核记录', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {
      taskId: 't-human', verdict: 'needs_human', riskLevel: 'high', confidence: 0.42,
      ruleHits: [{ruleId: 'R-SAMPLE-STALE', passed: true, detail: '采样时效内'}],
    });
    const detail = ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'});
    assert.equal(detail.taskId, 't-human');
    assert.equal(detail.prompt, '棚内闷热，是否可以通风');
    assert.equal(detail.version, 3);
    assert.equal(detail.audit.verdict, 'needs_human');
    assert.equal(detail.decision.riskLevel, 'high');
    assert.equal(detail.decision.confidence, 0.42);
    assert.deepEqual(detail.audit.ruleHits.map(h => h.ruleId), ['R-SAMPLE-STALE']);
    assert.equal(detail.retrieval.items[0].title, '通风规程');
    assert.equal(detail.stages[0].stage, 'decision');
    assert.equal(detail.events.length, 3);
    assert.deepEqual(detail.reviews, []);
    assert.equal(detail.reviewStatus, 'pending');
    assert.equal(detail.canApprove, true);
    assert.equal(detail.canReject, true);
    assert.equal(detail.executed, false);
    assert.equal(detail.hardwareControl, false);
  } finally { await ctx.close(); }
});

test('详情对未完成任务标记不可审核，不伪造结论', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-running', verdict: 'needs_human', status: 'running', events: 1});
    const detail = ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-running'});
    assert.equal(detail.status, 'running');
    assert.equal(detail.canApprove, false);
    assert.equal(detail.canReject, false);
    assert.equal(detail.audit, null);
    assert.equal(detail.blockedReason, 'review_task_not_finished');
  } finally { await ctx.close(); }
});

// ---------- 硬规则 block 不可被人工通过 ----------

test('硬规则 block 的任务人工通过被拒，且拒止原因保留', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {
      taskId: 't-block', verdict: 'block', modelVerdict: 'block', authoritative: 'rules',
      ruleHits: [{ruleId: 'R-CO', passed: false, detail: 'CO 32 达到演示拒止阈值 30'}],
    });
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-block', decision: 'approve', comment: '我认为可以放行', version: task.events.length, actor: 'admin'}),
      /hard_rule_block_approve_denied/,
    );
    // 被拒后不得留下任何"已通过"的记录。
    const detail = ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-block'});
    assert.equal(detail.reviewStatus, 'pending');
    assert.deepEqual(detail.reviews, []);
    assert.equal(detail.audit.verdict, 'block');
    assert.equal(detail.canApprove, false);
    assert.equal(detail.canReject, true);
  } finally { await ctx.close(); }
});

test('模型加严为 block 时同样不可人工通过', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-model-block', verdict: 'block', modelVerdict: 'block', authoritative: 'model', ruleHits: []});
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-model-block', decision: 'approve', comment: '模型太保守', version: task.events.length, actor: 'admin'}),
      /hard_rule_block_approve_denied/,
    );
  } finally { await ctx.close(); }
});

test('block 任务允许人工驳回，驳回不改变 block 结论', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-block', verdict: 'block', modelVerdict: 'block'});
    const saved = await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-block', decision: 'reject', comment: '确认维持拒止', version: task.events.length, actor: 'admin'});
    assert.equal(saved.ok, true);
    assert.equal(saved.originalVerdict, 'block');
    assert.equal(saved.finalVerdict, 'block');
    assert.equal(saved.modelConclusionUnchanged, true);
    assert.equal(saved.deviceCommandIssued, false);
  } finally { await ctx.close(); }
});

test('allow 任务不接受人工决策，避免伪造复核', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-allow', verdict: 'allow', riskLevel: 'low', confidence: 0.95, modelVerdict: 'allow'});
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-allow', decision: 'approve', comment: '补个章', version: task.events.length, actor: 'admin'}),
      /review_not_required/,
    );
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-allow', decision: 'reject', comment: '我想驳回', version: task.events.length, actor: 'admin'}),
      /review_not_required/,
    );
  } finally { await ctx.close(); }
});

// ---------- 人工意见作为独立追加记录，原结论不变 ----------

test('人工通过后原模型结论与硬规则命中完全不变', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {
      taskId: 't-human', verdict: 'needs_human', modelVerdict: 'needs_human',
      ruleHits: [{ruleId: 'R-SENSOR-OFFLINE', passed: true, detail: '传感终端在线'}],
    });
    const before = ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'});
    const saved = await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '现场已确认通风口畅通，同意', version: task.events.length, actor: 'admin'});
    const after = ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'});
    assert.equal(saved.originalVerdict, 'needs_human');
    assert.equal(saved.modelConclusionUnchanged, true);
    assert.equal(after.audit.verdict, 'needs_human');
    assert.equal(after.audit.modelVerdict, before.audit.modelVerdict);
    assert.deepEqual(after.audit.ruleHits, before.audit.ruleHits);
    assert.deepEqual(after.stages, before.stages);
    assert.deepEqual(after.retrieval, before.retrieval);
    // 人工结论是独立字段，不覆盖 audit。
    assert.equal(after.humanDecision, 'approve');
    assert.equal(after.reviewStatus, 'reviewed');
    assert.equal(after.canApprove, false);
  } finally { await ctx.close(); }
});

test('人工意见逐条追加保存，保留每条的作者、时间与版本', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'reject', comment: '证据不足，先驳回', version: task.events.length, actor: 'admin-a'});
    await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '补充现场照片后同意', version: task.events.length, actor: 'admin-b'});
    const detail = ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'});
    assert.equal(detail.reviews.length, 2);
    assert.deepEqual(detail.reviews.map(r => r.decision), ['reject', 'approve']);
    assert.deepEqual(detail.reviews.map(r => r.actor), ['admin-a', 'admin-b']);
    assert.equal(detail.reviews[0].reviewSeq, 1);
    assert.equal(detail.reviews[1].reviewSeq, 2);
    assert.equal(detail.humanDecision, 'approve');
    assert.ok(detail.reviews[1].recordedAt >= detail.reviews[0].recordedAt);
  } finally { await ctx.close(); }
});

test('审核记录写入持久化审计链，可在审计事件里查到', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '同意', version: task.events.length, actor: 'admin'});
    const audits = ctx.history.query({kind: 'audit', gatewayId: 'dayu-a', limit: 200}).items;
    const saved = audits.filter(row => row.data.event === 'human_review_saved');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].data.taskId, 't-human');
    assert.equal(saved[0].data.decision, 'approve');
    assert.equal(saved[0].data.actor, 'admin');
    assert.equal(typeof saved[0].hash, 'string');
  } finally { await ctx.close(); }
});

test('审核永不下发设备控制，返回体恒定声明未执行', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    const saved = await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '同意通风', version: task.events.length, actor: 'admin'});
    assert.equal(saved.executed, false);
    assert.equal(saved.hardwareControl, false);
    assert.equal(saved.deviceCommandIssued, false);
    const detail = ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'});
    assert.equal(detail.executed, false);
    assert.equal(detail.hardwareControl, false);
    assert.equal(detail.deviceCommandIssued, false);
  } finally { await ctx.close(); }
});

// ---------- 输入校验 ----------

test('非法决策、空意见与超长意见被拒', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    const version = task.events.length;
    const submit = (body) => ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', version, actor: 'admin', ...body});
    await assert.rejects(submit({decision: 'maybe', comment: '意见'}), /invalid_review_decision/);
    await assert.rejects(submit({decision: 'APPROVE', comment: '意见'}), /invalid_review_decision/);
    await assert.rejects(submit({decision: 'approve', comment: ''}), /invalid_review_comment/);
    await assert.rejects(submit({decision: 'approve', comment: '   '}), /invalid_review_comment/);
    await assert.rejects(submit({decision: 'approve', comment: 123}), /invalid_review_comment/);
    await assert.rejects(submit({decision: 'approve', comment: '长'.repeat(2001)}), /invalid_review_comment/);
    await assert.rejects(submit({decision: 'approve', comment: '意见', extra: 1}), /invalid_review_body/);
    // 全部被拒后不得留下记录。
    assert.equal(ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'}).reviews.length, 0);
  } finally { await ctx.close(); }
});

// ---------- 版本校验与防重复提交 ----------

test('版本不匹配时拒绝提交，防止基于过期状态审核', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human', events: 3});
    const submit = (version) => ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '同意', version, actor: 'admin'});
    await assert.rejects(submit(2), /review_stale_version/);
    await assert.rejects(submit(4), /review_stale_version/);
    await assert.rejects(submit('3'), /review_stale_version/);
    await assert.rejects(submit(undefined), /review_stale_version/);
    const result = await submit(3);
    assert.equal(result.ok, true);
  } finally { await ctx.close(); }
});

test('任务产生新事件后旧版本审核被拒', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human', events: 3});
    await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human', events: 5});
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '基于旧快照', version: 3, actor: 'admin'}),
      /review_stale_version/,
    );
    const result = await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '基于最新快照', version: 5, actor: 'admin'});
    assert.equal(result.ok, true);
  } finally { await ctx.close(); }
});

test('完全相同的提交重复到达时幂等，不产生第二条记录', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    const body = {gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '网络重试的同一份意见', version: task.events.length, actor: 'admin'};
    const first = await ctx.review.submit(body);
    const retry = await ctx.review.submit(body);
    assert.equal(first.duplicate, false);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.review.reviewSeq, first.review.reviewSeq);
    assert.equal(retry.review.seq, first.review.seq);
    assert.equal(ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'}).reviews.length, 1);
  } finally { await ctx.close(); }
});

test('并发提交不同意见时只有一个成功，另一个报冲突', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    const version = task.events.length;
    const results = await Promise.allSettled([
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '并发意见一', version, actor: 'admin-a'}),
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'reject', comment: '并发意见二', version, actor: 'admin-b'}),
    ]);
    const ok = results.filter(r => r.status === 'fulfilled');
    const bad = results.filter(r => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(bad.length, 1);
    assert.match(bad[0].reason.message, /review_conflict/);
    assert.equal(ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'}).reviews.length, 1);
  } finally { await ctx.close(); }
});

test('未完成任务不可审核', async () => {
  const ctx = await env();
  try {
    await seedTask(ctx.history, {taskId: 't-running', verdict: 'needs_human', status: 'running', events: 1});
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-running', decision: 'approve', comment: '抢跑', version: 1, actor: 'admin'}),
      /review_task_not_finished/,
    );
  } finally { await ctx.close(); }
});

// ---------- 重启恢复 ----------

test('重启后队列、人工意见与审核状态从保留文件完整恢复', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    await seedTask(ctx.history, {taskId: 't-block', verdict: 'block', modelVerdict: 'block'});
    await seedTask(ctx.history, {gatewayId: 'dayu-b', taskId: 't-other-device', verdict: 'needs_human'});
    await ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'reject', comment: '重启前的意见', version: task.events.length, actor: 'admin'});

    const restarted = await ctx.restart();
    try {
      const queue = restarted.review.queue({gatewayId: 'dayu-a'});
      assert.deepEqual(queue.items.map(i => i.taskId), ['t-human']);
      assert.equal(queue.items[0].reviewStatus, 'reviewed');
      assert.equal(queue.counts.block, 1);
      const detail = restarted.review.detail({gatewayId: 'dayu-a', taskId: 't-human'});
      assert.equal(detail.reviews.length, 1);
      assert.equal(detail.reviews[0].comment, '重启前的意见');
      assert.equal(detail.humanDecision, 'reject');
      assert.equal(detail.audit.verdict, 'needs_human');
      // 重启后仍然拦截硬规则 block。
      const blockTask = restarted.review.detail({gatewayId: 'dayu-a', taskId: 't-block'});
      assert.equal(blockTask.canApprove, false);
      await assert.rejects(
        restarted.review.submit({gatewayId: 'dayu-a', taskId: 't-block', decision: 'approve', comment: '重启后再试', version: task.events.length, actor: 'admin'}),
        /hard_rule_block_approve_denied/,
      );
      // 重启后设备隔离仍生效。
      assert.throws(() => restarted.review.detail({gatewayId: 'dayu-a', taskId: 't-other-device'}), /review_task_not_found/);
    } finally { await restarted.history.flush(); }
  } finally { await ctx.close(); }
});

test('审核写入失败时如实标记未确认，不假装保存成功', async () => {
  const ctx = await env();
  try {
    const task = await seedTask(ctx.history, {taskId: 't-human', verdict: 'needs_human'});
    // 模拟保留文件写入不可用。
    ctx.history.healthy = false;
    await assert.rejects(
      ctx.review.submit({gatewayId: 'dayu-a', taskId: 't-human', decision: 'approve', comment: '写盘失败时的意见', version: task.events.length, actor: 'admin'}),
      /cloud_history_unavailable|history_write_failed/,
    );
    ctx.history.healthy = true;
    assert.equal(ctx.review.detail({gatewayId: 'dayu-a', taskId: 't-human'}).reviews.length, 0);
  } finally { await ctx.close(); }
});
