import http from '@ohos.net.http';
import {normalizeDirectConfig} from './DirectConnectionSettings';
export class WeatherRisk {code: string = '';title: string = '';advice: string = '';startsAt: number = 0;endsAt: number = 0;hours: number = 0;}
export class WeatherSummary {minTemperatureC: number = 0;maxTemperatureC: number = 0;maxGustMs: number = 0;totalRainMm: number = 0;}
export class NativeWeather {
  schemaVersion: number = 0;gatewayId: string = '';available: boolean = false;provider: string = '';officialWarning: boolean = false;hardwareControl: boolean = false;
  fetchedAt: number = 0;expiresAt: number = 0;risks: WeatherRisk[] = [];summary: WeatherSummary = new WeatherSummary();
}
class WeatherCheck { title: string = '';reason: string = ''; }
class AdvicePersistence { saved: boolean = false;recordId: number = 0; }
class AdviceEvidence { fetchedAt: number = 0;expiresAt: number = 0; }
class WeatherAdviceReceipt {
  schemaVersion: number = 0;kind: string = '';gatewayId: string = '';readOnly: boolean = false;executed: boolean = true;requiresHumanConfirmation: boolean = false;
  summary: string = '';checks: WeatherCheck[] = [];limitations: string[] = [];sourceHash: string = '';provider: string = '';model: string = '';
  persistence: AdvicePersistence = new AdvicePersistence();evidence: AdviceEvidence = new AdviceEvidence();
}
export function weatherAdviceText(text: string,id: string): string {
  const d = JSON.parse(text) as WeatherAdviceReceipt;
  if (!d || d.schemaVersion !== 1 || d.kind !== 'weather_advice' || d.gatewayId !== id || d.readOnly !== true || d.executed !== false || d.requiresHumanConfirmation !== true || !d.persistence || d.persistence.saved !== true || !Number.isSafeInteger(d.persistence.recordId) || d.persistence.recordId < 1 || !d.evidence || !Number.isSafeInteger(d.evidence.expiresAt) || d.evidence.expiresAt <= Date.now() || !/^[a-f0-9]{64}$/.test(d.sourceHash) || typeof d.summary !== 'string' || d.summary.length > 1500 || !Array.isArray(d.checks) || d.checks.length > 6 || !Array.isArray(d.limitations) || d.limitations.length > 6) throw new Error('天气建议回执无效');
  let result = d.summary;
  for (const c of d.checks) {
    if (!c || typeof c.title !== 'string' || c.title.length > 100 || typeof c.reason !== 'string' || c.reason.length > 600) throw new Error('天气建议条目无效');
    result += '\n\n' + c.title + '\n' + c.reason;
  }
  for (const item of d.limitations) { if (typeof item !== 'string' || item.length > 400) throw new Error('天气建议限制无效');result += '\n待核查：' + item; }
  return result + '\n\n需人工核对现场；未执行设备。\n审计记录 #' + d.persistence.recordId.toString() + '\n天气依据 ' + d.sourceHash;
}
export function parseNativeWeather(text: string,id: string): NativeWeather {
  const value = JSON.parse(text) as NativeWeather;
  if (!value || value.schemaVersion !== 1 || value.gatewayId !== id || value.provider !== 'Open-Meteo' || value.officialWarning !== false || value.hardwareControl !== false || typeof value.available !== 'boolean') throw new Error('天气来源校验失败');
  if (!value.available) throw new Error('天气服务暂不可用，风险未知');
  const now = Date.now();
  if (!Number.isSafeInteger(value.fetchedAt) || !Number.isSafeInteger(value.expiresAt) || value.fetchedAt > now + 1000 || value.expiresAt <= now || value.expiresAt - value.fetchedAt !== 1800000 || !Array.isArray(value.risks) || value.risks.length > 6) throw new Error('天气时效校验失败');
  const s = value.summary;
  if (!s || !Number.isFinite(s.minTemperatureC) || !Number.isFinite(s.maxTemperatureC) || s.minTemperatureC < -100 || s.maxTemperatureC > 70 || s.minTemperatureC > s.maxTemperatureC || !Number.isFinite(s.maxGustMs) || s.maxGustMs < 0 || s.maxGustMs > 150 || !Number.isFinite(s.totalRainMm) || s.totalRainMm < 0 || s.totalRainMm > 12000) throw new Error('天气数值无效');
  const codes: string[] = [];
  for (const risk of value.risks) {
    if (!risk || !['frost','heat','wind','rain','snow','thunder'].includes(risk.code) || codes.includes(risk.code) || typeof risk.title !== 'string' || risk.title.length > 40 || typeof risk.advice !== 'string' || risk.advice.length > 300 || !Number.isSafeInteger(risk.startsAt) || !Number.isSafeInteger(risk.endsAt) || risk.endsAt <= risk.startsAt || !Number.isInteger(risk.hours) || risk.hours < 1 || risk.hours > 24) throw new Error('天气提示格式无效');
    codes.push(risk.code);
  }
  return value;
}
class BoardClock {deviceId: string = '';uptime_ms: number = 0;}
class WeatherAck {saved: boolean = false;informationalOnly: boolean = false;authenticated: boolean = true;}
export async function relayWeather(ip: string,weather: NativeWeather): Promise<void> {
  const config = normalizeDirectConfig('direct',ip);
  if (!config.boardIp || !weather.available || weather.expiresAt <= Date.now()) throw new Error('采集板或天气未就绪');
  const client = http.createHttp();
  const started = Date.now();
  try {
    const response = await client.request('http://' + config.boardIp + '/api/pengan/telemetry', {method:http.RequestMethod.GET,expectDataType:http.HttpDataType.STRING,connectTimeout:2000,readTimeout:2000,maxLimit:4096,maxRedirects:0});
    if (response.responseCode !== 200 || typeof response.result !== 'string') throw new Error('采集板时钟读取失败');
    const clock = JSON.parse(response.result) as BoardClock;
    if (clock.deviceId !== 'hh-hsp101-001' || !Number.isInteger(clock.uptime_ms) || clock.uptime_ms < 0 || clock.uptime_ms > 4294967295 || Date.now() < started || Date.now() - started >= 3000) throw new Error('采集板时钟无效');
    let mask = 0;
    for (const r of weather.risks) { const i = ['frost','heat','wind','rain','snow','thunder'].indexOf(r.code); if (i < 0) throw new Error('天气风险代码无效'); mask |= 1 << i; }
    const ttl = Math.min(600,Math.floor((weather.expiresAt - Date.now()) / 1000));
    if (ttl < 1) throw new Error('天气已过期');
    const s = weather.summary;
    const body = 'PGWX1 ' + mask.toString() + ' ' + Math.round(s.minTemperatureC*10).toString() + ' ' + Math.round(s.maxTemperatureC*10).toString() + ' ' + Math.round(s.maxGustMs*10).toString() + ' ' + Math.round(s.totalRainMm*10).toString() + ' ' + ttl.toString() + ' ' + clock.uptime_ms.toString();
    const result = await client.request('http://' + config.boardIp + '/api/pengan/weather', {method:http.RequestMethod.POST,header:{'Content-Type':'application/x-pengan-weather'},extraData:body,expectDataType:http.HttpDataType.STRING,connectTimeout:2000,readTimeout:2000,maxLimit:1024,maxRedirects:0});
    if (result.responseCode !== 202 || typeof result.result !== 'string') throw new Error('板端未确认；请核对固件版本');
    const ack = JSON.parse(result.result) as WeatherAck;
    if (ack.saved !== true || ack.informationalOnly !== true || ack.authenticated !== false) throw new Error('天气转发回执无效');
  } finally { client.destroy(); }
}
