export class ModelPlanStep {
  action: string = '';
  reason: string = '';
  maxRunMs: number = 20000;
  requiresConfirmation: boolean = true;
  processed: boolean = false;
}
export class ModelPlan {
  summary: string = '';
  provider: string = '';
  model: string = '';
  simulated: boolean = true;
  executed: boolean = false;
  steps: ModelPlanStep[] = [];
}
export class ModelStatus {
  configured: boolean = false;
  provider: string = '';
  model: string = '';
  executesDevices: boolean = false;
}
export class CropImageAnalysis {
  mode: string = '';
  kind: string = '';
  source: string = '';
  simulated: boolean = true;
  executed: boolean = false;
  steps: ModelPlanStep[] = [];
  hardwareControl: boolean = false;
  realAdmission: string = '';
  imageSha256: string = '';
  analyzedAt: number = 0;
  provider: string = '';
  model: string = '';
  summary: string = '';
  findings: string[] = [];
  unknowns: string[] = [];
}
export interface PromptBody { prompt: string; }
export class AnalysisToolTrace {
  tool: string = '';
  at: number = 0;
  readOnly: boolean = false;
  resultSummary: string = '';
}
export class HardwareAnalysis {
  persistence?: AnalysisPersistence;
  toolTrace?: AnalysisToolTrace[];
  mode: string = '';
  simulated: boolean = true;
  executed: boolean = false;
  steps: ModelPlanStep[] = [];
  summary: string = '';
  findings: string[] = [];
  unknowns: string[] = [];
  observationReceivedAt: number | null = null;
  deviceOnline: boolean = false;
  analyzedAt: number = 0;
  provider: string = '';
  model: string = '';
  hardwareControl: boolean = false;
  realAdmission: string = '';
}
export class AnalysisPersistence {
  saved: boolean = false;
  recordId?: number;
  error?: string;
}

// 三阶段智能体管线 v1（docs/三阶段智能体管线契约.md 第 3 节）。字段名与枚举值逐字锁定。
// 说明：契约里的匿名嵌套类型 Stage/Decision/Plan/Audit 在此加 Pipeline 前缀，避免与既有
// ModelPlan/ModelPlanStep 混淆；字段名、枚举值、取值范围仍与契约一致。
export type PipelineVerdict = 'allow' | 'block' | 'needs_human';
export type PipelineModelVerdict = 'allow' | 'block' | 'needs_human' | 'unknown';
export type PipelineStageName = 'decision' | 'generate' | 'verify';
export type PipelineStageState = 'passed' | 'blocked' | 'failed';
export type PipelineRiskLevel = 'low' | 'medium' | 'high';
export type PipelineMode = 'simulation' | 'hardware';
export type PipelineAuthority = 'rules' | 'model';
export type PipelineEvidenceValue = string | number | boolean | null;

export class PipelineStage {
  stage: PipelineStageName = 'decision';
  state: PipelineStageState = 'failed';
  startedAt: number = 0;
  finishedAt: number = 0;
  durationMs: number = 0;
  summary: string = '';
  error: string | null = null;
}

export class PipelineCandidate {
  action: string = '';
  reason: string = '';
  riskLevel: PipelineRiskLevel = 'high';
  requiresConfirmation: boolean = true;
  maxRunMs: number | null = null;
}

export class PipelineDecision {
  intent: string = '';
  situation: string = '';
  confidence: number = 0;
  riskLevel: PipelineRiskLevel = 'high';
  candidates: PipelineCandidate[] = [];
  openQuestions: string[] = [];
}

export class PipelinePlanStep {
  action: string = '';
  reason: string = '';
  requiresConfirmation: boolean = true;
  maxRunMs: number = 20000;
  processed: boolean = false;
}

export class PipelineEvidence {
  ref: string = '';
  value: PipelineEvidenceValue = null;
  observedAt: number | null = null;
  fresh: boolean = false;
}

export class PipelinePlan {
  summary: string = '';
  steps: PipelinePlanStep[] = [];
  evidence: PipelineEvidence[] = [];
}

export class PipelineRuleHit {
  ruleId: string = '';
  passed: boolean = true;
  detail: string = '';
}

export class PipelineAudit {
  verdict: PipelineVerdict = 'needs_human';
  reasons: string[] = [];
  ruleHits: PipelineRuleHit[] = [];
  missingEvidence: string[] = [];
  modelVerdict: PipelineModelVerdict = 'unknown';
  authoritative: PipelineAuthority = 'rules';
}

export class PipelineMemory {
  used: number = 0;
  sources: string[] = [];
}

export class AgentPipelineResult {
  kind: string = 'agent_pipeline';
  pipelineVersion: number = 1;
  traceId: string = '';
  requestedAt: number = 0;
  prompt: string = '';
  mode: PipelineMode = 'simulation';
  provider: string = '';
  model: string = '';
  calls: number = 0;
  executed: boolean = false;
  hardwareControl: boolean = false;
  stages: PipelineStage[] = [];
  decision: PipelineDecision | null = null;
  plan: PipelinePlan | null = null;
  audit: PipelineAudit = new PipelineAudit();
  memory: PipelineMemory = new PipelineMemory();
}

