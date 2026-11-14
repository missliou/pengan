import {replayHistory} from './history-replay.mjs';
import {LocalSpeech} from './speech.mjs';
import {CropReviews} from './crop-reviews.mjs';
import {WeatherService} from './weather.mjs';
import {weatherAdvice,weatherAdviceInput} from './weather-advice.mjs';
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir,open,rm} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DayuIngress} from './dayu-ingest.mjs';
import {CloudSecurity} from './cloud-security.mjs';
import {CloudHistory} from './cloud-history.mjs';
import {AiConfigStore,validateConfig} from './ai-config.mjs';
import {AgentPlanner} from './agent.mjs';
import {AgentPipeline,pipelinePromptCatalog} from './agent-pipeline.mjs';
import {KnowledgeStore} from './knowledge-store.mjs';
import {PipelineTasks} from './pipeline-tasks.mjs';
import {HumanReview} from './human-review.mjs';
import {AlertCenter} from './alerts.mjs';
import {DataStore} from './data-store.mjs';
import {hspSnapshot} from './hsp-telemetry.mjs';

const fail=code=>{throw Error(code);};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
async function json(req,limit=8192){
 let bytes=0;const chunks=[];
 for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)fail('body_too_large');chunks.push(chunk);}
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!plain(value))fail('invalid_json');return value;}catch{fail('invalid_json');}
}
function queryHistory(history,kind,gatewayId,params){
 const limit=params.has('limit')?Number(params.get('limit')):50;
 const beforeSeq=params.has('beforeSeq')?Number(params.get('beforeSeq')):undefined;
 if(!Number.isInteger(limit)||limit<1||limit>200||beforeSeq!==undefined&&(!Number.isSafeInteger(beforeSeq)||beforeSeq<1))fail('invalid_history_query');
 const data=history.database?{...history.database.queryHistory({kind,gatewayId,limit,beforeSeq}),storage:{...history.status(),database:{engine:'sqlite',schemaVersion:2}}}:history.query({kind,gatewayId,limit,beforeSeq});
 return {...data,schemaVersion:1,gatewayId,simulated:false,historical:true,isCurrent:false,items:data.items.map(row=>({seq:row.seq,hash:row.hash,recordedAt:row.recordedAt,sessionBootId:row.data.sessionBootId,historical:true,isCurrent:false,...(kind==='telemetry'?{observation:row.data.observation,replayed:row.data.replayed===true,capturedAt:row.data.capturedAt??null}:{prompt:row.data.prompt,analysis:row.data.analysis})}))};
}

