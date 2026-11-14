# 交接：QWEN-ADMIN-UI-SESSION-20261102（设备管理页真实数据接线）

- 任务 ID：QWEN-ADMIN-UI-SESSION-20261102
- 执行者：Qwen-3.8
- 日期：2026-11-02
- 汇总状态：**待汇总**（共享待办/进度由协调者维护，本任务未改写）
- 锁：`tmp/collaboration-locks/ADMIN-UI-SESSION-20261102.lock`，范围仅 `admin-ui/`

## 1. 任务来源与范围

用户要求"遍历全部代码，看还能做什么，然后开始制作"。我完整遍历后确认：

- `待办.md` 下一阶段优先任务第 3 项"管理员真实登录、admin/viewer 权限、CSRF/Origin、审计"**后端已由 Codex 实现**（`gateway/cloud-server.mjs`、`gateway/cloud-security.mjs`）。
- 前端 `admin-ui/` 的登录门、会话恢复、CSRF、设备选择器也**已由 Codex 在 ADMIN-UI-FIX 中实现**，我原以为的缺口不存在（如实记录，未重复开发）。
- **真实缺口**：后端 `GET /admin-api/devices` 每台设备都返回完整实时快照（`hardware.deviceOnline/source/receivedAt/sampleAgeMs/values/quality/reason/uptimeMs/climateAgeMs/gasAgeMs`），而前端 `devices.js` **只渲染了 `gatewayId` 一个字段**，其余真实数据全部丢弃。这正对应需求第 4 项"设备管理与诊断"。

范围严格限定 `admin-ui/`。未改 `openharmony/`、固件、`gateway/` 业务代码与既有测试、SDK、他人持锁文件、共享待办/进度/发布清单。

## 2. 基线

- Node.js v22.23.2（Windows 本机）
- 接手时 `npm test` = **50 项全通过**（`admin-ui/test/` 五个文件）
- `admin-ui/dist` 为 Codex ADMIN-UI-FIX 后的产物
- 后端真实接口（只读核对，未修改）：
  - `GET /admin-api/devices` → `{items:[{schemaVersion,gatewayId,mode,simulated,hardware}]}`
  - `GET /api/observations?gatewayId=` / `GET /api/health` / `GET /admin-api/audit`
  - `POST /admin-api/session/login` → `{authenticated,user:{username,role},csrfToken}` + HttpOnly cookie
  - `GET /admin-api/session` → 同结构（**含 csrfToken**，故前端刷新不掉线的强校验成立）

## 3. 修改文件

```
admin-ui/src/pages/devices.js     重写：渲染后端真实完整快照 + 诊断面板 + 本地时效
admin-ui/styles.css               新增 .device-grid/.table-scroll 桌面样式（宽表溢出修复）
admin-ui/test/devices.test.mjs    新增：10 项设备页回归
admin-ui/dist/**                  重建（源码与产物 SHA256 一致）
docs/管理平台后端API缺口.md        更新：标注已实现项与新发现的准入码语义问题
docs/协作记录/QWEN-ADMIN-UI-SESSION-20261102-Qwen.md  本文件
```

未修改：`admin-ui/src/lib/*`、`admin-ui/src/app.js`、其他页面、`gateway/**`、Codex 的既有测试文件。

## 4. 已实现功能

设备管理页现在渲染服务端真实返回的全部字段：

| 区域 | 内容 |
|---|---|
| 已登记设备表 | gatewayId、采集板 deviceId、在线状态、来源（四值映射）、最后接收、样本年龄、温度、湿度、气体 ADC、状态原因；行可点击切换当前设备 |
| 当前设备诊断 | 运行时长、温湿度通道年龄、气体通道年龄、温度、湿度、气体 ADC+mV、状态原因；随 `watchHardware` 每 2s 轮询 + 500ms 本地老化 |
| 能力边界 | 执行器未接入、CO/CO₂ 未接入、气体为 MQ-2 ADC 原始值不换算浓度、令牌由部署登记、远程诊断不在网页范围 |
| 失败分类 | offline（后端未连接）/ forbidden（会话失效）/ parse（响应无效）/ not_implemented 分别给出不同提示，均不显示推测数据 |
| 演示模式 | 不读取真实登记、不编造设备数量、刷新按钮禁用 |

## 5. 本轮发现并修复的真实缺陷

