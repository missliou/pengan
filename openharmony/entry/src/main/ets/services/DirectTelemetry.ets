// 由 docs/DAYU200直采原生实现草案.md §2（第 35~320 行）逐行落地。
// 语义与 gateway/hsp-telemetry.mjs + gateway/hsp-http.mjs + GatewayLink.ets 对齐，改动须两侧同步。
// 与本文件配套的可执行断言：gateway/test/native-direct-vectors.test.mjs（主机侧，node --test）。
import http from '@ohos.net.http';
import util from '@ohos.util';

// 与 gateway/hsp-telemetry.mjs 的 HSP_TTL_MS 对齐，改动必须两侧同步。
const TTL_MS: number = 10000;
const REQUEST_TIMEOUT_MS: number = 3000;
const MAX_BODY_BYTES: number = 4096;
const PATH: string = '/api/pengan/telemetry';
const EXPECTED_DEVICE_ID: string = 'hh-hsp101-001';

// 帧结构：字段与固件 dash_pengan_json 一一对应。
// JSON.parse(...) as RawFrame只是类型断言，不会实例化本类或补默认值；
// 缺失字段仍为undefined，必须由validateFrame严格拒绝。
class RawFrame {
  schemaVersion: number = 0;
  deviceId: string = '';
  simulated: boolean = true;
  controlSupported: boolean = true;
  coValid: boolean = true;
  co2Valid: boolean = true;
  coPpm: number | null = 0;
  co2Ppm: number | null = 0;
  uptime_ms: number = -1;
  th_ok: boolean = false;
  temperature10: number = 0;
  humidity10: number = 0;
  gas_ok: boolean = false;
  gas_raw: number = 0;
  gas_mv: number = 0;
  th_sample_age_ms: number = -1;
  gas_sample_age_ms: number = -1;
}

// 只有白名单键参与上报与本地持久化，其余板载字段（page/trend/nfc/wifi_*）丢弃。
class TrimmedFrame {
  schemaVersion: number = 1;
  deviceId: string = EXPECTED_DEVICE_ID;
  simulated: boolean = false;
  controlSupported: boolean = false;
  coValid: boolean = false;
  co2Valid: boolean = false;
  coPpm: number | null = null;
  co2Ppm: number | null = null;
  uptime_ms: number = 0;
  th_ok: boolean = false;
  gas_ok: boolean = false;
  th_sample_age_ms: number = 0;
  gas_sample_age_ms: number = 0;
  temperature10: number | null = null;
  humidity10: number | null = null;
  gas_raw: number | null = null;
  gas_mv: number | null = null;
}

class Values {
  temperatureC: number | null = null;
  humidityPct: number | null = null;
  gasRaw: number | null = null;
  gasMv: number | null = null;
  coPpm: number | null = null;
  co2Ppm: number | null = null;
}
class Quality {
  temperatureValid: boolean = false;
  humidityValid: boolean = false;
  gasValid: boolean = false;
  coValid: boolean = false;   // 无硬件，恒 false
  co2Valid: boolean = false;  // 无硬件，恒 false
}

class Snapshot {
  schemaVersion: number = 1;
  deviceId: string = EXPECTED_DEVICE_ID;
  source: string = 'dayu-direct';   // 落地前需协调者确认该取值（见 §5）
  simulated: boolean = false;
  deviceOnline: boolean = false;
  reason: string = '';
  receivedAt: number | null = null;
  sampleAgeMs: number | null = null;
  uptimeMs: number | null = null;
  climateAgeMs: number | null = null;
  gasAgeMs: number | null = null;
  sessionBootId: string = '';
  values: Values = new Values();
  quality: Quality = new Quality();
  actuationAvailable: boolean = false;
  controlSupported: boolean = false;
  admission: string = 'unknown_denied';
  frame: TrimmedFrame | null = null;
}

function uint(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n <= 4294967295;
}

