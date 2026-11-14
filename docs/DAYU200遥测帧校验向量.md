# DAYU200 遥测帧校验向量（端侧/云端共用）

任务 ID：QWEN-DAYU200-CONTRACT-20261102 · 执行者：Qwen-3.8 · 日期：2026-11-02

## 0. 用途与状态

- 本文件是**测试期望值清单**，用于把 `gateway/hsp-telemetry.mjs` 的既有校验语义固化下来，供后续原生直采与云端接入复用，避免两套实现各自漂移。
- 本任务首次撰写时**未实际运行**这些用例，只是源码推导的期望值。后续协调者 Codex 已在任务 `LEAD-GATEWAY-HSP-TELEMETRY-20261102` 中把 §2～§4 固化为可执行断言并跑通回归（详见文末 §7 落地回执，非本任务撰写）。**§3 与 §5 中标注"来源错标为 serial"的结论已被并发修复超越，当前以 §7.2 为准。**
- 基线源码：`gateway/hsp-telemetry.mjs`（本任务首核时 SHA-256 `75adfacf…`，**该文件随后被并发修改，哈希已失效，落地前须重新计算**）、`gateway/hsp-http.mjs`（`68c350e9…`，末次复读一致）、`firmware/hh-hsp101/src/dashboard.c`（`54383fd3…`，未复读，视为可能变化）。

## 1. 参考合法帧

固件 `dash_pengan_json` 实际产出的字段集合（`firmware/hh-hsp101/src/dashboard.c:125`）。示例取温度 25.6℃、湿度 64.0%、ADC 1234/3210mV：

```json
{"schemaVersion":1,"deviceId":"hh-hsp101-001","simulated":false,"uptime_ms":123456,"th_ok":true,"temperature10":256,"humidity10":640,"gas_ok":true,"gas_raw":1234,"gas_mv":3210,"th_sample_age_ms":800,"gas_sample_age_ms":900,"coValid":false,"co2Valid":false,"coPpm":null,"co2Ppm":null,"controlSupported":false}
```

`coValid`/`co2Valid` 必须显式为 `false`，`coPpm`/`co2Ppm` 必须显式为 `null`。**缺键不等于合规**（见 F-12/F-13）。

## 2. `validateHspFrame` 期望结果

错误名取自基线源码抛出的字符串。判定顺序即代码顺序：身份 → 质量 → 温湿度 → ADC。

| 编号 | 相对参考帧的改动 | 期望 | 依据要点 |
|---|---|---|---|
| F-01 | 原样 | 通过 | — |
| F-02 | `th_ok:false`，`temperature10:9999`、`humidity10:9999` | **通过**（接收方须把温湿度置空） | 范围检查只在 `th_ok===true` 时执行；残值不代表有效 |
| F-03 | `gas_ok:false`，`gas_raw:9999` | **通过**（ADC 置空） | 同上 |
| F-04 | `gas_ok:false`，`gas_raw` 缺失 | **通过**（ADC 未知） | 不检查即不要求存在 |
| F-05 | `th_ok:true`，`temperature10:851` | `invalid_hsp_climate` | 上限 850（即 85.0℃） |
| F-06 | `th_ok:true`，`temperature10:-401` | `invalid_hsp_climate` | 下限 -400 |
| F-07 | `th_ok:true`，`humidity10:1001` | `invalid_hsp_climate` | 上限 1000 |
| F-08 | `th_ok:true`，`temperature10:"256"` | `invalid_hsp_climate` | 非整数一律拒绝 |
| F-09 | `gas_ok:true`，`gas_raw:4096` | `invalid_hsp_adc` | 12 位上限 4095 |
| F-10 | `gas_ok:true`，`gas_mv:7201` | `invalid_hsp_adc` | 上限 7200 |
| F-11 | `coPpm:5` | `invalid_hsp_identity` | 缺硬件不得带浓度 |
| F-12 | 删除 `coPpm` 键 | `invalid_hsp_identity` | `undefined !== null` |
| F-13 | 删除 `coValid` 键 | `invalid_hsp_identity` | `undefined !== false` |
| F-14 | `simulated:true` | `invalid_hsp_identity` | 真实链路禁止模拟标记 |
| F-15 | `controlSupported:true` | `invalid_hsp_identity` | 无执行器 |
| F-16 | `deviceId:"HH-HSP101-001"` | `invalid_hsp_identity` | 严格相等，大小写敏感 |
| F-17 | `schemaVersion:"1"` | `invalid_hsp_identity` | 严格比较 |
| F-18 | 删除 `uptime_ms` | `invalid_hsp_quality` | 必需整数 |
| F-19 | `uptime_ms:4294967296` | `invalid_hsp_quality` | uint32 上限 4294967295 |
| F-20 | `uptime_ms:100.5` | `invalid_hsp_quality` | 非安全整数 |
| F-21 | `th_ok:0` | `invalid_hsp_quality` | 必须真布尔 |
| F-22 | `th_sample_age_ms:4294967296` | `invalid_hsp_quality` | 同 uint32 上限 |
| F-23 | 整帧为 `[]` | `invalid_hsp_identity` | 显式拒绝数组 |
| F-24 | `null` 或 JSON 解析失败 | `invalid_hsp_identity` / 解析层报错 | 空值走身份分支 |
| F-25 | 追加未知字段 `"wifi_ssid":"HomeNet"`、`"page":3` | **通过** | **校验器不拒绝未知字段**，隐私裁剪必须另做（见 §4） |

