// 人工审核中心（QWEN-HUMAN-REVIEW-20261103）。
//
// 安全与诚实边界（与后端 human-review.mjs 一一对应）：
//  - 人工意见是独立追加记录，永不修改原模型结论；界面明确写出"原结论保持不变"。
//  - 硬规则/模型加严的 block 只能驳回留痕，不能人工"通过"；按钮直接禁用并说明原因。
//  - viewer 只读：提交按钮禁用，不发任何写请求。
//  - 演示模式不读取真实队列、不调用真实写接口，界面常驻样例标注。
//  - 提交失败一律表述为"未确认"，保留已填意见，绝不谎报已保存。
//  - 所有后端文本走 textContent，不进 innerHTML；缺值显示"未知"，不补数。
import { el, chip, button, banner, sectionCard, emptyState, skeleton, clear, spinner } from '../lib/dom.js';
import { fmtDateTime } from '../lib/format.js';

const COMMENT_MAX = 2000;
const VERDICT_KIND = {needs_human: 'warn', block: 'bad', allow: 'ok'};
const DECISION_LABEL = {approve: '通过', reject: '驳回'};

// 错误码 → 面向人的解释。只映射已知码，未知码原样透出，不编造翻译。
function explain(code, message) {
  if (code === 'review_stale_version') return '任务已产生新的阶段事件，当前详情版本已过期。请重新载入该任务后再审核，本次未保存。';
  if (code === 'review_conflict') return '另一位管理员已提交审核，本次未保存。请刷新查看最新意见。';
  if (code === 'hard_rule_block_approve_denied') return '该任务被硬规则或模型加严判定为 block，不能人工通过；只能驳回留痕。本次未保存。';
  if (code === 'review_not_required') return '该任务结论为 allow，不需要人工复核。本次未保存。';
  if (code === 'review_task_not_finished') return '任务尚未完成，还不能审核。本次未保存。';
  if (code === 'review_task_not_found') return '未找到该任务，或它属于其它设备。本次未保存。';
  if (code === 'cloud_history_unavailable' || code === 'history_write_failed') return '服务端存储不可用，审核未保存。本次未确认，请刷新核对。';
  if (code === 'review_store_not_ready') return '审核队列尚未就绪，请稍后重试。本次未保存。';
  if (code === 'admin_forbidden' || code === 'csrf_required') return '会话已失效或权限不足，请重新登录。本次未保存。';
  if (code === 'invalid_review_comment' || code === 'invalid_review_decision' || code === 'invalid_review_body') return '提交内容不符合服务端校验，本次未保存。';
  if (code === 'review_actor_required') return '无法确认审核人身份，请重新登录。本次未保存。';
  if (code === 'gateway_required') return '尚未选择设备，无法读取该设备的审核队列。';
  return message || code || '未知错误';
}

function failureBanner(error) {
  const kind = error?.kind === 'offline' ? 'bad' : 'warn';
  const text = error?.kind === 'offline'
    ? '后端未连接：无法读取或提交人工审核，也不会显示推测的审核状态。'
    : error?.kind === 'forbidden'
      ? '没有权限或管理会话已失效：' + explain(error.code, error.message)
      : explain(error?.code, error?.message);
  return banner(kind, text);
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch { return '[无法序列化的事件数据]'; }
}

// 演示样例：字段形状与后端 detail() 一致，内容明确标注为样例，
// 不代表真实设备、真实模型结论或人员安全准入。
const DEMO_REVIEW_DETAIL = {
  taskId: 'demo-task-0001', status: 'completed', verdict: 'needs_human', calls: 3,
  provider: 'deepseek', model: 'deepseek-chat',
  startedAt: 1_000_000, finishedAt: 1_003_000, error: null, version: 3,
  prompt: '（演示样例）棚内闷热，是否可以通风？',
  audit: {
    verdict: 'needs_human', authoritative: 'rules', modelVerdict: 'needs_human',
    reasons: ['决策阶段风险等级为 high，需人工审核'],
    ruleHits: [
      {ruleId: 'R-ESTOP', passed: true, detail: '急停未触发'},
      {ruleId: 'R-CO-INVALID', passed: false, detail: 'CO 读数非法：未接入按非法处理'},
    ],
    missingEvidence: [],
  },
  stages: [{stage: 'decision', state: 'passed', durationMs: 120, summary: '意图「通风」（演示样例）', error: null}],
  decision: {intent: '通风', situation: '棚内闷热', confidence: 0.42, riskLevel: 'high', openQuestions: ['是否已现场确认']},
  plan: {summary: '演示计划，不执行设备', steps: [{action: 'ventilate', reason: '换气', maxRunMs: 5000}]},
  retrieval: {method: 'lexical', untrusted: true, items: [{chunkId: 'demo-c1', documentId: 'demo-d1', title: '通风规程（演示样例）', source: '本地演示，不是生产建议', content: '先核验气体传感器，再由现场人员判断是否通风。', score: 1.2}]},
  events: [{seq: 1, type: 'task_started', at: 1_000_000, data: {readOnly: true}}],
  reviews: [], reviewStatus: 'pending', humanDecision: null,
  canApprove: false, canReject: false, blockedReason: null, executed: false, hardwareControl: false, deviceCommandIssued: false,
};