// 校验语义严格对齐向量表 F-01…F-25：
// 身份→质量→温湿度→ADC，且范围检查只在对应 *_ok 为真时执行。
function validateFrame(raw: RawFrame, keys: Record<string, Object>): void {
  if (raw.schemaVersion !== 1 || raw.deviceId !== EXPECTED_DEVICE_ID ||
    raw.simulated !== false || raw.controlSupported !== false ||
    raw.coValid !== false || raw.co2Valid !== false ||
    raw.coPpm !== null || raw.co2Ppm !== null) {
    throw new Error('invalid_hsp_identity');
  }
  // 缺键必须视为非法：undefined !== null / undefined !== false 已覆盖上面几条，
  // 但 uptime_ms 与两个年龄字段是数值，需要显式存在性检查。
  const keyNames: string[] = Object.keys(keys);
  if (!keyNames.includes('coPpm') || !keyNames.includes('coValid')) {
    throw new Error('invalid_hsp_identity');
  }
  if (!uint(raw.uptime_ms) || typeof raw.th_ok !== 'boolean' || typeof raw.gas_ok !== 'boolean' ||
    !uint(raw.th_sample_age_ms) || !uint(raw.gas_sample_age_ms)) {
    throw new Error('invalid_hsp_quality');
  }
  if (raw.th_ok && (!Number.isSafeInteger(raw.temperature10) || raw.temperature10 < -400 || raw.temperature10 > 850 ||
    !Number.isSafeInteger(raw.humidity10) || raw.humidity10 < 0 || raw.humidity10 > 1000)) {
    throw new Error('invalid_hsp_climate');
  }
  if (raw.gas_ok && (!Number.isSafeInteger(raw.gas_raw) || raw.gas_raw < 0 || raw.gas_raw > 4095 ||
    !Number.isSafeInteger(raw.gas_mv) || raw.gas_mv < 0 || raw.gas_mv > 7200)) {
    throw new Error('invalid_hsp_adc');
  }
}

function assertPrivateIpv4(ip: string): void {
  const parts: string[] = ip.split('.');
  if (parts.length !== 4) throw new Error('board_requires_private_ipv4');
  for (const part of parts) {
    if (!/^\d+$/.test(part) || Number(part) > 255 || String(Number(part)) !== part) {
      throw new Error('board_requires_private_ipv4');
    }
  }
  const head: number = Number(parts[0]);
  const second: number = Number(parts[1]);
  const ok = head === 10 || (head === 192 && second === 168) ||
    (head === 172 && second >= 16 && second <= 31);
  if (!ok) throw new Error('board_requires_private_ipv4');
}

export class DirectTelemetry {
  private ip: string = '';
  private lastUptime: number = -1;
  private lastReceivedAt: number = -1;
  private lastFrame: TrimmedFrame | null = null;
  private polling: boolean = false;
  private sessionBootId: string = '';
  private revision: number = 0;   // 与 GatewayLink 同语义：配置变化即作废旧响应

  configure(ip: string): void {
    assertPrivateIpv4(ip);
    if (ip === this.ip) { this.invalidate(); return; }
    this.ip = ip;
    this.lastUptime = -1;
    this.lastReceivedAt = -1;
    this.lastFrame = null;
    this.sessionBootId = '';
    this.revision++;
  }

  invalidate(): void {
    this.revision++;
    this.lastFrame = null;
    // Hide cached readings, but keep identity/deduplication evidence. Navigation
    // or backgrounding is not a board reboot and must not renew a frozen frame.
  }

  private unknownSnapshot(reason: string, sessionBootId: string): Snapshot {
    // 关键：来源标签显式贯穿，不沿用网关那套默认 'serial'（发现 1）。
    const s = new Snapshot();
    s.reason = reason;
    s.source = 'dayu-direct';
    s.sessionBootId = sessionBootId;
    return s;
  }