1. **设备列表与详情面板时效口径不一致**（测试暴露）
   详情面板经 `LiveObservations` 本地老化后显示"离线/过期"，但设备列表只在 5s 网络刷新时取快照，中间 4.5s 仍显示"在线 + 旧读数"。设备已静默却显示在线属误导。
   修复：引入 `isLocallyStale()` 按后端 `HSP_TTL_MS=10000` 判本地时效，过期行读数转无效、原因转"遥测过期"；并挂在既有 500ms 节拍上用缓存数据重绘（`recheckStaleness()`），**不新增网络请求**。

2. **详情读取失败时列表失去老化节拍**（同类缺陷的另一分支）
   `obsError` 分支提前 return 未挂载 `watchHardware`，列表会永久冻结在最后一次快照。
   修复：该分支单独起一个 500ms 定时器做本地老化，由 `scope.onDispose` 统一清理。已补专项回归测试。

3. **单位字符串双空格**：`fmtValue` 自身在数值与单位间补空格，我误传前导空格导致 `25.6  ℃`。已修。

4. **误用 CSS 类**：`.grid` 在本项目样式表是 `display:grid` 布局类，用在 `<table>` 上会破坏表格排版。已改为新增 `.device-grid`。

5. **`.table-scroll` 仅在移动端媒体查询中定义**：10 列设备表在桌面会溢出卡片。已提升为全局样式。

6. **`admission` 字段语义可疑（后端问题，未擅自改）**：`gateway/hsp-telemetry.mjs:29` 在线帧由 `unknown()` 展开且**未覆盖 `admission`**，导致健康在线设备的 `admission` 恒为 `unknown_denied`。把它当状态展示会误导用户以为数据被拒。
   前端处理：**移除该字段渲染**，改由 `reason` 与能力边界卡如实表达。已在缺口文档登记，交后端负责人判断该字段是否应删除或赋予真实语义。

## 6. 实际验证结果

### 6.1 前端单元测试（本机实际执行）

```
npm test → tests 60 / pass 60 / fail 0 / skipped 0
node --test test/devices.test.mjs → tests 10 / pass 10 / fail 0
```

新增 10 项覆盖：真实快照字段渲染与设备计数、null 读数与无效质量位不补 0、CO/CO₂ 未接入且气体保持 ADC 原始值、诊断面板逐通道年龄与新鲜/过期切换、空登记的显式空状态、四类失败分别提示、演示模式零真实调用、点击行切换 gatewayId 与守卫、列表刷新节流与卸载停止、**详情失败时列表仍本地老化**。

接手基线 50 项全部保留通过，零回归。

### 6.2 真实云端后端契约验证（本机实际执行，30 项全通过）

用 `gateway/cloud-server.mjs` 起一次性回环实例（随机凭据、临时数据目录、进程退出即删），逐项核对我设备页依赖的字段路径：

- 登录/会话恢复返回 `authenticated` + `user.role` + `csrfToken`（前端 `rememberSession()` 强校验字段全部成立）
- 设备上传真实遥测帧被接受（`accepted:true`）
- `/admin-api/devices` 的 `hardware.deviceId/deviceOnline/source/receivedAt/sampleAgeMs/values.temperatureC=25.6/values.humidityPct=48.2/values.gasRaw=812/quality.temperatureValid/reason/uptimeMs/climateAgeMs/gasAgeMs/controlSupported` **全部与前端渲染路径一致**
- CO/CO₂ 恒为 `null` 且质量位 `false`
- `/api/observations` 的 `mode/simulated/actuationAvailable` 满足前端 `validateObservations()` 要求
- 单设备时省略 `gatewayId` 返回 200
- `/admin-api/audit` 记录 `login_success`
- 越权保护：无会话访问设备列表 **401**；错误 CSRF 写配置 **403**

### 6.3 构建

`node build.mjs` 成功；`src/pages/devices.js` 与 `dist/src/pages/devices.js` SHA256 一致（`465fa494…`）。`styles.css` 与 `dist/styles.css` 均含 7 处 `device-grid`，产物同步。

### 6.3.1 收尾最终复跑（清理后）

```
npm test        → tests 60 / pass 60 / fail 0 / skipped 0
node build.mjs  → build OK
src↔dist        → devices.js 465fa49400db 一致
```

一次性验证脚本（`verify-cloud-contract.mjs`、`shot-server.mjs`）与两个临时数据目录（`%TEMP%\pengan-shot-*`，仅含本任务生成的合成遥测/审计/ingress 状态，无用户数据）均已删除；两个回环验证进程已停止。项目 `admin-ui/screenshots/` 仅保留上一轮 5 张有效截图，下载失败的错误 XML 未混入。

