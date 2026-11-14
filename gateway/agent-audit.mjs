import {ALLOWED,validatePlan} from './agent.mjs';

// 阈值来源：openharmony/entry/src/main/ets/services/SafetyEngine.ets
// （15s 时效、CO>=30、CO2>=1500、急停、离线、读数非法）。
// 这些数值仅用于软件演示，不是国标，也不构成医疗或安全认证结论。
export const PIPELINE_LIMITS=Object.freeze({maxAgeMs:15000,futureSkewMs:1000,co:30,co2:1500,maxSteps:4,summaryMax:2000,reasonMax:1000,maxRunMsMin:1000,maxRunMsMax:20000,defaultMaxRunMs:20000});

const ENV_RULE_IDS=new Set(['R-ESTOP','R-SENSOR-OFFLINE','R-SAMPLE-STALE','R-CO-INVALID','R-CO2-INVALID','R-CO','R-CO2']);
const STRUCTURAL_RULE_IDS=new Set(['R-ACTION','R-PLAN']);
const clip=(value,max)=>String(value??'').slice(0,max);
const finite=value=>typeof value==='number'&&Number.isFinite(value);

function reading(direct,nested,validFlag){
  // 质量位为假时一律按缺失处理，绝不用其它通道的数据填补。
  if(validFlag===false)return null;
  if(direct!==undefined)return direct;
  return nested===undefined?null:nested;
}

function sampledAtOf(source,now){
  if(finite(source.sampledAt))return source.sampledAt;
  if(typeof source.sampledAt==='string'){const parsed=Date.parse(source.sampledAt);if(Number.isFinite(parsed))return parsed;}
  if(finite(source.receivedAt))return source.receivedAt;
  if(finite(source.sampleAgeMs)&&source.sampleAgeMs>=0)return now-source.sampleAgeMs;
  return null;
}

// 同时接受 ArkTS EnvSnapshot（co/co2/sensorOnline/sampledAt/emergency）、
// gateway 实物快照（deviceOnline/receivedAt/values.coPpm/quality.*）与模拟帧。
export function normalizeEnvironment(input,now=Date.now()){
  const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const values=source.values&&typeof source.values==='object'?source.values:{};
  const quality=source.quality&&typeof source.quality==='object'?source.quality:{};
  const state=source.state&&typeof source.state==='object'?source.state:{};
  const sampledAt=sampledAtOf(source,now);
  return {
    deviceId:typeof source.deviceId==='string'?clip(source.deviceId,60):'unknown',
    source:['serial','http','simulation','unknown'].includes(source.source)?source.source:(source.simulated===true?'simulation':'unknown'),
    simulated:source.simulated===true,
    emergency:source.emergency===true||state.emergency===true,
    // 在线状态未知时按离线处理（fail closed）。
    sensorOnline:typeof source.sensorOnline==='boolean'?source.sensorOnline:source.deviceOnline===true,
    sampledAt:finite(sampledAt)?sampledAt:null,
    ageMs:finite(sampledAt)?now-sampledAt:null,
    co:reading(source.co,values.coPpm,quality.coValid),
    co2:reading(source.co2,values.co2Ppm,quality.co2Valid),
    coValid:quality.coValid===true,
    co2Valid:quality.co2Valid===true,
    temperatureC:quality.temperatureValid===false?null:(finite(values.temperatureC)?values.temperatureC:null),
    humidityPct:quality.humidityValid===false?null:(finite(values.humidityPct)?values.humidityPct:null),
    gasRaw:quality.gasValid===false?null:(Number.isInteger(values.gasRaw)?values.gasRaw:null),
    gasMv:quality.gasValid===false?null:(finite(values.gasMv)?values.gasMv:null)
  };
}

// evidence.ref 只允许指向真实快照 env.* 下的已有字段。
export function evidenceSnapshot(environment){return {env:{...environment}};}

export function resolveEvidenceRef(snapshot,ref,environment){
  if(typeof ref!=='string'||ref.length>80)return null;
  const parts=ref.split('.');
  if(parts.length<2||parts.length>4||parts[0]!=='env')return null;
  if(!parts.slice(1).every(part=>/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(part)))return null;
  let cursor=snapshot;
  for(const part of parts){
    if(!cursor||typeof cursor!=='object'||!Object.hasOwn(cursor,part))return null;
    cursor=cursor[part];
  }
  if(cursor!==null&&!['string','number','boolean'].includes(typeof cursor))return null;
  const sampledAt=environment?.sampledAt,age=environment?.ageMs;
  const observedAt=finite(sampledAt)?sampledAt:null;
  const fresh=observedAt!==null&&finite(age)&&age<=PIPELINE_LIMITS.maxAgeMs&&age>=-PIPELINE_LIMITS.futureSkewMs;
  return {value:cursor,observedAt,fresh};
}