export async function startCloudServer({dataDir,publicOrigin,users,devices,port=0,fetchFn=fetch,speechUrl='',staticDir=fileURLToPath(new URL('../admin-ui/dist/',import.meta.url))}){
 const weather=new WeatherService({fetchFn});
 if(!path.isAbsolute(dataDir)||!Array.isArray(devices)||devices.length<1||devices.length>100||!Number.isInteger(port)||port<0||port>65535)fail('invalid_cloud_config');
 const sourceRoot=fileURLToPath(new URL('../',import.meta.url)),relativeData=path.relative(sourceRoot,dataDir);
 if(relativeData===''||(!path.isAbsolute(relativeData)&&!relativeData.startsWith('..'+path.sep)))fail('cloud_data_outside_project_required');
 const origin=new URL(publicOrigin);
 if(origin.origin!==publicOrigin||origin.username||origin.password||(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))))fail('cloud_https_required');
 const secure=origin.protocol==='https:',cookieName=secure?'__Host-pengan-session':'pengan-session';
 await mkdir(dataDir,{recursive:true});
 const lockFile=path.join(dataDir,'cloud-writer.lock');let writerLock;
 try{writerLock=await open(lockFile,'wx',0o600);await writerLock.writeFile(String(process.pid));}catch{await writerLock?.close();if(writerLock)await rm(lockFile,{force:true});fail('cloud_writer_lock_unavailable');}
 let database;
 try{
 const security=new CloudSecurity({users}),history=await new CloudHistory({file:path.join(dataDir,'history.jsonl')}).open();
 database=await new DataStore({directory:path.join(dataDir,'database')}).open(history.rows);
 const appendHistory=history.append.bind(history);
 history.append=async input=>{const row=await appendHistory(input);database.record(row);return row;};
 history.database=database;
 const cropReviews=new CropReviews({history,database}).open();
 const knowledge=await new KnowledgeStore({file:path.join(dataDir,'knowledge.json')}).open();
 const pipelineTasks=await new PipelineTasks({history}).open();
 // 人工审核队列从同一条保留审计链派生，因此天然继承设备隔离与重启恢复。
 const humanReview=await new HumanReview({history}).open();
 // 告警中心与人工审核同源：open() 重放 alert_state 行重建索引，天然继承哈希链与设备隔离。
 const alerts=await new AlertCenter({history}).open();
 const speech=new LocalSpeech({url:speechUrl,fetchFn});
 const configStore=new AiConfigStore(path.join(dataDir,'model-config.json'));
 let config=await configStore.open()||{provider:null,model:null,key:null,workspaceId:''},configRevision=0,modelBusy=false;
 const ingresses=new Map(),planners=new Map();
 for(const device of devices){
  if(!id(device.gatewayId)||ingresses.has(device.gatewayId))fail('invalid_device_registration');
  ingresses.set(device.gatewayId,await new DayuIngress({gatewayId:device.gatewayId,tokenSha256:device.tokenSha256,file:path.join(dataDir,'devices',device.gatewayId+'.json')}).open());
 }
 const audit=async(event,actor='system',gatewayId='system',extra={})=>history.append({kind:'audit',gatewayId,data:{event,actor,...extra}});
 const selected=params=>{const key=params.get('gatewayId')||(ingresses.size===1?[...ingresses.keys()][0]:'');if(!ingresses.has(key))fail('gateway_required');return ingresses.get(key);};
 // 告警派生输入：设备侧只给接入层的时间证据与当前快照，任务侧只给 PipelineTasks 的最近任务。
 const alertInputs=()=>({
  devices:[...ingresses.values()].map(ingress=>{
   const state=ingress.state,hardware=ingress.current().hardware;
   return {gatewayId:ingress.gatewayId,hasSession:Boolean(state?.sessionBootId),lastAcceptedAt:Number.isSafeInteger(state?.acceptedAt)?state.acceptedAt:null,
    snapshot:{deviceOnline:hardware.deviceOnline===true,reason:typeof hardware.reason==='string'?hardware.reason:null,receivedAt:Number.isSafeInteger(state?.receivedAt)?state.receivedAt:null,sampleAgeMs:Number.isSafeInteger(hardware.sampleAgeMs)?hardware.sampleAgeMs:null,quality:hardware.quality}};
  }),
  tasks:[...pipelineTasks.tasks.values()].map(task=>({gatewayId:task.gatewayId,taskId:task.taskId,status:task.status,error:typeof task.error==='string'?task.error:null,startedAt:task.startedAt??null,finishedAt:task.finishedAt??null,verdict:task.verdict??task.result?.audit?.verdict??null,stages:Array.isArray(task.result?.stages)?task.result.stages:[]})),
 });
 // 生产者钩子一律 best-effort：派生失败只记错误码供列表回传，绝不影响采集与模型链路。
 const reconcileAlerts=async(gatewayId,actor='system')=>{try{await alerts.reconcile({gatewayId,inputs:alertInputs(),actor});}catch(error){alerts.recordReconcileFailure(error);}};
 const modelStatus=()=>new AgentPlanner({...config,fetchFn}).status();
 function plannerFor(ingress){
  const session=ingress.state?.sessionBootId||'no-sample',key=ingress.gatewayId+'/'+session+'/'+configRevision;
  if(!planners.has(key)){
   // A session switch replaces this device's memory; never retain an unbounded
   // list of prior device sessions or import another device's analyses.
   for(const existing of planners.keys())if(existing.startsWith(ingress.gatewayId+'/'))planners.delete(existing);
   const planner=new AgentPlanner({...config,fetchFn});
   const prior=history.query({kind:'analysis',gatewayId:ingress.gatewayId,limit:200}).items.filter(r=>r.data.sessionBootId===session&&r.data.analysis.provider===config.provider&&r.data.analysis.model===config.model).slice(0,8).reverse();
   planner.recentAnalyses=prior.map(r=>({request:r.data.prompt.slice(0,300),summary:r.data.analysis.summary.slice(0,500),observationReceivedAt:r.data.analysis.observationReceivedAt,executed:false}));
   planners.set(key,planner);
  }
  return planners.get(key);
 }
 async function analyze(ingress,body){
  if(Object.keys(body).some(k=>k!=='prompt'))fail('invalid_prompt');
  if(modelBusy)fail('ai_busy_try_later');modelBusy=true;
  const session=ingress.state?.sessionBootId||'no-sample';
  try{
   const planner=plannerFor(ingress),analysis=await planner.analyze(body.prompt,ingress.current().hardware,{
    readEnvironment:()=>{if((ingress.state?.sessionBootId||'no-sample')!==session)fail('device_session_changed');return ingress.current().hardware;},
    readHistory:limit=>{const data=queryHistory(history,'telemetry',ingress.gatewayId,new URLSearchParams({limit:'200'}));return {...data,items:data.items.filter(r=>r.sessionBootId===session).slice(0,limit)};},
   });
   if((ingress.state?.sessionBootId||'no-sample')!==session)fail('device_session_changed');
   const row=await history.append({kind:'analysis',gatewayId:ingress.gatewayId,data:{prompt:body.prompt,analysis,sessionBootId:session}});
   return {...analysis,gatewayId:ingress.gatewayId,sessionBootId:session,persistence:{saved:true,recordId:row.seq}};
  }finally{modelBusy=false;}
 }
 async function generateWeatherAdvice(gatewayId,body,actor){
  const input=weatherAdviceInput(body);
  if(modelBusy)fail('ai_busy_try_later');modelBusy=true;
  try{
   const snapshot=await weather.read();
   if(!snapshot.available)fail('weather_forecast_unavailable');
   await audit('weather_advice_requested',actor,gatewayId);
   const result=await weatherAdvice({weather:snapshot,body:input,config,fetchFn});
   const record=await history.append({kind:'audit',gatewayId,data:{event:'weather_advice_saved',actor,advice:result}});
   return {...result,gatewayId,persistence:{saved:true,recordId:record.seq}};
  }catch(e){await audit('weather_advice_failed',actor,gatewayId);throw e;}finally{modelBusy=false;}
 }
 async function launchPipeline(ingress,body,actor){
    if(Object.keys(body).some(k=>k!=='prompt')||typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>1000)fail('invalid_pipeline_prompt');
    if(modelBusy)fail('ai_busy_try_later');modelBusy=true;
    const sessionBootId=ingress.state?.sessionBootId||'no-sample';
    try{
     const result=await pipelineTasks.start({gatewayId:ingress.gatewayId,prompt:body.prompt.trim(),actor,sessionBootId,onFinish:()=>{modelBusy=false;void reconcileAlerts(ingress.gatewayId,'system');},createPipeline:onEvent=>new AgentPipeline({...config,fetchFn,onEvent,
      readEnvironment:()=>{if((ingress.state?.sessionBootId||'no-sample')!==sessionBootId)fail('device_session_changed');return ingress.current().hardware;},
      readKnowledge:query=>knowledge.search(query,ingress.gatewayId,5),
      readMemory:()=>history.query({kind:'analysis',gatewayId:ingress.gatewayId,limit:200}).items.filter(r=>r.data.sessionBootId===sessionBootId&&r.data.analysis.provider===config.provider&&r.data.analysis.model===config.model).slice(0,8).map(r=>r.seq),
     })});return result;
    }catch(error){modelBusy=false;throw error;}
 }
 const server=http.createServer(async(req,res)=>{
  const send=(status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(value));};
  const url=new URL(req.url,'http://localhost'),route=url.pathname;
  let actor='anonymous';
  try{
   if(route.startsWith('/api/v1/')){
    if(req.headers.origin)fail('origin_denied');
    const gatewayId=req.headers['x-pengan-gateway-id'],ingress=ingresses.get(gatewayId);
    if(!ingress)fail('device_unauthorized');
    const auth=req.headers.authorization,token=typeof auth==='string'&&auth.startsWith('Bearer ')?auth.slice(7):'';
    ingress.authenticate(token);
    if(req.method==='GET'&&route==='/api/v1/device/weather'){send(200,{...await weather.read(),gatewayId:ingress.gatewayId});return;}
    if(req.method==='POST'&&route==='/api/v1/device/weather/advice'){if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');send(200,await generateWeatherAdvice(ingress.gatewayId,await json(req),'device'));return;}
    if(req.method==='POST'&&route==='/api/v1/telemetry/replay'){
     if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
     send(200,await replayHistory(history,ingress.gatewayId,await json(req,65536)));return;
    }
    if(req.method==='GET'&&route==='/api/v1/device/speech/status'){send(200,{...speech.status(),gatewayId:ingress.gatewayId});return;}
    if(req.method==='POST'&&route==='/api/v1/device/speech'){
     if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
     await audit('speech_transcription_requested','device',ingress.gatewayId);
     send(200,{...await speech.transcribe(await json(req,440000)),gatewayId:ingress.gatewayId});return;
    }
    if(req.method==='POST'&&route==='/api/v1/device/media'){
     if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
     const body=await json(req,3*1024*1024);
     await audit('device_media_upload_requested','device',ingress.gatewayId);
     const item=await database.upload(body,{gatewayId:ingress.gatewayId,actor:'device',role:'admin'});
     await audit('media_saved','device',ingress.gatewayId,{mediaId:item.mediaId,category:item.category});
     send(201,{saved:true,item});return;
    }
    if(req.method==='POST'&&route==='/api/v1/telemetry/current'){
     if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
     const body=await json(req,4096),sentAt=Number(req.headers['x-pengan-sent-at']),now=Date.now();
     if(!/^\d{1,16}$/.test(req.headers['x-pengan-sent-at']||'')||!Number.isSafeInteger(sentAt)||sentAt<0||now-sentAt>3000||sentAt-now>1000)fail('sender_clock_out_of_window');
     if(Number.isSafeInteger(body.sampleAgeMs)&&body.sampleAgeMs>=0)body.sampleAgeMs+=Math.max(0,now-sentAt)+1000;
     const result=await ingress.accept(body,token);
     // Recover the history write after an interrupted previous response without
     // recording old out-of-order frames or duplicating a committed entry.
     if(ingress.state.sessionBootId===body.sessionBootId&&ingress.state.frame.uptime_ms===body.frame.uptime_ms){
      const key=hash(ingress.gatewayId+'/'+body.sessionBootId+'/'+body.frame.uptime_ms);
      const s=ingress.state;
      const stored=hspSnapshot({transport:'http',receivedAt:s.receivedAt,frame:s.frame},s.acceptedAt);stored.source='dayu-direct';
      await history.append({kind:'telemetry',gatewayId:ingress.gatewayId,key,data:{sessionBootId:s.sessionBootId,observation:stored}});
     }
     // 采集入库成功后 best-effort 派生告警：失败只记错误码，不影响设备侧响应。
     await reconcileAlerts(ingress.gatewayId,'device');
     send(200,result);return;
    }
    if(req.method==='POST'&&route==='/api/v1/device/pipeline'){
     if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
     send(202,await launchPipeline(ingress,await json(req),'device'));return;
    }
    if(req.method==='GET'&&route.startsWith('/api/v1/device/pipeline/tasks/')){
     send(200,pipelineTasks.get(decodeURIComponent(route.slice('/api/v1/device/pipeline/tasks/'.length)),ingress.gatewayId));return;
    }
    if(req.method==='GET'&&route==='/api/v1/device/observations'){send(200,ingress.current());return;}
    if(req.method==='GET'&&route==='/api/v1/device/crop-reviews'){send(200,cropReviews.deviceInbox(ingress.gatewayId));return;}
    if(req.method==='GET'&&route==='/api/v1/device/history'){
     const kind=url.searchParams.get('kind');if(!['telemetry','analysis'].includes(kind))fail('invalid_history_query');
     send(200,queryHistory(history,kind,ingress.gatewayId,url.searchParams));return;
    }
    if(req.method==='POST'&&['/api/v1/device/analyze','/api/v1/device/test','/api/v1/device/inspect-image'].includes(route)){
     if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
     const body=await json(req,route.endsWith('inspect-image')?3*1024*1024:8192);
     await audit(route.endsWith('/analyze')?'device_analysis_requested':route.endsWith('/test')?'device_model_test_requested':'device_photo_analysis_requested','device',ingress.gatewayId);
     if(route.endsWith('/analyze')){send(200,await analyze(ingress,body));return;}
     if(modelBusy)fail('ai_busy_try_later');modelBusy=true;
     try{const planner=plannerFor(ingress);if(route.endsWith('/test')&&Object.keys(body).length)fail('invalid_connection_test');const result=route.endsWith('/test')?await planner.testConnection():await planner.inspectImage(body);send(200,{...result,gatewayId:ingress.gatewayId});}finally{modelBusy=false;}return;
    }
    send(404,{error:'not_found'});return;
   }
   if(!route.startsWith('/api/')&&!route.startsWith('/admin-api/')){
    if(req.method!=='GET'){send(405,{error:'method_not_allowed'});return;}
    const relative=route==='/'?'index.html':decodeURIComponent(route).slice(1);
    if(!/^(index\.html|env\.js|styles\.css|src\/[A-Za-z0-9_./-]+\.(?:js|css))$/.test(relative)||relative.split('/').includes('..')){send(404,{error:'not_found'});return;}
    const bytes=await readFile(path.join(staticDir,relative));
    const type=relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':'text/html';
    res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(bytes);return;
   }
   if(req.headers.origin&&req.headers.origin!==publicOrigin)fail('origin_denied');
   const isWrite=!['GET','HEAD'].includes(req.method);
   if(isWrite&&req.headers.origin!==publicOrigin)fail('origin_denied');
   const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));
   const token=cookie?cookie.slice(cookieName.length+1):'';
   const cookieValue=value=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict${secure?'; Secure':''}`;
   if(route==='/admin-api/session/login'&&req.method==='POST'){
    const body=await json(req);let logged;
    try{logged=await security.login(body.username,body.password,{ip:req.socket.remoteAddress});await audit('login_success',logged.user.username);}
    catch(e){if(logged)security.logout(logged.token);await audit('login_failed','anonymous');throw e;}
    send(200,{authenticated:true,user:logged.user,csrfToken:logged.csrfToken},{'set-cookie':cookieValue(logged.token)});return;
   }
   const session=security.authenticate(token);actor=session.user.username;
   if(isWrite)security.requireCsrf(session,req.headers['x-pengan-csrf']);
   if(route==='/admin-api/session'&&req.method==='GET'){send(200,{authenticated:true,...session});return;}
   if(route==='/admin-api/session/logout'&&req.method==='POST'){security.logout(token);await audit('logout',actor);send(200,{ok:true},{'set-cookie':cookieValue('')+'; Max-Age=0'});return;}
   if(isWrite)security.requireRole(session,'admin');
   if(route==='/admin-api/weather'&&req.method==='GET'){const device=selected(url.searchParams);send(200,{...await weather.read(),gatewayId:device.gatewayId});return;}
   if(route==='/admin-api/weather/advice'&&req.method==='POST'){if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');send(200,await generateWeatherAdvice(selected(url.searchParams).gatewayId,await json(req),actor));return;}
   if(route==='/admin-api/agent/prompts'&&req.method==='GET'){send(200,pipelinePromptCatalog());return;}
   if(route==='/admin-api/storage'&&req.method==='GET'){security.requireRole(session,'admin');send(200,database.status());return;}
   if(route==='/admin-api/crop-reviews'&&req.method==='GET'){
    const gatewayId=selected(url.searchParams).gatewayId;
    send(200,url.searchParams.get('history')==='1'?cropReviews.versions(gatewayId,url.searchParams.get('mediaId')||'',session.user.role):url.searchParams.has('mediaId')?cropReviews.read(gatewayId,url.searchParams.get('mediaId'),session.user.role):cropReviews.list(gatewayId,session.user.role,url.searchParams));return;
   }
   if(route==='/admin-api/crop-reviews'&&req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
    const gatewayId=selected(url.searchParams).gatewayId,body=await json(req,8192);
    send(200,await cropReviews.save(gatewayId,body,actor,session.user.role));return;
   }
   if(route==='/admin-api/media'&&req.method==='GET'){
    const gatewayId=selected(url.searchParams).gatewayId;
    send(200,database.list({gatewayId,role:session.user.role,category:url.searchParams.get('category')||'',limit:Number(url.searchParams.get('limit')||20),beforeSeq:url.searchParams.has('beforeSeq')?Number(url.searchParams.get('beforeSeq')):undefined}));return;
   }
   if(route==='/admin-api/media'&&req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
    const gatewayId=selected(url.searchParams).gatewayId,body=await json(req,3*1024*1024);
    await audit('media_upload_requested',actor,gatewayId);
    const item=await database.upload(body,{gatewayId,actor,role:session.user.role});
    await audit('media_saved',actor,gatewayId,{mediaId:item.mediaId,category:item.category});
    send(201,{saved:true,item});return;
   }
   if(req.method==='GET'&&route.startsWith('/admin-api/media/')){
    const gatewayId=selected(url.searchParams).gatewayId,parts=route.slice('/admin-api/media/'.length).split('/');
    if(parts.length===2&&parts[1]==='content'){
     const {row,bytes}=await database.content(parts[0],gatewayId,session.user.role);
     await audit('media_viewed',actor,gatewayId,{mediaId:row.mediaId,category:row.category});
     res.writeHead(200,{'content-type':row.mime,'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'content-disposition':'inline','referrer-policy':'no-referrer'});res.end(bytes);return;
    }
    if(parts.length===1){send(200,database.detail(parts[0],gatewayId,session.user.role));return;}
    send(404,{error:'media_not_found'});return;
   }
   if(route==='/admin-api/knowledge'&&req.method==='GET'){send(200,{items:knowledge.list(selected(url.searchParams).gatewayId)});return;}
   if(route==='/admin-api/knowledge'&&req.method==='POST'){
    const gatewayId=selected(url.searchParams).gatewayId,body=await json(req,200000);
    if(Object.keys(body).some(k=>!['id','title','source','text'].includes(k)))fail('invalid_knowledge_document');
    await audit('knowledge_save_requested',actor,gatewayId);
    const document=await knowledge.upsert({...body,gatewayId});
    await audit('knowledge_saved',actor,gatewayId,{documentId:document.id});send(200,document);return;
   }
   if(route==='/admin-api/knowledge/search'&&req.method==='POST'){
    const gatewayId=selected(url.searchParams).gatewayId,body=await json(req);
    if(Object.keys(body).some(k=>k!=='query')||typeof body.query!=='string'||!body.query.trim()||body.query.length>1000)fail('invalid_knowledge_query');
    send(200,{items:knowledge.search(body.query,gatewayId,5),method:'lexical',untrusted:true});return;
   }
   if(route==='/admin-api/pipeline/tasks'&&req.method==='GET'){send(200,pipelineTasks.list(selected(url.searchParams).gatewayId));return;}
   if(route.startsWith('/admin-api/pipeline/tasks/')&&req.method==='GET'){send(200,pipelineTasks.get(route.slice('/admin-api/pipeline/tasks/'.length),selected(url.searchParams).gatewayId));return;}
   // 人工审核中心：队列与详情对 admin/viewer 只读开放；提交审核走上面的 isWrite→requireRole('admin')+CSRF。
   // 队列/详情/提交都以 selected() 解析设备，跨设备访问统一报未找到，沿用既有设备隔离口径。
   if(route==='/admin-api/review'&&req.method==='GET'){
    const ingress=selected(url.searchParams),params=url.searchParams;
    send(200,humanReview.queue({gatewayId:ingress.gatewayId,verdict:params.get('verdict')||'needs_human',reviewStatus:params.get('reviewStatus')||null,limit:params.has('limit')?Number(params.get('limit')):50}));return;
   }
   if(route.startsWith('/admin-api/review/')&&['GET','POST'].includes(req.method)){
    const ingress=selected(url.searchParams),taskId=decodeURIComponent(route.slice('/admin-api/review/'.length));
    if(req.method==='GET'){send(200,humanReview.detail({gatewayId:ingress.gatewayId,taskId}));return;}
    if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
    const body=await json(req);
    await audit('human_review_requested',actor,ingress.gatewayId,{taskId});
    // human_review_saved 由 HumanReview 作为带 key 的权威记录写入哈希链；
    // 这里不再重复 audit，否则同一动作会留下两条同名审计行、破坏幂等。
    send(200,await humanReview.submit({...body,gatewayId:ingress.gatewayId,actor}));return;
   }
   // 告警中心：列表/详情对 admin/viewer 只读开放；ack/note 走上面的 isWrite→requireRole('admin')+CSRF，viewer 必然 403。
   // 读路径同步派生一次（mode='read' 只做状态迁移，不累加 occurrences），派生失败如实返回错误码而不是空列表。
   if(route==='/admin-api/alerts'&&req.method==='GET'){
    const ingress=selected(url.searchParams),params=url.searchParams,hardware=ingress.current().hardware,state=ingress.state;
    await alerts.reconcile({gatewayId:ingress.gatewayId,inputs:alertInputs(),actor,mode:'read'});
    send(200,alerts.list({gatewayId:ingress.gatewayId,type:params.get('type'),severity:params.get('severity'),status:params.get('status'),cursor:params.get('cursor'),limit:params.has('limit')?Number(params.get('limit')):undefined,
     source:{connected:hardware.deviceOnline===true,lastAcceptedAt:Number.isSafeInteger(state?.acceptedAt)?state.acceptedAt:null}}));return;
   }
   if(route.startsWith('/admin-api/alerts/')){
    const ingress=selected(url.searchParams),rest=decodeURIComponent(route.slice('/admin-api/alerts/'.length)),slash=rest.indexOf('/');
    const alertId=slash<0?rest:rest.slice(0,slash),action=slash<0?'':rest.slice(slash+1);
    if(req.method==='GET'&&action===''){send(200,alerts.detail({gatewayId:ingress.gatewayId,alertId}));return;}
    if(req.method==='POST'&&(action==='ack'||action==='note')){
     if(!req.headers['content-type']?.startsWith('application/json'))fail('json_required');
     // alert_state 行自身带 actor，这里不再写第二条审计行，避免同一动作两条记录破坏幂等（同 human_review_saved）。
     const body=await json(req);
     send(200,await alerts.submit({...body,gatewayId:ingress.gatewayId,alertId,action,actor}));return;
    }
   }
   if(route==='/api/agent/pipeline'&&req.method==='POST'){send(202,await launchPipeline(selected(url.searchParams),await json(req),actor));return;}
   if(route==='/api/health'&&req.method==='GET'){send(200,{ok:true,mode:'hardware',simulated:false,transport:'dayu-direct',hardwareConnected:[...ingresses.values()].some(i=>i.current().hardware.deviceOnline)});return;}
   if(route==='/admin-api/devices'&&req.method==='GET'){send(200,{items:[...ingresses.values()].map(i=>i.current())});return;}
   if(route==='/admin-api/audit'&&req.method==='GET'){security.requireRole(session,'admin');const limit=Number(url.searchParams.get('limit')||50);send(200,history.query({kind:'audit',limit,beforeSeq:url.searchParams.has('beforeSeq')?Number(url.searchParams.get('beforeSeq')):undefined}));return;}
   if(route==='/api/observations'&&req.method==='GET'){send(200,selected(url.searchParams).current());return;}
   if(route==='/api/hardware/history'&&req.method==='GET'){send(200,queryHistory(history,'telemetry',selected(url.searchParams).gatewayId,url.searchParams));return;}
   if(route==='/api/agent/history'&&req.method==='GET'){send(200,queryHistory(history,'analysis',selected(url.searchParams).gatewayId,url.searchParams));return;}
   if(route==='/api/agent/status'&&req.method==='GET'){send(200,modelStatus());return;}
   if(route==='/api/agent/config'&&req.method==='GET'){send(200,{...modelStatus(),keySaved:Boolean(config.key),csrfToken:session.csrfToken});return;}
   if(route==='/api/agent/config'&&req.method==='POST'){
    if(modelBusy)fail('ai_busy_try_later');modelBusy=true;
    try{const next=validateConfig(await json(req),config);await audit('model_config_change_requested',actor);await configStore.save(next);config=next;configRevision++;planners.clear();await audit('model_config_changed',actor);send(200,{...modelStatus(),keySaved:Boolean(config.key)});}finally{modelBusy=false;}return;
   }
   if(route==='/api/agent/test'&&req.method==='POST'){
    if(modelBusy)fail('ai_busy_try_later');if(Object.keys(await json(req)).length)fail('invalid_connection_test');modelBusy=true;
    try{await audit('model_test_requested',actor);const result=await new AgentPlanner({...config,fetchFn}).testConnection();await audit('model_test_passed',actor);send(200,result);}finally{modelBusy=false;}return;
   }
   send(501,{error:'cloud_api_not_implemented'});
  }catch(error){
   const code=typeof error.message==='string'&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'cloud_request_failed';
   if(actor!=='anonymous'&&/forbidden|csrf_required/.test(code)){
    try{await audit('permission_denied',actor,'system',{reason:code});}catch{send(503,{error:'audit_write_failed'});return;}
   }
   // 告警码显式前置映射（契约 5.4）：容量/事件上限 507、写失败 503、冲突 409、未找到 404、入参 400。
   const alertStatus={crop_image_not_found:404,crop_review_revision_conflict:409,crop_review_state_invalid:503,media_upload_conflict:409,media_not_found:404,media_capacity_exceeded:507,alert_store_full:507,alert_event_limit:507,alert_persist_failed:503,alert_store_not_ready:503,alert_reconcile_failed:503,alert_revision_conflict:409,alert_not_found:404,invalid_alert_query:400,invalid_alert_note:400,invalid_alert_actor:400};
   const status=alertStatus[code]??(/unauthorized|session_invalid|session_expired|invalid_credentials|login_failed/.test(code)?401:/forbidden|permission|role|csrf|origin/.test(code)?403:/rate_limit|too_many|busy/.test(code)?429:/write|unavailable|not_ready|integrity|history_.*limit|cloud_request_failed/.test(code)?503:/body_too_large/.test(code)?413:/clock|retired_session|session_changed/.test(code)?409:400);
   send(status,{error:code});
  }
 });
 server.requestTimeout=35000;server.headersTimeout=5000;server.maxHeadersCount=32;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 if(!secure&&origin.port==='0')publicOrigin='http://127.0.0.1:'+server.address().port;
 let closing;
 const close=()=>closing??=(async()=>{try{await new Promise(resolve=>server.close(resolve));await pipelineTasks.close();await knowledge.flush();await history.flush();}finally{await database?.close();await writerLock.close();await rm(lockFile,{force:true});}})();
 return {server,port:server.address().port,publicOrigin,close,security,history,ingresses,knowledge,pipelineTasks,humanReview,alertCenter:alerts,database};
 }catch(error){await database?.close();await writerLock.close();await rm(lockFile,{force:true});throw error;}
}
