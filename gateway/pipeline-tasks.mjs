import {pipelinePromptCatalog} from './agent-pipeline.mjs';
import {randomUUID} from 'node:crypto';
const copy=value=>structuredClone(value);
export class PipelineTasks {
 constructor({history}){this.history=history;this.tasks=new Map();this.pending=new Set();this.closing=false;}
 async open(){
  // The retained history owns all records; this map is only a recent-task view.
  for(const row of this.history.rows)if(row.kind==='audit'&&row.data.event==='pipeline_state'&&row.data.task?.gatewayId===row.gatewayId){const t=row.data.task;this.tasks.delete(t.taskId);this.tasks.set(t.taskId,copy(t));if(this.tasks.size>100)this.tasks.delete(this.tasks.keys().next().value);}
  for(const task of this.tasks.values())if(task.status==='running'){task.status='failed';task.error='server_restarted';task.finishedAt=Date.now();await this.record(task,'interrupted',{reason:task.error});}
  return this;
 }
 async record(task,type,data={}){
  if(task.events.length>=40)throw Error('pipeline_event_limit');
  const candidate=copy(task);candidate.events.push({seq:candidate.events.length+1,type,at:Date.now(),data:copy(data)});
  await this.history.append({kind:'audit',gatewayId:task.gatewayId,data:{event:'pipeline_state',actor:task.actor,task:candidate}});
  Object.assign(task,candidate);
 }
 list(gatewayId){return {items:[...this.tasks.values()].filter(t=>t.gatewayId===gatewayId).reverse().slice(0,50).map(t=>({taskId:t.taskId,gatewayId:t.gatewayId,status:t.status,startedAt:t.startedAt,finishedAt:t.finishedAt,error:t.error})),scope:'recent-50-not-complete'};}
 get(taskId,gatewayId){const task=this.tasks.get(taskId);if(!task||task.gatewayId!==gatewayId)throw Error('pipeline_task_not_found');return copy(task);}
 async start({gatewayId,prompt,actor,sessionBootId,createPipeline,onFinish}){
  if(this.closing)throw Error('pipeline_service_closing');
  const task={taskId:randomUUID(),promptPolicy:pipelinePromptCatalog(),gatewayId,prompt,actor,sessionBootId,status:'running',startedAt:Date.now(),events:[],historical:true,isCurrent:false,executed:false};
  await this.record(task,'task_started',{sessionBootId,readOnly:true});
  this.tasks.set(task.taskId,task);while(this.tasks.size>100)this.tasks.delete(this.tasks.keys().next().value);
  const work=new Promise(resolve=>setImmediate(resolve)).then(async()=>{
   try{
    const pipeline=createPipeline(async event=>{if(event.type==='retrieval_completed')task.retrieval=copy(event.data);await this.record(task,event.type,event.data);});
    const result=await pipeline.pipeline({prompt,mode:'hardware'});
    const completed=copy(task);completed.result=result;completed.retrieval=result.retrieval||task.retrieval;
    completed.status='completed';completed.finishedAt=Date.now();await this.record(completed,'task_completed',{verdict:result.audit?.verdict,calls:result.calls});Object.assign(task,completed);
   }catch{
    task.status='failed';task.error='pipeline_or_storage_failed';task.finishedAt=Date.now();
    try{await this.record(task,'task_failed',{reason:task.error});}catch{task.persistenceUnconfirmed=true;}
   }finally{onFinish();}
  });
  this.pending.add(work);void work.finally(()=>this.pending.delete(work));
  return {taskId:task.taskId,gatewayId};
 }
 async close(){this.closing=true;await Promise.allSettled([...this.pending]);}
}