export function environmentRules(environment,now=Date.now()){
  const hits=[];
  hits.push({ruleId:'R-ESTOP',passed:environment.emergency!==true,detail:environment.emergency===true?'急停生效，不可豁免':'急停未触发'});
  hits.push({ruleId:'R-SENSOR-OFFLINE',passed:environment.sensorOnline===true,detail:environment.sensorOnline===true?'传感终端在线':'传感终端离线或在线状态未知'});
  const age=finite(environment.sampledAt)?now-environment.sampledAt:null;
  const future=age!==null&&age<-PIPELINE_LIMITS.futureSkewMs;
  const stale=age===null||age>PIPELINE_LIMITS.maxAgeMs||future;
  let staleDetail;
  if(age===null)staleDetail='采样时间戳缺失或非有限值';
  else if(future)staleDetail='采样时间戳晚于当前时间 '+Math.abs(age)+'ms';
  else staleDetail='采样已 '+age+'ms 未更新（时效 '+PIPELINE_LIMITS.maxAgeMs+'ms）';
  hits.push({ruleId:'R-SAMPLE-STALE',passed:!stale,detail:stale?staleDetail:'采样时效内（'+Math.max(0,age)+'ms）'});
  if(!finite(environment.co)||environment.co<0){
    hits.push({ruleId:'R-CO-INVALID',passed:false,detail:'CO 读数非法：缺失、非有限或为负；未接入按非法处理'});
  }else{
    hits.push({ruleId:'R-CO',passed:environment.co<PIPELINE_LIMITS.co,detail:environment.co<PIPELINE_LIMITS.co?'CO '+environment.co+' 低于演示拒止阈值 '+PIPELINE_LIMITS.co:'CO '+environment.co+' 达到演示拒止阈值 '+PIPELINE_LIMITS.co});
  }
  if(!finite(environment.co2)||environment.co2<0){
    hits.push({ruleId:'R-CO2-INVALID',passed:false,detail:'CO₂ 读数非法：缺失、非有限或为负；未接入按非法处理'});
  }else{
    hits.push({ruleId:'R-CO2',passed:environment.co2<PIPELINE_LIMITS.co2,detail:environment.co2<PIPELINE_LIMITS.co2?'CO₂ '+environment.co2+' 低于演示拒止阈值 '+PIPELINE_LIMITS.co2:'CO₂ '+environment.co2+' 达到演示拒止阈值 '+PIPELINE_LIMITS.co2});
  }
  return hits;
}

function planStructureDetail(plan,error){
  const problems=[];
  if(!plan||typeof plan!=='object'||Array.isArray(plan))return '计划不是对象';
  if(typeof plan.summary!=='string')problems.push('summary 缺失或非字符串');
  else if(plan.summary.length>PIPELINE_LIMITS.summaryMax)problems.push('summary 超长 '+plan.summary.length+' 字符');
  if(!Array.isArray(plan.steps))problems.push('steps 不是数组');
  else{
    if(plan.steps.length>PIPELINE_LIMITS.maxSteps)problems.push('步骤 '+plan.steps.length+' 条，超过 '+PIPELINE_LIMITS.maxSteps+' 条');
    plan.steps.forEach((step,index)=>{
      const position='第 '+(index+1)+' 步';
      if(!step||typeof step!=='object'||Array.isArray(step)){problems.push(position+'不是对象');return;}
      if(!ALLOWED.has(step.action))problems.push(position+'动作不在白名单');
      if(typeof step.reason!=='string'||step.reason.length>PIPELINE_LIMITS.reasonMax)problems.push(position+'reason 缺失或超长');
      const maxRunMs=step.maxRunMs??PIPELINE_LIMITS.defaultMaxRunMs;
      if(step.action==='ventilate'&&(!Number.isInteger(maxRunMs)||maxRunMs<PIPELINE_LIMITS.maxRunMsMin||maxRunMs>PIPELINE_LIMITS.maxRunMsMax))problems.push(position+'ventilate 的 maxRunMs='+maxRunMs+' 不在 '+PIPELINE_LIMITS.maxRunMsMin+'..'+PIPELINE_LIMITS.maxRunMsMax);
    });
  }
  if(problems.length)return problems.join('；');
  if(error?.message==='invalid_model_duration')return 'ventilate 的 maxRunMs 不是合法整数区间';
  if(error?.message==='invalid_model_tool')return '步骤动作不在白名单或 reason 超长';
  return '计划结构非法';
}

