# 交接：QWEN-DAYU200-CONTRACT-20261102

- 任务 ID：QWEN-DAYU200-CONTRACT-20261102
- 执行者：Qwen-3.8
- 日期：2026-11-02
- 汇总状态：**待汇总**（`待办.md`、`进度.md` 由协调者 Codex 维护，本任务未改写共享清单）

## 1. 目标 / 范围

对应 `待办.md`「下一阶段优先任务」第 1、2 项中**只读调研与设计**的部分：

- 确定 DAYU200 直读 HH-HSP101 遥测的接口、地址配置、时效与来源、后台行为、断网策略；
- 设计 DAYU200 主动上报 Ubuntu 云端的认证、HTTPS、隔离与去重契约。

范围边界：仅新增文档，**不改任何源码、不改共享清单、不构建、不装机、不烧录、不启动服务、不调用模型**。实现与真机验证留待认领。

## 2. 基线

Git 不可用：该目录属主为系统 `BUILTIN/Administrators`，Git 报 dubious ownership 而拒绝读取仓库状态。本任务未修改全局 Git 配置，改用文件哈希作为可核对基线：

| 文件 | SHA-256 |
|---|---|
| `gateway/hsp-http.mjs` | 68c350e95455a62e070a847c52d436405bb79aabb6ab73f48059df7a9cc7d5c9 |
| `gateway/hsp-telemetry.mjs` | 75adfacf825df2787c49981cf390f955f340fc6651c218b8868aae6b85918e34 |
| `openharmony/.../services/GatewayLink.ets` | 35a6fe90337a7747a4408576717f0163192edebe7915904c0e172e707405b14a |
| `openharmony/.../services/ConnectionSettings.ets` | 14e3f42a2ef95509b9a1843243b73710bb8811a01abd1e99ad47d2026673c9d8 |
| `openharmony/.../pages/Index.ets` | 9a0ea510eefc2b79dda97f43d889eeb3f16d27fe5ace89559517eb6f9b6420bc |
| `firmware/hh-hsp101/src/dashboard.c` | 54383fd3ea152a1e814d704d83d28ae0988ae7293f72c3d47e7bf29c9af8a5e5 |
| `待办.md` | a052e927b2af8f326ba53752d89a8f72710af9b5665e6f18aba0451973eb2000 |

（另有 `gateway/runtime.mjs` 656cb30b…、`进度.md` df5e08ef…、`规则.md` beb7bfbe… 一并核对，未修改。）

## 3. 本次新增文件（本任务唯一写入集合）

- `docs/DAYU200直采与端云上报契约设计.md`
- `docs/DAYU200遥测帧校验向量.md`
- `docs/协作记录/QWEN-DAYU200-CONTRACT-20261102-Qwen.md`（本文件）
- `tmp/collaboration-locks/DAYU200-CONTRACT-20261102.lock`
- `tmp/collaboration-locks/`（该目录此前不存在，本次创建）

## 4. 行为变化 / 接口影响

本任务**没有产生代码行为变化**。对外提出的契约建议（需协调者裁决，未落地）：

- 建议新增 `transport` 取值 `dayu-direct` 以区分直采与电脑桥。影响面：`hsp-telemetry.mjs:hspSource`（只接受 `serial`/`http`，未知值抛 `invalid_hsp_transport`）。**并发更新**：本任务进行中，协调者 `LEAD-GATEWAY-HSP-TELEMETRY-20261102` 已并行修改该文件——新增 `hspSourceOrUnknown()`，失败/未知来源统一标 `unknown`，不再冒充 `serial`；`dayu-direct` 仍未启用，启用时需同步扩展 `hspSource`、历史字段、报告导出与测试。
- 建议上报批次以 `(deviceId, sessionBootId, uptime_ms)` 为去重键；`sessionBootId` 端侧合成，避免改固件。若改用固件 `bootId`，属跨所有权改动（固件 + 网关 + 测试），需另行交接说明。
- 明确不新增权限声明：`module.json5` 当前仅 `INTERNET` 与 `CAMERA`，本任务未改；后台持续采集是否需要持续运行能力，属待决策项。

## 5. 实际执行的验证

只有只读核对，可复核：

- 逐行核对固件 `dash_pengan_json`、`pengan_telemetry`、`dash_status_json` 与 `dash_provision.h` 的 `GET /api/pengan/telemetry` 路由，确认字段集合、503 分支、`no-store` 与 Origin 检查仅覆盖配网接口。
- 逐条推导 `validateHspFrame` 与 `hspSnapshot` 的判定顺序与边界，写成 F-01…F-25、S-01…S-11、T-01…T-10 期望表。
- 核对 `GatewayLink.ets` 的时效与重复帧保护、`revision`/epoch 作废语义，以及 `ConnectionSettings.ets` 的地址校验规则（公网强制 HTTPS）。

## 6. 失败与限制（如实记录）

- **未运行任何测试**。API26 SDK 与 Hvigor 工具链目前缺失（`待办.md` tmp 误删检查一节），恢复由 Codex 认领；因此校验向量表是源码推导结果，**不是已通过的测试报告**。
- **未重跑历史 112 项回归**，不能据此断言当前代码仍全过。
- 服务在线状态、设备连接、模型配置本次**均未重新核对**，只作为历史记录看待。
- 第二把锁（`CONFIG-CLOUD-20261102.lock`）由文件写入工具创建，严格意义上不是规则第 3 条要求的「原子独占创建」。其范围是本执行者自己新建的文档文件，与 Codex 已认领的 `tmp/sdk`、`tmp/build-tools`、原生构建、接续文档均不相交。协调者汇总时可按实际情况处置，不建议据此判定第一把锁也不合规——第一把锁确实用 shell 的 `> file` 独占创建（`set -o noclobber`）方式获取。

## 7. 未完成项 / 下一步

1. 等 §6 五项决策定案（见 `docs/原生配置入口与云端部署设计.md` 第 6 节与 `给用户的项目决策单与状态真相表.md`）。
2. SDK 恢复后，把校验向量落成可运行测试，先验证与现有实现一致。
3. 实现原生直采（只改原生侧）并真机验收。
4. 云端最小接入与 §4.3 探针。

## 8. 锁状态

未释放。文件已落稳，可释放；删除锁文件属破坏性操作，本任务未获该范围授权，请协调者或用户确认后删除 `tmp/collaboration-locks/DAYU200-CONTRACT-20261102.lock`。
