import { EnvSnapshot, SafetyResult } from '../model/Models';

// 参数仅用于软件演示，真实部署需要单独确定阈值和标定要求。
export class SafetyEngine {
  static check(env: EnvSnapshot, now: number = Date.now()): SafetyResult {
    let reasons: string[] = [];
    if (env.emergency) reasons.push('急停已触发');
    if (!env.sensorOnline) reasons.push('传感终端离线');
    if (!Number.isFinite(env.sampledAt) || now - env.sampledAt > 15000 || env.sampledAt > now + 1000) {
      reasons.push('传感读数过期或时间异常');
    }
    if (!Number.isFinite(env.co) || env.co < 0) reasons.push('CO 读数无效');
    else if (env.co >= 30) reasons.push('CO 达到演示拒止阈值');
    if (!Number.isFinite(env.co2) || env.co2 < 0) reasons.push('CO₂ 读数无效');
    else if (env.co2 >= 1500) reasons.push('CO₂ 达到演示拒止阈值');
    return new SafetyResult(reasons.length === 0, reasons);
  }
}
