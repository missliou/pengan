# DAYU200 直采原生实现草案（可粘贴，未编译）

任务 ID：QWEN-DAYU200-CONTRACT-20261102（补充件）· 执行者：Qwen-3.8 · 日期：2026-11-02

## 0. 为什么这份草案放在 `docs/` 而不是直接写进 `openharmony/`

`进度.md` 记录原生构建带**源码指纹**校验（`build-native7` 前后核对来源，41 文件指纹 `f90f318b…`），且 Codex 已认领「原生验证构建」范围。此时由我在 `openharmony/` 增删文件，会让对方的构建校验出现**伪失配**，把别人的验证成果搞乱。所以：

- 本文件是**实现草案 + 接线说明**，不是已落地代码。
- 未编译、未预览、未装机。ArkTS 严格模式下的类型与 API 可用性（尤其 `http` 的重定向语义、`util.TextEncoder` 方法名）必须在 SDK 恢复后实测确认。
- 落地动作请由 `openharmony/` 当前负责人执行，或明确转交所有权后再写。

配套语义基线：`docs/DAYU200遥测帧校验向量.md`。代码里的每个分支都要对得上那张表的编号。

## 1. 设计约束（从基线代码逐条搬过来，不新造规则）

| 约束 | 来源 | 草案中的落点 |
|---|---|---|
| 只允许 RFC1918 IPv4 | `gateway/hsp-http.mjs:7` | `assertPrivateIpv4()` |
| 3 秒超时、4096 字节上限、禁缓存、拒绝重定向 | 同上 21-30 行 | `pollOnce()` |
| 帧字段与范围校验、范围仅在 `*_ok` 为真时检查 | `hsp-telemetry.mjs:5-11` | `validateFrame()` |
| `HSP_TTL_MS = 10000`；`thAge = age + th_sample_age_ms`；严格小于 | 同上 3、24-26 行 | `toSnapshot()` |
| `uptime_ms` 相同判重复、不刷新接收时间 | `hsp-http.mjs:31` | `pollOnce()` |
| 上报只保留白名单字段 | `hsp-http.mjs:33-34` | `trimmedFrame` |
| 同一 `receivedAt` 长期不变视为陈旧 | `GatewayLink.ets:316-321` | `repeatedAge` 分支 |
| 公网必须 HTTPS、HTTP 仅限本地与私网 | `ConnectionSettings.ets:20` | 沿用，不改动 |

顺带修正我在核对中发现的第 1 号问题：未知原因分支**显式带上来源标签**，不再依赖默认值 `'serial'`。

## 2. 实现草案

建议文件名 `openharmony/entry/src/main/ets/services/DirectTelemetry.ets`（新建文件，不碰 `Index.ets` 以外的既有文件）。

```typescript
import http from '@ohos.net.http';
import util from '@ohos.util';

// 与 gateway/hsp-telemetry.mjs 的 HSP_TTL_MS 对齐，改动必须两侧同步。
const TTL_MS: number = 10000;
const REQUEST_TIMEOUT_MS: number = 3000;
const MAX_BODY_BYTES: number = 4096;
const PATH: string = '/api/pengan/telemetry';
const EXPECTED_DEVICE_ID: string = 'hh-hsp101-001';

// 帧结构：字段与固件 dash_pengan_json 一一对应。
// 说明：这里一律给显式默认值，JSON.parse 后缺字段会保留默认值，
// 再由 validateFrame 用「键是否存在」判断补值是否合法。
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
  if (!Object.keys(keys).includes('coPpm') || !Object.keys(keys).includes('coValid')) {
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
  private firstSeenAt: number = 0;
  private sessionBootId: string = '';
  private revision: number = 0;   // 与 GatewayLink 同语义：配置变化即作废旧响应

  configure(ip: string): void {
    assertPrivateIpv4(ip);
    this.ip = ip;
    this.lastUptime = -1;
    this.lastReceivedAt = -1;
    this.firstSeenAt = 0;
    this.sessionBootId = '';
    this.revision++;
  }

  invalidate(): void { this.revision++; }

  private unknownSnapshot(reason: string, sessionBootId: string): Snapshot {
    // 来源标签显式贯穿。网关侧同类默认标错已由 LEAD-GATEWAY-HSP-TELEMETRY-20261102
    // 修复（'serial' 默认 → 'unknown'）；原生侧保持同一口径，不依赖任何默认值行为。
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
        // 重定向语义需在真机核实：若该版本无法禁止跟随，改为响应体全字段校验兜底。
        // usingProtocol 等字段按实测 SDK 补齐，不凭记忆填写。
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
      if (Date.now() - startedAt >= REQUEST_TIMEOUT_MS) {
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
        const repeatedAge = this.firstSeenAt > 0 ? Date.now() - this.firstSeenAt : 0;
        if (repeatedAge >= TTL_MS) return this.unknownSnapshot('board_sample_not_updating', session);
        return this.unknownSnapshot('board_duplicate_frame', session);
      }

      if (age >= TTL_MS) {
        return this.unknownSnapshot('telemetry_stale', session);
      }

      const thAge = age + raw.th_sample_age_ms;
      const gasAge = age + raw.gas_sample_age_ms;
      const th = raw.th_ok && thAge < TTL_MS;
      const gas = raw.gas_ok && gasAge < TTL_MS;

      const trimmed = new TrimmedFrame();
      trimmed.uptime_ms = raw.uptime_ms;
      trimmed.th_ok = raw.th_ok;
      trimmed.gas_ok = raw.gas_ok;
      trimmed.th_sample_age_ms = raw.th_sample_age_ms;
      trimmed.gas_sample_age_ms = raw.gas_sample_age_ms;
      // 通道不可用即置空，不采信板侧残值（向量表 F-02/F-03/T-02/T-03）。
      trimmed.temperature10 = th ? raw.temperature10 : null;
      trimmed.humidity10 = th ? raw.humidity10 : null;
      trimmed.gas_raw = gas ? raw.gas_raw : null;
      trimmed.gas_mv = gas ? raw.gas_mv : null;

      this.lastUptime = raw.uptime_ms;
      this.lastReceivedAt = receivedAt;
      this.sessionBootId = session;
      if (this.firstSeenAt === 0) this.firstSeenAt = Date.now();

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
      s.values.temperatureC = th ? raw.temperature10 / 10 : null;
      s.values.humidityPct = th ? raw.humidity10 / 10 : null;
      s.values.gasRaw = gas ? raw.gas_raw : null;
      s.values.gasMv = gas ? raw.gas_mv : null;
      s.values.coPpm = null;
      s.values.co2Ppm = null;
      s.quality.temperatureValid = th;
      s.quality.humidityValid = th;
      s.quality.gasValid = gas;
      s.quality.coValid = false;
      s.quality.co2Valid = false;
      s.frame = trimmed;
      return s;
    } catch (error) {
      const message = (error as Error).message;
      const known = message === 'invalid_hsp_identity' || message === 'invalid_hsp_quality' ||
        message === 'invalid_hsp_climate' || message === 'invalid_hsp_adc';
      return this.unknownSnapshot(known ? message : 'invalid_hsp_sample', boot);
    } finally {
      if (client) client.destroy();
    }
  }
}
```