> F-25 是隐私红线相关的关键一条：不能因为"帧校验通过"就以为多余字段被过滤掉了。

## 3. `hspSnapshot`（时效层）期望结果

时效常量 `HSP_TTL_MS = 10000`。`age = now - receivedAt`；`thAge = age + th_sample_age_ms`；`gasAge = age + gas_sample_age_ms`；通道可用需 `*_ok === true` 且对应 `*Age < 10000`（严格小于）。输入形态为 `{receivedAt, transport, frame}` 三层信封。

| 编号 | 输入 | 期望 |
|---|---|---|
| S-01 | `age = 0`，参考帧（`th_sample_age_ms:800`、`gas_sample_age_ms:900`） | `deviceOnline:true`，`reason:"read_only_hardware"`，温度 25.6 / 湿度 64.0 / ADC 1234、3210 |
| S-02 | `age = 9999`，参考帧 | `thAge = 10799 ≥ 10000` → 温湿度**未知**；`gasAge = 10899 ≥ 10000` → ADC**未知**；`deviceOnline` 仍为 `true` |
| S-03 | `age = 10000` | `telemetry_stale`，全部未知、`receivedAt:null` |
| S-04 | `age = 9000`，`th_sample_age_ms:900`、`gas_sample_age_ms:50` | `thAge=9900 <10000` 温湿度有效；`gasAge=9050 <10000` ADC 有效 |
| S-05 | `age = 9500`，`th_sample_age_ms:600`、`gas_sample_age_ms:100` | `thAge=10100` → 温湿度未知；`gasAge=9600` → ADC 有效（**允许一通道有效、另一通道未知并存**） |
| S-06 | `receivedAt` 大于 `now` | `invalid_receive_time` |
| S-07 | `frame` 为 F-05 之类非法帧，`age` 正常 | `invalid_hsp_sample`（内层校验异常被捕获后统一归此原因） |
| S-08 | `transport:"http"`，合法帧 | `source:"http"` |
| S-09 | `transport` 缺失 | `source:"serial"` |
| S-10 | `transport:"ble"` | ~~`source` 回落为 `"serial"`~~ → **并发修复后为 `"unknown"`**（见 §7.2），快照原因仍为无效类 |
| S-11 | 直采新增取值 `transport:"dayu-direct"` | `hspSource` 仍只接受 `serial`/`http`，抛 `invalid_hsp_transport`，失败路径标签为 `"unknown"`（不再污染为 `serial`）→ 若正式启用该取值，仍须扩展 `hspSource` 与相关测试 |

