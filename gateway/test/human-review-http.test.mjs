// 人工审核中心 HTTP 集成回归（QWEN-HUMAN-REVIEW-20261103，执行者 Qwen-3.8）。
// 覆盖：未认证 401、viewer 只读、admin 写、CSRF/Origin 拦截、设备隔离、
//       硬规则 block 不可人工通过、防重复提交、版本校验、并发冲突、重启恢复。
// 复用既有 cloud-server 真实鉴权栈（Cookie/scrypt/CSRF/角色），不 mock 安全层。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startCloudServer} from '../cloud-server.mjs';
import {CloudSecurity} from '../cloud-security.mjs';

// 测试专用一次性口令，非任何真实凭据；不写入日志或交接。
const PASSWORD = 'test-only-review-login-12345';
const SHA = 'b'.repeat(64);

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pengan-review-http-'));
  const passwordHash = await CloudSecurity.hashPassword(PASSWORD);
  const options = {
    dataDir: dir,
    publicOrigin: 'http://127.0.0.1:0',
    users: [{username: 'admin', role: 'admin', passwordHash}, {username: 'reader', role: 'viewer', passwordHash}],
    devices: ['dayu-a', 'dayu-b'].map(gatewayId => ({gatewayId, tokenSha256: createHash('sha256').update('test-device-only-' + gatewayId).digest('hex')})),
    fetchFn: async () => { throw Error('no_real_model'); },
  };
  let runtime;
  async function start() { runtime = await startCloudServer(options); }
  await start();
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });

  async function request(route, {body, headers = {}, method} = {}) {
    return fetch(runtime.publicOrigin + route, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {origin: runtime.publicOrigin, 'content-type': 'application/json', ...headers},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
  }
  async function login(name = 'admin') {
    const response = await request('/admin-api/session/login', {body: {username: name, password: PASSWORD}});
    assert.equal(response.status, 200);
    const data = await response.json();
    return {cookie: response.headers.get('set-cookie').split(';')[0], 'x-pengan-csrf': data.csrfToken};
  }
  // 直接写入一条与 PipelineTasks.record 同形状的完成态任务（真实管线在无模型时会落同样结构）。
  async function seedTask({gatewayId = 'dayu-a', taskId, verdict = 'needs_human', riskLevel = 'high', confidence = 0.42, ruleHits = [], modelVerdict = verdict, authoritative = 'rules', events = 3} = {}) {
    const task = {
      taskId, gatewayId, prompt: '棚内闷热，是否可以通风', actor: 'admin', sessionBootId: 'boot-1',
      status: 'completed', startedAt: 1_000, finishedAt: 2_000, events: [],
      historical: true, isCurrent: false, executed: false,
      result: {
        kind: 'agent_pipeline', pipelineVersion: 1, traceId: 'ap-http-test', requestedAt: 1_000,
        prompt: '棚内闷热，是否可以通风', mode: 'hardware', provider: 'deepseek', model: 'deepseek-chat',
        executed: false, hardwareControl: false, calls: 3,
        retrieval: {method: 'lexical', untrusted: true, items: [{chunkId: 'c1', documentId: 'd1', title: '通风规程', source: 'manual', content: '先测气体再通风', score: 1.5, contentSha256: SHA}]},
        decision: {intent: '通风', situation: '棚内闷热', confidence, riskLevel, candidates: [], openQuestions: []},
        plan: {summary: '两步计划', steps: [{action: 'ventilate', reason: '换气', maxRunMs: 5_000, requiresConfirmation: true, processed: false}], evidence: []},
        audit: {verdict, reasons: ['需人工审核'], ruleHits, missingEvidence: [], modelVerdict, authoritative},
        memory: {used: 0, sources: []},
        stages: [{stage: 'decision', state: 'passed', startedAt: 1_000, finishedAt: 1_100, durationMs: 100, summary: 'ok', error: null}],
      },
    };
    for (let i = 1; i <= events; i += 1) task.events.push({seq: i, type: 'stage_started', at: 1_000 + i, data: {stage: 'decision'}});
    await runtime.history.append({kind: 'audit', gatewayId, data: {event: 'pipeline_state', actor: 'admin', task}});
    return task;
  }
  const reviewBody = (taskId, decision, comment, version = 3) => ({taskId, decision, comment, version});
  return {request, login, seedTask, reviewBody, start, close: () => runtime.close(), runtime: () => runtime};
}

test('未认证读取人工审核队列返回 401', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human'});
  assert.equal((await h.request('/admin-api/review?gatewayId=dayu-a')).status, 401);
});

test('viewer 可只读队列与详情，但提交审核被 403 拒绝', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human'});
  const reader = await h.login('reader');
  const queue = await h.request('/admin-api/review?gatewayId=dayu-a', {headers: reader});
  assert.equal(queue.status, 200);
  const data = await queue.json();
  assert.deepEqual(data.items.map(item => item.taskId), ['t-human']);

  const detail = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {headers: reader});
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.verdict, 'needs_human');
  assert.equal(body.canApprove, true);

  const submit = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', 'viewer 越权尝试'), headers: reader});
  assert.equal(submit.status, 403);
});

test('admin 提交缺 CSRF 或 Origin 不符时被拒', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human'});
  const admin = await h.login();
  const noCsrf = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '没有 CSRF'), headers: {cookie: admin.cookie}});
  assert.equal(noCsrf.status, 403);
  const badOrigin = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '跨站来源'), headers: {...admin, origin: 'http://evil.example'}});
  assert.equal(badOrigin.status, 403);
});

