async function request(path,body) {
  const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(path==='/api/agent/plan'?32000:6500)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'gateway_error');
  return data;
}
export const deviceSnapshot=()=>request('/api/device');
export const deviceCommand=(action,parameters={})=>request('/api/command',{action,parameters:action==='ventilate'?{maxRunMs:parameters.maxRunMs??20000}:{}});
export const deviceScenario=(name)=>request('/api/demo/scenario',{name});
export const agentStatus=()=>request('/api/agent/status');
export const agentPlan=(prompt)=>request('/api/agent/plan',{prompt});