  async pollOnce(): Promise<Snapshot> {
    const revisionAtStart = this.revision;
    const boot = this.sessionBootId;
    if (this.ip.length === 0) return this.unknownSnapshot('board_not_configured', boot);
    if (this.polling) return this.unknownSnapshot('board_request_busy', boot);
    if (this.lastReceivedAt >= 0 && Date.now() < this.lastReceivedAt) return this.unknownSnapshot('invalid_receive_time', boot);
    this.polling = true;

    let client: http.HttpRequest | undefined = undefined;
    const startedAt = Date.now();
    try {
      client = http.createHttp();
      const response = await client.request('http://' + this.ip + PATH, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: REQUEST_TIMEOUT_MS,
        readTimeout: REQUEST_TIMEOUT_MS,
        usingCache: false,
        // Official API26 SDK: maxRedirects (since 23), maxLimit (since 11).
        maxRedirects: 0,
        maxLimit: MAX_BODY_BYTES,
      });
      if (revisionAtStart !== this.revision) {
        return this.unknownSnapshot('board_address_changed', boot);
      }
      if (response.responseCode === 503) {
        return this.unknownSnapshot('board_telemetry_unavailable', boot);
      }
      if (response.responseCode !== 200 || typeof response.result !== 'string') {
        return this.unknownSnapshot('board_http_failed', boot);
      }
      const text: string = response.result;
      if (new util.TextEncoder().encodeInto(text).byteLength > MAX_BODY_BYTES) {
        return this.unknownSnapshot('board_frame_too_large', boot);
      }

      const keys: Record<string, Object> = JSON.parse(text) as Record<string, Object>;
      const raw: RawFrame = JSON.parse(text) as RawFrame;
      validateFrame(raw, keys);

      const receivedAt = startedAt;   // 只信接收方墙钟；板侧无可靠时钟
      const age = Date.now() - receivedAt;
      if (age < 0) return this.unknownSnapshot('invalid_receive_time', boot);
      if (age >= REQUEST_TIMEOUT_MS) {
        return this.unknownSnapshot('board_sample_too_slow', boot);
      }
      if (revisionAtStart !== this.revision) {
        return this.unknownSnapshot('board_address_changed', boot);
      }

      // uptime_ms 回绕视为板子重启，合成新会话（契约 §3.4 方案 1，不改固件）。
      let session = this.sessionBootId;
      if (this.lastUptime >= 0 && raw.uptime_ms < this.lastUptime) {
        session = 'boot-' + receivedAt.toString() + '-' + raw.uptime_ms.toString();
      } else if (session.length === 0) {
        session = 'boot-' + receivedAt.toString() + '-' + raw.uptime_ms.toString();
      }

      // 重复帧判定：uptime_ms 相同则不刷新接收时间、不入队。
      if (this.lastUptime === raw.uptime_ms && session === this.sessionBootId) {
        const repeatedAge = Date.now() - this.lastReceivedAt;
        if (repeatedAge < 0) return this.unknownSnapshot('invalid_receive_time', session);
        if (repeatedAge >= TTL_MS) return this.unknownSnapshot('board_sample_not_updating', session);
        return this.unknownSnapshot('board_duplicate_frame', session);
      }

      const trimmed = new TrimmedFrame();
      trimmed.uptime_ms = raw.uptime_ms;
      trimmed.th_ok = raw.th_ok;
      trimmed.gas_ok = raw.gas_ok;
      trimmed.th_sample_age_ms = raw.th_sample_age_ms;
      trimmed.gas_sample_age_ms = raw.gas_sample_age_ms;
      // Preserve valid raw samples with their original ages; current view masks stale channels.
      // A stale-but-th_ok raw frame must not contain null readings and break peer validation.
      trimmed.temperature10 = raw.th_ok ? raw.temperature10 : null;
      trimmed.humidity10 = raw.th_ok ? raw.humidity10 : null;
      trimmed.gas_raw = raw.gas_ok ? raw.gas_raw : null;
      trimmed.gas_mv = raw.gas_ok ? raw.gas_mv : null;

      this.lastUptime = raw.uptime_ms;
      this.lastReceivedAt = receivedAt;
      this.sessionBootId = session;
      this.lastFrame = trimmed;
      return this.currentSnapshot();
    } catch (error) {
      if (revisionAtStart !== this.revision) return this.unknownSnapshot('board_address_changed', boot);
      const message = (error as Error).message;
      const known = message === 'invalid_hsp_identity' || message === 'invalid_hsp_quality' ||
        message === 'invalid_hsp_climate' || message === 'invalid_hsp_adc';
      return this.unknownSnapshot(known ? message : 'invalid_hsp_sample', boot);
    } finally {
      if (client) client.destroy();
      this.polling = false;
    }
  }

  // Local-only aging: does not send HTTP or renew receivedAt. Call before displaying cached data.
  currentSnapshot(): Snapshot {
      const raw = this.lastFrame;
      const session = this.sessionBootId;
      if (!raw || this.lastReceivedAt < 0) return this.unknownSnapshot('board_no_sample', session);
      const receivedAt = this.lastReceivedAt;
      const age = Date.now() - receivedAt;
      if (age < 0) return this.unknownSnapshot('invalid_receive_time', session);
      if (age >= TTL_MS) return this.unknownSnapshot('telemetry_stale', session);
      const thAge = age + raw.th_sample_age_ms;
      const gasAge = age + raw.gas_sample_age_ms;
      const th = raw.th_ok && thAge < TTL_MS;
      const gas = raw.gas_ok && gasAge < TTL_MS;
      const s = new Snapshot();
      s.source = 'dayu-direct';
      s.deviceOnline = true;
      s.reason = 'read_only_hardware';
      s.receivedAt = receivedAt;
      s.sampleAgeMs = age;
      s.uptimeMs = raw.uptime_ms;
      s.climateAgeMs = thAge;
      s.gasAgeMs = gasAge;
      s.sessionBootId = session;
      s.values.temperatureC = th ? (raw.temperature10 as number) / 10 : null;
      s.values.humidityPct = th ? (raw.humidity10 as number) / 10 : null;
      s.values.gasRaw = gas ? raw.gas_raw : null;
      s.values.gasMv = gas ? raw.gas_mv : null;
      s.values.coPpm = null;
      s.values.co2Ppm = null;
      s.quality.temperatureValid = th;
      s.quality.humidityValid = th;
      s.quality.gasValid = gas;
      s.quality.coValid = false;
      s.quality.co2Valid = false;
      s.frame = JSON.parse(JSON.stringify(raw)) as TrimmedFrame;
      return s;
  }
}
