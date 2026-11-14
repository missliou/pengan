# 交接：QWEN-HSP-SOURCE-SWEEP-20261102（unknown 来源下游全链路排查）

- 任务 ID：QWEN-HSP-SOURCE-SWEEP-20261102
- 执行者：Qwen-3.8
- 日期：2026-11-02
- 汇总状态：**待汇总**（响应 `待办.md` LEAD-GATEWAY-HSP-TELEMETRY-20261102 一节"需全链路排查"的请求）
- 性质：只读排查 + 本报告，未修改任何源码。

## 1. 排查对象

`source`/`transport` 新增合法取值 `unknown` 后，仓库内所有按"是否等于 `http`/`serial`"二分或白名单处理来源的代码位置。检索式覆盖 `source==='http'`、`transport==='http'`、`: 'serial'`、`hspSourceOrUnknown`、`wifi-http`、`serial-http` 等形态，范围为 `gateway/`、`openharmony/`、`tools/`、`tests/`、`firmware/`。

## 2. 逐处结论

| 位置 | 写法 | 是否受影响 | 结论 |
|---|---|---|---|
| `gateway/runtime.mjs:166`（`/api/health`） | `h?.source==='http'?'wifi-http':'serial-http'` | **是，唯一确认的残留点** | `unknown` 会被显示成 `serial-http`。不影响数据正确性（失败快照 `deviceOnline:false`，`hardwareConnected` 如实为 false），但传输标签误导排查者。修改会牵连 `gateway/test/real-ai.test.mjs:17` 对 `serial-http` 的断言，需测试与实现同批改 |
| `gateway/hardware-history.mjs:35-36` | `hspSource(sample.transport)` + `source==='http'?{transport:'http'}:{}` | 否 | 采样写入只发生在 `deviceOnline===true` 的读取成功路径，`transport` 必为可解析的 `serial`/`http`；`hspSource` 抛异常即整条不入历史。Codex"保持不动"的判断经核实成立 |
| `gateway/analysis-history.mjs:20` | `['serial','http','unknown'].includes(...)` | 已适配 | 白名单含 `unknown`，归一化不折叠 |
| `gateway/report.mjs:16` | 同上 | 已适配 | 白名单含 `unknown` |
| `openharmony/**/GatewayLink.ets`、`Index.ets` | 检索未发现按 `source` 二分的显示逻辑 | 否 | 原生端消费的是 `/api/hardware` 快照的字段值与在线标志，不读取 `source` 文本；不受本次影响。直采实现落地时若引入来源显示，需按三值（`serial`/`http`/`unknown`）处理 |
| `tools/`（面板服务、诊断脚本） | 未发现来源二分 | 否 | `panel.js` 相关测试未断言来源文本；`diagnose-pengan.ps1` 只读健康字段，`transport` 仅作透传展示（`serial-http`/`wifi-http` 字面量若出现在旧诊断输出中属历史记录，不是缺陷） |
| `firmware/**` | 不适用 | 否 | 固件无来源标签概念 |
| `tests/`（跨模块） | 未发现 | 否 | — |
| `docs/verification/*/service-check.json` | `"transport": "serial-http"` | 历史记录 | 属 2026-10-31 快照，不修改 |

## 3. 建议处置（供协调者决定，本任务不动手）

`runtime.mjs` 健康接口三选一：
1. `source==='http'?'wifi-http':source==='unknown'?'unknown':'serial-http'`（最小改动，语义如实）；
2. 直接透传 `h?.source ?? 'mqtt'`（信息最全，但改变现有面板字段口径）；
3. 维持现状但在 `待办.md` 注明"离线时 serial-http 仅表示非 wifi，不代表串口在线"（零改动，靠文档兜底）。

同批更新 `real-ai.test.mjs:17` 断言。该文件属网关所有权，按规则由负责人落地。

## 4. 锁与边界

- 本排查为只读，未新建锁；结论写入本报告与我此前拥有的三份文档（向量表 §0/§3/§5、契约设计 §0、草案注释、决策单），Codex 追加的落地回执与共享清单未动。
- 本任务未运行测试、未启动服务、未修改代码。
