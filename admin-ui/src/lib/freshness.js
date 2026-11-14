import { ApiError } from './api.js';
const TTL = 10000;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sources = new Set(['serial', 'http', 'unknown', 'dayu-direct']);

export function validateObservations(data) {
  const h = data?.hardware, q = h?.quality, v = h?.values;
  if (data?.schemaVersion !== 1 || data.mode !== 'hardware' || data.simulated !== false ||
      !h || h.deviceId !== 'hh-hsp101-001' || h.simulated !== false || !sources.has(h.source) ||
      typeof h.deviceOnline !== 'boolean' || h.actuationAvailable !== false || !q || !v ||
      q.coValid !== false || q.co2Valid !== false || v.coPpm !== null || v.co2Ppm !== null)
    throw new ApiError('真实观测协议无效', { kind: 'parse' });
  for (const key of ['temperatureValid', 'humidityValid', 'gasValid'])
    if (typeof q[key] !== 'boolean') throw new ApiError('传感器质量标记无效', { kind: 'parse' });
  if (!h.deviceOnline) return data;
  if (!integer(h.receivedAt) || !integer(h.sampleAgeMs)) throw new ApiError('采样时间无效', { kind: 'parse' });
  for (const [key, valid, min, max] of [['temperatureC', 'temperatureValid', -40, 85], ['humidityPct', 'humidityValid', 0, 100], ['gasRaw', 'gasValid', 0, 4095], ['gasMv', 'gasValid', 0, 7200]]) {
    if (q[valid] && (!Number.isFinite(v[key]) || v[key] < min || v[key] > max || key === 'gasRaw' && !Number.isInteger(v[key])))
      throw new ApiError('有效传感读数不在量程内', { kind: 'parse' });
  }
  if ((q.temperatureValid || q.humidityValid) && !integer(h.climateAgeMs) || q.gasValid && !integer(h.gasAgeMs))
    throw new ApiError('传感器采样年龄无效', { kind: 'parse' });
  return data;
}

export class LiveObservations {
  constructor(now = Date.now) { this.now = now; this.reset(); }
  reset() { this.data = null; this.key = null; this.firstSeen = 0; this.startedAt = 0; this.failed = ''; this.expires = {}; }
  invalidate(reason = '读取失败，当前状态未知') { this.data = null; this.failed = reason; }
  ingest(data, startedAt) {
    validateObservations(data);
    const h = data.hardware, key = `${h.deviceId}/${h.source}/${h.receivedAt}`;
    if (!integer(startedAt)) throw new ApiError('本地请求时间无效', { kind: 'parse' });
    if (key !== this.key) { this.key = key; this.firstSeen = startedAt; this.expires = {}; }
    // The same frame can shorten its lifetime, never extend it. Preserve channel
    // deadlines even if an intermediary later reports smaller ages for this frame.
    if (h.deviceOnline) for (const field of ['sampleAgeMs', 'climateAgeMs', 'gasAgeMs']) {
      if (integer(h[field])) this.expires[field] = Math.min(this.expires[field] ?? Infinity, startedAt + TTL - h[field]);
    }
    this.startedAt = startedAt; this.data = structuredClone(data); this.failed = '';
    return this.current();
  }
  current() {
    if (!this.data) return null;
    const result = structuredClone(this.data), h = result.hardware, q = h.quality, v = h.values;
    const now = this.now(), elapsed = now - this.startedAt, repeatedAge = now - this.firstSeen;
    const age = Math.max(h.sampleAgeMs + elapsed, TTL + now - this.expires.sampleAgeMs);
    if (!h.deviceOnline || elapsed < 0 || repeatedAge < 0 || age >= TTL) {
      h.reason = !h.deviceOnline ? h.reason : elapsed < 0 || repeatedAge < 0 ? 'invalid_receive_time' : 'telemetry_stale'; h.deviceOnline = false;
      h.sampleAgeMs = null; h.climateAgeMs = null; h.gasAgeMs = null;
      for (const key of Object.keys(v)) v[key] = null;
      for (const key of Object.keys(q)) q[key] = false;
      return result;
    }
    h.sampleAgeMs = age;
    for (const [ageKey, flags, fields] of [['climateAgeMs', ['temperatureValid', 'humidityValid'], ['temperatureC', 'humidityPct']], ['gasAgeMs', ['gasValid'], ['gasRaw', 'gasMv']]]) {
      const channelAge = Number.isFinite(h[ageKey]) ? Math.max(h[ageKey] + elapsed, TTL + now - this.expires[ageKey], age) : null;
      h[ageKey] = channelAge;
      if (channelAge === null || channelAge >= TTL) for (const flag of flags) q[flag] = false;
      if (flags.every(flag => !q[flag])) for (const field of fields) v[field] = null;
    }
    if (!q.temperatureValid) v.temperatureC = null;
    if (!q.humidityValid) v.humidityPct = null;
    v.coPpm = null; v.co2Ppm = null;
    return result;
  }
}
