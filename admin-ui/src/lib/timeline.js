import {el} from './dom.js';
export const PHASES=[['retrieval','知识检索'],['safety','安全检查'],['decision','决策'],['generate','生成'],['verify','审核'],['execute','执行'],['feedback','结果回传'],['save','保存']];
const labels={passed:'成功',completed:'完成',running:'进行中',failed:'失败',blocked:'规则拒止',waiting:'等待',unavailable:'未接入',not_executed:'未执行'};
const time=v=>Number.isSafeInteger(v)&&v>=0;
export function buildTimeline(task){
 const events=[...new Map((task.events||[]).filter(e=>Number.isSafeInteger(e.seq)).map(e=>[e.seq,e])).values()].sort((a,b)=>a.seq-b.seq);
 return PHASES.map(([key,label])=>{
  const record=task.result?.stages?.find(s=>s.stage===key),start=events.find(e=>key==='retrieval'?e.type==='retrieval_started':e.type==='stage_started'&&e.data?.stage===key),end=events.findLast(e=>key==='retrieval'?e.type==='retrieval_completed':key==='safety'?e.type==='safety_checked':key==='save'?e.type==='task_completed':e.type==='stage_completed'&&e.data?.stage===key);
  let state=record?.state||end?.data?.state||(end?'completed':start?(task.status==='failed'?'failed':'running'):'waiting');
  if(key==='execute')state='unavailable';if(key==='feedback')state='not_executed';
  if(key==='retrieval'&&(task.result?.retrieval?.error||end?.data?.error))state='failed';
  if(key==='save'&&task.persistenceUnconfirmed)state='failed';
  const startedAt=record?.startedAt??start?.at,finishedAt=record?.finishedAt??end?.at;
  const durationMs=time(startedAt)&&time(finishedAt)&&finishedAt>=startedAt?finishedAt-startedAt:null;
  return {key,label,state,durationMs,summary:record?.summary||end?.data?.summary||'',error:record?.error||null};
 });
}
export function renderTaskTimeline(task){return el('ol',{class:'task-timeline','aria-label':'任务处理时间轴'},buildTimeline(task).map(s=>el('li',{class:'task-stage '+s.state},[el('strong',{text:s.label}),el('span',{text:labels[s.state]||s.state}),el('small',{text:s.durationMs===null?'耗时未知':s.durationMs+' 毫秒'}),s.summary?el('p',{text:s.summary}):null,s.error?el('p',{text:'失败原因：'+s.error}):null])));}
