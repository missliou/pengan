import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';
import {readFile, writeFile, rename, mkdir, stat, rm} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {validateHspFrame, hspSnapshot} from './hsp-telemetry.mjs';

const fail = code => { throw Error(code); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const keys = ['schemaVersion','deviceId','simulated','controlSupported','coValid','co2Valid','coPpm','co2Ppm','uptime_ms','th_ok','gas_ok','th_sample_age_ms','gas_sample_age_ms','temperature10','humidity10','gas_raw','gas_mv'];
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value);
const int = v => Number.isSafeInteger(v) && v >= 0;
function frameOnly(frame) {
  validateHspFrame(frame);
  if (Object.keys(frame).some(key => !keys.includes(key))) fail('unexpected_frame_field');
  return Object.fromEntries(keys.map(key => [key, frame[key] ?? null]));
}

// One enrolled DAYU200 per instance/file. Token hashes are supplied by the
// deployment, never persisted in telemetry. This is a latest-state store, NOT
// the historical batch/AI storage proposed in the design document.
export class DayuIngress {
  constructor({gatewayId, tokenSha256, file, now = Date.now}) {
    if (!safeId(gatewayId) || !/^[a-f0-9]{64}$/.test(tokenSha256) || !path.isAbsolute(file)) fail('invalid_ingress_config');
    Object.assign(this, {gatewayId, tokenSha256, file, now}); this.state = null; this.busy = false; this.ready = false;
  }
  authenticate(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) fail('device_unauthorized');
    if (!timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(this.tokenSha256, 'hex'))) fail('device_unauthorized');
  }
  async open() {
    this.ready = false;
    try {
      if ((await stat(this.file)).size > 65536) fail('invalid_ingress_state');
      const s = JSON.parse(await readFile(this.file, 'utf8'));
      if (!object(s) || s.schemaVersion !== 1 || s.gatewayId !== this.gatewayId || !safeId(s.sessionBootId) ||
          !int(s.receivedAt) || !int(s.acceptedAt) || s.receivedAt > s.acceptedAt || !Array.isArray(s.retired) ||
          s.retired.length > 128 || s.retired.some(id => !safeId(id) || id === s.sessionBootId) || new Set(s.retired).size !== s.retired.length) fail('invalid_ingress_state');
      frameOnly(s.frame); this.state = s;
    } catch (e) { if (e.code !== 'ENOENT') fail('ingress_state_unavailable'); this.state = null; }
    this.ready = true; return this;
  }
  async accept(body, token) {
    this.authenticate(token);
    if (!this.ready) fail('ingress_not_ready');
    if (this.busy) fail('ingress_busy');
    if (!object(body) || Object.keys(body).some(k => !['schemaVersion','gatewayId','sessionBootId','sampleAgeMs','frame'].includes(k)) ||
        body.schemaVersion !== 1 || body.gatewayId !== this.gatewayId || !safeId(body.sessionBootId) || !int(body.sampleAgeMs) || body.sampleAgeMs >= 10000) fail('invalid_ingress_envelope');
    const frame = frameOnly(body.frame), now = this.now(), old = this.state;
    if (!int(now) || now < body.sampleAgeMs || old && now < old.acceptedAt) fail('invalid_server_time');
    if (old?.retired.includes(body.sessionBootId)) fail('retired_session');
    if (old?.sessionBootId === body.sessionBootId && frame.uptime_ms <= old.frame.uptime_ms)
      return {schemaVersion:1, accepted:false, duplicate:true};
    const retired = [...(old?.retired || [])];
    if (old && old.sessionBootId !== body.sessionBootId) { if (retired.length >= 128) fail('session_limit_reenroll_required'); retired.push(old.sessionBootId); }
    const next = {schemaVersion:1, gatewayId:this.gatewayId, sessionBootId:body.sessionBootId, retired, receivedAt:now-body.sampleAgeMs, acceptedAt:now, frame};
    this.busy = true;
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(path.dirname(this.file), {recursive:true});
      await writeFile(temp, JSON.stringify(next), {flag:'wx', mode:0o600});
      await rename(temp, this.file); this.state = next;
      return {schemaVersion:1, accepted:true, duplicate:false};
    } catch { fail('ingress_write_failed'); }
    finally { this.busy = false; await rm(temp, {force:true}).catch(() => {}); }
  }
  current() {
    if (!this.ready) fail('ingress_not_ready');
    const hardware = hspSnapshot(this.state ? {transport:'http', receivedAt:this.state.receivedAt, frame:this.state.frame} : null, this.now());
    hardware.source = 'dayu-direct';
    return {schemaVersion:1, gatewayId:this.gatewayId, mode:'hardware', simulated:false, hardware};
  }
}

// Fixed loopback listener behind a TLS reverse proxy. No public-bind option and
// no unauthenticated current-data/admin endpoint.
export async function startDayuIngressServer(ingress, {port = 0} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !ingress.ready) fail('invalid_ingress_listener');
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(body)); };
    try {
      if (req.method !== 'POST' || req.url !== '/api/v1/telemetry/current') { send(404,{error:'not_found'}); return; }
      const auth = req.headers.authorization;
      const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
      ingress.authenticate(token);
      if (req.headers.origin) { send(403,{error:'device_endpoint_not_browser_api'}); return; }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) { send(415,{error:'json_required'}); return; }
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 4096) { send(413,{error:'body_too_large'}); return; } chunks.push(chunk); }
      let body; try { body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); } catch { send(400,{error:'invalid_json'}); return; }
      // Require a synchronized sender clock and account for transit plus the
      // permitted 1s positive skew. Never treat receipt time as sampling time.
      const sent = req.headers['x-pengan-sent-at'], now = ingress.now();
      const sentAt = typeof sent === 'string' && /^\d{1,16}$/.test(sent) ? Number(sent) : NaN;
      if (!Number.isSafeInteger(sentAt) || sentAt < 0 || now - sentAt > 3000 || sentAt - now > 1000) { send(409,{error:'sender_clock_out_of_window'}); return; }
      if (object(body) && int(body.sampleAgeMs)) body.sampleAgeMs += Math.max(0,now-sentAt) + 1000;
      send(200,await ingress.accept(body,token));
    } catch (e) {
      const codes = {device_unauthorized:401,ingress_not_ready:503,ingress_busy:429,invalid_ingress_envelope:400,unexpected_frame_field:400,invalid_server_time:409,retired_session:409,session_limit_reenroll_required:409,ingress_write_failed:503};
      send(codes[e.message] || 400,{error:codes[e.message] ? e.message : 'invalid_ingress_frame'});
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',() => {server.off('error',reject);resolve();}); });
  return server;
}