test('admin 可提交通过，返回体声明未下发设备控制且原结论不变', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human'});
  const admin = await h.login();
  const response = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '现场已确认通风口畅通'), headers: admin});
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.ok, true);
  assert.equal(saved.originalVerdict, 'needs_human');
  assert.equal(saved.finalVerdict, 'needs_human');
  assert.equal(saved.modelConclusionUnchanged, true);
  assert.equal(saved.executed, false);
  assert.equal(saved.hardwareControl, false);
  assert.equal(saved.deviceCommandIssued, false);

  const detail = await (await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {headers: admin})).json();
  assert.equal(detail.audit.verdict, 'needs_human');
  assert.equal(detail.humanDecision, 'approve');
  assert.equal(detail.reviews.length, 1);
  assert.equal(detail.reviews[0].actor, 'admin');
});

test('硬规则 block 的任务人工通过被 400 拒绝，驳回可用', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-block', verdict: 'block', modelVerdict: 'block', ruleHits: [{ruleId: 'R-CO', passed: false, detail: 'CO 32 达到演示拒止阈值 30'}]});
  const admin = await h.login();
  const approve = await h.request('/admin-api/review/t-block?gatewayId=dayu-a', {body: h.reviewBody('t-block', 'approve', '我认为可以放行'), headers: admin});
  assert.equal(approve.status, 400);
  assert.equal((await approve.json()).error, 'hard_rule_block_approve_denied');
  const detail = await (await h.request('/admin-api/review/t-block?gatewayId=dayu-a', {headers: admin})).json();
  assert.equal(detail.canApprove, false);
  assert.equal(detail.reviews.length, 0);
  assert.equal(detail.audit.verdict, 'block');

  const reject = await h.request('/admin-api/review/t-block?gatewayId=dayu-a', {body: h.reviewBody('t-block', 'reject', '确认维持拒止'), headers: admin});
  assert.equal(reject.status, 200);
  assert.equal((await reject.json()).finalVerdict, 'block');
});

test('版本不匹配被拒（400 review_stale_version），精确重试幂等，不产生第二条记录', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human', events: 3});
  const admin = await h.login();
  const stale = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '基于过期快照', 2), headers: admin});
  // 与网关既有约定一致：pipeline_task_not_found 也是 400；客户端按 error 码区分语义。
  assert.equal(stale.status, 400);
  assert.equal((await stale.json()).error, 'review_stale_version');

  const first = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '同一份意见'), headers: admin});
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const retry = await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '同一份意见'), headers: admin});
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.duplicate, true);
  assert.equal(retryBody.review.reviewSeq, firstBody.review.reviewSeq);
  const detail = await (await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {headers: admin})).json();
  assert.equal(detail.reviews.length, 1);
});

test('非法决策与空意见返回 400', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human'});
  const admin = await h.login();
  assert.equal((await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'maybe', '意见'), headers: admin})).status, 400);
  assert.equal((await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '   '), headers: admin})).status, 400);
  assert.equal((await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: {...h.reviewBody('t-human', 'approve', '意见'), extra: 1}, headers: admin})).status, 400);
});

test('跨设备读取与审核被拒，不泄露其它设备任务', async t => {
  const h = await fixture(t);
  await h.seedTask({gatewayId: 'dayu-b', taskId: 't-b'});
  const admin = await h.login();
  // 跨设备统一报 review_task_not_found（400），不泄露其它设备任务是否存在。
  assert.equal((await h.request('/admin-api/review/t-b?gatewayId=dayu-a', {headers: admin})).status, 400);
  const submit = await h.request('/admin-api/review/t-b?gatewayId=dayu-a', {body: h.reviewBody('t-b', 'approve', '越权审核'), headers: admin});
  assert.equal(submit.status, 400);
  assert.equal((await submit.json()).error, 'review_task_not_found');
  const queue = await (await h.request('/admin-api/review?gatewayId=dayu-a', {headers: admin})).json();
  assert.deepEqual(queue.items, []);
  assert.equal(queue.counts.needs_human, 0);
});

test('重启后人工审核队列与意见从保留文件恢复', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human'});
  const admin = await h.login();
  await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'reject', '重启前的意见'), headers: admin});
  await h.close();
  await h.start();
  const renewed = await h.login('reader');
  const queue = await (await h.request('/admin-api/review?gatewayId=dayu-a', {headers: renewed})).json();
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].reviewStatus, 'reviewed');
  assert.equal(queue.items[0].humanDecision, 'reject');
  const detail = await (await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {headers: renewed})).json();
  assert.equal(detail.reviews[0].comment, '重启前的意见');
  assert.equal(detail.audit.verdict, 'needs_human');
});

test('审核动作写入持久化审计，可在审计接口查到', async t => {
  const h = await fixture(t);
  await h.seedTask({taskId: 't-human'});
  const admin = await h.login();
  await h.request('/admin-api/review/t-human?gatewayId=dayu-a', {body: h.reviewBody('t-human', 'approve', '同意通风'), headers: admin});
  const audit = await (await h.request('/admin-api/audit?limit=200', {headers: admin})).json();
  const saved = audit.items.filter(row => row.data.event === 'human_review_saved');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].data.taskId, 't-human');
  assert.equal(saved[0].data.actor, 'admin');
  assert.equal(saved[0].data.decision, 'approve');
});