### 6.4 浏览器实拍（第一轮成功，第二轮未完成）

**第一轮（已完成）**：用一次性回环云端后端（真实登录 + dayu-a 上传真实帧 + dayu-b 未上传）实拍三个页面，浏览器 agent 逐项确认：

| 页面 | 渲染 | 红色报错横幅 | null 文本 |
|---|---|---|---|
| 运行总览 | 正常 | 无（仅设备状态标签为红色"离线/过期"，属业务状态） | 无 |
| 设备管理 | 正常，表格含 dayu-a / dayu-b 两台 | 无 | 无 |
| 系统与审计 | 正常，审计列表含 `login_success`，服务健康 `ok` | 无 | 无 |

缺失/无效数据均以中文"未知""未接入""无效"呈现，无字面量 `null`。这验证了登录链路、设备表格渲染、审计页与前端 `format.js` 的缺值口径在**真实后端数据**下工作正常。

**截图文件未留存（如实声明）**：浏览器 agent 返回的 CDN 链接在下载时已失效（`NoSuchKey`），三个 480 字节文件实为错误 XML，已删除，未混入交付。

**第二轮（未完成）**：第一轮实拍时 dayu-a 的帧已超过 10s TTL，表格显示"离线/过期"而非在线读数——这恰好验证了本轮新增的本地时效逻辑生效，但未能展示在线态。为此改造验证环境为每 3 秒持续上传新鲜帧后重拍，该轮浏览器 agent 触发 `takeover_type=login` 人工登录接管并在 40 步耗尽，未取得截图。**未叫醒用户做人工登录**：这是本地一次性验证环境，人工登录无意义，且截图仅为辅助证据。

**因此**：设备表格"在线 + 25.6℃/48.2%/ADC 812"的视觉证据**未取得**。该状态已由 `test/devices.test.mjs` 前 4 项与 §6.2 的真实后端契约验证（30 项）覆盖，但**没有浏览器布局证据**。

### 6.5 未实测项（如实声明）

- **Ubuntu 部署未实测**：无云环境。README 的 nginx 反代配置未验证。
- **真实 DAYU200 硬件未验收**：验证用的遥测帧由脚本构造，非实物板采集。
- **真实模型未调用**：未配置任何密钥，`/api/agent/test` 未测。
- **HTTPS/TLS 未测**：验证走回环 HTTP（`publicOrigin=http://127.0.0.1`），`__Host-` cookie 前缀与 `Secure` 分支未覆盖。
- 浏览器截图是布局证据，不构成功能验收。

## 7. 后端接口缺口（更新）

`docs/管理平台后端API缺口.md` 已更新。本轮变化：

- 原列缺口 1（管理会话鉴权）、3（设备列表）、6（审计事件）**已由 Codex 实现**，标记为已完成。
- 仍然缺：服务端条件查询/导出（前端仍是客户端窗口分页）、AI 任务独立审计流、实时推送 SSE。
- **新增登记**：`admission` 字段语义问题（见 §5.6），建议后端明确其语义或删除。
- 遗留（非本轮范围）：`gateway/runtime.mjs:166` health 接口 transport 二分把 `unknown` 显示为 `serial-http`，已在 `QWEN-HSP-SOURCE-SWEEP-20261102` 登记。

## 8. 已知问题

- 设备列表 5s 刷新一次、本地老化 500ms 重算；设备数量很大（后端上限 100 台）时表格较长，暂未做分页——服务端条件查询就绪后应一并处理。
- 点击行切换设备走外壳 `navigate('devices')` 整页重渲染，会重新拉取列表与观测；设备多时有可感知的重载。可后续优化为只切换 `gatewayId` 局部刷新。
- 测试夹具中的时间戳为固定小值（1970 年），依赖 mock 的 `Date.now`；这是既有 `pages.test.mjs` 的同款做法，非新引入。

## 9. 下一步建议

1. 后端确认 `admission` 字段语义（删除或赋予真实含义）。
2. 服务端条件查询/导出接口就绪后，把 `records.js` 与设备列表切换为请求驱动分页。
3. 有 Ubuntu 环境后按 README 实测 nginx 反代 + HTTPS + `__Host-` cookie。
4. 接真实 DAYU200 后复验设备表在线/离线/时效切换与多设备隔离。
5. 请 Codex 复核本轮 `devices.js` 与 `styles.css` 改动。

## 10. 锁状态

`tmp/collaboration-locks/ADMIN-UI-SESSION-20261102.lock` 文件落稳后标记 RELEASED，可安全删除。