~~S-10 与 S-11 是迁移时必须注意的行为：未知 `transport` 会把来源标签错标为 `serial`~~（撰写本文时成立）。**已由协调者在 `LEAD-GATEWAY-HSP-TELEMETRY-20261102` 修复**：失败与未知来源统一标 `unknown`，见 §7.2。注意新增的下游兼容点：凡按 `source==='http'…:'serial'` 二分处理的代码都会把 `unknown` 误读为串口，已核实 `gateway/runtime.mjs` 的 `/api/health` 仍存在该二分（详见本任务交接 §排查）。

## 4. 采集与上报的裁剪期望

基线 `hsp-http.mjs` 的白名单（键集合为准，顺序无关）：

```text
schemaVersion, deviceId, simulated, controlSupported, coValid, co2Valid,
coPpm, co2Ppm, uptime_ms, th_ok, gas_ok, th_sample_age_ms, gas_sample_age_ms,
temperature10, humidity10, gas_raw, gas_mv
```

期望行为：

| 编号 | 场景 | 期望 |
|---|---|---|
| T-01 | 帧含 `wifi_ssid`、`wifi_ip`、`nfc_text`、`page`、`trend` | 仅白名单键被保留，其余丢弃 |
| T-02 | `th_ok:false` | `temperature10`、`humidity10` 置为 `null` 后再落盘/上报 |
| T-03 | `gas_ok:false` | `gas_raw`、`gas_mv` 置为 `null` |
| T-04 | `uptime_ms` 与上一帧相同 | `{accepted:false, duplicate:true}`，**不刷新** `receivedAt` |
| T-05 | 响应非 2xx（含板侧 503 `telemetry_unavailable`） | `wifi_http_failed`，不产生记录 |
| T-06 | 响应体 > 4096 字节 | `wifi_frame_too_large`，取消读取 |
| T-07 | 取回耗时 ≥ 3000ms | `wifi_sample_too_slow`，丢弃 |
| T-08 | 服务返回 3xx 重定向 | 拒绝跟随 |
| T-09 | 目标 IP 为公网地址或 `169.254.x` | `wifi_requires_private_ipv4`，拒绝发起 |
| T-10 | 已有落盘文件内容损坏 | `existing_hardware_sample_invalid`（启动恢复失败即报错，不静默忽略） |

上报到云端时（`docs/DAYU200直采与端云上报契约设计.md` §4.2），裁剪规则必须与 T-01～T-03 完全一致，并额外要求 `sessionBootId` 不得使用可反推家庭网络的派生值。

## 5. 本轮只读核对中发现的行为差异（供实现与协调者判断）

1. **（已由协调者修复）失败路径来源错标为 `serial`。** 本文撰写时 `readHspTelemetry`/`hspSnapshot` 的异常分支不传 `source`，默认值 `'serial'` 会让无线/未知样本冒充串口。协调者在 `LEAD-GATEWAY-HSP-TELEMETRY-20261102` 中新增 `hspSourceOrUnknown()` 并覆盖全部失败分支，见 §7.2。
   - **修复的尾巴（本任务 2026-11-02 复核登记）**：`gateway/runtime.mjs` 的 `/api/health` 仍是 `h?.source==='http'?'wifi-http':'serial-http'` 二分。失败快照的 `deviceOnline` 为 false、`hardwareConnected` 如实为 false，不构成数据错误，但**传输标签会把 unknown 显示成 serial-http**；且 `gateway/test/real-ai.test.mjs:17` 断言 `serial-http`，该改动会连带测试一起动。属于网关所有权范围，未擅自修改，已提交协调者处置。`gateway/hardware-history.mjs:36` 的二分只作用于读取成功样本（transport 必可解析），不受影响，保持不动是正确的。
