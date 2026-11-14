# 交接：LEAD-GATEWAY-HSP-TELEMETRY-20261102

- 任务 ID：LEAD-GATEWAY-HSP-TELEMETRY-20261102
- 执行者：Codex-lead（DeepSeek Harness Team Lead / 协调者）
- 日期：2026-11-02
- 汇总状态：**待汇总**（`待办.md`、`进度.md` 由协调者汇总，本文只提交本任务交接）

## 1. 目标 / 范围

承接 Qwen 的 `QWEN-DAYU200-CONTRACT-20261102`：把 `docs/DAYU200遥测帧校验向量.md` 里"标注未实际运行"的期望值变成可执行断言，并修复该文档 §5 差异 1 指出的来源错标缺陷。

范围边界：**只改网关（`gateway/`）与测试**。不改固件，不改原生 ArkTS（`openharmony/**` 本轮只读），不改共享清单，不构建 HAP、不装机、不烧录、不启动服务、不调用模型。

## 2. 基线（改动前 SHA-256）

| 文件 | 改动前 | 改动后 |
|---|---|---|
| `gateway/hsp-telemetry.mjs` | 75adfacf825df2787c49981cf390f955f340fc6651c218b8868aae6b85918e34 | 24529919b002a7dc0acdabbad7eb7f2ba4020753d44a52678d026b08aab786a3 |
| `gateway/hsp-http.mjs` | 68c350e95455a62e070a847c52d436405bb79aabb6ab73f48059df7a9cc7d5c9 | 未改（哈希相同） |
| `gateway/analysis-history.mjs` | 68422d40b6659d95bbf50556504b4dcd10025921eae9de04e51f743ec96bd4bc | 3bdf69f95093a6930f869ac290d811fcf1f79406ae7e75f39e08377c220c00bb |
| `gateway/report.mjs` | 684adcc9f31153369de466fd850140d24d02e0c3e2c43efe000fcccd501c282f | 413809f9a40aa7bafc857c3d9d7f53b12ab5425566685404fea8129b6774f32e |
| `gateway/hardware-history.mjs` | 80cb399b2e3e9bd832fe518c770d5a5b27bffafc21f7393db1f9452c0f73a253 | 未改（哈希相同） |
| `gateway/runtime.mjs` | 656cb30bd7d1f14dee274bf4e08833a5f896b3723933444621f81243174dc941 | 未改（哈希相同） |
| `gateway/test/hsp-vectors.test.mjs` | 不存在 | 新增，addc852642bed60ae0a1e08292a3045226c95d69df5a0a191ec22dc8c3b8926e |
| `gateway/test/hsp-bridge-integration.test.mjs` | — | ff15f78d8684e64704af4ff4e753b4a941c44364346c7650c9d7d9666fe3b24c |
| `docs/DAYU200遥测帧校验向量.md` | — | a44b075a2f7f5b87d2afd660ddb9becbcdb03642e2aed668b4a6a3aa02544409（仅追加 §7） |

## 3. 完成的三件事

### 3.1 §5 差异 1：失败路径来源错标（已修复）

`gateway/hsp-telemetry.mjs` 新增：

```js
export function hspSourceOrUnknown(transport){if(transport===undefined)return 'unknown';try{return hspSource(transport);}catch{return 'unknown';}}
```

`hspSnapshot` 与 `readHspTelemetry` 的失败分支全部改用它。可确证的 `http` 帧超时后仍标 `'http'`；非法 transport（`'ble'`、未来的 `'dayu-direct'`）与损坏样本标 `'unknown'`，不再冒充串口。

**实现坑（留给后续维护者）**：第一版写成 `try{return hspSource(t)}catch{...}` 是错的——`hspSource(undefined)` 属于正常返回 `'serial'` 而不是抛异常。`undefined` 必须显式先判。

### 3.2 连锁缺陷（由 3.1 暴露，已一并修复）

新的 `'unknown'` 来源一旦进入真实链路就会被判非法：`gateway/analysis-history.mjs` 与 `gateway/report.mjs` 的快照清洗白名单只认 `['serial','http']`，抛 `invalid_observation_source`；而 `gateway/runtime.mjs:210` 的裸 `catch` 把任何持久化异常压成 `analysis_history_write_failed`。

