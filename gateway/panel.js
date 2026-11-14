const $=id=>document.getElementById(id);
let polling=false,sending=false,deviceOnline=false,modelConfigured=false,planning=false,plan=null,nextStep=0,planFailed=false;
let operationMode='unknown',serviceOnline=false;
let serviceContextEpoch=0,analysisRequestId=0,savedConfigSnapshot=null;
let modelTestBusy=false,modelTestEpoch=0;
let reportBusy=false,reportEpoch=0;
let aiHistoryBusy=false;
let imageBusy=false,imageFile=null,imageEpoch=0;
let configBusy=false,configToken='',savedKey=false;
const buttons=[...document.querySelectorAll('[data-action]')];
const updateButtons=()=>{$('model-test').disabled=modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||!modelConfigured||!serviceOnline;$('history-csv-export').disabled=$('report-export').disabled=modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||operationMode!=='hardware'||!serviceOnline;$('image-send').disabled=modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||!imageFile||!modelConfigured||!serviceOnline||operationMode!=='hardware';$('config-save').disabled=modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||!configToken;$('config-clear').disabled=modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||!configToken||!savedKey;$('config-reload').disabled=modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending;buttons.forEach(b=>{b.disabled=operationMode!=='simulation'||modelTestBusy||reportBusy||imageBusy||sending||planning||configBusy||!deviceOnline;});$('ai-send').disabled=modelTestBusy||reportBusy||imageBusy||sending||planning||configBusy||!modelConfigured||!(operationMode==='hardware'?serviceOnline:deviceOnline);$('ai-clear').disabled=modelTestBusy||reportBusy||imageBusy||sending||planning||configBusy||!plan;document.querySelectorAll('[data-step]').forEach(b=>{b.disabled=operationMode!=='simulation'||modelTestBusy||reportBusy||imageBusy||sending||planning||configBusy||!deviceOnline||planFailed||Number(b.dataset.step)!==nextStep;});};
async function request(path,body,timeout=body?9000:5000,headers={}){
 const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(timeout),...(body?{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'http_'+response.status);return data;
}
function timestamp(value){return Number.isFinite(value)&&value>0?new Date(value).toLocaleString('zh-CN',{hour12:false}):'未知';}
async function refresh(){
 if(polling)return;polling=true;
 try{
  const [health,model]=await Promise.all([request('/api/health'),request('/api/agent/status')]);
  const mode=health.mode==='hardware'&&health.simulated===false?'hardware':health.simulated===true?'simulation':null;
  if(!mode)throw Error('服务模式未知');
  if(operationMode!==mode){invalidateAnalysisContext('服务模式已变化，请重新提交');invalidateModelCheck('服务模式已变化，请重新测试');invalidateReport('服务模式已变化，请重新导出');operationMode=mode;clearPlan('运行模式已核验，请提交分析');}
  serviceOnline=true;
  document.querySelectorAll('[data-simulation]').forEach(e=>{e.hidden=mode!=='simulation';});$('real-history').hidden=mode!=='hardware';$('ai-history').hidden=mode!=='hardware';
  $('mode-description').textContent=mode==='hardware'?'真实采集模式 · HH-HSP101 · 只读分析':'软件演示模式 · 数值和控制均为模拟';
  modelConfigured=model.configured===true;
  $('model').textContent=modelConfigured?`${model.provider} / ${model.model} · 已配置`:'未配置 · 当前不调用真实模型';
  $('ai-config').textContent=modelConfigured?'模型已配置，可分析观测及缺失信息':'模型未配置，请在模型设置中保存配置';
  $('ai-send').textContent=mode==='hardware'?'分析真实采集':'生成演示计划';
  if(mode==='hardware'){
   deviceOnline=false;
   $('connection').textContent='真实数据服务可达 · '+new Date().toLocaleTimeString('zh-CN');
   $('gateway').textContent='真实采集服务 · 已连接';
   $('device').textContent=health.hardwareConnected?'HH-HSP101采集可达':'HH-HSP101未连接 / 样本过期';
   $('journal').textContent='正在核验真实采集存储';await Promise.all([refreshHistory(),refreshAiHistory()]);return;
  }
  const state=await request('/api/device');if(state.simulated!==true)throw Error('演示协议无效');
  deviceOnline=state.deviceOnline===true;
  $('connection').textContent='服务可达 · 更新于 '+new Date().toLocaleTimeString('zh-CN',{hour12:false});
  $('gateway').textContent=state.brokerConnected?'MQTT 已连接（本机）':'MQTT 未连接';
  $('device').textContent=deviceOnline?'模拟终端在线':'模拟终端离线 / 读数过期';
  modelConfigured=model.configured===true;$('ai-config').textContent=modelConfigured?'模型已配置，可提交规划请求':'模型未配置，请在模型设置中保存配置';
  $('model').textContent=model.configured?`${model.provider} / ${model.model} · 已配置`:'未配置 · 当前不调用真实模型';
  $('journal').textContent=state.journal?.enabled?`${state.journal.healthy?'可写':'写入异常'} · ${state.journal.records} 条 · 本地模拟记录`:'未启用文件存储';
  const f=state.frame,values=f?.values||{};
  $('sample').textContent=`模拟设备 ${f?.deviceId||'未知'} · 网关接收 ${timestamp(state.receivedAt)} · ${deviceOnline?'在线':'失联数据仅供查看'} · 风机 ${f?.state?.fan?'模拟运行':'模拟停止'} · 急停 ${f?.state?.emergency?'已触发':'未触发'}`;
  const fields=[['CO','coPpm','ppm',f?.quality?.coValid],['CO₂','co2Ppm','ppm',f?.quality?.co2Valid],['温度','temperatureC','℃',true],['湿度','humidityPct','%',true],['土壤湿度','soilPct','%',true],['光照','lightLux','lx',true]];
  $('readings').replaceChildren(...fields.map(([label,key,unit,valid])=>{const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=valid&&Number.isFinite(values[key])?values[key]+' '+unit:'无效 / 未知';box.append(dt,dd);return box;}));
  $('events').replaceChildren(...(state.events||[]).slice().reverse().map(event=>{const tr=document.createElement('tr');for(const value of [timestamp(event.at),event.event,JSON.stringify(event.detail,null,2)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));
 }catch(error){invalidateAnalysisContext('服务连接失败，旧分析已作废');invalidateModelCheck('服务连接失败，上次测试不代表当前连接');invalidateReport('服务连接失败，导出状态未确认');serviceOnline=false;deviceOnline=false;modelConfigured=false;$('connection').textContent='连接失败：'+error.message+'；保留旧数据显示，禁止发送指令。';$('gateway').textContent='连接状态未知';$('device').textContent='状态未知';}
 finally{polling=false;updateButtons();}
}
buttons.forEach(button=>button.addEventListener('click',async()=>{
 if(operationMode!=='simulation'||modelTestBusy||reportBusy||imageBusy||sending||planning||configBusy||!deviceOnline)return;
 const action=button.dataset.action;
 if(action!=='query_environment'&&!window.confirm(`确认执行“${button.textContent}”？仅操作软件模拟设备。`))return;
 clearPlan('手动指令使旧计划失效，请重新规划');sending=true;updateButtons();$('result').textContent='等待模拟终端执行回执…';
 try{const ack=await request('/api/command',{action,...(action==='ventilate'?{parameters:{maxRunMs:20000}}:{})});
  if(ack.simulated!==true||!['executed','rejected','failed'].includes(ack.status))throw new Error('回执格式无效');
  $('result').textContent='软件模拟回执（不代表真实硬件动作）\n'+JSON.stringify(ack,null,2);
 }catch(error){$('result').textContent='请求未确认：'+error.message+'。不要视为执行成功；请先查询状态。';}
 finally{sending=false;await refresh();updateButtons();}
}));
const labels={query_environment:'查询模拟环境',request_access:'模拟准入申请',ventilate:'模拟通风',stop_ventilation:'停止模拟通风'};
function message(error){if(['TimeoutError','AbortError'].includes(error.name))return '请求超时，结果未确认；请先查询状态，不自动重试';return ({invalid_ai_config:'请检查服务商与模型名称格式',key_required_for_provider:'切换服务商或首次配置时需要填写新密钥',config_save_failed:'服务端保存失败，原配置保持不变',ai_not_configured:'模型尚未配置，请先保存模型设置',ai_busy_try_later:'模型正在处理其他请求，请稍后重试',ai_provider_http_401:'模型密钥或权限校验失败，请检查电脑端配置',ai_provider_http_429:'模型服务限流，请稍后重试'})[error.message]||'请求失败：'+error.message;}
function clearPlan(text){plan=null;nextStep=0;planFailed=false;$('ai-plan').replaceChildren();$('ai-status').textContent=text;updateButtons();}
function validatePlan(p){if(!p||p.simulated!==true||p.executed!==false||typeof p.summary!=='string'||p.summary.length>2000||!Array.isArray(p.steps)||p.steps.length>4)throw Error('invalid_plan');for(const s of p.steps)if(!Object.hasOwn(labels,s.action)||typeof s.reason!=='string'||s.reason.length>1000||(s.action==='ventilate'&&(!Number.isInteger(s.maxRunMs)||s.maxRunMs<1000||s.maxRunMs>20000)))throw Error('invalid_step');return p;}
function renderPlan(p){const summary=document.createElement('p');summary.textContent=p.summary;const source=document.createElement('p');source.textContent='来源：'+(p.provider||'服务端模型')+' / '+(p.model||'未知')+' · 建议尚未执行 · 软件模拟';const cards=p.steps.map((s,i)=>{const card=document.createElement('article');card.className='ai-step';const title=document.createElement('h3');title.textContent=(i+1)+'. '+labels[s.action]+(s.action==='ventilate'?'（'+s.maxRunMs/1000+'秒）':'');const reason=document.createElement('p');reason.textContent=s.reason;const status=document.createElement('p');status.id='step-'+i;status.setAttribute('role','status');status.textContent='等待人工确认';const button=document.createElement('button');button.textContent='确认执行此步骤';button.dataset.step=String(i);button.addEventListener('click',()=>executeStep(i));card.append(title,reason,status,button);return card;});$('ai-plan').replaceChildren(summary,source,...cards);updateButtons();}
async function executeStep(i){if(operationMode!=='simulation'||!plan||modelTestBusy||reportBusy||imageBusy||sending||planning||configBusy||!deviceOnline||planFailed||i!==nextStep)return;const s=plan.steps[i];if(!window.confirm('确认执行“'+labels[s.action]+'”？仅操作软件模拟终端。'))return;sending=true;updateButtons();const status=$('step-'+i);status.textContent='等待模拟终端回执，尚未确认执行';try{const ack=await request('/api/command',{action:s.action,...(s.action==='ventilate'?{parameters:{maxRunMs:s.maxRunMs}}:{})});if(ack.simulated!==true||ack.deviceId!=='hsp-demo-001'||typeof ack.commandId!=='string'||!['executed','rejected','failed'].includes(ack.status))throw Error('invalid_ack');if(ack.status==='executed'){nextStep++;status.textContent='已收到模拟执行回执 · '+ack.commandId+' · '+ack.reason;$('ai-status').textContent=nextStep===plan.steps.length?'全部步骤收到模拟回执，不代表真实设备动作或实际安全':'下一步仍需人工确认';}else{planFailed=true;status.textContent=(ack.status==='rejected'?'被终端规则拒止':'执行失败')+' · '+ack.reason+' · '+ack.commandId;$('ai-status').textContent='本步骤未成功，后续步骤停止，请处理原因后重新规划';}}catch(error){planFailed=true;status.textContent='执行结果未知：'+message(error);$('ai-status').textContent='后续步骤已停止，请先查询状态，避免盲目重发控制';}finally{sending=false;await refresh();updateButtons();}}
function validateAnalysis(p){
 if(!p||p.mode!=='hardware'||p.simulated!==false||p.executed!==false||p.hardwareControl!==false||p.realAdmission!=='unknown_denied'||!Array.isArray(p.steps)||p.steps.length||typeof p.summary!=='string'||p.summary.length>4000||typeof p.deviceOnline!=='boolean'||!Number.isFinite(p.analyzedAt)||p.analyzedAt<=0||(p.observationReceivedAt!==null&&(!Number.isFinite(p.observationReceivedAt)||p.observationReceivedAt<=0)))throw Error('真实分析协议无效');
 if(p.persistence!==undefined&&(!p.persistence||typeof p.persistence.saved!=='boolean'||(p.persistence.saved&&(!Number.isSafeInteger(p.persistence.recordId)||p.persistence.recordId<1))))throw Error('分析保存状态无效');
 for(const key of ['findings','unknowns'])if(!Array.isArray(p[key])||p[key].length>20||p[key].some(t=>typeof t!=='string'||t.length>2000))throw Error('真实分析内容无效');
 if(p.toolTrace!==undefined&&(!Array.isArray(p.toolTrace)||p.toolTrace.length>6||p.toolTrace.some(t=>!t||!['read_environment','read_recent_history'].includes(t.tool)||!Number.isFinite(t.at)||t.at<=0||t.readOnly!==true||typeof t.resultSummary!=='string'||t.resultSummary.length>2000)))throw Error('只读工具溯源无效');return p;
}
function renderAnalysis(p){
 const nodes=[];
 if(p.persistence){const saved=document.createElement('p');saved.textContent=p.persistence.saved===true&&Number.isSafeInteger(p.persistence.recordId)?'已保存文字分析 #'+p.persistence.recordId:'未保存，不影响本次分析，但无法在重启后追溯';nodes.push(saved);}
 for(const text of [p.summary,'模型：'+(p.provider||'未知')+' / '+(p.model||'未知')+' · 分析时间：'+timestamp(p.analyzedAt),'观测接收：'+timestamp(p.observationReceivedAt)+' · '+(p.observationStale===true?'分析完成时观测已过期':p.deviceOnline?'基于提交时有效观测':'真实观测不可用，仅说明缺失信息')]){const n=document.createElement('p');n.textContent=text;nodes.push(n);}
 for(const [title,items] of [['分析依据',p.findings],['待补充信息',p.unknowns]]){const h=document.createElement('h3');h.textContent=title;const list=document.createElement('ul');for(const text of items){const li=document.createElement('li');li.textContent=text;list.append(li);}nodes.push(h,list);}
 if(p.toolTrace?.length){const h=document.createElement('h3');h.textContent='只读工具溯源';const list=document.createElement('ul');for(const trace of p.toolTrace){const li=document.createElement('li');li.textContent=(trace.tool==='read_environment'?'读取实时观测':'读取近期历史')+' · '+trace.tool+' · '+timestamp(trace.at)+' · '+trace.resultSummary;list.append(li);}nodes.push(h,list);}
 const n=document.createElement('p');n.textContent='真实准入未知／拒止；没有执行器控制。此结果是提交时的分析记录，不代表持续实时状态。';nodes.push(n);$('ai-plan').replaceChildren(...nodes);updateButtons();
}
function invalidateAnalysisContext(reason){serviceContextEpoch++;clearPlan(reason);$('image-result').replaceChildren();$('image-status').textContent=reason+'；照片不会自动重新发送';}
function analysisContextValid(epoch,mode){return epoch===serviceContextEpoch&&operationMode===mode&&serviceOnline;}
window.addEventListener('offline',()=>invalidateAnalysisContext('网络已断开，旧分析已作废'));
$('ai-send').addEventListener('click',async()=>{
 if(modelTestBusy||reportBusy||imageBusy||planning||sending||configBusy||!modelConfigured||!(operationMode==='hardware'?serviceOnline:deviceOnline))return;
 const prompt=$('ai-prompt').value.trim();if(!prompt||prompt.length>1000){$('ai-status').textContent='请输入1至1000字的问题';return;}
 const epoch=serviceContextEpoch,mode=operationMode,id=++analysisRequestId;
 clearPlan(mode==='hardware'?'正在分析真实观测及缺失信息…':'正在请求演示计划…');planning=true;updateButtons();
 try{
  if(!analysisContextValid(epoch,mode))return;
  const response=await request(mode==='hardware'?'/api/agent/analyze':'/api/agent/plan',{prompt},35000);
  if(!analysisContextValid(epoch,mode)||id!==analysisRequestId)return;
  if(mode==='hardware'){plan=validateAnalysis(response);renderAnalysis(plan);$('ai-status').textContent='分析已完成 · 只读建议，没有执行设备';await refreshAiHistory();}
  else{plan=validatePlan(response);renderPlan(plan);$('ai-status').textContent=plan.steps.length?'计划已生成，未执行，请逐步确认':'模型已给出建议，无执行步骤';}
 }catch(error){if(analysisContextValid(epoch,mode)&&id===analysisRequestId)$('ai-status').textContent=message(error);}
 finally{if(id===analysisRequestId){planning=false;updateButtons();}}
});
$('ai-clear').addEventListener('click',()=>{if(!planning&&!sending)clearPlan(operationMode==='hardware'?'分析记录已从页面清除':'计划已清除；已发出的设备操作不会因此撤销');});

function showSavedConfig(config,fill){
 savedKey=config.keySaved===true;
 savedConfigSnapshot=['deepseek','qwen'].includes(config.provider)&&typeof config.model==='string'&&config.model?{provider:config.provider,model:config.model,workspaceId:config.workspaceId||''}:null;
 if(fill){$('config-provider').value=config.provider||'deepseek';$('config-model').value=config.model||'';$('config-workspace').value=config.workspaceId||'';updateWorkspace();}
 $('config-key-state').textContent=savedKey?'已保存密钥 · 原值不回显；同一服务商留空可保留':'尚未保存密钥 · 请填写后保存';
}
async function loadConfig(){
 if(modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending)return;configBusy=true;updateButtons();
 try{const config=await request('/api/agent/config');if(typeof config.csrfToken!=='string'||!config.csrfToken)throw Error('config_token_missing');configToken=config.csrfToken;showSavedConfig(config,true);$('config-key').value='';$('config-status').textContent='配置已载入，保存前不会更改当前模型';}
 catch(error){configToken='';$('config-status').textContent=message(error);}
 finally{configBusy=false;updateButtons();}
}
async function saveConfig(clearKey=false){
 if(modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||!configToken)return;
 if(clearKey&&!window.confirm('确认清除服务端已保存的模型密钥？此后无法生成新计划。'))return;
 if(clearKey&&!savedConfigSnapshot){$('config-status').textContent='请先重新读取已保存配置，未清除密钥';return;}
 const body=clearKey?{...savedConfigSnapshot,key:'',clearKey:true}:{provider:$('config-provider').value,model:$('config-model').value.trim(),workspaceId:$('config-provider').value==='qwen'?$('config-workspace').value.trim():'',key:clearKey?'':$('config-key').value.trim(),clearKey};
 invalidateAnalysisContext('模型配置正在更新，旧分析已作废');invalidateModelCheck('配置正在更新，请保存后重新测试');configBusy=true;updateButtons();$('config-status').textContent='正在保存到电脑服务端…';
 try{const config=await request('/api/agent/config',body,9000,{'X-Pengan-Config-Token':configToken});$('config-key').value='';showSavedConfig(config,true);clearPlan('模型配置已更新，请重新生成计划');$('config-status').textContent=config.configured?'已保存并生效，无需重启；可前往AI助手生成计划':'配置已保存，密钥已清除，模型服务未启用';await refresh();}
 catch(error){$('config-key').value='';$('config-status').textContent=message(error);}
 finally{body.key='';configBusy=false;updateButtons();}
}
$('config-save').addEventListener('click',()=>saveConfig(false));
$('config-clear').addEventListener('click',()=>saveConfig(true));
$('config-reload').addEventListener('click',loadConfig);
loadConfig();

$('refresh').addEventListener('click',refresh);
refresh();setInterval(refresh,2500);

let readingHardware=false,hardwareEpoch=0,hardwareView=null,lastHardwareReceived=null,hardwareFirstSeen=0;
function invalidateHardware(reason){
 hardwareView=null;
 $('hardware-connection').textContent='未知 / 未确认';
 $('hardware-connection').className='hardware-state';
 $('hardware-timing').textContent=reason;
 $('hardware-status').textContent='温度：未知 / 湿度：未知 / MQ-2 ADC：未知\nCO、CO₂：未接入；真实准入状态：未知／拒止；没有执行器控制';
}
function renderHardware(){
 if(!hardwareView)return;
 const elapsed=Date.now()-hardwareView.at;
 if(elapsed<0||elapsed+hardwareView.maxAge>=10000||Date.now()-hardwareFirstSeen>=10000){invalidateHardware('样本已过期，请等待新的真实采集');return;}
 const h=hardwareView.data,v=h.values,q=h.quality;
 const value=(valid,n,unit)=>valid?n+' '+unit:'未知';
 $('hardware-connection').textContent='真实设备在线 · 只读';$('hardware-connection').className='hardware-state online';
 $('hardware-timing').textContent='网关接收：'+timestamp(h.receivedAt)+' · 最老有效采样年龄：'+((hardwareView.maxAge+elapsed)/1000).toFixed(1)+' 秒 · 10秒后失效';
 $('hardware-status').textContent='温度：'+value(q.temperatureValid,v.temperatureC,'℃')+' / 湿度：'+value(q.humidityValid,v.humidityPct,'%')+'\nMQ-2原始ADC：'+value(q.gasValid,v.gasRaw,'counts')+' / 电压：'+value(q.gasValid,v.gasMv,'mV')+'\nCO、CO₂：未接入；真实准入状态：未知／拒止；没有执行器控制';
}
function validateHardware(h,elapsed){
 if(!h||h.simulated!==false||h.deviceId!=='hh-hsp101-001'||h.actuationAvailable!==false||typeof h.deviceOnline!=='boolean'||!h.values||!h.quality)throw Error('真实采集协议不匹配');
 if(h.quality.coValid!==false||h.quality.co2Valid!==false)throw Error('气体质量标记不匹配');
 if(!h.deviceOnline)return null;
 const q=h.quality,v=h.values;
 if(!Number.isFinite(h.receivedAt)||h.receivedAt<=0||!Number.isFinite(h.sampleAgeMs)||h.sampleAgeMs<0||elapsed<0)throw Error('采样时间无效');
 for(const key of ['temperatureValid','humidityValid','gasValid'])if(typeof q[key]!=='boolean')throw Error('采样质量无效');
 if(q.temperatureValid&&(!Number.isFinite(v.temperatureC)||v.temperatureC< -40||v.temperatureC>85))throw Error('温度无效');
 if(q.humidityValid&&(!Number.isFinite(v.humidityPct)||v.humidityPct<0||v.humidityPct>100))throw Error('湿度无效');
 if(q.gasValid&&(!Number.isInteger(v.gasRaw)||v.gasRaw<0||v.gasRaw>4095||!Number.isFinite(v.gasMv)||v.gasMv<0||v.gasMv>7200))throw Error('ADC无效');
 const ages=[h.sampleAgeMs];if(q.temperatureValid||q.humidityValid)ages.push(h.climateAgeMs);if(q.gasValid)ages.push(h.gasAgeMs);
 if(ages.some(n=>!Number.isFinite(n)||n<0||n+elapsed>=10000))throw Error('样本过期');
 return Math.max(...ages)+elapsed;
}
async function refreshHardware(){
 if(readingHardware||document.hidden)return;readingHardware=true;const epoch=hardwareEpoch,started=Date.now();
 try{
 const h=await request('/api/hardware');if(epoch!==hardwareEpoch||document.hidden)return;
 const maxAge=validateHardware(h,Date.now()-started);
 if(maxAge===null){invalidateHardware('真实设备未连接或样本过期：'+(h.reason||'状态未知'));return;}
 if(h.receivedAt!==lastHardwareReceived){lastHardwareReceived=h.receivedAt;hardwareFirstSeen=Date.now();}
 hardwareView={data:h,maxAge,at:Date.now()};renderHardware();
 }catch{if(epoch===hardwareEpoch)invalidateHardware('真实设备读取失败或数据无效；不保留旧正常值');}
 finally{readingHardware=false;}
}
document.addEventListener('visibilitychange',()=>{hardwareEpoch++;invalidateHardware(document.hidden?'页面已进入后台，在线状态未确认':'页面已恢复，重新核验真实采集');if(!document.hidden)refreshHardware();});
window.addEventListener('offline',()=>{hardwareEpoch++;invalidateHardware('浏览器网络已断开');});
window.addEventListener('online',()=>{hardwareEpoch++;invalidateHardware('网络已恢复，重新核验真实采集');refreshHardware();});
window.addEventListener('pagehide',()=>{hardwareEpoch++;invalidateHardware('页面已离开，在线状态未确认');});
$('refresh').addEventListener('click',refreshHardware);
refreshHardware();setInterval(refreshHardware,2500);setInterval(renderHardware,1000);

// Persistent real observations are historical snapshots, never current readings.
async function refreshHistory(){
 try{
  const data=await request('/api/hardware/history?limit=50');
  if(data.schemaVersion!==1||data.simulated!==false||data.historical!==true||data.isCurrent!==false||!Array.isArray(data.items)||data.items.length>50||!data.storage)throw Error('历史协议无效');
  const store=data.storage;
  if(typeof store.enabled!=='boolean'||typeof store.healthy!=='boolean'||!Number.isSafeInteger(store.records)||store.records<0||!Number.isSafeInteger(store.bytes)||store.bytes<0||!Number.isSafeInteger(store.maxBytes)||store.maxBytes<=0)throw Error('存储状态无效');
  const rows=data.items.map(item=>{
   const h=item.observation;
   if(!Number.isSafeInteger(item.seq)||item.seq<1||item.historical!==true||item.isCurrent!==false||!h||h.simulated!==false||h.deviceId!=='hh-hsp101-001'||!h.values||!h.quality)throw Error('历史记录无效');
   const v=h.values,q=h.quality;
   const reading=(flag,value,min,max,unit)=>flag===true&&Number.isFinite(value)&&value>=min&&value<=max?value+' '+unit:'未知';
   const tr=document.createElement('tr');
   for(const text of [item.seq,timestamp(h.receivedAt),reading(q.temperatureValid,v.temperatureC,-40,85,'℃')+' / '+reading(q.humidityValid,v.humidityPct,0,100,'%'),reading(q.gasValid,v.gasRaw,0,4095,'counts')+' / '+reading(q.gasValid,v.gasMv,0,7200,'mV'),'历史快照 · 非当前读数']){const td=document.createElement('td');td.textContent=String(text);tr.append(td);}return tr;
  });
  if(operationMode!=='hardware')return;
  $('real-history-rows').replaceChildren(...rows);
  $('history-storage').textContent=store.enabled?(store.healthy?'存储可写':'存储异常／已停止记录')+' · '+store.records+' 条 · '+(store.bytes/1048576).toFixed(2)+' / '+(store.maxBytes/1048576).toFixed(0)+' MB；容量满时停止记录，不覆盖旧数据':'真实历史存储未启用';
  $('journal').textContent=store.enabled?(store.healthy?'真实采集存储可写':'真实采集存储异常')+' · '+store.records+' 条':'真实采集存储未启用';
  $('history-empty').textContent=rows.length?'以下为最近'+rows.length+'条采集记录，历史值不能证明当前安全。':'尚无真实采集记录；设备连接并上报有效样本后开始记录。';
 }catch{
  $('history-storage').textContent='真实历史读取失败，存储健康状态未知';$('journal').textContent='真实采集存储状态未知';$('real-history-rows').replaceChildren();$('history-empty').textContent='无法读取历史记录，请检查服务连接；未显示旧成功状态。';
 }
}

function updateWorkspace(){const qwen=$('config-provider').value==='qwen';$('workspace-field').hidden=!qwen;$('config-workspace').disabled=!qwen;}
$('config-provider').addEventListener('change',updateWorkspace);
updateWorkspace();
function resetImage(message){imageEpoch++;imageFile=null;$('image-result').replaceChildren();$('image-status').textContent=message;updateButtons();}
$('crop-file').addEventListener('change',()=>{
 resetImage('照片仅在本地选择，尚未上传');
 const file=$('crop-file').files?.[0];
 if(!file)return;
 if(!['image/jpeg','image/png'].includes(file.type)||file.size<=0||file.size>2*1024*1024){$('image-status').textContent='请选择不超过2MiB的JPEG或PNG照片';return;}
 imageFile=file;$('image-status').textContent='已选择：'+file.name+' · '+(file.size/1024).toFixed(1)+' KiB；点击发送前不会上传';updateButtons();
});
$('image-clear').addEventListener('click',()=>{$('crop-file').value='';resetImage('照片和页面分析已清除；已发出的请求不会因此撤回');});
function validateImageAnalysis(p){
 if(!p||p.mode!=='hardware'||p.kind!=='crop_image_analysis'||p.source!=='user_photo'||p.simulated!==false||p.executed!==false||p.hardwareControl!==false||p.realAdmission!=='unknown_denied'||!Array.isArray(p.steps)||p.steps.length||!/^[a-fA-F0-9]{64}$/.test(p.imageSha256)||typeof p.summary!=='string'||p.summary.length>4000||!Number.isFinite(p.analyzedAt)||p.analyzedAt<=0)throw Error('图片分析协议无效');
 for(const key of ['findings','unknowns'])if(!Array.isArray(p[key])||p[key].length>20||p[key].some(t=>typeof t!=='string'||t.length>2000))throw Error('图片分析内容无效');return p;
}
$('image-send').addEventListener('click',async()=>{
 if(modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||!imageFile||!modelConfigured||!serviceOnline||operationMode!=='hardware')return;
 const prompt=$('image-prompt').value.trim()||'请分析这张作物照片中可见的现象，说明依据和不确定性。';
 if(prompt.length>1000){$('image-status').textContent='问题最多1000字';return;}
 const file=imageFile,epoch=imageEpoch,contextEpoch=serviceContextEpoch,contextMode=operationMode;imageBusy=true;updateButtons();$('image-status').textContent='正在发送照片并请求模型分析…';$('image-result').replaceChildren();
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());if(epoch!==imageEpoch||!analysisContextValid(contextEpoch,contextMode))return;
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const data=validateImageAnalysis(await request('/api/agent/inspect-image',{prompt,mimeType:file.type,imageBase64:btoa(binary)},30000));
  if(epoch!==imageEpoch||!analysisContextValid(contextEpoch,contextMode))return;
  const nodes=[];for(const text of [data.summary,'图像SHA256：'+data.imageSha256,'模型：'+(data.provider||'未知')+' / '+(data.model||'未知')+' · '+timestamp(data.analyzedAt),...data.findings.map(t=>'观察：'+t),...data.unknowns.map(t=>'待核实：'+t),'照片分析仅供参考，不是病害确诊；没有设备执行权限，不能用于准入。']){const node=document.createElement('p');node.textContent=text;nodes.push(node);}$('image-result').replaceChildren(...nodes);$('image-status').textContent='照片分析完成；请结合现场检查核实';
 }catch(error){if(epoch===imageEpoch&&analysisContextValid(contextEpoch,contextMode))$('image-status').textContent='未获得有效图片分析：'+message(error)+'；没有生成诊断结论';}
 finally{imageBusy=false;updateButtons();}
});

async function refreshAiHistory(){
 if(aiHistoryBusy||operationMode!=='hardware')return;aiHistoryBusy=true;$('ai-history-refresh').disabled=true;
 try{
  const data=await request('/api/agent/history?limit=20');
  const store=data.storage;
  if(data.schemaVersion!==1||data.simulated!==false||data.historical!==true||data.isCurrent!==false||!Array.isArray(data.items)||data.items.length>20||!store||typeof store.enabled!=='boolean'||typeof store.healthy!=='boolean'||!Number.isSafeInteger(store.records)||store.records<0||!Number.isSafeInteger(store.bytes)||store.bytes<0||!Number.isSafeInteger(store.maxBytes)||store.maxBytes<=0)throw Error('分析历史协议无效');
  const cards=data.items.map(row=>{
   if(!Number.isSafeInteger(row.seq)||row.seq<1||row.historical!==true||row.isCurrent!==false||typeof row.prompt!=='string'||row.prompt.length>1000||!Number.isFinite(row.recordedAt)||row.recordedAt<=0)throw Error('分析历史记录无效');
   const p=validateAnalysis(row.analysis),card=document.createElement('article');card.className='ai-step';
   for(const text of ['#'+row.seq+' · '+row.prompt,'分析时间：'+timestamp(p.analyzedAt)+' · '+(p.provider||'未知')+' / '+(p.model||'未知'),p.summary,'观测接收：'+timestamp(p.observationReceivedAt)+' · 历史分析，不代表当前环境']){const node=document.createElement('p');node.textContent=text;card.append(node);}
   for(const t of p.toolTrace||[]){const node=document.createElement('p');node.textContent='只读工具：'+t.tool+' · '+timestamp(t.at)+' · '+t.resultSummary;card.append(node);}return card;
  });
  if(operationMode!=='hardware')return;
  $('ai-history-items').replaceChildren(...cards);
  $('ai-history-status').textContent=(store.enabled?(store.healthy?'分析存储可写':'分析存储异常／已停止记录'):'分析存储未启用')+' · '+store.records+' 条 · '+(store.bytes/1048576).toFixed(2)+' / '+(store.maxBytes/1048576).toFixed(0)+' MB；容量满停止记录，不覆盖。'+(cards.length?'':' 尚无已保存的真实文字分析。');
 }catch{$('ai-history-items').replaceChildren();$('ai-history-status').textContent='文字分析历史读取失败，存储状态未知；未沿用旧成功状态。';}
 finally{aiHistoryBusy=false;$('ai-history-refresh').disabled=false;}
}
$('ai-history-refresh').addEventListener('click',refreshAiHistory);

function invalidateReport(text){reportEpoch++;$('report-status').textContent=text;}
window.addEventListener('offline',()=>invalidateReport('网络已断开，导出状态未确认'));
function validateSessionReport(p){
 if(!p||p.schemaVersion!==1||p.kind!=='pengan_real_session_report'||p.mode!=='hardware'||p.simulated!==false||p.hardwareActuation!==false||p.realAdmission!=='unknown_denied'||!Number.isFinite(p.generatedAt)||p.generatedAt<=0||!p.scope||p.scope.observationLimit!==50||p.scope.analysisLimit!==20||p.scope.completeHistory!==false||!Array.isArray(p.limitations)||p.limitations.length>30||p.limitations.some(t=>typeof t!=='string'||t.length>4000))throw Error('真实报告协议无效');
 const c=p.current,h=c?.hardware;
 if(c?.schemaVersion!==1||c.mode!=='hardware'||c.simulated!==false||!h||h.deviceId!=='hh-hsp101-001'||h.simulated!==false||h.actuationAvailable!==false||typeof h.deviceOnline!=='boolean'||!h.values||!h.quality||h.quality.coValid!==false||h.quality.co2Valid!==false||h.values.coPpm!==null||h.values.co2Ppm!==null)throw Error('当前观测来源无效');
 if(!h.deviceOnline&&Object.values(h.values).some(v=>v!==null))throw Error('离线当前观测不能填入历史值');
 for(const [key,limit] of [['observationHistory',50],['analysisHistory',20]]){
  const envelope=p[key];
  if(envelope?.schemaVersion!==1||envelope.simulated!==false||envelope.historical!==true||envelope.isCurrent!==false||!Array.isArray(envelope.items)||envelope.items.length>limit)throw Error('报告历史来源无效');
  for(const row of envelope.items){
   if(row.historical!==true||row.isCurrent!==false||!Number.isSafeInteger(row.seq)||row.seq<1)throw Error('报告记录来源无效');
   if(key==='analysisHistory'){validateAnalysis(row.analysis);if(row.analysis.kind==='crop_image_analysis')throw Error('报告不能包含照片分析');}
   else if(!row.observation||row.observation.simulated!==false||row.observation.deviceId!=='hh-hsp101-001'||row.observation.actuationAvailable!==false)throw Error('报告观测来源无效');
  }
 }return p;
}
function observationCsv(report){
 validateSessionReport(report);
 const headers=['report_generated_at_ms','complete_history','storage_healthy','seq','record_hash','historical','is_current','received_at_ms','device_online_at_record','sample_age_ms','temperature_c','temperature_valid','humidity_pct','humidity_valid','mq2_adc','mq2_mv','gas_valid','co_ppm','co2_ppm','real_admission','acquisition_source'];
 const rows=[headers];
 for(const row of report.observationHistory.items){
  const h=row.observation,q=h.quality,v=h.values;
  if(h.source!==undefined&&!['serial','http'].includes(h.source))throw Error('CSV采集来源无效');
  if(!q||!v||typeof h.deviceOnline!=='boolean'||q.coValid!==false||q.co2Valid!==false||v.coPpm!==null||v.co2Ppm!==null||typeof row.hash!=='string'||! /^[a-f0-9]{64}$/.test(row.hash))throw Error('CSV历史观测协议无效');
  const time=n=>Number.isSafeInteger(n)&&n>=0;
  if(h.deviceOnline&&(!time(h.receivedAt)||!Number.isFinite(h.sampleAgeMs)||h.sampleAgeMs<0))throw Error('CSV历史采样时间无效');
  const values=[];
  for(const [key,quality,min,max] of [['temperatureC','temperatureValid',-40,85],['humidityPct','humidityValid',0,100],['gasRaw','gasValid',0,4095],['gasMv','gasValid',0,7200]]){
   if(typeof q[quality]!=='boolean')throw Error('CSV传感器质量无效');
   const valid=h.deviceOnline&&q[quality],n=v[key];
   if(valid&&(!Number.isFinite(n)||n<min||n>max||key==='gasRaw'&&!Number.isInteger(n)))throw Error('CSV传感器读数无效');
   values.push(valid?n:'');
  }
  rows.push([report.generatedAt,false,report.observationHistory.storage?.healthy===true,row.seq,row.hash,true,false,h.deviceOnline?h.receivedAt:'',h.deviceOnline,h.deviceOnline?h.sampleAgeMs:'',values[0],h.deviceOnline&&q.temperatureValid,values[1],h.deviceOnline&&q.humidityValid,values[2],values[3],h.deviceOnline&&q.gasValid,'','','unknown_denied',h.source||'serial']);
 }
 // Only fixed labels, verified hashes, booleans and finite numeric values enter CSV.
 return '\ufeff'+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}
async function requestReport(){
 const response=await fetch('/api/reports/latest',{cache:'no-store',signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw Error('报告服务返回HTTP '+response.status);
 if(!response.body?.getReader)throw Error('浏览器不支持有界报告读取');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel().catch(()=>{});throw Error('报告超过1MiB限制');}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);validateSessionReport(JSON.parse(text));return text;
}
async function exportRealReport(format='json'){
 if(modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||operationMode!=='hardware'||!serviceOnline)return;
 reportBusy=true;const epoch=reportEpoch;updateButtons();$('report-status').textContent='正在获取最近真实记录，不调用AI…';let url,link;
 try{
  const text=await requestReport();if(epoch!==reportEpoch||operationMode!=='hardware'||!serviceOnline)return;
  const now=new Date(),pad=n=>String(n).padStart(2,'0'),stamp=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes())+pad(now.getSeconds());
  const csv=format==='csv';const contents=csv?observationCsv(JSON.parse(text)):text;
  url=URL.createObjectURL(new Blob([contents],{type:csv?'text/csv;charset=utf-8':'application/json;charset=utf-8'}));link=document.createElement('a');link.href=url;link.download=(csv?'pengan-historical-observations-':'pengan-real-report-')+stamp+(csv?'.csv':'.json');document.body.append(link);link.click();
  $('report-status').textContent='已提交浏览器下载，请确认保存位置。'+(format==='csv'?'CSV仅含最近50条历史采集，未知值留空；无记录时仅有表头。':'报告仅含最近窗口，非完整历史；照片不在报告中。');
 }catch(error){if(epoch===reportEpoch)$('report-status').textContent='导出未确认：'+message(error)+'；请检查浏览器下载记录，不能视为已保存。';}
 finally{link?.remove();if(url)URL.revokeObjectURL(url);reportBusy=false;updateButtons();}
}
$('report-export').addEventListener('click',()=>exportRealReport('json'));
$('history-csv-export').addEventListener('click',()=>exportRealReport('csv'));

// Manual model connection check sends synthetic text only.
function invalidateModelCheck(text){modelTestEpoch++;$('model-test-status').textContent=text;}
function validateModelCheck(p){if(!p||p.kind!=='model_connection_check'||p.ok!==true||p.fieldDataSent!==false||p.imageSent!==false||p.executed!==false||!['deepseek','qwen'].includes(p.provider)||typeof p.model!=='string'||!p.model||p.model.length>150||!Number.isFinite(p.checkedAt)||p.checkedAt<=0||!Number.isFinite(p.roundTripMs)||p.roundTripMs<0||p.roundTripMs>120000)throw Error('模型测试协议无效');return p;}
$('model-test').addEventListener('click',async()=>{
 if(modelTestBusy||reportBusy||imageBusy||configBusy||planning||sending||!modelConfigured||!serviceOnline)return;
 modelTestBusy=true;const epoch=modelTestEpoch;updateButtons();$('model-test-status').textContent='正在发送合成测试问题，不发送现场数据或照片…';
 try{const p=validateModelCheck(await request('/api/agent/test',{},35000));if(epoch!==modelTestEpoch||!serviceOnline)return;$('model-test-status').textContent='上次测试通过：'+timestamp(p.checkedAt)+' · '+p.provider+' / '+p.model+' · '+p.roundTripMs+' ms。仅代表这一次请求，不保证持续可用。';}
 catch(error){if(epoch===modelTestEpoch)$('model-test-status').textContent='模型测试未通过：'+message(error)+'；没有发送现场数据或照片。';}
 finally{modelTestBusy=false;updateButtons();}
});
