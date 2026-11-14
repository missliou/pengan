// 演示阈值只服务于模拟场景，未经现场标定和安全认证。
export const DEMO_POLICY = Object.freeze({co:30,co2:1500,maxAgeMs:15000});
export function evaluate(env, now=Date.now()) {
  const reasons=[];
  if(env.emergency) reasons.push('急停已触发');
  if(!Number.isFinite(env.at)||now-env.at>DEMO_POLICY.maxAgeMs||env.at>now+1000) reasons.push('传感读数过期或时间异常');
  if(!env.sensorOnline) reasons.push('传感终端离线');
  if(!Number.isFinite(env.co)||env.co<0) reasons.push('CO 读数无效');
  else if(env.co>=DEMO_POLICY.co) reasons.push('CO 达到演示拒止阈值');
  if(!Number.isFinite(env.co2)||env.co2<0) reasons.push('CO₂ 读数无效');
  else if(env.co2>=DEMO_POLICY.co2) reasons.push('CO₂ 达到演示拒止阈值');
  return {allowed:reasons.length===0,reasons};
}
export function decide(env,action,now=Date.now()) {
  const check=evaluate(env,now);
  if(env.emergency) return {ok:false,reason:'急停锁定，停止所有模拟执行器'};
  if(action==='access') return {ok:check.allowed,reason:check.allowed?'模拟气体条件通过，仅授权短时入棚':'拒止：'+check.reasons.join('；')};
  if(action==='ventilate') return {ok:true,reason:'启动模拟通风，等待回采验证'};
  return {ok:false,reason:'工具不在允许清单中'};
}
export function canonical(value) {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export async function hashRecord(record,previousHash) {
  const bytes=new TextEncoder().encode(previousHash+'\n'+canonical(record));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function verifyChain(rows) {
  let previous='GENESIS';
  for(let i=0;i<rows.length;i++) {
    const {hash,prev,...record}=rows[i];
    if(prev!==previous||hash!==await hashRecord(record,previous)) return {ok:false,index:i};
    previous=hash;
  }
  return {ok:true,count:rows.length};
}