**用户可见症状**：真实采集离线时，AI 分析照常返回，但静默不落盘。三个既有测试因此红（`analysis-history.test.mjs:51`、`analysis-memory.test.mjs`、`report.test.mjs`）。

修复：两处白名单扩为 `['serial','http','unknown']`，且快照归一化改为 `['serial','http','unknown'].includes(input.source)?input.source:'serial'`，不再把 `'unknown'` 折叠回 `'serial'`。

`gateway/hardware-history.mjs` 的采样白名单**保持不动**：采样记录只在读取成功时写入，来源必为可确证的 `serial`/`http`，不属于本条。

### 3.3 向量固化为可执行断言（新增 `gateway/test/hsp-vectors.test.mjs`，6 个用例）

- F-01～F-25 表驱动，逐条断言 `validateHspFrame` 的通过/拒绝原因；
- S-01～S-09 通道年龄叠加（`climateAgeMs` 10799/9900/10100、`gasAgeMs` 9050）；
- S-10 非法 transport 断言 `source==='unknown'`，且 `hspSource('ble')`/`hspSource('dayu-direct')` 抛 `invalid_hsp_transport`；
- T-01～T-05 白名单 17 键、残值置空、重复帧不刷新、失败不覆盖；
- 文件读取：缺文件 `hardware_not_connected`、损坏文件 `hardware_read_failed` + `'unknown'`；
- 端到端：`'unknown'` 来源可落盘到分析历史并可生成报告，标签不被改写。

### 3.4 测试环境脆性（已修）

`gateway/test/hsp-bridge-integration.test.mjs` 原硬编码 `'pwsh.exe'`，本机无 PowerShell 7 时整条读板链路测试红。改为 `pwshAvailable()` 探测（先查 `%ProgramFiles%\PowerShell\7\pwsh.exe`，再遍历 `PATH`），不可用时带明确文案 `skip`。

**这不是把红改绿**：`tools/read-hsp.ps1` 首行带 `#requires -Version 7.0`，PowerShell 5.1 会直接报 `ScriptRequiresUnmatchedPSVersion`，因此 PS7 是硬要求，5.1 无法替代。该用例在装有 PS7 的机器上必须实跑通过。

## 4. 没做的事（诚实标注）

- **§5 差异 2 未修**：`gateway/hsp-http.mjs` 仍以 `raw.uptime_ms===this.lastUptime` 判重。板子重启后 `uptime_ms` 归零，会把真实新数据误判为重复。修复需要设计文档 §3.4 的 `sessionBootId` 决策先落地，否则只能做局部取舍。**建议先采纳推荐方案 1（原生侧合成 sessionBootId）再改去重键。**
- **原生 ArkTS 侧未同步**：`openharmony/entry/src/main/ets/**` 的校验/时效实现没有对应向量断言，两套实现仍无自动一致性护栏。
- **未启用 `dayu-direct` 来源取值**：仍按设计抛 `invalid_hsp_transport`，失败路径得到 `'unknown'`，不再污染为 `serial`。是否启用需协调者最终确认。
- **无真机验证**：本机没有 DAYU200 与 HH-HSP101，全部结论基于内置 test runner 的离线用例。

## 5. 验证证据

```
node --test tests/*.test.mjs gateway/test/*.test.mjs
# tests 118 / pass 117 / fail 0 / skipped 1
```

对比基线：改动前 112 项（111 通过、1 失败），改动后 118 项（117 通过、1 跳过、0 失败）。新增 6 项来自 `hsp-vectors.test.mjs`；原本失败的 `hsp-bridge-integration` 由"环境缺失导致失败"改为"环境缺失明确跳过"。

## 6. 接口影响

- 观测快照的 `source` 字段新增合法取值 `'unknown'`。任何下游（网页面板、报告、原生端）若按 `source==='http'?'http':'serial'` 二分处理，会把 `'unknown'` 误读为 `'serial'`——**这是需要全链路排查的兼容点**。
- `hspSourceOrUnknown` 为新导出函数，`hspSource` 语义未变。
- 无 API 路由、无数据结构字段增删。
