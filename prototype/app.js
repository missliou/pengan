import { evaluate, decide, hashRecord, verifyChain } from './safety.js';
import {deviceSnapshot,deviceCommand,deviceScenario,agentStatus,agentPlan} from './remote-link.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={home:'环境态势',agent:'智能助手',tasks:'任务中心',monitor:'作物巡查',audit:'审计台账'};
const initial=()=>({co:4,co2:680,temp:25.6,humidity:64,soil:48,light:12600,at:Date.now(),sensorOnline:true,emergency:false});
let env=initial(),cloud=true,page='home',fan=false,hold=false,busy=false,generation=0,tasks=[],chat=[],report='',verification='',audit=[];
let auditQueue=Promise.resolve();
let remote=false,remotePolling=false,remoteLastEventAt=0;
let aiMode=false,aiPlan=null,aiProvider='';
const remoteButton=document.createElement('button');remoteButton.id='remote-toggle';remoteButton.textContent='连接 MQTT 模拟终端';$('#demo-controls').append(remoteButton);
try{const stored=JSON.parse(localStorage.getItem('pengan.audit')||'[]');if(Array.isArray(stored)&&stored.every(r=>r&&typeof r==='object'))audit=stored;}catch{}
const clock=()=>new Date().toLocaleString('zh-CN',{hour12:false});
const time=ts=>new Date(ts).toLocaleTimeString('zh-CN',{hour12:false});
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
function log(event,result,source='规则引擎') {
 const token=generation;
 const capturedAt=Date.now();
 const snapshot={co:env.co,co2:env.co2,sensorOnline:env.sensorOnline,emergency:env.emergency};
 auditQueue=auditQueue.then(async()=>{
  if(token!==generation)return;
  const record={id:audit.length+1,at:capturedAt,event,result,source,snapshot};
  const prev=audit.at(-1)?.hash||'GENESIS';const hash=await hashRecord(record,prev);
  if(token!==generation)return;
  audit.push({...record,prev,hash});
  verification='';
  try{localStorage.setItem('pengan.audit',JSON.stringify(audit));}catch{toast('本地存储不可用，记录仅保存在本次会话');}
  if(page==='audit'||page==='home')render();
 }).catch(()=>toast('审计写入失败，请检查浏览器能力'));
 return auditQueue;
}
function title(en,sub){return `<div class="page-title"><div><div class="eyebrow">PENGAN / ${en}</div><h1>${names[page]}</h1><p class="subtitle">${sub}</p></div><div class="status-row"><span class="badge ${cloud?'':'neutral'}"><i class="dot"></i>模拟云端${cloud?'在线':'断开'}</span><span class="badge ${env.sensorOnline?'':'bad'}">模拟终端${env.sensorOnline?'在线':'离线'}</span></div></div>`;}
function metric(label,value,unit,foot,alert=false,icon='◌'){return `<article class="metric ${alert?'alert':''}"><div class="metric-label">${label}<span class="metric-icon">${icon}</span></div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-bottom"><span>${foot}</span><span>模拟采样</span></div></article>`;}
function chart(){return `<svg class="chart" viewBox="0 0 620 150" preserveAspectRatio="none" aria-label="静态示意趋势，不是真实历史采样"><g stroke="#edf1ec" stroke-dasharray="3 4"><path d="M0 20H620M0 60H620M0 100H620M0 140H620"/></g><path d="M0 104L35 100 70 105 105 85 140 92 175 78 210 82 245 62 280 70 315 56 350 72 385 65 420 78 455 60 490 69 525 48 560 58 595 45 620 53" fill="none" stroke="#438365" stroke-width="2.5"/><path d="M0 65L35 70 70 63 105 74 140 69 175 85 210 79 245 94 280 85 315 100 350 93 385 102 420 95 455 108 490 102 525 111 560 102 595 113 620 108" fill="none" stroke="#b1c6ac" stroke-width="2"/></svg><div class="chart-labels"><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span></div><div class="chart-legend"><span><i class="legend-dot"></i>CO₂ 趋势示意</span><span><i class="legend-dot light"></i>温度趋势示意</span></div>`;}
function recent(){return audit.slice(-3).reverse().map(r=>`<div class="event"><span class="event-dot"></span><div class="event-body"><strong>${esc(r.event)}</strong><p>${esc(r.result)}</p></div><time>${time(r.at)}</time></div>`).join('')||'<div class="quiet">暂无记录，点击“申请入棚”开始演示。</div>';}
function home(){const c=evaluate(env);return title('OVERVIEW','一号示范棚 · 入棚前核验，作业中守护')+`<div class="metrics">${metric('一氧化碳 CO',env.co,'ppm','演示拒止值 ≥ 30 ppm',env.co>=30,'≋')}${metric('二氧化碳 CO₂',env.co2,'ppm','演示拒止值 ≥ 1500 ppm',env.co2>=1500,'◉')}${metric('空气温湿度',env.temp.toFixed(1),'°C',`相对湿度 ${env.humidity}%`,false,'♧')}${metric('土壤湿度',env.soil,'%','光照 '+env.light.toLocaleString()+' lx',false,'♧')}</div><div class="grid-main"><div><section class="panel"><div class="panel-head"><h2>入棚安全核验</h2><span class="badge ${c.allowed?'':'bad'}">${c.allowed?'模拟环境条件通过':'已触发准入拦截'}</span></div><div class="access-body"><div class="access-ring ${c.allowed?'':'blocked'}"><strong>${c.allowed?'条件通过':'禁止入棚'}</strong><span>本地规则判定</span></div><div class="access-copy"><h3>${c.allowed?'环境已核验，等待入棚申请':'当前环境不满足准入条件'}</h3><p>${c.allowed?'模拟 CO / CO₂ 读数低于演示阈值。<br>每次申请都会重新校验最新读数。':esc(c.reasons.join('；'))}<br>${env.emergency?'急停锁定中':fan?'模拟风机运行中 · 正在等待环境回采':'模拟风机待机'}</p></div></div><div class="checks"><span>${env.sensorOnline?'✓':'×'} 终端连接</span><span>${hold?'×':'✓'} 读数时效</span><span>${env.emergency?'×':'✓'} 急停状态</span><span>○ 身份认证待接入</span></div><div class="actions"><button class="primary" data-action="access">申请入棚 · 模拟</button><button data-action="ventilate">${fan?'通风运行中':'启动通风'}</button><button class="secondary" data-go="tasks">查看任务流 →</button></div></section><section class="panel"><div class="panel-head"><h2>环境变化趋势</h2><small>静态示意 / 今日</small></div>${chart()}</section></div><div><section class="panel assistant-panel"><div class="assistant-top"><div class="assistant-mark">✧</div><div><h2>棚安智能助手</h2><small>规则脚本演示 · 未接入大模型</small></div></div><p>从环境核验到通风复测，让每一步操作都有依据、有回执。</p><button class="suggestion" data-prompt="看看现在能不能进棚">看看现在能不能进棚 <span>↗</span></button><button class="suggestion" data-prompt="启动通风并复测">启动通风并复测 <span>↗</span></button><button class="suggestion" data-go="monitor">给作物做一次体检 <span>↗</span></button></section><section class="panel"><div class="panel-head"><h2>最近动态</h2><button data-go="audit" style="border:0;padding:0;font-size:11px">全部 →</button></div>${recent()}</section><div class="inline-note">安全路径在终端本地闭环。模拟云端断开后，入棚规则与通风控制仍可演示。</div></div></div>`;}
function agent(){return title('ASSISTANT','用自然语言发起任务，执行前由本地安全规则核验')+`<div class="two-col"><section class="panel"><div class="panel-head"><h2>与棚安对话</h2><span class="badge neutral">脚本演示</span></div><div class="chat-log">${chat.length?chat.map(r=>`<div class="bubble ${r.role==='user'?'user':''}"><small>${r.role==='user'?'你':'棚安 · 脚本演示'}</small>${esc(r.text)}</div>`).join(''):'<div class="bubble"><small>棚安 · 脚本演示</small>你好，我可以演示查询环境、申请入棚和通风复测。试试“看看现在能不能进棚”。<br>当前回复来自本地脚本，未调用真实 AI。</div>'}</div><form class="chat-form" id="chat-form"><input aria-label="输入任务" id="chat-input" placeholder="输入：申请入棚 / 查看环境 / 启动通风" maxlength="300" autocomplete="off"><button class="primary" ${busy?'disabled':''}>发送</button></form></section><div><section class="panel"><div class="panel-head"><h2>可用演示工具</h2><small>03 TOOLS</small></div><div class="tool-row"><span>读取环境快照</span><span class="quiet">query_realtime_env</span></div><div class="tool-row"><span>核验并申请入棚</span><span class="quiet">access_control</span></div><div class="tool-row"><span>通风与回采验证</span><span class="quiet">ventilation_control</span></div><p class="inline-note">工具参数通过允许清单限制。输入任何文字，都不能绕过本地安全规则。</p></section><button class="suggestion" data-prompt="看看现在能不能进棚">看看现在能不能进棚 ↗</button><button class="suggestion" data-prompt="启动通风并复测">启动通风并复测 ↗</button></div></div>`;}
function taskView(){return title('TASK CENTER','从计划、执行到回采验证，每一步都可查看')+`<section class="panel"><div class="panel-head"><h2>任务执行记录</h2><small>${tasks.length} 项 / 本次会话</small></div>${tasks.length?tasks.slice().reverse().map(t=>`<article class="task"><h3>${esc(t.title)}</h3><div class="task-meta">${esc(t.id)} · ${time(t.at)} · ${esc(t.source)}</div>${t.steps.map((s,i)=>`<div class="step ${s.state==='blocked'?'blocked':''}"><span class="step-index">${i+1}</span><div>${esc(s.name)}<small>${esc(s.detail)}</small></div><span class="badge ${s.state==='blocked'?'bad':s.state==='waiting'?'neutral':''}">${{done:'已完成',blocked:'已拦截',waiting:'等待回采'}[s.state]}</span></div>`).join('')}</article>`).join(''):'<div class="empty">还没有任务<br>在环境态势页申请入棚，或让助手发起通风。</div>'}</section>`;}
const scriptAgentPage=agent;
function modelPanel(){return `<section class="panel"><div class="panel-head"><h2>模型接口</h2><button id="ai-toggle" ${busy?'disabled':''}>${aiMode?'返回脚本演示':'切换到服务端模型'}</button></div><p class="inline-note">${aiMode?'已选择 '+esc(aiProvider)+'。发送时会把输入和模拟环境快照提交给所配置的模型服务商；计划不自动执行。':'默认脚本不发送外部请求。真实模型需在服务端配置，密钥不进入浏览器。'}</p>${aiPlan?`<h3 style="font-size:14px">待确认计划</h3><p class="quiet">${esc(aiPlan.summary)}</p>${aiPlan.steps.map((s,i)=>`<div class="step"><span class="step-index">${i+1}</span><div>${esc(s.action)}<small>${esc(s.reason)}</small></div><button data-plan-step="${i}" ${s.executed||busy?'disabled':''}>${s.executed?'已处理':'确认此步骤'}</button></div>`).join('')}`:''}</section>`;}
function agentWithModel(){let html=scriptAgentPage();if(aiMode)html=html.replaceAll('脚本演示 · 未接入大模型','服务端模型 · 计划待确认').replaceAll('棚安 · 脚本演示','棚安 · 模型接口').replace('<span class="badge neutral">脚本演示</span>','<span class="badge neutral">'+esc(aiProvider)+'</span>');return html+modelPanel();}
function monitor(){return title('CROP INSPECTION','拍照巡查入口预览 · 真实摄像头与视觉模型待接入')+`<div class="two-col"><section class="panel"><div class="panel-head"><h2>一号棚 · 作物观察位</h2><span class="badge neutral">绘制的示意画面</span></div><div class="camera"><span class="camera-label">DEMO / 非摄像头画面</span><svg viewBox="0 0 600 300" aria-label="温室作物示意"><rect width="600" height="300" fill="#e6ede4"/><g fill="none" stroke="#c2d0bf" stroke-width="3"><path d="M30 300V110Q300 -100 570 110V300M140 300V90Q300 -10 460 90V300M235 300V90Q300 60 365 90V300"/><path d="M0 180H600M0 110H600"/></g><path d="M260 300L290 135H310L350 300" fill="#d1d5c4"/><g fill="#8ca684"><path d="M0 300V240L270 145 220 300Z"/><path d="M600 300V240L330 145 385 300Z"/></g><g stroke="#65846b" stroke-width="4"><path d="M80 300L160 185M180 300L235 170M420 300L365 170M520 300L440 185"/></g><g fill="#6e9271"><ellipse cx="120" cy="250" rx="30" ry="13" transform="rotate(-30 120 250)"/><ellipse cx="195" cy="230" rx="27" ry="12" transform="rotate(30 195 230)"/><ellipse cx="400" cy="230" rx="30" ry="13" transform="rotate(-30 400 230)"/><ellipse cx="470" cy="250" rx="30" ry="13" transform="rotate(30 470 250)"/></g></svg><span class="camera-bottom">等待 USB 摄像头接入 DAYU200</span></div><div class="actions" style="margin-top:18px"><button class="primary" id="analyze">生成示例巡查报告</button><span class="quiet" style="padding:10px">不采集、不上传任何图片</span></div></section><section class="panel"><div class="panel-head"><h2>巡查报告</h2><span class="badge neutral">固定示例</span></div>${report||'<div class="empty">点击左侧按钮预览报告结构<br>这里将展示图片分析结果与养护建议。</div>'}</section></div>`;}
function auditView(){return title('AUDIT LOG','记录操作来源、环境快照与执行结果')+`<section class="panel"><div class="panel-head"><h2>本地审计记录</h2><div class="actions"><button id="verify">校验哈希链</button><button id="export">导出 JSON</button></div></div><p class="inline-note">浏览器本地保存 · SHA-256 串联。校验可发现未重算哈希的篡改，不能证明数据来源真实，也不能防止整链重写。真实部署需独立存证。</p><div class="result ${verification.includes('异常')?'bad':''}">${esc(verification)}</div><div class="table-wrap"><table><thead><tr><th>时间</th><th>事件</th><th>来源</th><th>结果</th><th>记录摘要</th></tr></thead><tbody>${audit.slice().reverse().map(r=>`<tr><td>${time(r.at)}</td><td>${esc(r.event)}</td><td>${esc(r.source)}</td><td>${esc(r.result)}</td><td class="hash">${esc(String(r.hash).slice(0,16))}…</td></tr>`).join('')}</tbody></table></div>${audit.length?'':'<div class="empty">尚无审计记录</div>'}</section>`;}
function render(){ $('#page-name').textContent=names[page];$('#task-count').textContent=tasks.length;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#content').innerHTML=({home,agent:agentWithModel,tasks:taskView,monitor,audit:auditView}[page])();$('#cloud-toggle').textContent=cloud?'断开模拟云端':'恢复模拟云端';$('#sensor-toggle').textContent=env.sensorOnline?'断开模拟终端':'恢复模拟终端';$('#emergency').textContent=env.emergency?'解除急停':'触发急停';remoteButton.textContent=remote?'断开 MQTT 模拟终端':'连接 MQTT 模拟终端';$('.demo-banner>span').textContent=remote?'MQTT 联调模式 · 真实本机消息链路，终端与执行器仍为软件模拟':'交互原型 · 模拟数据　未连接开发板、云端模型或真实门禁';const el=$('.chat-log');if(el)el.scrollTop=el.scrollHeight;}
async function refreshRemote(){
 if(!remote||remotePolling)return;remotePolling=true;
 try{
  const data=await deviceSnapshot();if(!remote)return;
  const f=data.frame;if(!f)throw new Error('no_telemetry');
  env={co:f.quality.coValid?f.values.coPpm:NaN,co2:f.quality.co2Valid?f.values.co2Ppm:NaN,temp:f.values.temperatureC,humidity:f.values.humidityPct,soil:f.values.soilPct,light:f.values.lightLux,at:Date.now()-(data.gatewayNow-data.receivedAt+f.sampleAgeMs),sensorOnline:data.deviceOnline,emergency:f.state.emergency};
  fan=f.state.fan;hold=Date.now()-env.at>15000;
  for(const row of data.events){if(row.at<=remoteLastEventAt||row.event!=='device_event')continue;const event=row.detail;const reason={verification_passed:'MQTT 模拟终端回采通过，风机停止；未自动开锁',fan_timeout:'MQTT 模拟终端风机超时，转人工检查',emergency_active:'MQTT 模拟终端急停'}[event.reason]||event.reason;
   for(const t of tasks)for(const s of t.steps)if(s.state==='waiting'){s.state=event.reason==='verification_passed'?'done':'blocked';s.detail=reason;}
   await log('MQTT 设备事件',reason,'模拟终端');
  }
  remoteLastEventAt=Math.max(remoteLastEventAt,...data.events.map(e=>e.at));
 }catch{if(remote){env.sensorOnline=false;fan=false;}}
 finally{remotePolling=false;if(remote)render();}
}
async function remoteAction(action,source,parameters={}){
 const t=newTask('MQTT '+({request_access:'入棚申请',ventilate:'通风请求',query_environment:'查询环境',stop_ventilation:'停止通风'}[action]||'设备操作'),source);
 t.steps.push(step('经网关发送 MQTT 命令','等待设备返回相同 commandId 的执行回执','waiting'));render();
 try{
  const ack=await deviceCommand(action,parameters);const ok=ack.status==='executed';
  t.steps[0].state=ok?'done':'blocked';t.steps[0].detail=`${ack.commandId} · ${ack.status}`;
  const reason={simulated_access_only:'模拟终端规则通过；真实门锁未接入',simulated_fan_started:'模拟终端风机已启动',already_running:'终端已有通风任务',emergency_active:'急停锁定，拒绝执行'}[ack.reason]||ack.reason;
  t.steps.push(step('终端本地校验与执行回执',reason,ok?'done':'blocked'));
  if(ok&&action==='ventilate')t.steps.push(step('等待终端回采','通过 MQTT 遥测与事件确认','waiting'));
  await log('MQTT 命令回执',reason,source);await refreshRemote();toast(reason);return {ok,reason};
 }catch(error){const reason='设备操作未确认：'+error.message;t.steps[0].state='blocked';t.steps[0].detail=reason;await log('MQTT 命令失败',reason,source);toast(reason);return {ok:false,reason};}
 finally{render();}
}
function go(next){if(!names[next])return;page=next;location.hash=next;render();}
function newTask(title,source){const t={id:'TASK-'+String(tasks.length+1).padStart(3,'0'),title,source,at:Date.now(),steps:[]};tasks.push(t);return t;}
const step=(name,detail,state='done')=>({name,detail,state});
async function access(source='人工操作'){
 if(remote)return remoteAction('request_access',source);
 const t=newTask('入棚申请核验',source),d=decide(env,'access');
 t.steps.push(step('读取环境快照',`CO ${env.co} ppm · CO₂ ${env.co2} ppm`),step('确定性安全规则校验',d.reason,d.ok?'done':'blocked'));
 if(d.ok)t.steps.push(step('模拟准入回执','仅显示授权结果；真实身份认证和门锁均未接入'));
 await log('入棚申请',d.reason,source);toast(d.ok?'模拟准入通过，真实门锁未接入':d.reason);render();return d;
}
async function ventilate(source='人工操作'){
 if(remote)return remoteAction('ventilate',source);
 const t=newTask('通风并复测',source),d=decide(env,'ventilate');
 t.steps.push(step('本地执行条件校验',d.reason,d.ok?'done':'blocked'));
 if(!d.ok){await log('通风请求',d.reason,source);toast(d.reason);render();return d;}
 if(fan){t.steps.push(step('重复命令抑制','已有通风任务，未重复启动'));render();return {ok:true,reason:'通风任务已在运行'};}
 fan=true;t.steps.push(step('启动模拟风机','执行器回执为软件模拟'),step('等待模拟回采','每 2 秒更新；最长运行 20 秒','waiting'));
 await log('通风启动','模拟风机运行，等待回采',source);render();return d;
}
async function prompt(text){
 if(busy)return;busy=true;chat.push({role:'user',text});render();
 try{
 if(!cloud){chat.push({role:'assistant',text:'模拟云端已断开，助手暂停处理。可以在“环境态势”页面继续操作本地核验和通风。'});return;}
 if(aiMode){
  if(!remote){chat.push({role:'assistant',text:'请先在演示控制台连接 MQTT 模拟终端，以便模型使用当前网关的模拟快照。'});return;}
  try{aiPlan=await agentPlan(text);chat.push({role:'assistant',text:aiPlan.summary+'\n计划未执行，请在下方逐项确认。'});await log('模型生成计划',`${aiPlan.provider} · ${aiPlan.steps.length} 个步骤，尚未执行`,'AI 建议');}
  catch(error){chat.push({role:'assistant',text:'模型请求失败：'+error.message+'。没有执行任何设备操作。'});}return;
 }
 let answer;
 if(/通风|风机/.test(text)){const d=await ventilate('助手脚本');answer=d.ok?'已创建通风任务。请到任务中心查看执行与回采状态。':d.reason;}
 else if(/进棚|入棚|开门|放行/.test(text)){const d=await access('助手脚本');answer=d.reason+'。具体依据已经写入任务流与本地台账。';}
 else if(/环境|读数|温度/.test(text)){const t=newTask('查询环境快照','助手脚本');t.steps.push(step('读取模拟快照',`CO ${env.co} ppm · CO₂ ${env.co2} ppm`));answer=`模拟读数：CO ${env.co} ppm，CO₂ ${env.co2} ppm，温度 ${env.temp} °C，土壤湿度 ${env.soil}%。\n本地规则：${evaluate(env).allowed?'演示条件通过':evaluate(env).reasons.join('；')}。`;}
 else answer='当前脚本支持“查看环境”“申请入棚”“启动通风”。自由对话、天气预案和病害分析将在接入模型后提供。';
 chat.push({role:'assistant',text:answer});
 }finally{busy=false;render();}
}
let fanStarted=0;
function stopFan(reason,success){fan=false;fanStarted=0;for(const t of tasks)for(const s of t.steps)if(s.state==='waiting'){s.state=success?'done':'blocked';s.detail=reason;}log('通风结束',reason);}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.planStep!==undefined){
  const index=Number(b.dataset.planStep),planned=aiPlan?.steps[index];if(!planned||planned.executed||busy)return;
  if(!remote){toast('请先连接 MQTT 模拟终端');return;}
  busy=true;planned.executed=true;render();
  try{await remoteAction(planned.action,'AI 计划 / 人工确认',planned);}finally{busy=false;render();}return;
 }
 if(remote&&(b.dataset.scenario||['sensor-toggle','emergency'].includes(b.id))){
  const name=b.dataset.scenario||(b.id==='sensor-toggle'?(env.sensorOnline?'offline':'online'):(env.emergency?'clear_emergency':'emergency'));
  try{await deviceScenario(name);await log('MQTT 场景切换',name,'演示控制台');await refreshRemote();}catch(error){toast('网关不可用：'+error.message);}return;
 }
 if(b.dataset.page||b.dataset.go){go(b.dataset.page||b.dataset.go);return;}
 if(b.dataset.prompt){go('agent');await prompt(b.dataset.prompt);return;}
 if(b.dataset.action){if(b.dataset.action==='access')await access();else await ventilate();return;}
 if(b.dataset.scenario){hold=b.dataset.scenario==='stale';env.co=b.dataset.scenario==='co'?65:4;env.co2=b.dataset.scenario==='co2'?2200:680;env.at=Date.now()-(hold?60000:0);await log('模拟场景切换',b.textContent,'演示控制台');render();return;}
 switch(b.id){
 case'ai-toggle':if(aiMode){aiMode=false;aiPlan=null;render();}else{try{const status=await agentStatus();if(!status.configured){toast('尚未配置模型。请设置服务端 PENGAN_AI_PROVIDER / MODEL / KEY 后重启网关。');break;}aiMode=true;aiPlan=null;aiProvider=status.provider+' / '+status.model;render();}catch{toast('模型接口不可用，请先启动网关。');}}break;
 case'remote-toggle':
  if(remote){remote=false;env=initial();fan=false;hold=false;for(const t of tasks)for(const s of t.steps)if(s.state==='waiting'){s.state='blocked';s.detail='已断开联调，设备结果未确认';}toast('返回本地模拟，网关任务仍由模拟终端管理');render();}
  else{try{const data=await deviceSnapshot();remoteLastEventAt=Math.max(0,...data.events.map(e=>e.at));remote=true;await refreshRemote();await log('接入 MQTT 联调','连接的是软件模拟终端，不是真实硬件','人工操作');}catch{toast('请先运行 node gateway/demo.mjs 启动本地网关');}}break;
 case'demo-toggle':$('#demo-controls').hidden=!$('#demo-controls').hidden;break;
 case'cloud-toggle':cloud=!cloud;await log('模拟云端连接',cloud?'已恢复':'已断开，本地规则继续运行','演示控制台');render();break;
 case'sensor-toggle':env.sensorOnline=!env.sensorOnline;if(env.sensorOnline&&!hold)env.at=Date.now();await log('模拟终端连接',env.sensorOnline?'已恢复':'已断开，禁止准入','演示控制台');render();break;
 case'emergency':env.emergency=!env.emergency;if(env.emergency&&fan)stopFan('急停触发，模拟执行器已停止',false);await log('急停状态',env.emergency?'已触发':'人工解除；须重新核验','演示控制台');render();break;
 case'reset':if(remote){toast('请先断开 MQTT 联调再重置本地演示');break;}generation++;env=initial();fan=false;fanStarted=0;hold=false;cloud=true;tasks=[];chat=[];report='';verification='';audit=[];localStorage.removeItem('pengan.audit');await log('演示初始化','会话和模拟读数已重置','演示控制台');render();toast('演示状态已重置');break;
 case'analyze':report='<div class="report"><span class="badge neutral">示例内容 · 未进行图片识别</span><h3>作物巡查报告结构预览</h3><p><b>观察结论：</b>待真实图片分析后生成。</p><p><b>数据依据：</b>摄像头抓拍、环境快照与采集时间。</p><p><b>养护建议：</b>展示建议及其依据；设备操作仍须经过安全规则。</p><p><b>置信说明：</b>由实际模型输出与验证结果决定，不生成虚构置信度。</p></div>';await log('巡查报告预览','生成固定示例，未采集或上传图片','人工操作');render();break;
 case'verify':await auditQueue;{const result=await verifyChain(audit);verification=result.ok?`校验通过：${result.count} 条本地记录哈希连续一致。`:`校验异常：第 ${result.index+1} 条记录不一致。`;render();}break;
 case'export':await auditQueue;{const blob=new Blob([JSON.stringify({prototype:true,exportedAt:clock(),records:audit},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='棚安-模拟审计记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}break;
 }
});
document.addEventListener('submit',e=>{if(e.target.id==='chat-form'){e.preventDefault();const text=$('#chat-input').value.trim();if(text)prompt(text);}});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(names[next]){page=next;render();}});
setInterval(()=>{
 $('#clock').textContent=clock();
 if(remote){refreshRemote();return;}
 if(env.sensorOnline&&!hold)env.at=Date.now();
 if(fan){
  if(!fanStarted)fanStarted=Date.now();
  if(env.sensorOnline&&!hold){env.co=Math.max(4,env.co-9);env.co2=Math.max(680,env.co2-260);}
  if(evaluate(env).allowed)stopFan('模拟回采已低于演示阈值，停止通风；未自动开锁',true);
  else if(Date.now()-fanStarted>=20000)stopFan('运行达到 20 秒演示上限，停止并转人工检查',false);
 }
 if(page==='home'||page==='tasks')render();
},2000);
page=names[location.hash.slice(1)]?location.hash.slice(1):'home';$('#clock').textContent=clock();render();
if(!audit.length)log('演示启动','模拟设备初始化；未连接真实硬件','系统');
