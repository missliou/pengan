import { AgentPipelineResult, PipelineAudit, PipelineCandidate, PipelineDecision, PipelineEvidence,
  PipelineEvidenceValue, PipelineMemory, PipelinePlan, PipelinePlanStep, PipelineRuleHit,
  PipelineStage } from '../model/AgentModels';

// 三阶段管线卡片的展示投影：只把契约响应映射成文案、色点与明细行。
// 不做安全判定、不调用设备接口；颜色语义固定为 allow 绿 / needs_human 琥珀 / block 红。
export class PipelineStageCard {
  stage: string = 'decision';
  title: string = '决策';
  state: string = 'failed';
  stateText: string = '未识别';
  dotColor: string = '#7C8D7E';
  summary: string = '';
  durationText: string = '';
  error: string = '';
}

export class PipelineVerdictBadge {
  verdict: string = '';
  text: string = '';
  color: string = '';
  authoritative: string = 'rules';
  authorityText: string = '服务端硬规则';
  reasons: string[] = [];
}

export class AgentPipelineView {
  static stageTitle(stage: string): string {
    if (stage === 'decision') return '决策';
    if (stage === 'generate') return '生成';
    if (stage === 'verify') return '审核';
    return '未知阶段';
  }

  static stageStateText(state: string): string {
    if (state === 'passed') return '通过';
    if (state === 'blocked') return '拦截';
    if (state === 'failed') return '失败';
    return '未识别状态';
  }

  // 色点：passed 绿、blocked 红、failed 琥珀；未知一律中性灰，保证不会静默显示成通过。
  static stageDotColor(state: string): string {
    if (state === 'passed') return '#216E49';
    if (state === 'blocked') return '#A8493B';
    if (state === 'failed') return '#B26A00';
    return '#7C8D7E';
  }

  static verdictText(verdict: string): string {
    if (verdict === 'allow') return '直接通过 · 低风险，无需人工确认';
    if (verdict === 'needs_human') return '需人工确认 · 风险偏高或把握不足';
    if (verdict === 'block') return '已拦截 · 命中硬规则，不得执行';
    return '结论未识别 · 请查看服务端原始响应';
  }

  static verdictColor(verdict: string): string {
    if (verdict === 'allow') return '#216E49';
    if (verdict === 'needs_human') return '#B26A00';
    if (verdict === 'block') return '#A8493B';
    return '#7C8D7E';
  }

  static riskText(risk: string): string {
    if (risk === 'low') return '低';
    if (risk === 'medium') return '中';
    if (risk === 'high') return '高';
    return '未知';
  }

  static evidenceValueText(value: PipelineEvidenceValue): string {
    if (value === null) return '未知';
    if (typeof value === 'string') return value.length === 0 ? '空字符串' : value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return '未知';
  }

  static badge(audit: PipelineAudit): PipelineVerdictBadge {
    const badge = new PipelineVerdictBadge();
    badge.verdict = audit.verdict;
    badge.text = AgentPipelineView.verdictText(audit.verdict);
    badge.color = AgentPipelineView.verdictColor(audit.verdict);
    badge.authoritative = audit.authoritative;
    badge.authorityText = audit.authoritative === 'model' ? '模型复核' : '服务端硬规则';
    badge.reasons = audit.reasons.slice(0, 6);
    if (badge.reasons.length === 0) {
      badge.reasons = [audit.verdict === 'block' ? '服务端未给出拦截原因，按拦截处理' : '服务端未给出理由'];
    }
    return badge;
  }

  static stageCards(result: AgentPipelineResult): PipelineStageCard[] {
    const cards: PipelineStageCard[] = [];
    result.stages.forEach((stage: PipelineStage) => {
      const card = new PipelineStageCard();
      card.stage = stage.stage;
      card.title = AgentPipelineView.stageTitle(stage.stage);
      card.state = stage.state;
      card.stateText = AgentPipelineView.stageStateText(stage.state);
      card.dotColor = AgentPipelineView.stageDotColor(stage.state);
      card.summary = stage.summary.length === 0 ? '服务端未返回阶段摘要' : stage.summary;
      card.durationText = Math.max(0, Math.round(stage.durationMs)).toString() + 'ms';
      card.error = stage.error === null ? '' : '错误码：' + stage.error;
      cards.push(card);
    });
    return cards;
  }

