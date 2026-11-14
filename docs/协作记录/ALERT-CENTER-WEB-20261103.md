# 告警中心 Web 管理端交接（ALERT-CENTER-WEB-20261103）

- 任务ID：ALERT-CENTER-20261103（子任务 ALERT-CENTER-WEB-20261103）
- 执行者：alert-web（Team Lead 派发的 Web 管理端执行者）
- 锁：tmp/collaboration-locks/ALERT-CENTER-WEB-20261103.lock（独占，已 RELEASED，文件保留）
- 权威依据：docs/告警中心接口契约.md（只读，未修改）。本页实现对齐其第 5 节接口与第 6 节 Web 交互契约。
- 范围：仅 admin-ui 前端页面、导航注册、接口封装、样式、测试与 dist 重建。**未改 gateway/、openharmony/、firmware/、待办.md、进度.md、契约文档**。

---

## 1. 基线（本次改动前实测）

项目工作区无 git 基线，按文件 SHA256 核对。基线测量时间＝本任务开工前，测试基线＝同一时刻的 `cd admin-ui; npm test`。

| 被改文件 | 基线 SHA256 | 基线行数 |
| --- | --- | --- |
| admin-ui/src/app.js | `0ED08A8A3FE651AE84E8834938AD73DBCC5CE1E4F807DA145087FE9EBD73F65B` | 322 |
| admin-ui/src/lib/api.js | `9034E34B6CAE2D89C83CA3D12E759ADDE8A777DA51287CB94FF08E08BF083D66` | 195 |
| admin-ui/src/lib/data-source.js | `9291A46DE5CD78F1E9A5691DDFCED1FEDB8114C068A1F3C0497EBD79B6835B31` | 47 |
| admin-ui/styles.css | `B4367A8AB8A50E87297A0C2EB2EB04896519BB15BC9D1B65FD77E19AFC3089CB` | 463 |
| admin-ui/src/pages/alerts.js | 基线不存在（新建） | — |
| admin-ui/test/alerts.test.mjs | 基线不存在（新建） | — |
| admin-ui/dist/** | 基线为旧构建产物，已整体重建 | — |

测试基线原始计数：

```
# tests 88
# pass 88
# fail 0
# cancelled 0
# skipped 0
```

> 行数口径说明：表内基线行数用 `(Get-Content).Count`（PowerShell 5.1 默认编码）。该口径对含中文的文件会低估真实行数，因此**"本次变动"一律用同一口径的前后差**给出；新文件用换行符计数（`wc -l` 等价）。

---

## 2. 修改文件与行数

| 文件 | 现状 | 本次变动 | 当前 SHA256 |
| --- | --- | --- | --- |
| admin-ui/src/pages/alerts.js | 新建，595 行 | 新建 595 行 | `3F3C2C5E7D965BA68DD5796A31BF71F7EDE5AE21E4273E5FB38A43E3415A6FED` |
| admin-ui/test/alerts.test.mjs | 新建，473 行（19 个 test） | 新建 473 行 | `EC3624179E8582034B2D92CF2CCE1559A3019F64A4D0C52E7098A6006255A23E` |
| admin-ui/src/app.js | 344 行 | +22 行 | `BBCE93530F2B59AD2C7A1E61705E0319AB8CCC4F9D22ECEAA9A766735FDAF789` |
| admin-ui/src/lib/api.js | 225 行 | +30 行 | `CFC68329881DCB85C7C01044C015A5C2F3F69EFAF442C5C17843F4043C6B2E4F` |
| admin-ui/src/lib/data-source.js | 53 行 | +6 行 | `468CA8A8836CBF2EDB2D1F2B68F47A2C684E27C8C0E606A9B9C0EC339F113153` |
| admin-ui/styles.css | 510 行 | +45 行 | `897971855A815771F87835BE4203D3BF059D314EDE5943F34141919BA63FF777` |
| admin-ui/dist/** | 全量重建（25 个 src 文件 + index.html + styles.css + env.js） | 重建 | 见第 5 节 |

除上表外，未新增/修改任何其它文件。

---

## 3. 接口与交互变化

### 3.1 admin-ui/src/lib/api.js（+30 行，纯新增，无改动既有函数）

| 函数 | 方法/路径 | 说明 |
| --- | --- | --- |
| `listAlerts({ type, severity, status, cursor, limit = 20 }, options)` | `GET /admin-api/alerts` | 空值筛选不参与拼接；`limit` 始终显式带上；`maxBytes: 262144`；沿用既有网关参数与超时策略（读 9000ms）。 |
| `readAlert(alertId, options)` | `GET /admin-api/alerts/{alertId}` | 单条完整记录。 |
| `acknowledgeAlert({ alertId, expectedRevision, note }, options)` | `POST /admin-api/alerts/{alertId}/ack` | body 只含 `expectedRevision`，`note` 非空才附加；`timeoutMs: 15000`。 |
| `noteAlert({ alertId, expectedRevision, text }, options)` | `POST /admin-api/alerts/{alertId}/note` | body 含 `expectedRevision` 与 `text`。 |

错误沿用既有 `ApiError`（`kind: offline/http/parse/forbidden/stale/timeout/not_implemented` + `status` + `code`），未新增错误类型；契约第 5.4 节的错误码在页面侧按 `code` 映射成可读文案。

### 3.2 admin-ui/src/lib/data-source.js（+6 行）

```
source.listAlerts = (params) => read('listAlerts', [params]);
source.readAlert = (alertId) => read('readAlert', [alertId]);
source.acknowledgeAlert = (body) => write(() => api.acknowledgeAlert(body, { gatewayId }));
source.noteAlert = (body) => write(() => api.noteAlert(body, { gatewayId }));
```

读写分离沿用既有通道：读走 `read()`（演示模式无样例即 `demo_read_only`，结束 `scope.assertActive()`），写走 `write()`（viewer 先被拒为 `forbidden`，再受 `MutationGate` 防重入）。

### 3.3 admin-ui/src/app.js（+22 行）

- 新增导航项 `{ id: 'alerts', title: '告警中心', sec: '监控', badge: 'alerts', render: renderAlerts }`，位于「人工审核」之后；`renderShell` 的徽标槽位由写死 review 改为按 `p.badge` 生成，review 条目补 `badge: 'review'`，既有 `signal`（侧栏指示灯）路径一字未改。
- `state.alertPending`（`null`=未知）：新值只来自 `probeAlertPending()` 里的 `alertPendingTotal(data.counts)`，即 `counts.open + counts.acknowledged`；读不到一律 `null`（徽标隐藏），**从不拿 `items.length` 冒充总数**。
- `probeAlertPending()` 在 `contextRevision` 守卫下运行，迟到响应不写状态；演示模式 / 未登录 / 无设备直接置 `null`。
- 触发点：进入会话、设备切换、健康探测成功（顶栏 10s 探测）、离线与 `visibilitychange`（清空旧数字）。
- `markNavDots()` 徽标选择器改为 `.nav-badge[data-badge]`，`alerts` 分支调用页面导出的 `applyAlertBadge`，与页面共用同一条渲染路径（口径只有一处实现）。

### 3.4 admin-ui/src/pages/alerts.js（新建，595 行）

结构（自上而下）：提示条 → `.alert-live`（统计卡 + 列表卡，轮询只替换这里）→ 详情容器 → 确认与处理备注卡 → 页面级反馈区。

- `canWrite = !demoMode && state.user.role === 'admin'`：viewer 与演示模式下确认/备注按钮与输入框全部 disabled。
- 提交：`busy` 单飞 + `finally` 复位，`expectedRevision` 取当前详情 `revision`；成功用回执 `receipt.alert` 就地重绘详情并静默刷新列表；失败文案含「提交未确认」且不清空输入；409 / `alert_revision_conflict` 额外提供「重新读取详情」按钮（真的重读，不是只改文案）。
- 轮询 `POLL_MS = 15_000`：只调 `listAlerts`（沿用当前筛选与游标），替换统计与列表容器并给 `.alert-live` 加 `.alert-polling`（CSS 关掉入场动画）；详情不参与轮询；`document.hidden` 时跳过。
- 清理：`scope.onDispose` 里 `loadGeneration++ / detailGeneration++ / clearInterval`；`load`、`openDetail` 均按 generation + 选中 id 双校验丢弃迟到响应。
- 空态与未连接分开：`暂无告警（未虚构）`（明确"空列表只表示服务端没返回数据，不代表设备一定正常"）vs `未连接` / `后端未连接`；未连接时统计网格**整体不渲染数字**。
- 演示模式：页面自带 2 条样例（`alert_demo_offline` / `alert_demo_collect`），带「样例」徽标与 `sample: true`，且在任何事件绑定之前 return，**不发起任何 dataSource 调用**。

### 3.5 admin-ui/styles.css（+45 行）

新增 `.alert-page/.alert-live/.alert-stats/.alert-stats-grid/.alert-list/.alert-row(.is-active)/.alert-row-meta/.alert-timeline/.alert-note-head/.alert-note-body/#alert-note` 与 `.alert-live.alert-polling` 关闭动画规则；`.alert-row` 参照既有 `.review-row` 写法，颜色全部走既有 CSS 变量，深色主题自动继承（未新增媒体查询块以外的变量）。

---

## 4. 契约第 6 节逐条落实与测试对应

| 契约条目 | 实现位置 | 对应测试（admin-ui/test/alerts.test.mjs） |
| --- | --- | --- |
| ① 导航「告警中心」+ 未处理数徽标（open+acknowledged），切设备刷新 | app.js 导航注册 / `probeAlertPending` / `applyAlertBadge` | `未处理数=open+acknowledged，缺项即未知，0 与未知都隐藏徽标`；`app.js 注册「告警中心」导航，徽标与页面共用 applyAlertBadge，不动既有信号灯口径` |
| ② 统计 all/open/acknowledged/recovered + 分严重程度，口径取 countBasis，未连接不显示 0 | `paintStats()` | `统计区展示四项计数与 countBasis 原文，并给出分严重程度`；`设备未连接显示「未连接」，不拿 0 冒充正常` |
| ③ 类型/严重程度/状态筛选 + 游标分页 + 每项字段 + 空态 | `paintList()` / 筛选 toolbar / `nextCursor` | `列表项显示设备、类型、最近发生时间与状态徽标，末页禁用「下一页」`；`游标分页优先用服务端 nextCursor，到末页禁用并可返回首屏`；`类型/严重程度/状态筛选重置游标并透传…`；`空列表显示「暂无告警」明确空态，不虚构任何记录` |
| ④ 详情 basis/occurrences/firstAt/lastAt/recoveredAt/恢复情况/确认记录/备注时间轴 | `paintDetail()` | `详情展示 basis、occurrences、firstAt/lastAt/recoveredAt、恢复情况、确认记录与备注时间轴`；`已恢复缺 recoveredAt 时如实说未给出，不补造恢复时间` |
| ⑤ admin 可写 / viewer 只读 / 提交中禁用 / 失败「未确认」保留输入 / 409 重读 | `submit()` / `syncSubmitState()` | `viewer 只读——确认/备注禁用且不发送任何写请求`；`admin 确认携带 expectedRevision，提交中禁用防重复，成功后不重建备注输入框`；`admin 备注提交携带文本与 expectedRevision，成功后清空输入`；`提交失败显示「未确认」并保留已填写的备注`；`版本冲突 409 提示已被他人更新，并可重新读取详情` |
| ⑥ 15s 轮询只换统计与列表、不重建输入框、清理定时器与 AbortController、迟到响应按 generation 丢弃 | `poll()` / `replace(host, nodes, silent)` / `scope.onDispose` | `15s 轮询只替换统计与列表容器，不重建详情输入框、不重放入场动画`；`页面卸载清理定时器，迟到响应按 generation 丢弃` |
| ⑦ 演示模式跟随站点开关、样例带「样例」、写操作禁用且不调真实接口 | 演示模式分支 + `canWrite` | `演示模式样例带「样例」标记，确认/备注禁用且不调用真实写接口` |
| ⑧ 后端不可达显示「后端未连接」，不渲染成空列表或 0 告警 | `failureBanner()` | `后端不可达显示「后端未连接」，不渲染成空列表或 0 告警` |

AbortController 的实际来源：`PageScope.signal` 已透传给 `api.listAlerts/readAlert`（`dataSource.read` 内部传 `signal: scope.signal`），`scope.dispose()` 即 abort 在途请求；页面自身再用 generation 兜住"已 abort 但回调已入队"的迟到响应。

---

## 5. 验证（真跑，原始输出）

### 5.1 单元/行为测试

```
cd admin-ui; npm test
# tests 107
# pass 107
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 472.9943
```

基线 88 → 现在 107（+19 个 test，全部落在 admin-ui/test/alerts.test.mjs），fail 0。

期间出现过两次失败，均已修正（不是放宽断言）：
1. 分页用例最初用 `textContent` 断言 `alertId`，而页面把 `alertId` 放在 `dataset` 而非可见文本 → 改为按 `dataset.alertId` 定位行并断言换页后旧行被替换。
2. 导航注册用例的服务灯正则写成 `dataset: { dot:`，实际源码是 `dataset: {dot: p.signal}` → 按真实写法更正。

### 5.2 dist 重建与哈希核对

```
cd admin-ui; node build.mjs
构建完成：admin-ui/dist/
  API_BASE = /api
```

- 全量比对：`src` 下 25 个文件逐个与 `dist/src` 对应文件比 SHA256 → **mismatch = 0，missing = 0**。
- `admin-ui/styles.css` ↔ `dist/styles.css`：**MATCH**；`admin-ui/index.html` ↔ `dist/index.html`：**MATCH**。
- 关键文件 src/dist 成对一致：

| 文件 | SHA256（src 与 dist 相同） |
| --- | --- |
| src/app.js | `BBCE93530F2B59AD2C7A1E61705E0319AB8CCC4F9D22ECEAA9A766735FDAF789` |
| src/lib/api.js | `CFC68329881DCB85C7C01044C015A5C2F3F69EFAF442C5C17843F4043C6B2E4F` |
| src/lib/data-source.js | `468CA8A8836CBF2EDB2D1F2B68F47A2C684E27C8C0E606A9B9C0EC339F113153` |
| src/pages/alerts.js | `3F3C2C5E7D965BA68DD5796A31BF71F7EDE5AE21E4273E5FB38A43E3415A6FED` |
| styles.css | `897971855A815771F87835BE4203D3BF059D314EDE5943F34141919BA63FF777` |

---

## 6. 限制与未验收项

1. **像素级目视布局未验收**。本任务只跑了 DOM 行为测试与 dist 哈希核对，没有在浏览器里目视检查告警中心的栅格、间距、深色主题与窄屏表现。**必须由 lead 另行目视核对**，本文件不声称目视通过。
2. **后端接口可能尚未落地**。页面按契约第 5 节的字段与错误码编写，测试全部用 fixture/桩驱动真实页面代码；没有为了"跑通"而在生产代码里写假分支。真实 `/admin-api/alerts*` 的联调、真实 `event: alert_store_full(507)` 与 `alert_persist_failed(503)` 场景、以及 `nextCursor` 的真实分页边界，均**未在真实后端上验证**。
3. **徽标请求量**：`probeAlertPending()` 挂在与后端联通时的 10s 健康探测上，每 10s 会发一次 `limit=1` 的列表请求；告警页本身还有 15s 轮询。请求都很轻，但存在同一 counts 被两条路径分别读取的情况，未做去重/节流。若 lead 认为需要收敛，可只保留页面内轮询上报徽标。
4. **带筛选时不写导航徽标**：服务端 `counts` 随筛选变化，因此页面在任一筛选生效时直接跳过 `publishPending`（徽标保持上一次的全量值或 `null`），避免"筛出来的 0 条"被当成"设备没有告警"。
5. 未做的次要项：列表未提供"按 alertId 深链"（无 URL 路由，沿用既有站点状态机）；未接入 `lib/pagination.js`（该模块是客户端分页工具，本页用服务端游标，故未使用）；未新增多语言/文案外部化。
6. 侧栏既有页面（overview/review/records/tasks/knowledge/model/devices/system）的渲染与指示灯口径只在源码层面确认未被改动，其回归由既有 88 个测试覆盖（本次仍全绿），未逐页目视。

---

## 7. 下一步建议

1. lead 目视核对告警中心（桌面 + 窄屏 + 深色）并与 review 页风格对齐。
2. 后端 `/admin-api/alerts` 系列落地后做一次真实联调：① 未连接设备的 `source.connected=false` 表现；② 统计 0 与"未连接"的区分；③ ack/note 的 `expectedRevision` 冲突路径（两个 admin 并发）；④ 507 容量错误的可读文案。
3. 若采纳第 6 节第 3 条，收敛徽标探测频率（例如复用页面轮询结果，或把健康探测里的告警探测降频）。
4. 可选：把 `docs/告警中心接口契约.md` 第 6 节与本文件第 4 节的映射表并入 `进度.md`（本任务无权修改该文件，交由协调者）。

---

## 8. 锁状态

- 锁文件：`tmp/collaboration-locks/ALERT-CENTER-WEB-20261103.lock`
- 状态：**RELEASED**（按约定保留文件，未删除）
- 释放前已确认：无未提交的写入、无后台任务、测试与 dist 核对均为最后一次实测结果。
