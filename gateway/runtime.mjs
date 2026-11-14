import net from 'node:net';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {Aedes} from 'aedes';
import mqtt from 'mqtt';
import {SimulatedDevice} from './device.mjs';
import {PREFIX,DEVICE_ID,ACTIONS,validateTelemetry} from './protocol.mjs';
import {AgentPlanner} from './agent.mjs';
import {AgentPipeline} from './agent-pipeline.mjs';
import {readFile} from 'node:fs/promises';
import {validateConfig} from './ai-config.mjs';
import {readHspTelemetry} from './hsp-telemetry.mjs';
import {fileURLToPath} from 'node:url';
import {createRealReport,disabledReportHistory} from './report.mjs';
const panelFiles=new Map(await Promise.all(['panel.html','panel.js','panel.css'].map(async name=>[name,await readFile(new URL('./'+name,import.meta.url))])));

const listen=(server,port,host='127.0.0.1')=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
const publish=(client,topic,data)=>client.publishAsync(`${PREFIX}/${topic}`,JSON.stringify(data),{qos:1,retain:false});
export async function startDemo({mqttPort=18886,httpPort=5187,tickMs=2000,commandTimeoutMs=4000,journal,httpHost='127.0.0.1',plannerOptions,configStore,operationMode='simulation',historyStore,analysisStore,hardwareFile=fileURLToPath(new URL('../tmp/runtime/hsp-latest.json',import.meta.url))}={}){
  if(!['hardware','simulation'].includes(operationMode))throw new Error('invalid_operation_mode');
  const isHardware=operationMode==='hardware';
  const observations=async()=>({schemaVersion:1,mode:'hardware',simulated:false,gatewayNow:Date.now(),hardware:await readHspTelemetry(hardwareFile),capabilities:{readEnvironment:true,actuate:false,co:false,co2:false},admission:'unknown_denied'});
  if(net.isIP(httpHost)!==4||!(/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(httpHost)))throw new Error('http_host_must_be_private_ipv4');
  const password=randomBytes(24).toString('hex');
  const broker=isHardware?null:await Aedes.createBroker();
  if(broker){
  broker.authenticate=(client,user,pass,cb)=>cb(null,user==='demo'&&pass?.toString()===password&&['pengan-ui','pengan-device'].includes(client.id));
  broker.authorizePublish=(client,packet,cb)=>{
    if(!client)return cb(null);
    const topics=client.id==='pengan-ui'?['command']:['telemetry','status','ack','event'];
    if(!topics.some(t=>packet.topic===`${PREFIX}/${t}`)||(packet.topic===`${PREFIX}/command`&&packet.retain))return cb(new Error('topic_or_retain_denied'));
    cb(null);
  };
  broker.authorizeSubscribe=(client,subscription,cb)=>{
    const topics=client.id==='pengan-device'?['command']:['telemetry','status','ack','event'];
    cb(null,topics.some(t=>subscription.topic===`${PREFIX}/${t}`)?subscription:null);
  };
  broker.on('clientError',()=>{});
  }
  const tcp=broker?net.createServer(broker.handle):null;
  if(tcp)await listen(tcp,mqttPort);
  const url=tcp?`mqtt://127.0.0.1:${tcp.address().port}`:'';
  const opts={username:'demo',password,protocolVersion:4,reconnectPeriod:500,connectTimeout:3000,clean:true};
  let ui,deviceClient,api,timer,historyTimer;
  const simulator=new SimulatedDevice();
  let planner=new AgentPlanner(plannerOptions);
  const restoreAnalysisMemory=target=>{
    target.recentAnalyses=[];
    try{
      if(!analysisStore||analysisStore.status().healthy!==true)return;
      const history=analysisStore.read({limit:200});
      if(history.simulated!==false||history.historical!==true||history.isCurrent!==false||history.storage?.healthy!==true||!Array.isArray(history.items))return;
      const matching=history.items.filter(row=>row.analysis?.provider===target.provider&&row.analysis?.model===target.model).slice(0,8).reverse();
      const restored=matching.map(row=>{
        const a=row.analysis;
        if(typeof row.prompt!=='string'||row.prompt.length>1000||typeof a.summary!=='string'||a.summary.length>2000||a.mode!=='hardware'||a.simulated!==false||a.executed!==false||a.hardwareControl!==false||a.realAdmission!=='unknown_denied'||a.kind==='crop_image_analysis'||a.source==='user_photo')throw Error('invalid_memory_record');
        return {request:row.prompt.slice(0,300),summary:a.summary.slice(0,500),observationReceivedAt:a.observationReceivedAt,executed:false};
      });
      if(analysisStore.status().healthy===true)target.recentAnalyses=restored;
    }catch{target.recentAnalyses=[];}
  };
  restoreAnalysisMemory(planner);
  const configToken=randomBytes(24).toString('hex');
  let configuring=false;
  const configStatus=()=>({...planner.status(),keySaved:Boolean(planner.key)});
  let planning=false;
  let frame=null,receivedAt=0,status=false,lastBoot='',lastSeq=-1;
  const pending=new Map(),events=[];
  const note=(event,detail)=>{const row={at:Date.now(),event,detail,simulated:true};events.push(row);if(events.length>500)events.shift();journal?.append(row).catch(()=>{});};
  const snapshot=()=>({simulated:true,gatewayNow:Date.now(),brokerConnected:ui?.connected===true,deviceOnline:status&&Date.now()-receivedAt<15000,receivedAt,frame,events:events.slice(-50),journal:journal?.status()??{enabled:false}});
  // 三阶段只读管线：环境与记忆都是只读输入；不执行动作、不写硬件历史、不写分析历史。
  const pipelineEnvironment=async mode=>{
    if(mode==='hardware')return readHspTelemetry(hardwareFile);
    const current=snapshot();
    return current.frame?{...current.frame,source:'simulation',simulated:true,deviceOnline:current.deviceOnline}:{source:'simulation',simulated:true,deviceOnline:false};
  };
  const pipelineMemory=()=>{
    try{
      if(!analysisStore||analysisStore.status().healthy!==true)return [];
      const history=analysisStore.read({limit:8});
      if(history.simulated!==false||history.historical!==true||history.isCurrent!==false||!Array.isArray(history.items))return [];
      return history.items.map(row=>row.seq).filter(seq=>Number.isSafeInteger(seq));
    }catch{return [];}
  };
  // 每次请求按当前 planner 配置构造，密钥热更新后端点立即生效，且不额外通道读取密钥。
  const pipelineFor=()=>new AgentPipeline({provider:planner.provider,model:planner.model,key:planner.key,workspaceId:planner.workspaceId,fetchFn:planner.fetchFn,readEnvironment:pipelineEnvironment,readMemory:pipelineMemory});
  const close=async()=>{
    clearInterval(timer);
    clearInterval(historyTimer);
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('gateway_stopped'));}pending.clear();
    if(api)await new Promise(r=>api.close(r));
    await Promise.allSettled([ui?.endAsync(true),deviceClient?.endAsync(true)]);
    if(broker)await new Promise(r=>broker.close(r));
    if(tcp)await new Promise(r=>tcp.close(r));
    await journal?.flush();
    await historyStore?.flush();
    await analysisStore?.flush();
  };
  try{
    if(isHardware&&historyStore){await historyStore.collect(hardwareFile).catch(()=>{});historyTimer=setInterval(()=>historyStore.collect(hardwareFile).catch(()=>{}),2000);}
    if(!isHardware){
    ui=await mqtt.connectAsync(url,{...opts,clientId:'pengan-ui'});
    deviceClient=await mqtt.connectAsync(url,{...opts,clientId:'pengan-device',will:{topic:`${PREFIX}/status`,payload:JSON.stringify({online:false,simulated:true}),qos:1,retain:true}});
    ui.on('error',()=>{status=false;});deviceClient.on('error',()=>{});
    ui.on('offline',()=>{status=false;});
    ui.on('message',(topic,payload)=>{
      if(payload.length>32768)return;
      let message;try{message=JSON.parse(payload.toString());}catch{return;}
      if(topic===`${PREFIX}/telemetry`){
        if(!validateTelemetry(message))return;
        if(message.bootId===lastBoot&&message.seq<=lastSeq)return;
        lastBoot=message.bootId;lastSeq=message.seq;frame=message;receivedAt=Date.now();
      }else if(topic===`${PREFIX}/status`){status=message.online===true&&message.simulated===true;}
      else if(topic===`${PREFIX}/ack`){
        if(message.deviceId!==DEVICE_ID||message.simulated!==true||!['executed','rejected','failed'].includes(message.status))return;
        const request=pending.get(message.commandId);if(!request)return;
        clearTimeout(request.timer);pending.delete(message.commandId);request.resolve(message);note('command_ack',message);
      }else if(topic===`${PREFIX}/event`)note('device_event',message);
    });
    deviceClient.on('message',async(topic,payload,packet)=>{
      if(topic!==`${PREFIX}/command`||payload.length>8192)return;
      let command;try{command=JSON.parse(payload.toString());}catch{return;}
      try{const ack=simulator.execute(command,{retained:packet.retain});await publish(deviceClient,'ack',ack);await publish(deviceClient,'telemetry',simulator.telemetry());}catch{note('simulator_error','message_processing_failed');}
    });
    await ui.subscribeAsync(['telemetry','status','ack','event'].map(t=>`${PREFIX}/${t}`),{qos:1});
    await deviceClient.subscribeAsync(`${PREFIX}/command`,{qos:1});
    await publish(deviceClient,'status',{online:true,simulated:true});
    await publish(deviceClient,'telemetry',simulator.telemetry());
    ui.on('connect',async()=>{try{await ui.subscribeAsync(['telemetry','status','ack','event'].map(t=>`${PREFIX}/${t}`),{qos:1});}catch{status=false;}});
    deviceClient.on('connect',async()=>{try{await deviceClient.subscribeAsync(`${PREFIX}/command`,{qos:1});await publish(deviceClient,'status',{online:!simulator.paused,simulated:true});}catch{}});
    timer=setInterval(async()=>{
      try{
        const event=simulator.tick();if(event)await publish(deviceClient,'event',event);
        if(!simulator.paused)await publish(deviceClient,'telemetry',simulator.telemetry());
      }catch{note('transport_error','telemetry_failed');}
    },tickMs);
    }
    async function command(action,parameters={}){
      if(isHardware)throw new Error('simulation_disabled');
      if(!ACTIONS.has(action))throw new Error('unknown_action');
      if(!ui.connected||!status||Date.now()-receivedAt>=15000||simulator.paused)throw new Error('device_unavailable');
      const now=Date.now(),c={version:1,deviceId:DEVICE_ID,commandId:randomUUID(),action,parameters:action==='ventilate'?{maxRunMs:parameters.maxRunMs??20000}:{},issuedAt:now,expiresAt:now+5000,source:'manual',simulated:true};
      note('command_requested',{commandId:c.commandId,action:c.action,expiresAt:c.expiresAt});
      return new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{pending.delete(c.commandId);note('command_timeout',{commandId:c.commandId,result:'unknown'});reject(new Error('ack_timeout_result_unknown'));},commandTimeoutMs);
        pending.set(c.commandId,{resolve,reject,timer:timeout});
        publish(ui,'command',c).catch(()=>{clearTimeout(timeout);pending.delete(c.commandId);note('command_publish_failed',{commandId:c.commandId});reject(new Error('publish_failed'));});
      });
    }
    async function scenario(name){if(isHardware)throw new Error('simulation_disabled');simulator.scenario(name);await publish(deviceClient,'status',{online:!simulator.paused,simulated:true});if(!simulator.paused)await publish(deviceClient,'telemetry',simulator.telemetry());note('scenario',name);}
    api=http.createServer(async(req,res)=>{
      const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
      const origin=req.headers.origin;
      if(origin&&!['http://127.0.0.1:5186','http://localhost:5186',`http://127.0.0.1:${api.address().port}`,`http://${httpHost}:${api.address().port}`].includes(origin)){send(403,{error:'origin_denied'});return;}
      const panelName=req.url==='/'?'panel.html':req.url==='/panel.js'?'panel.js':req.url==='/panel.css'?'panel.css':null;
      if(req.method==='GET'&&panelName){
        res.writeHead(200,{'Content-Type':panelName.endsWith('.html')?'text/html; charset=utf-8':panelName.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
        res.end(panelFiles.get(panelName));return;
      }
      if(req.method==='GET'&&req.url==='/api/observations'){send(200,await observations());return;}
      if(req.method==='GET'&&req.url==='/api/reports/latest'){
        if(!isHardware){send(403,{error:'real_mode_required'});return;}
        try{
          const output=createRealReport({current:await observations(),observationHistory:historyStore?historyStore.read({limit:50}):disabledReportHistory(64*1024*1024),analysisHistory:analysisStore?analysisStore.read({limit:20}):disabledReportHistory(16*1024*1024)});
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="'+output.filename+'"'});res.end(output.body);
        }catch(error){send(error.message==='report_too_large'?413:503,{error:error.message==='report_too_large'?'report_too_large':'report_unavailable'});}return;
      }
      if(req.method==='GET'&&(req.url==='/api/agent/history'||req.url.startsWith('/api/agent/history?'))){
        const params=new URL(req.url,'http://localhost').searchParams,limit=params.has('limit')?Number(params.get('limit')):20;
        if(!Number.isInteger(limit)||limit<1||limit>200){send(400,{error:'invalid_history_query'});return;}
        try{send(200,analysisStore?analysisStore.read({limit}):{schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:{enabled:false,healthy:false,records:0,bytes:0,maxBytes:16*1024*1024},items:[]});}
        catch{send(503,{error:'analysis_history_unavailable'});}return;
      }
      if(req.method==='GET'&&(req.url==='/api/hardware/history'||req.url.startsWith('/api/hardware/history?'))){
        const params=new URL(req.url,'http://localhost').searchParams;
        const limit=params.has('limit')?Number(params.get('limit')):50,beforeSeq=params.has('beforeSeq')?Number(params.get('beforeSeq')):Number.MAX_SAFE_INTEGER;
        if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(beforeSeq)||beforeSeq<1){send(400,{error:'invalid_history_query'});return;}
        send(200,historyStore?historyStore.read({limit,beforeSeq}):{schemaVersion:1,simulated:false,historical:true,isCurrent:false,storage:{enabled:false,healthy:false,records:0,bytes:0,maxBytes:64*1024*1024},items:[]});return;
      }
      if(isHardware&&['/api/device','/api/command','/api/demo/scenario','/api/agent/plan'].includes(req.url)){send(403,{error:'simulation_disabled',mode:'hardware',simulated:false});return;}
      if(req.method==='GET'&&req.url==='/api/device'){send(200,snapshot());return;}
      if(req.method==='GET'&&req.url==='/api/hardware'){send(200,await readHspTelemetry(hardwareFile));return;}
      if(req.method==='GET'&&req.url==='/api/health'){const h=isHardware?await readHspTelemetry(hardwareFile):null;send(200,{ok:true,mode:operationMode,simulated:!isHardware,transport:isHardware?(h?.source==='http'?'wifi-http':'serial-http'):'mqtt',hardwareConnected:h?.deviceOnline===true});return;}
      if(req.method==='GET'&&req.url==='/api/agent/status'){send(200,{...planner.status(),mode:operationMode});return;}
      if(req.method==='GET'&&req.url==='/api/agent/config'){send(200,{...configStatus(),csrfToken:configToken});return;}
      if(req.method!=='POST'||!['/api/command','/api/demo/scenario','/api/agent/plan','/api/agent/pipeline','/api/agent/config','/api/agent/analyze','/api/agent/inspect-image','/api/agent/test'].includes(req.url)){send(404,{error:'not_found'});return;}
      if(!req.headers['content-type']?.startsWith('application/json')){send(415,{error:'json_required'});return;}
      try{
        // TCP chunks can split a UTF-8 character. Decode only after collecting
        // the byte-bounded body, otherwise Chinese prompts can be corrupted.
        const chunks=[];let bodyBytes=0;
        const maxBodyBytes=req.url==='/api/agent/inspect-image'?3*1024*1024:8192;
        for await(const part of req){bodyBytes+=part.length;if(bodyBytes>maxBodyBytes){send(413,{error:'body_too_large'});return;}chunks.push(part);}
        const data=JSON.parse(Buffer.concat(chunks,bodyBytes).toString('utf8'));
        if(!data||Array.isArray(data)||typeof data!=='object'){send(400,{error:'json_object_required'});return;}
        if(req.url==='/api/agent/config'){
          if(!configStore){send(503,{error:'config_save_unavailable'});return;}
          if(req.headers['x-pengan-config-token']!==configToken){send(403,{error:'config_token_required'});return;}
          if(planning||configuring){send(429,{error:'ai_busy_try_later'});return;}
          configuring=true;
          try{
            const config=validateConfig(data,planner);
            await configStore.save(config);
            planner=new AgentPlanner({...plannerOptions,...config});
            restoreAnalysisMemory(planner);
            send(200,configStatus());
          }finally{configuring=false;}
        }
        else if(req.url==='/api/agent/test'){
          if(Object.keys(data).length){send(400,{error:'invalid_connection_test'});return;}
          if(planning||configuring){send(429,{error:'ai_busy_try_later',simulated:false});return;}
          planning=true;try{send(200,await planner.testConnection());}finally{planning=false;}
        }
        else if(req.url==='/api/agent/inspect-image'){
          if(planning||configuring){send(429,{error:'ai_busy_try_later',simulated:false});return;}
          planning=true;
          try{send(200,await planner.inspectImage(data));}finally{planning=false;}
        }
        else if(req.url==='/api/agent/analyze'){
          if(planning||configuring){send(429,{error:'ai_busy_try_later',simulated:false});return;}
          planning=true;
          try{const analysis=await planner.analyze(data.prompt,await readHspTelemetry(hardwareFile),{
            readEnvironment:()=>readHspTelemetry(hardwareFile),
            readHistory:limit=>historyStore?historyStore.read({limit}):{simulated:false,historical:true,isCurrent:false,storage:{enabled:false},items:[]}
          });
          let persistence={saved:false,error:'analysis_history_disabled'};
          if(analysisStore){try{persistence={saved:true,recordId:await analysisStore.append(data.prompt,analysis)};}catch{persistence={saved:false,error:'analysis_history_write_failed'};}}
          send(200,{...analysis,persistence});}finally{planning=false;}
        }
        else if(req.url==='/api/agent/pipeline'){
          if(planning||configuring){send(429,{error:'ai_busy_try_later',simulated:!isHardware});return;}
          if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>2000){send(400,{error:'invalid_prompt'});return;}
          planning=true;
          try{send(200,await pipelineFor().pipeline({prompt:data.prompt,mode:isHardware?'hardware':'simulation'}));}finally{planning=false;}
        }
        else if(req.url==='/api/agent/plan'){
          if(planning||configuring){send(429,{error:'ai_busy_try_later',simulated:true});return;}
          planning=true;
          try{const s=snapshot();const hardware=await readHspTelemetry(hardwareFile);const context={simulated:true,deviceOnline:s.deviceOnline,frame:s.frame,readOnlyHardware:hardware};send(200,await planner.plan(data.prompt,context));}
          finally{planning=false;}
        }
        else if(req.url==='/api/demo/scenario'){await scenario(data.name);send(200,{ok:true,simulated:true});}
        else{const ack=await command(data.action,data.parameters);send(200,ack);}
      }catch(error){send(error instanceof SyntaxError?400:422,{error:error instanceof SyntaxError?'invalid_json':error.message,mode:operationMode,simulated:!isHardware});}
    });
    await listen(api,httpPort,httpHost);
    return {mqttPort:tcp?tcp.address().port:null,httpPort:api.address().port,command,scenario,snapshot,simulator,close};
  }catch(error){await close();throw error;}
}
