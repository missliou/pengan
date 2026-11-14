# 交接：NATIVE-DIRECT-TELEMETRY-20261102

- 任务 ID：NATIVE-DIRECT-TELEMETRY-20261102
- 执行者：Codex-lead（DeepSeek Harness Team Lead / 协调者），实现由执行子代理完成
- 日期：2026-11-02
- 汇总状态：**待汇总**（`待办.md`、`进度.md` 由协调者汇总）

## 1. 目标 / 范围

把 Qwen 在 `docs/DAYU200直采原生实现草案.md` 写下的 ArkTS 直采实现落地为真实源文件，并建立原生侧可执行向量断言。草案刻意留在 `docs/` 未进 `openharmony/`，理由是源码指纹会让别人构建出现伪失配——这个顾虑由持有构建的所有权方解除。

范围：只新建文件。**未改任何既有文件**，未改固件，未构建 HAP，未装机，未烧录。

## 2. 交付物

| 文件 | 字节 |
| --- | --- |
| `openharmony/entry/src/main/ets/services/DirectTelemetry.ets` | 11476 |
| `gateway/test/native-direct-vectors.test.mjs` | 20060 |
| `openharmony/entry/src/test/README.md` | 2315 |

## 3. 关键判断：SDK 缺失并不阻断逻辑验证

之前把"原生侧向量断言"挂在"SDK 恢复后"，是错的。向量断言需要的是**能执行代码的运行时**，不是 ArkTS 编译器。

Node 22 的 ESM 加载器只剥离 `.ts/.mts/.cts/.js` 的类型，对 `.ets` 报 `ERR_UNKNOWN_FILE_EXTENSION`。实测可行的路径：读 `.ets` 源文本 → 把 `@ohos.net.http` / `@ohos.util` 两条 import 改写成从 `globalThis` 取桩 → 写入临时 `.mts` → `pathToFileURL` 动态 import。**测的是被测实现的真实代码，不是替身。** 这条路可复用于任何 ArkTS 纯逻辑模块。

## 4. 发现的缺陷（需优先处理）

### 4.1 `telemetry_stale` 是死代码，"样本年龄"语义不成立

`DirectTelemetry.ets:208-209`：

```ts
const receivedAt = startedAt;
const age = Date.now() - receivedAt;
```

两行相邻，`age` 恒约 0。`:210` 的 `if (Date.now() - startedAt >= REQUEST_TIMEOUT_MS)` 又把 `age` 上限压到 2999，于是 `:232` 的 `if (age >= TTL_MS)` **永远不可能触发**。即使把守卫移到后面，`age` 仍只测量"本次请求耗时"，不是"数据实际年龄"。

影响：向量 S-03（`age=10000 → telemetry_stale`）在原生侧不可达。真正时效目前只由 `th_sample_age_ms`/`gas_sample_age_ms` 与通道裁剪承担（`:236-239`，严格小于才有效，**这段逻辑正确**）。

**这与 `uptime_ms` 判重漏洞是同一类问题的两面：原生侧没有任何跨轮次的"数据年龄"概念。**

### 4.2 其余三条

- `uptime_ms` 回绕能触发新 `sessionBootId`，但**重启后恰好同值不能**（`:226`）。同 §5 差异 2，待 `sessionBootId` 决策。
- `assertPrivateIpv4` 拒绝 `127.0.0.1`，本机回环调试不可用；前导零写法被拒（好事，但向量表未覆盖）。
- `board_sample_too_slow` 用总耗时当样本年龄，与网关 T-07 一致，非缺陷。

## 5. 已验证正确

- 四段校验顺序与短路；范围检查**只在 `*_ok` 为真时执行**（`th_ok=false`/`gas_ok=false` 时越界值必须放行）；
- 通道裁剪严格小于 10000 才有效，7001+2999=10000 失效、7000+2999=9999 有效已钉死；
- 白名单实测 17 键，嵌入 `wifi_ssid`/`wifi_ip`/`page`/`trend`/`nfc_text` 后不泄漏；
- 所有失败路径 `source` 恒为 `'dayu-direct'`；
- 接受帧 `reason` 恒为 `'read_only_hardware'`，**不能用"有无 reason"判成败**。

## 6. ArkTS 严格模式适配

只有 1 处：草案的 `if (!Object.keys(keys).includes('coPpm') || ...)` 改为先落 `const keyNames: string[] = Object.keys(keys)` 再 `includes`。语义等价（同组键、同异常）。

## 7. 验证证据

```
node --test gateway/test/native-direct-vectors.test.mjs  => 22 tests / 22 pass / 0 fail
node --test tests/*.test.mjs gateway/test/*.test.mjs     => 140 tests / 139 pass / 0 fail / 1 skipped
node tools/native-source.mjs => {"sha256":"d2a57e4fc961e98713de2d224cdb36c235f0f30cac77c7b26f4b893f734bdd02","files":43}
```

指纹 `f90f318b…`(41) → `d2a57e4f…`(43)，增量 +2 精确对应新增的 2 个 `openharmony/` 文件（`tools/native-source.mjs:7` 只递归 `openharmony/`）。连续 6 次全量回归 0 失败。

**偶发失败说明**：首次全量运行出现 1 fail 且未留 `not ok` 行，之后 15 次干净，我方再跑 6 次亦干净。判断与 Qwen 同时段并发改写 `gateway/` 产品文件（写入时间 00:44-00:46）有关。不掩盖，但也不计为代码缺陷。

## 8. 没做的事

- **未接线**：`DirectTelemetry.ets` 是独立可测模块，**未接入 `Index.ets`**。草案 §3 的接线清单（新增 `boardAddress`/`localOnly` 配置键、采集入口从 `gateway.readHardware()` 换成 `direct.pollOnce()`）会改动 `Index.ets` 与 `ConnectionSettings.ets`，属独立任务，且需先解决 4.1。
- **未启用 `source='dayu-direct'` 进网关白名单**：网关 `hspSource()` 仍只接受 `serial`/`http`。当前两侧不互通，直采数据无法进入网关历史与报告——这是**有意为之**，避免端侧改完无对端可连。
- **未编译 HAP**：SDK 缺 `ets` 组件，客观不能。

## 9. 接口影响

先新建文件，未改既有接口。但接线时会引入：

- `ConnectionSettings` 新增 `boardAddress`（板子 IPv4）与 `localOnly`（布尔）两个键，**不改** `DEFAULT_GATEWAY` 与 `gatewayAddress`。
- `HardwareSnapshot`（`GatewayLink.ets:39`）当前**没有 `source` 与 `reason` 字段**，而直采 `Snapshot` 有。接线的第一步必须先给原生侧补这两个字段，否则网关新增的 `'unknown'` 来源与直采的 `'dayu-direct'` 在原生端都无处承载。