2. **去重完全依赖 `uptime_ms` 相等**，而该值在板子重启后回绕（设计文档 §3.4），单靠它无法区分"重复帧"与"重启后恰好同值"。
3. **范围检查只在 `*_ok` 为真时执行。** 容易被误写成"始终检查"，从而把 F-02/F-03/F-04 这类本应通过的帧拒绝，将可恢复的单通道故障放大成整帧丢弃。端侧与云端两处实现都要按本表对齐。
4. **HTTP 遥测通道无认证、无 TLS。** 板侧 Origin 检查只覆盖配网接口，遥测接口是开放只读。原生直采属同一局域网只读，可接受；但**云端上报不能沿用该信任模型**，必须独立做设备鉴权。

## 6. 待办（实现阶段）

- [ ] SDK 恢复后，把 §2～§4 各条写成可运行用例，先在 `gateway/test/hsp-telemetry.test.mjs` 一侧跑通，确认期望值与现有实现一致（该步只验证，不改产品语义）。
- [ ] 原生侧实现同一组向量并断言结果一致。
- [ ] 若采纳 `dayu-direct` 来源取值，同步扩展 `hspSource`、历史字段、报告导出与相关测试。
- [ ] 差异 1 的修复由 `gateway/hsp-telemetry.mjs` 负责人落地，本任务不代改。

## 7. 落地回执（协调者 Codex，任务 LEAD-GATEWAY-HSP-TELEMETRY-20261102）

本节由协调者在实现侧完成 §5 差异 1 与 §6 待办后追加，用于闭合本向量文档与代码之间的鸿沟。上文 §1～§6 由 Qwen 撰写，本节不改其任何结论。

### 7.1 向量已固化为可执行断言

新建 `gateway/test/hsp-vectors.test.mjs`（6 个用例，全绿）：

| 用例 | 覆盖 | 结果 |
| --- | --- | --- |
| §2 表驱动 | F-01～F-25，逐条断言 `validateHspFrame` 的通过/拒绝原因 | 通过 |
| §3 S-01～S-09 | 通道年龄叠加：`climateAgeMs` 10799/9900/10100、`gasAgeMs` 9050，过期即未知 | 通过 |
| §3 S-10 | 非法 transport 不再被错标为 serial | 通过 |
| §4 T-01～T-05 | 17 键白名单、残值置空、重复帧不刷新、失败不覆盖最后样本 | 通过 |
| 文件读取 | 缺文件/损坏文件/正常无线样本的来源标签 | 通过 |
| §6 端到端 | `unknown` 来源可通过历史持久化与报告生成 | 通过 |

### 7.2 §5 差异 1 已修复（来源错标）

`gateway/hsp-telemetry.mjs` 新增 `hspSourceOrUnknown(transport)`：`transport` 为 `undefined` 时返回 `'unknown'`，可解析时返回 `'serial'`/`'http'`，非法值同样返回 `'unknown'`。`hspSnapshot` 与 `readHspTelemetry` 的失败分支全部改用它，超时但可确证的 `http` 帧仍保留 `'http'`。

**修复过程中暴露的连锁问题（已一并处理）**：`gateway/analysis-history.mjs` 与 `gateway/report.mjs` 的快照清洗白名单只接受 `['serial','http']`，会把新的 `'unknown'` 判为 `invalid_observation_source`；由于 `gateway/runtime.mjs:210` 用裸 `catch` 把任何持久化异常压成 `analysis_history_write_failed`，症状表现为"真实采集离线时 AI 分析静默不落盘"。现已把两处白名单扩为 `['serial','http','unknown']`，且快照归一化不再把 `'unknown'` 折叠回 `'serial'`。`gateway/hardware-history.mjs` 的采样记录白名单**保持不动**：采样写入只发生在读取成功时，来源必为可确证的 `serial`/`http`。

### 7.3 §5 差异 2 未修复（保留给实现阶段）