  static ruleRows(audit: PipelineAudit): string[] {
    const rows: string[] = [];
    audit.ruleHits.forEach((hit: PipelineRuleHit) => {
      rows.push((hit.passed ? '✓ ' : '✕ ') + hit.ruleId + ' · ' + (hit.passed ? '通过' : '命中') +
        (hit.detail.length === 0 ? '' : ' · ' + hit.detail));
    });
    if (rows.length === 0) rows.push('服务端未返回规则命中明细');
    return rows;
  }

  static missingEvidenceRows(audit: PipelineAudit): string[] {
    return audit.missingEvidence.length === 0 ? ['缺失依据：无'] : audit.missingEvidence.slice(0, 5).map((item: string) => '缺失依据：' + item);
  }

  static decisionRows(decision: PipelineDecision | null): string[] {
    if (decision === null) return ['决策阶段未返回结构化结论'];
    const rows: string[] = [];
    rows.push('意图：' + decision.intent);
    rows.push('判读：' + decision.situation);
    rows.push('置信度：' + Math.round(decision.confidence * 100).toString() + '% · 风险：' + AgentPipelineView.riskText(decision.riskLevel));
    const candidates = decision.candidates.slice(0, 4);
    candidates.forEach((item: PipelineCandidate) => {
      rows.push('候选：' + item.action + ' · ' + AgentPipelineView.riskText(item.riskLevel) + '风险 · ' +
        (item.requiresConfirmation ? '需确认' : '直接放行') + ' · ' + item.reason);
    });
    if (decision.candidates.length > 4) rows.push('候选：另有 ' + (decision.candidates.length - 4).toString() + ' 条未显示');
    decision.openQuestions.slice(0, 3).forEach((question: string) => { rows.push('待确认问题：' + question); });
    return rows;
  }

  static planRows(plan: PipelinePlan | null): string[] {
    if (plan === null) return ['生成阶段未返回结构化计划'];
    const rows: string[] = [];
    rows.push('计划：' + plan.summary);
    plan.steps.slice(0, 4).forEach((step: PipelinePlanStep) => {
      rows.push('步骤：' + step.action + ' · ' + (step.requiresConfirmation ? '需确认' : '直接放行') +
        ' · 上限 ' + Math.round(step.maxRunMs).toString() + 'ms · ' + step.reason);
    });
    if (plan.steps.length > 4) rows.push('步骤：另有 ' + (plan.steps.length - 4).toString() + ' 条未显示');
    plan.evidence.slice(0, 8).forEach((item: PipelineEvidence) => {
      rows.push('依据：' + item.ref + ' = ' + AgentPipelineView.evidenceValueText(item.value) +
        (item.fresh ? ' · 时效内' : ' · 已过期') +
        (item.observedAt === null ? '' : ' · ' + new Date(item.observedAt).toLocaleString()));
    });
    if (plan.evidence.length === 0) rows.push('依据：服务端未返回引用');
    return rows;
  }

  static memoryRow(memory: PipelineMemory): string {
    return '记忆：引用历史 ' + memory.used.toString() + ' 条' +
      (memory.sources.length === 0 ? '' : '（' + memory.sources.join('、') + '）');
  }

  static statusLine(result: AgentPipelineResult): string {
    return '三阶段管线 · ' + (result.mode === 'hardware' ? '真实硬件模式' : '模拟模式') +
      ' · ' + result.provider + ' / ' + result.model + ' · 模型调用 ' + result.calls.toString() +
      ' 次 · 只出建议，未执行设备（executed=false，hardwareControl=false）';
  }

  // 明细行按「规则 → 缺失依据 → 决策 → 计划 → 记忆」顺序拼装，供卡片直接渲染。
  static detailRows(result: AgentPipelineResult): string[] {
    const rows: string[] = ['【规则判定】'];
    AgentPipelineView.ruleRows(result.audit).forEach((row: string) => { rows.push(row); });
    AgentPipelineView.missingEvidenceRows(result.audit).forEach((row: string) => { rows.push(row); });
    rows.push('结论来源：' + (result.audit.authoritative === 'model' ? '模型复核' : '服务端硬规则') +
      ' · 模型结论：' + result.audit.modelVerdict);
    rows.push('【决策阶段】');
    AgentPipelineView.decisionRows(result.decision).forEach((row: string) => { rows.push(row); });
    rows.push('【生成阶段】');
    AgentPipelineView.planRows(result.plan).forEach((row: string) => { rows.push(row); });
    rows.push('【记忆】');
    rows.push(AgentPipelineView.memoryRow(result.memory));
    return rows;
  }

  static errorText(error: Error): string {
    const message = error.message.length === 0 ? '未知错误' : error.message;
    return '三阶段管线未返回有效结果：' + message + '。未执行设备操作。';
  }
}