## 3. 接线说明（改动点清单，供落地者执行）

1. **新建** `DirectTelemetry.ets`（上面的内容）。
2. `ConnectionSettings.ets`：新增键 `boardAddress`（存板子 IPv4）与 `localOnly`（布尔）。校验复用 `normalizeGatewayAddress` 的私网判断思路，但**不能直接复用该函数**——它要求带 scheme，而板子端点是裸 IP。**不改动** `DEFAULT_GATEWAY`、`gatewayAddress` 键名与公网强制 HTTPS 规则，避免破坏既有测试与已保存配置。
3. `Index.ets`：
   - 启动载入配置处（现 `configure(address)` 附近）同时载入板子地址并 `direct.configure(ip)`。
   - 保存配置后调用 `direct.configure(ip)`（内部已递增 `revision` 作废旧响应）。
   - 真实模式的采集入口由 `gateway.readHardware()` 改为 `direct.pollOnce()`；`localOnly` 为真时**只走直采、不出网**。
   - 文案沿用现有"未知/质量无效"的显示口径；错误提示里不得再出现"电脑网页"。
4. `module.json5`：本草案**不需要新增权限**（`INTERNET` 已覆盖局域网 HTTP）。若后续要做后台持续采集，才涉及持续运行能力，属独立决策，见契约文档 §3.6。
5. **不要**改 `gateway/runtime.mjs` 的路由与 `GatewayLink.ets` 的云端接口签名，除非同批提供云端契约实现——否则会出现端侧改完无对端可连的"待集成"状态。

## 4. 落地后必须补的测试

- 把 `docs/DAYU200遥测帧校验向量.md` 的 F/S/T 三组在原生侧做成可运行断言（可用 `hypium` 或主机侧等价测试），与网关侧结果比对，两边期望必须一致。
- 新增直采专用用例：回环 HTTP 服务返回参考帧 → 快照字段正确；返回 503 → `board_telemetry_unavailable`；返回带 `wifi_ssid` 的帧 → `trimmedFrame` 不含该键；`uptime_ms` 回绕 → `sessionBootId` 变化。
- 现有 112 项回归需全量重跑一次，并把日志目录写进进度（由协调者落笔）。

## 5. 这份草案里我刻意没有做的事

- 没有写云端上报的 `fetch` 实现：`transport` 取值、去重键、令牌签发都还在等决策（契约文档 §4.3、决策单第 5 节）。
- 没有引入 `bootId` 到固件：会牵连固件 + 网关 + 测试三处跨所有权改动。
- 没有新增权限声明与后台任务：未核实目标系统能力，不凭印象写。
- 没有把任何文件写进 `openharmony/` 或 `gateway/`：见 §0 的源码指纹冲突风险。
- `source` 字面量 `'dayu-direct'` 只是草案占位，**在协调者确认前不得合入**——`hspSource()` 目前只接受 `serial`/`http`，直接合入会让云端侧把样本判成 `invalid_hsp_sample`。