板子重启后 `uptime_ms` 归零，`gateway/hsp-http.mjs` 仍以 `raw.uptime_ms===this.lastUptime` 判重。本任务未改动该逻辑：修复需要设计文档 §3.4 的 `sessionBootId` 决策先落地，否则只能做局部取舍。**建议采纳设计文档推荐方案 1（原生侧合成 sessionBootId）后再改去重键。**

### 7.4 §6 待办状态

- [x] §2～§4 写成可运行用例 —— 落在 `gateway/test/hsp-vectors.test.mjs`（比 §6 原文建议的 `hsp-telemetry.test.mjs` 单独成文件，避免与既有用例混叠）。
- [ ] 原生侧 ArkTS 实现同一组向量 —— 未做，仍待推进；两套实现目前仍无自动一致性护栏。
- [ ] `dayu-direct` 来源取值扩展 —— 未做。当前 `hspSource('dayu-direct')` 按设计抛 `invalid_hsp_transport`，失败路径会得到 `'unknown'`，不再污染为 `serial`。
- [x] §5 差异 1 由 `gateway/hsp-telemetry.mjs` 负责人落地 —— 已由本任务完成，见 7.2。

### 7.5 回归基线（本机，Windows + Node 内置 test runner）

`node --test tests/*.test.mjs gateway/test/*.test.mjs` → **118 项，117 通过，1 跳过，0 失败**。

跳过项是 `gateway/test/hsp-bridge-integration.test.mjs`（离线协议串联）：`tools/read-hsp.ps1` 带 `#requires -Version 7.0`，本机只有 Windows PowerShell 5.1，因此该用例按环境能力跳过而非失败。这是**环境限制，不是代码缺陷**，在装有 PowerShell 7 的机器上必须实跑通过。

## 8. 原生侧落地回执（协调者 Codex，任务 NATIVE-DIRECT-TELEMETRY-20261102）

本节把 Qwen 的 `docs/DAYU200直采原生实现草案.md` 落地为真实 ArkTS 源文件，并建立**不需要 SDK、不需要设备、不需要网络**的可执行断言。上文 §1～§7 不改。

### 8.1 交付物

| 文件 | 字节 | 说明 |
| --- | --- | --- |
| `openharmony/entry/src/main/ets/services/DirectTelemetry.ets` | 11476 | 草案 §2 逐行落地，仅 1 处 ArkTS 适配 |
| `gateway/test/native-direct-vectors.test.mjs` | 20060 | 22 个用例，主机侧驱动真实 .ets |
| `openharmony/entry/src/test/README.md` | 2315 | 主机侧测试说明 |

**关键技术手段**：Node 22 的 ESM 加载器只对 `.ts/.mts/.cts/.js` 做类型剥离，对 `.ets` 报 `ERR_UNKNOWN_FILE_EXTENSION`，`data:` URL 也不剥离。因此测试读 `.ets` 源文本 → 把两条 `@ohos` import 改写成从 `globalThis` 取桩 → 写入临时 `.mts` → `pathToFileURL` 动态 import。**断言的是被测实现的真实代码，不是替身。**

### 8.2 此前的阻塞判断是错的

之前认为"原生侧向量断言必须先恢复 SDK"。实际不成立：向量断言需要的是**能执行代码的运行时**，不是 ArkTS 编译器。SDK 缺失只阻断 HAP 构建，不阻断逻辑验证。这一条同时纠正了草案 §6 待办把"写可运行用例"挂在"SDK 恢复后"的前提。

### 8.3 实测确认的缺陷（比 §5 差异 2 更严重，需优先处理）

1. **`telemetry_stale` 是死代码，且"样本年龄"语义不成立。** `DirectTelemetry.ets:208-209` 的 `receivedAt = startedAt` 与 `age = Date.now() - receivedAt` 相邻，`age` 恒约 0；`:210` 的耗时守卫又把 `age` 上限压到 2999，于是 `:232` 的 `if (age >= TTL_MS)` **永远不可能触发**。即便把守卫移后，`age` 仍只测量"本次请求耗时"，不是"数据实际年龄"。
   - 影响：向量 S-03（`age=10000 → telemetry_stale`）在原生侧不可达。
   - 真正的时效目前只由 `th_sample_age_ms` / `gas_sample_age_ms` 与通道裁剪承担（`:236-239`，严格小于才有效，此段逻辑正确）。
   - **这与 §5 差异 2（`uptime_ms` 判重）是同一类问题的两面：原生侧没有任何跨轮次的"数据年龄"概念。**