// R-ACTION 复用 agent.mjs 的 ALLOWED；R-PLAN 复用 agent.mjs 的 validatePlan 语义。
export function planRules(plan,candidates=[]){
  const actions=[];
  const steps=Array.isArray(plan?.steps)?plan.steps:[];
  for(const step of steps)actions.push(step?.action);
  for(const candidate of Array.isArray(candidates)?candidates:[])actions.push(candidate?.action);
  const bad=actions.filter(action=>!ALLOWED.has(action));
  const hits=[{ruleId:'R-ACTION',passed:bad.length===0,detail:bad.length?'动作不在白名单：'+[...new Set(bad)].map(action=>clip(action,40)).join('、'):'所有动作均在白名单内'}];
  let passed=true,detail='计划结构合法';
  try{validatePlan(plan);}catch(error){passed=false;detail=planStructureDetail(plan,error);}
  hits.push({ruleId:'R-PLAN',passed,detail:clip(detail,200)});
  return hits;
}

// 第 4.2 节：allow 直接放行，不需要人工确认；其余按动作是否只读决定。
export function requiresConfirmation(verdict,action){return verdict==='allow'?false:action!=='query_environment';}

export function composeAudit({ruleHits=[],stageFailures=[],decision=null,modelVerdict='unknown',fabricatedEvidence=0,missingEvidence=[]}={}){
  const failed=ruleHits.filter(hit=>hit&&hit.passed===false);
  const envFailed=failed.filter(hit=>ENV_RULE_IDS.has(hit.ruleId));
  const structuralFailed=failed.filter(hit=>STRUCTURAL_RULE_IDS.has(hit.ruleId));
  const reasons=[];
  let verdict='allow',authoritative='rules';
  if(envFailed.length||structuralFailed.length){
    verdict='block';
    for(const hit of [...envFailed,...structuralFailed])reasons.push(clip(hit.detail||hit.ruleId,200));
  }else if(stageFailures.length){
    verdict='needs_human';
    for(const failure of stageFailures)reasons.push(clip(failure.stage+' 阶段失败：'+failure.error,200));
  }else if(decision&&decision.riskLevel==='high'){
    verdict='needs_human';
    reasons.push('决策阶段风险等级为 high，需人工审核');
  }else if(!decision||!finite(decision.confidence)||decision.confidence<0.7){
    verdict='needs_human';
    reasons.push('决策阶段置信度 '+(decision&&finite(decision.confidence)?decision.confidence:'未知')+' 低于 0.7，需人工审核');
  }else if(fabricatedEvidence>0){
    verdict='needs_human';
    reasons.push('计划依据中有 '+fabricatedEvidence+' 条无法在真实快照中核实，需人工审核');
  }else{
    reasons.push('无硬规则命中且风险与置信度达标，直接放行（requiresConfirmation=false）');
  }
  // 模型结论只能加严，不能放宽。
  if(modelVerdict==='block'&&verdict!=='block'){
    verdict='block';authoritative='model';
    reasons.push('模型审核要求拒止，服务端据此加严为 block');
  }else if(modelVerdict==='needs_human'&&verdict==='allow'){
    verdict='needs_human';authoritative='model';
    reasons.push('模型审核要求人工复核，服务端据此加严为 needs_human');
  }
  if(modelVerdict==='allow'&&(envFailed.length||structuralFailed.length))reasons.push('模型结论为 allow，但硬规则命中，最终仍为 block：模型不得放宽规则');
  const missing=[];
  for(const item of missingEvidence)if(typeof item==='string'&&item.trim())missing.push(clip(item.trim(),200));
  return {verdict,reasons:reasons.slice(0,6),ruleHits,missingEvidence:[...new Set(missing)].slice(0,5),modelVerdict,authoritative};
}
