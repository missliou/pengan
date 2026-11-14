import {createHash} from 'node:crypto';

// 人工审核中心（QWEN-HUMAN-REVIEW-20261103）。
//
// 设计约束（对应任务要求）：
// 1) 不改动 pipeline-tasks / agent-pipeline / agent-audit：审核队列直接从持久化审计行
//    （event='pipeline_state'）派生，因此"重启恢复""设备隔离""原模型结论不变"都是继承来的，
//    而不是重新实现一遍。
// 2) 人工意见是**独立追加记录**（event='human_review_saved'），写入同一条哈希链保留文件；
//    永远不修改任务的 result/audit/stages。
// 3) 硬规则或模型加严得到的 block 不接受人工"通过"；block 只允许人工驳回以留痕确认。
// 4) 本模块没有任何设备控制通道：不存在下发指令的代码路径，返回体恒定声明未执行。
// 5) 只读角色由 HTTP 层的 requireRole(session,'admin') 拦截，本模块不做鉴权，避免两处口径分叉。

const fail = code => { throw Error(code); };
const copy = value => structuredClone(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');

const VERDICTS = new Set(['allow', 'needs_human', 'block']);
const DECISIONS = new Set(['approve', 'reject']);
// 人工审核提交体允许的字段；与既有写接口一样采用严格白名单。
const REVIEW_BODY_KEYS = new Set(['gatewayId', 'taskId', 'decision', 'comment', 'version', 'actor']);
const COMMENT_MAX = 2000;
const QUEUE_LIMIT_MAX = 200;
const TASK_VIEW_MAX = 100;

// 保留文件里人工审核行的事件名；与既有 pipeline_state / knowledge_* 同一命名风格。
export const HUMAN_REVIEW_EVENT = 'human_review_saved';

function taskKey(gatewayId, taskId) { return gatewayId + '|' + taskId; }

export class HumanReview {
  #cursor = 0;

  constructor({history, now = Date.now} = {}) {
    if (!history || typeof history.query !== 'function' || typeof history.append !== 'function') fail('invalid_review_config');
    this.history = history;
    this.now = now;
    // 只是保留文件的最近视图；权威数据始终在 CloudHistory 里。
    this.tasks = new Map();
    this.reviews = new Map();
    this.ready = false;
    this.#cursor = 0;
  }

  async open() {
    this.ready = false;
    this.tasks.clear();
    this.reviews.clear();
    this.#cursor = 0;
    this.#sync();
    this.ready = true;
    return this;
  }

  // CloudHistory.rows 是权威内存视图（seq = index + 1，追加式）。
  // 这里只增量消费新行，因此运行时新产生的任务与审核无需重新扫描即可被看见。
  #sync() {
    const rows = Array.isArray(this.history.rows) ? this.history.rows : [];
    for (let index = this.#cursor; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || row.kind !== 'audit') continue;
      const data = row.data || {};
      if (data.event === 'pipeline_state') this.#absorbTask(row.gatewayId, data.task);
      else if (data.event === HUMAN_REVIEW_EVENT) this.#absorbReview(row);
    }
    this.#cursor = rows.length;
  }

  #absorbTask(gatewayId, task) {
    if (!task || typeof task !== 'object' || !id(gatewayId) || !id(task.taskId)) return;
    // 同一任务会随每个阶段事件重复落盘；后写的快照更完整，直接覆盖。
    if (task.gatewayId !== gatewayId) return;
    const key = taskKey(gatewayId, task.taskId);
    this.tasks.delete(key);
    this.tasks.set(key, copy(task));
    while (this.tasks.size > TASK_VIEW_MAX) this.tasks.delete(this.tasks.keys().next().value);
  }

  #absorbReview(row) {
    const data = row.data || {};
    if (!id(row.gatewayId) || !id(data.taskId)) return;
    const key = taskKey(row.gatewayId, data.taskId);
    const list = this.reviews.get(key) || [];
    list.push(this.#reviewRecord(row));
    list.sort((a, b) => a.reviewSeq - b.reviewSeq || a.seq - b.seq);
    this.reviews.set(key, list);
  }

  #reviewRecord(row) {
    const data = row.data;
    return {
      seq: row.seq,
      recordedAt: row.recordedAt,
      reviewSeq: Number.isSafeInteger(data.reviewSeq) ? data.reviewSeq : 0,
      taskId: data.taskId,
      gatewayId: row.gatewayId,
      decision: data.decision,
      comment: data.comment,
      actor: data.actor,
      version: data.version,
      originalVerdict: data.originalVerdict,
      fingerprint: data.fingerprint,
    };
  }

  #assertReady() { if (!this.ready) fail('review_store_not_ready'); this.#sync(); }

  #task(gatewayId, taskId) {
    if (!id(gatewayId) || !id(taskId)) fail('review_task_not_found');
    // 跨设备读取统一报"未找到"，不泄露其它设备任务是否存在。
    const task = this.tasks.get(taskKey(gatewayId, taskId));
    if (!task) fail('review_task_not_found');
    return task;
  }

  #verdictOf(task) {
    const verdict = task.result?.audit?.verdict;
    return VERDICTS.has(verdict) ? verdict : null;
  }

  #reviewsOf(gatewayId, taskId) { return copy(this.reviews.get(taskKey(gatewayId, taskId)) || []); }

  // 人工结论以最后一条为准；历史记录本身不被覆盖。
  #humanDecisionOf(gatewayId, taskId) {
    const reviews = this.reviews.get(taskKey(gatewayId, taskId)) || [];
    return reviews.length ? reviews.at(-1).decision : null;
  }

  // canApprove / canReject 是"当前这个决策是否还有意义"的界面指引，不是权限位；
  // 权限位由 HTTP 层的角色检查决定。
  #capability(task, gatewayId) {
    const verdict = this.#verdictOf(task);
    const finished = task.status === 'completed' && verdict !== null;
    const human = this.#humanDecisionOf(gatewayId, task.taskId);
    let blockedReason = null;
    if (!finished) blockedReason = 'review_task_not_finished';
    else if (verdict === 'allow') blockedReason = 'review_not_required';
    return {
      finished,
      verdict,
      humanDecision: human,
      blockedReason,
      // block 一律不可人工通过（要求 5）。
      canApprove: finished && verdict === 'needs_human' && human !== 'approve',
      canReject: finished && (verdict === 'needs_human' || verdict === 'block') && human !== 'reject',
    };
  }

  queue({gatewayId, verdict = 'needs_human', reviewStatus = null, limit = 50} = {}) {
    this.#assertReady();
    if (!id(gatewayId)) fail('gateway_required');
    if (!VERDICTS.has(verdict) && verdict !== 'all') fail('invalid_review_query');
    if (reviewStatus !== null && !['pending', 'reviewed'].includes(reviewStatus)) fail('invalid_review_query');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > QUEUE_LIMIT_MAX) fail('invalid_review_query');

    const own = [...this.tasks.values()].filter(task => task.gatewayId === gatewayId);
    const counts = {needs_human: 0, block: 0, allow: 0, pending: 0, reviewed: 0, unfinished: 0};
    const rows = [];
    // own 的插入顺序即落盘顺序；反转后最新任务在前。
    for (const task of own.reverse()) {
      const taskVerdict = this.#verdictOf(task);
      const reviews = this.reviews.get(taskKey(gatewayId, task.taskId)) || [];
      const reviewStatusOf = reviews.length ? 'reviewed' : 'pending';
      if (taskVerdict === null) counts.unfinished += 1;
      else counts[taskVerdict] += 1;
      // pending / reviewed 只对真正需要人工的任务计数，避免把 allow 也算进待办。
      if (taskVerdict === 'needs_human') counts[reviewStatusOf] += 1;
      if (verdict !== 'all' && taskVerdict !== verdict) continue;
      if (reviewStatus !== null && reviewStatusOf !== reviewStatus) continue;
      rows.push({
        taskId: task.taskId,
        gatewayId,
        status: task.status,
        verdict: taskVerdict,
        modelVerdict: task.result?.audit?.modelVerdict ?? null,
        authoritative: task.result?.audit?.authoritative ?? null,
        riskLevel: task.result?.decision?.riskLevel ?? null,
        confidence: task.result?.decision?.confidence ?? null,
        prompt: String(task.prompt ?? '').slice(0, 200),
        startedAt: task.startedAt ?? null,
        finishedAt: task.finishedAt ?? null,
        // 版本号 = 事件条数；提交审核时必须回传，用于拒绝基于过期快照的决策。
        version: Array.isArray(task.events) ? task.events.length : 0,
        reviewStatus: reviewStatusOf,
        reviewCount: reviews.length,
        humanDecision: this.#humanDecisionOf(gatewayId, task.taskId),
        historical: true,
        isCurrent: false,
        executed: task.executed === true,
      });
    }
    return {
      schemaVersion: 1,
      gatewayId,
      filter: {verdict, reviewStatus, limit},
      counts,
      items: rows.slice(0, limit),
      total: rows.length,
      historical: true,
      isCurrent: false,
      executed: false,
      scope: 'recent-audit-window',
      note: '队列为最近审计窗口派生视图，不是全量归档。',
    };
  }

  detail({gatewayId, taskId} = {}) {
    this.#assertReady();
    const task = this.#task(gatewayId, taskId);
    const capability = this.#capability(task, gatewayId);
    const result = task.result && typeof task.result === 'object' ? task.result : null;
    return {
      schemaVersion: 1,
      taskId: task.taskId,
      gatewayId,
      status: task.status,
      actor: task.actor ?? null,
      sessionBootId: task.sessionBootId ?? null,
      prompt: String(task.prompt ?? ''),
      startedAt: task.startedAt ?? null,
      finishedAt: task.finishedAt ?? null,
      error: task.error ?? null,
      version: Array.isArray(task.events) ? task.events.length : 0,
      // 原模型结论原样返回，人工意见不写进这些字段。
      verdict: capability.verdict,
      audit: result?.audit ? copy(result.audit) : null,
      decision: result?.decision ? copy(result.decision) : null,
      plan: result?.plan ? copy(result.plan) : null,
      stages: Array.isArray(result?.stages) ? copy(result.stages) : [],
      retrieval: result?.retrieval ? copy(result.retrieval) : null,
      memory: result?.memory ? copy(result.memory) : null,
      traceId: result?.traceId ?? null,
      provider: result?.provider ?? null,
      model: result?.model ?? null,
      calls: Number.isSafeInteger(result?.calls) ? result.calls : null,
      events: Array.isArray(task.events) ? copy(task.events) : [],
      reviews: this.#reviewsOf(gatewayId, taskId),
      reviewStatus: capability.humanDecision ? 'reviewed' : 'pending',
      humanDecision: capability.humanDecision,
      canApprove: capability.canApprove,
      canReject: capability.canReject,
      blockedReason: capability.blockedReason,
      historical: true,
      isCurrent: false,
      executed: task.executed === true || result?.executed === true,
      hardwareControl: result?.hardwareControl === true,
      deviceCommandIssued: false,
    };
  }

  async submit(body = {}) {
    this.#assertReady();
    // 与后端其它写接口一致：严格字段白名单，多余字段直接拒绝而不是静默丢弃。
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_review_body');
    if (Object.keys(body).some(key => !REVIEW_BODY_KEYS.has(key))) fail('invalid_review_body');
    const {gatewayId, taskId, decision, comment, version, actor} = body;
    if (!DECISIONS.has(decision)) fail('invalid_review_decision');
    if (typeof comment !== 'string' || !comment.trim() || comment.length > COMMENT_MAX) fail('invalid_review_comment');
    const task = this.#task(gatewayId, taskId);
    const currentVersion = Array.isArray(task.events) ? task.events.length : 0;
    if (!Number.isSafeInteger(version) || version !== currentVersion) fail('review_stale_version');
    if (task.status !== 'completed' || this.#verdictOf(task) === null) fail('review_task_not_finished');

    const verdict = this.#verdictOf(task);
    if (verdict === 'allow') fail('review_not_required');
    // 要求 5：硬规则或模型加严的 block 不可被人工"通过"覆盖；驳回仅用于留痕确认。
    if (verdict === 'block' && decision === 'approve') fail('hard_rule_block_approve_denied');
    if (typeof actor !== 'string' || !actor.trim() || actor.length > 64) fail('review_actor_required');

    const normalized = comment.trim().slice(0, COMMENT_MAX);
    const fingerprint = digest([taskId, actor.trim(), decision, normalized, String(version)].join('\u0000'));
    const existing = this.#reviewsOf(gatewayId, taskId);

    // 精确重试（同一人、同一决策、同一意见、同一版本）幂等返回原记录，不追加第二条。
    const prior = existing.find(review => review.fingerprint === fingerprint);
    if (prior) return this.#receipt({task, verdict, review: prior, duplicate: true});

    const reviewSeq = existing.length + 1;
    const key = 'human-review-' + taskId + '-' + reviewSeq;
    let row;
    try {
      row = await this.history.append({
        kind: 'audit',
        gatewayId,
        key,
        data: {
          event: HUMAN_REVIEW_EVENT,
          actor: actor.trim(),
          taskId,
          reviewSeq,
          decision,
          comment: normalized,
          version,
          originalVerdict: verdict,
          modelVerdict: task.result?.audit?.modelVerdict ?? null,
          fingerprint,
        },
      });
    } catch (error) {
      // 并发提交会争用同一 reviewSeq，哈希链的 key 冲突即代表另一方已先落盘。
      if (error?.message === 'history_key_conflict') fail('review_conflict');
      throw error;
    }
    // 只经 #sync() 一条路径吸收新行：手动再 push 会与增量同步重复计数同一条审核。
    this.#sync();
    const review = this.#reviewRecord(row);
    return this.#receipt({task, verdict, review, duplicate: false});
  }

  #receipt({task, verdict, review, duplicate}) {
    return {
      schemaVersion: 1,
      ok: true,
      duplicate,
      review,
      taskId: task.taskId,
      gatewayId: task.gatewayId,
      // 人工意见是追加记录：原结论与最终记录的结论都不因人工决策而改变。
      originalVerdict: verdict,
      finalVerdict: verdict,
      modelConclusionUnchanged: true,
      reviewStatus: 'reviewed',
      humanDecision: review.decision,
      historical: true,
      isCurrent: false,
      executed: false,
      hardwareControl: false,
      deviceCommandIssued: false,
    };
  }

  status() {
    return {
      enabled: true,
      ready: this.ready,
      tasks: this.tasks.size,
      reviews: [...this.reviews.values()].reduce((sum, list) => sum + list.length, 0),
      scope: 'derived-from-retained-audit',
      deviceControl: false,
    };
  }
}

export default HumanReview;