export default async function renderReview(ctx) {
  // 不使用 live-dashboard 作用域：那是总览高频轮询的防闪烁豁免区。
  // 审核页只在用户动作后刷新，保留入场与悬停动效。
  const wrap = el('div', {class: 'review-page'});
  const canWrite = !ctx.demoMode && ctx.state?.user?.role === 'admin';
  const queueHost = el('div', {}, [skeleton(2)]);
  const detailHost = el('div', {});
  // 提交结果反馈放在页面级节点：详情区会被重绘，若把反馈嵌在详情里会被冲掉，
  // 用户将看不到"已保存 / 未确认"，属诚实性问题。
  const feedback = el('div', {'data-role': 'review-feedback'});

  const verdictFilter = el('select', {id: 'review-verdict', 'aria-label': '按结论筛选'}, [
    el('option', {value: 'needs_human', text: '需人工审核（needs_human）', selected: true}),
    el('option', {value: 'block', text: '硬规则拒止（block）'}),
    el('option', {value: 'allow', text: '已放行（allow）'}),
    el('option', {value: 'all', text: '全部结论'}),
  ]);
  const statusFilter = el('select', {id: 'review-status', 'aria-label': '按审核状态筛选'}, [
    el('option', {value: '', text: '待审 + 已审', selected: true}),
    el('option', {value: 'pending', text: '仅待审'}),
    el('option', {value: 'reviewed', text: '仅已审'}),
  ]);

  wrap.append(
    banner('warn', '人工审核中心：只追加人工意见，不下发设备控制，也不修改模型结论。硬规则 block 不能被人工"通过"覆盖。'),
    sectionCard('审核队列 · ' + (ctx.state?.gatewayId || '未选择设备'),
      '队列由持久化审计链派生，按当前设备隔离，服务重启后仍可恢复。',
      el('div', {class: 'toolbar'}, [
        verdictFilter, statusFilter, el('span', {class: 'spacer'}),
        button('刷新审核队列', () => refreshQueue(), {variant: 'secondary small', disabled: ctx.demoMode}),
      ]),
      queueHost),
    detailHost,
    feedback,
  );

  let selectedId = '', detailVersion = null, revision = 0, busy = false;

  // ---------- 演示模式：明确标注，且不调用任何真实接口 ----------
  if (ctx.demoMode) {
    queueHost.replaceChildren(banner('warn', '演示模式：以下为样例任务结构，未连接真实后端，任何提交都不会保存。'));
    detailHost.replaceChildren(renderSubmitArea(DEMO_REVIEW_DETAIL, false, true));
    return wrap;
  }

  verdictFilter.addEventListener('change', () => refreshQueue());
  statusFilter.addEventListener('change', () => refreshQueue());

  // ---------- 队列 ----------
  async function refreshQueue() {
    if (!ctx.scope.active) return;
    const version = ++revision;
    clear(queueHost);
    queueHost.append(skeleton(2));
    try {
      const data = await ctx.dataSource.listReviewQueue({
        verdict: verdictFilter.value || 'needs_human',
        reviewStatus: statusFilter.value || null,
      });
      if (!ctx.scope.active || version !== revision) return;
      if (!Array.isArray(data?.items)) throw new Error('审核队列协议无效');
      paintQueue(data);
    } catch (error) {
      if (!ctx.scope.active || version !== revision) return;
      clear(queueHost);
      queueHost.append(failureBanner(error));
    }
  }

  function paintQueue(data) {
    clear(queueHost);
    const counts = data.counts || {};
    const count = (key) => Number.isSafeInteger(counts[key]) ? counts[key] : '未知';
    queueHost.append(el('div', {class: 'btn-row mb-md'}, [
      chip('warn', '待审 ' + count('pending')),
      chip('ok', '已审 ' + count('reviewed')),
      chip('bad', 'block ' + count('block')),
      chip('plain', 'needs_human ' + count('needs_human')),
      chip('plain', 'allow ' + count('allow')),
    ]));
    if (data.items.length === 0) {
      const onlyPending = data.filter?.verdict === 'needs_human' && !data.filter?.reviewStatus;
      queueHost.append(emptyState(onlyPending ? '暂无待人工审核任务' : '没有符合筛选条件的任务',
        data.total === 0 ? '本设备在当前筛选下没有任务记录。' : '换个筛选条件试试。'));
      return;
    }
    queueHost.append(el('div', {class: 'review-list'}, data.items.map((item) => {
      // 按钮文本必须精确等于 taskId · verdict（宿主按 textContent 全等定位），
      // 徽标与摘要放在同一行的相邻节点，视觉上仍连成一行。
      const label = item.taskId + ' · ' + (item.verdict || item.status || '未知');
      return el('div', {
        class: 'review-row' + (item.taskId === selectedId ? ' is-active' : ''),
        onclick: (e) => { if (!e?.target?.closest?.('button')) { selectedId = item.taskId; openDetail(); } },
      }, [
        el('button', {
          class: 'btn secondary small', type: 'button',
          dataset: {taskId: String(item.taskId ?? '')},
          onclick: () => { selectedId = item.taskId; openDetail(); },
        }, [label]),
        el('div', {class: 'review-row-meta'}, [
          chip(VERDICT_KIND[item.verdict] || 'unknown', String(item.verdict || '未知')),
          item.reviewStatus === 'reviewed'
            ? chip('ok', '已审 ' + (item.humanDecision ? (DECISION_LABEL[item.humanDecision] || String(item.humanDecision)) : ''))
            : chip('warn', '待审'),
          el('span', {class: 'muted', text: (item.riskLevel ? '风险 ' + item.riskLevel + ' · ' : '') + String(item.prompt || '').slice(0, 40)}),
        ]),
      ]);
    })));
    queueHost.append(el('p', {class: 'muted mt-md mb-0', text: data.note || '队列为最近窗口视图，非全量归档。'}));
  }

  // ---------- 详情 ----------
  async function openDetail() {
    if (!ctx.scope.active || !selectedId) return;
    const version = ++revision, id = selectedId;
    clear(detailHost);
    detailHost.append(sectionCard('任务详情', null, el('div', {class: 'btn-row'}, [spinner(), ' 正在读取…'])));
    try {
      const detail = await ctx.dataSource.readReviewTask(id);
      if (!ctx.scope.active || version !== revision) return;
      if (!detail || detail.taskId !== id) throw new Error('任务详情协议无效');
      detailVersion = Number.isSafeInteger(detail.version) ? detail.version : null;
      paintDetail(detail);
      paintSelectedRowState();
    } catch (error) {
      if (!ctx.scope.active || version !== revision) return;
      clear(detailHost);
      detailHost.append(sectionCard('任务详情', null, failureBanner(error)));
    }
  }

  function paintSelectedRowState() {
    const nodes = queueHost.querySelectorAll ? [...queueHost.querySelectorAll('.review-row')] : [];
    for (const node of nodes) {
      const btn = node.querySelector?.('button');
      const taskId = btn?.dataset?.taskId;
      node.classList.toggle('is-active', Boolean(taskId) && taskId === selectedId);
    }
  }

  function paintDetail(detail) {
    clear(detailHost);
    const audit = detail.audit || null;
    const ruleHits = Array.isArray(audit?.ruleHits) ? audit.ruleHits : [];
    const failedHits = ruleHits.filter(hit => hit && hit.passed === false);
    const retrieval = detail.retrieval || null;
    const ragItems = Array.isArray(retrieval?.items) ? retrieval.items : [];
    const events = Array.isArray(detail.events) ? detail.events : [];
    const stages = Array.isArray(detail.stages) ? detail.stages : [];
    const reviews = Array.isArray(detail.reviews) ? detail.reviews : [];

    detailHost.append(sectionCard(
      '任务 ' + String(detail.taskId ?? '未知') + ' · 开始 ' + fmtDateTime(detail.startedAt),
      '状态 ' + (detail.status || '未知') + ' · 版本 v' + (detailVersion ?? '未知')
        + ' · 模型调用 ' + (Number.isSafeInteger(detail.calls) ? detail.calls + ' 次' : '未知')
        + (detail.provider ? ' · ' + detail.provider + '/' + (detail.model || '?') : ''),
      el('div', {class: 'btn-row mb-sm'}, [
        chip(VERDICT_KIND[detail.verdict] || 'unknown', '结论 ' + (detail.verdict || '未知')),
        audit ? chip('plain', '权威来源 ' + (audit.authoritative || '未知')) : null,
        chip('plain', detail.reviewStatus === 'reviewed' ? '已审' : '待审'),
        detail.executed === true ? chip('bad', '异常：声明已执行') : chip('ok', '未执行设备'),
        detail.deviceCommandIssued === true ? chip('bad', '已下发控制') : chip('ok', '未下发设备控制'),
      ]),
      el('dl', {class: 'kv'}, [
        el('dt', {text: '问题'}), el('dd', {text: detail.prompt || '未知'}),
        el('dt', {text: '开始 / 结束'}), el('dd', {text: fmtDateTime(detail.startedAt) + ' → ' + (detail.finishedAt ? fmtDateTime(detail.finishedAt) : '未结束')}),
        el('dt', {text: '任务失败原因'}), el('dd', {text: detail.error || '无'}),
      ]),
    ));

    // 风险原因与硬规则命中
    detailHost.append(sectionCard('风险原因与硬规则', '硬规则命中不可被人工放宽；这里如实展示服务端判定依据。',
      el('div', {class: 'reason-list'},
        (Array.isArray(audit?.reasons) && audit.reasons.length ? audit.reasons : ['未提供原因'])
          .map(reason => el('p', {class: 'reason-line', text: '· ' + String(reason)}))),
      el('h4', {text: '规则命中（共 ' + ruleHits.length + ' 条，未通过 ' + failedHits.length + ' 条）'}),
      ruleHits.length
        ? el('ul', {class: 'rule-hits'}, ruleHits.map(hit => el('li', {}, [
          chip(hit.passed === false ? 'bad' : 'ok', String(hit.ruleId ?? '未知规则')), ' ',
          el('span', {text: String(hit.detail ?? '')}),
        ])))
        : el('p', {class: 'muted', text: '本任务没有规则命中记录。'}),
      Array.isArray(audit?.missingEvidence) && audit.missingEvidence.length
        ? el('div', {}, [el('h4', {text: '缺失证据'}), el('ul', {}, audit.missingEvidence.map(item => el('li', {text: String(item)})))])
        : null,
    ));

    // 原始阶段结果（人工意见不写进这里）
    detailHost.append(sectionCard('原始阶段结果', '决策 / 生成 / 审核的原始输出。人工意见作为独立记录追加，不修改此处内容。',
      stages.length
        ? el('ol', {class: 'stage-list'}, stages.map(stage => el('li', {}, [
          chip(stage.state === 'passed' ? 'ok' : stage.state === 'blocked' ? 'bad' : 'warn', String(stage.stage ?? '未知阶段')), ' ',
          el('span', {text: (stage.state || '未知') + ' · ' + (Number.isFinite(stage.durationMs) ? stage.durationMs + ' ms' : '耗时未知') + ' · ' + (stage.summary || '无摘要')}),
          stage.error ? el('span', {class: 'muted', text: ' · 错误 ' + String(stage.error)}) : null,
        ])))
        : el('p', {class: 'muted', text: '暂无阶段记录（任务可能未完成）。'}),
      detail.decision
        ? el('div', {}, [el('h4', {text: '决策阶段'}), el('dl', {class: 'kv'}, [
          el('dt', {text: '意图'}), el('dd', {text: detail.decision.intent || '未知'}),
          el('dt', {text: '情况'}), el('dd', {text: detail.decision.situation || '未知'}),
          el('dt', {text: '置信度 / 风险'}), el('dd', {text: (Number.isFinite(detail.decision.confidence) ? detail.decision.confidence : '未知') + ' / ' + (detail.decision.riskLevel || '未知')}),
          el('dt', {text: '待澄清'}), el('dd', {text: Array.isArray(detail.decision.openQuestions) && detail.decision.openQuestions.length ? detail.decision.openQuestions.join('；') : '无'}),
        ])])
        : null,
      detail.plan
        ? el('div', {}, [
          el('h4', {text: '生成的计划草案（未执行）'}),
          el('p', {text: detail.plan.summary || '无摘要'}),
          el('ol', {}, (Array.isArray(detail.plan.steps) ? detail.plan.steps : []).map(step => el('li', {
            text: String(step.action ?? '?') + ' · ' + String(step.reason ?? '') + (Number.isFinite(step.maxRunMs) ? ' · 上限 ' + step.maxRunMs + ' ms' : ''),
          }))),
        ])
        : null,
    ));

    // RAG 引用
    detailHost.append(sectionCard('RAG 引用', '检索资料为未可信参考，仅供参考，不能作为传感器证据，也不能放宽安全规则。',
      el('p', {class: 'muted mt-0'}, [
        '检索方式 ' + String(retrieval?.method || '未知') + ' · 命中 ' + ragItems.length + ' 块 · ',
        retrieval?.untrusted === false ? chip('bad', '被标记为可信（异常）') : chip('warn', '未可信资料'),
        retrieval?.error ? el('span', {text: ' · 检索错误 ' + String(retrieval.error)}) : null,
      ]),
      ragItems.length
        ? el('div', {class: 'rag-list'}, ragItems.map(item => sectionCard(String(item.title ?? '无标题'), String(item.source ?? '来源未知'),
          el('p', {text: String(item.content ?? '')}),
          el('p', {class: 'mono muted', text: '块 ' + String(item.chunkId ?? '?') + ' · 文档 ' + String(item.documentId ?? '?') + ' · 分值 ' + (Number.isFinite(item.score) ? item.score : '未知') + ' · SHA256 ' + String(item.contentSha256 ?? '未知')}),
        )))
        : emptyState('本次没有检索命中', '无命中不会补造依据。'),
    ));

    // 阶段事件
    detailHost.append(sectionCard('阶段事件（' + events.length + ' 条）', '按落盘顺序展示可解释状态与摘要，不含模型内部思维链。',
      events.length
        ? el('ol', {class: 'event-list'}, events.map(event => el('li', {class: 'event-item'}, [
          el('span', {class: 'mono muted', text: '#' + (Number.isSafeInteger(event.seq) ? event.seq : '?') + ' · ' + fmtDateTime(event.at)}), ' ',
          chip('plain', String(event.type ?? '未知事件')),
          event.data ? el('div', {class: 'event-data mono', text: safeJson(event.data)}) : null,
        ])))
        : el('p', {class: 'muted', text: '暂无事件记录。'}),
    ));

    // 历史人工意见
    detailHost.append(sectionCard('人工审核记录（' + reviews.length + ' 条）', '每条意见独立追加保存，保留作者、时间与当时版本；不覆盖原模型结论。',
      reviews.length
        ? el('div', {class: 'review-history'}, reviews.map(review => el('div', {class: 'review-entry'}, [
          el('div', {class: 'btn-row'}, [
            chip(review.decision === 'approve' ? 'ok' : 'bad', (DECISION_LABEL[review.decision] || String(review.decision ?? '未知'))),
            chip('plain', '#' + (Number.isSafeInteger(review.reviewSeq) ? review.reviewSeq : '?')),
            el('span', {class: 'muted', text: String(review.actor ?? '未知审核人') + ' · ' + fmtDateTime(review.recordedAt) + ' · 基于 v' + (Number.isSafeInteger(review.version) ? review.version : '?')}),
          ]),
          el('p', {text: String(review.comment ?? '')}),
          el('p', {class: 'muted mb-0'}, [
            '当时原结论 ' + String(review.originalVerdict ?? '未知') + ' · 指纹 ',
            el('span', {class: 'mono', text: String(review.fingerprint ?? '').slice(0, 16)}),
          ]),
        ])))
        : emptyState('尚无人工审核意见', detail.canApprove || detail.canReject ? '填写意见后可提交。' : '当前任务不接受人工决策。'),
    ));

    detailHost.append(renderSubmitArea(detail, canWrite, false));
  }

  // ---------- 提交区 ----------
  function renderSubmitArea(detail, writable, demo) {
    const comment = el('textarea', {
      id: 'review-comment', rows: 4, maxlength: String(COMMENT_MAX),
      placeholder: demo ? '演示模式不会保存任何内容' : '填写审核意见（必填，最多 ' + COMMENT_MAX + ' 字）。不要填写密码、密钥或家庭网络信息。',
    });
    if (demo) comment.value = '（演示样例）现场已确认通风口畅通';

    const approveDisabled = demo || !writable || detail.canApprove !== true;
    const rejectDisabled = demo || !writable || detail.canReject !== true;

    const submit = (decision) => async () => {
      if (busy || !ctx.scope.active) return;
      const text = (comment.value || '').trim();
      clear(feedback);
      if (!text) {
        feedback.append(banner('warn', '请填写审核意见后再提交；空意见不会被发送。'));
        return;
      }
      const submittedRevision = revision, submittedVersion = detail.version;
      busy = true;
      approveBtn.disabled = true; rejectBtn.disabled = true;
      feedback.append(el('p', {class: 'muted'}, [spinner(), ' 正在提交；提交后即使关闭页面，服务端也可能已完成写入，请以刷新后的记录为准…']));
      try {
        const receipt = await ctx.dataSource.submitReview({
          taskId: detail.taskId, decision, comment: text, version: submittedVersion,
        });
        if (!ctx.scope.active || selectedId !== detail.taskId || submittedRevision !== revision) return;
        clear(feedback);
        comment.value = '';
        feedback.append(banner('ok', receipt?.duplicate
          ? '服务端确认这是重复提交：已返回原有记录，没有新增第二条意见。'
          : '服务端已确认保存审核意见。原模型结论保持 ' + String(receipt?.originalVerdict ?? detail.verdict ?? '未知')
            + ' 不变，人工意见作为独立追加记录保存；本次未下发任何设备控制。'));
        await openDetail();
        await refreshQueue();
      } catch (error) {
        if (!ctx.scope.active || selectedId !== detail.taskId || submittedRevision !== revision) return;
        clear(feedback);
        // 保存未确认：保留已填意见，明确说明未保存，可核对后重试。
        feedback.append(banner(error?.kind === 'offline' ? 'bad' : 'warn',
          (error?.kind === 'offline' ? '提交未确认（后端不可达）：' : '提交未确认：')
          + explain(error?.code, error?.message)
          + ' 已填写的意见保留在输入框中，可在核对后重试。'));
      } finally {
        busy = false;
        if (ctx.scope.active) {
          approveBtn.disabled = approveDisabled;
          rejectBtn.disabled = rejectDisabled;
        }
      }
    };

    const approveBtn = button('通过（人工确认）', submit('approve'), {disabled: approveDisabled});
    const rejectBtn = button('驳回', submit('reject'), {variant: 'danger', disabled: rejectDisabled});

    const hints = [];
    if (demo) hints.push('演示模式：不会调用真实写接口，也不会保存任何意见。');
    else if (!writable) hints.push('当前账号为只读角色，无写入权限；只能查看队列与详情。');
    else if (detail.verdict === 'block') hints.push('该任务为硬规则/模型加严 block：硬规则不可被人工通过覆盖，只能驳回留痕。');
    else if (detail.verdict === 'allow') hints.push('该任务结论为 allow，不需要人工复核。');
    else if (detail.status !== 'completed') hints.push('任务尚未完成，还不能审核。');
    else if (detail.canApprove !== true && detail.humanDecision === 'approve') hints.push('该任务已通过；如需改变结论可提交驳回，历史意见会逐条保留。');

    return sectionCard('人工审核 · ' + String(detail.taskId ?? '未知'),
      '人工意见是独立追加记录：原模型结论、阶段结果与硬规则命中都不会被修改。本功能不下发设备控制。',
      el('div', {class: 'field'}, [el('label', {for: 'review-comment', text: '审核意见'}), comment]),
      el('div', {class: 'btn-row'}, [approveBtn, rejectBtn]),
      hints.length ? el('p', {class: 'muted mt-sm', text: hints.join(' ')}) : null);
  }

  // 初始队列不阻塞渲染：迟到结果由 revision/scope 双重作废。
  void refreshQueue();
  ctx.scope.onDispose(() => { revision += 1; });
  return wrap;
}