2. **板子重启后 `uptime_ms` 恰好相同无法区分。** `:226` 的 `lastUptime === raw.uptime_ms && session === this.sessionBootId` 在真实时钟下退化为"只要 uptime 不变就永远判重复"。回绕（新值更小）能触发新 `sessionBootId`，但**重启后恰好同值不能**。与 §5 差异 2 一致，仍待 `sessionBootId` 决策。

3. **`assertPrivateIpv4` 拒绝 `127.0.0.1`**，本机回环调试不可用。这是设计取舍而非缺陷，但需在接线时知晓：直采端点只放行 10/192.168/172.16-31 三段。另外前导零写法（`01.2.3.4`）被拒，性质上是好事但向量表未覆盖。

4. **`board_sample_too_slow` 用"总耗时"当样本年龄**，与网关 `hsp-http.mjs` 的 T-07 一致，但不是"接收后驻留时间"。要与本次实测一致，不应单独改原生侧。

### 8.4 已验证正确的部分

- 身份→质量→温湿度→ADC 四段顺序与短路，范围检查**只在对应 `*_ok` 为真时执行**（`th_ok=false` / `gas_ok=false` 时越界值必须放行，已断言）；
- 通道裁剪严格小于 10000 才有效，边界 7001+2999=10000 失效、7000+2999=9999 有效已钉死；
- 白色名单实测：嵌入 `wifi_ssid`/`wifi_ip`/`page`/`trend`/`nfc_text` 后 `Snapshot.frame` 恰为 17 键；
- 所有失败路径 `source` 恒为 `'dayu-direct'`，从未出现 `'serial'` 或 `'unknown'`（覆盖 8 类失败 + 未配置）；
- 接受帧的 `reason` 恒为 `'read_only_hardware'`，**不能用"有无 reason"判成败**。

### 8.5 回归基线（更新）

```
node --test gateway/test/native-direct-vectors.test.mjs   => 22 / 22 pass / 0 fail
node --test tests/*.test.mjs gateway/test/*.test.mjs      => 140 tests / 139 pass / 0 fail / 1 skipped
node tools/native-source.mjs => {"sha256":"d2a57e4fc961e98713de2d224cdb36c235f0f30cac77c7b26f4b893f734bdd02","files":43}
```

指纹由 `f90f318b…`（41 文件）变为 `d2a57e4f…`（43 文件），增量 +2 精确对应新增的 2 个 `openharmony/` 文件（`tools/native-source.mjs:7` 只递归 `openharmony/`，`gateway/test/` 不计入）。连续 6 次全量回归均 0 失败。

**偶发失败说明**：子代理首次全量运行出现过 1 fail 且未留下 `not ok` 行，之后 15 次干净，我方再跑 6 次亦干净。判断与 Qwen 在同一时段并发改写 `gateway/` 产品文件（`analysis-history.mjs`、`hsp-telemetry.mjs`、`report.mjs` 写入时间 00:44-00:46）有关——测试进程读文件时文件正被改写。**不掩盖，但也不作为代码缺陷记录**；若复现需在无并发写入条件下定位。

### 8.6 尚未接线

`DirectTelemetry.ets` 目前是**独立可测模块，未接入 `Index.ets`**。草案 §3 的接线清单（新增 `boardAddress`/`localOnly` 配置键、把真实模式采集入口从 `gateway.readHardware()` 换成 `direct.pollOnce()`）尚未执行——它会改动 `Index.ets` 与 `ConnectionSettings.ets`，属独立任务，且需先解决 8.3 第 1 条。
