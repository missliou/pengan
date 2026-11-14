# ALERT-CENTER-GATEWAY-20261103 交接

## 1. 任务与范围

- 任务ID：ALERT-CENTER-20261103（告警中心后端：真实派生 / 生命周期 / 持久化 / 管理端接口 / 测试）
- 执行者：alert-gateway（gateway 后端执行者）
- 权威契约：docs/告警中心接口契约.md（v1.1，含 §4 落盘口径与节流规则）
- 独占锁：tmp/collaboration-locks/ALERT-CENTER-GATEWAY-20261103.lock
- 可写范围（严格）：gateway/alerts.mjs（新建）、gateway/cloud-server.mjs（仅新增告警 import/初始化/输入构造/生产者钩子/4 条路由/错误码映射/return 暴露）、gateway/test/alerts.test.mjs（新建）、gateway/test/alerts-http.test.mjs（新建）、本文件
- 未触碰：admin-ui/、openharmony/、firmware/、待办.md、进度.md、他人文件与他人锁；gateway 既有模块（cloud-history.mjs、human-review.mjs、pipeline-tasks.mjs、cloud-security.mjs、dayu-ingest.mjs、hsp-telemetry.mjs）只读未改

## 2. 基线（改动前）

工作区无 Git 基线（仓库状态全为 untracked），按文件 SHA256 核对。

| 文件 | 改动前 SHA256 | 说明 |
| --- | --- | --- |
| gateway/cloud-server.mjs | 1F029D5197F4EDBCE6813EA662C63C4B7786782E84C645C28D6C135DC5C20284 | 231 行，唯一被修改的既有文件 |
| docs/告警中心接口契约.md | EE9D898F47A999C6534AAB708327098439591BA3413C0F4E4E9756D21829C94A | 只读（v1.1 由 lead 维护） |
| gateway/alerts.mjs | 不存在 | 新建 |
| gateway/test/alerts.test.mjs | 不存在 | 新建 |
| gateway/test/alerts-http.test.mjs | 不存在 | 新建 |

基线全量回归：`node --test "test/*.test.mjs"` → tests 233 / pass 232 / fail 0 / skipped 1（hsp-bridge-integration，本机无 PowerShell 7）。

## 3. 修改文件与行数（完成后）

| 文件 | 行数 | SHA256 | 变化 |
| --- | --- | --- | --- |
| gateway/alerts.mjs | 513 | D378F57448674F02059B026BBEC55EB2CE27CB1A9D16EB489E1241345B341BAE | 新建：纯函数派生 + 追加链持久化 + 生命周期 + 列表/详情/确认/备注 |
| gateway/cloud-server.mjs | 268 | 5217AA182A2FBA0160B2D374CF86CA5B8D2078B5C060DB96E7B27776DB6F3C06 | 231 → 268 行（+37）：import/初始化/alertInputs/reconcileAlerts/两个生产者钩子/4 条路由/错误码映射/return 暴露 alertCenter |
| gateway/test/alerts.test.mjs | 554 | 6A1143F667D84AD62FBBC41782A38D1E13ABA68C6742C04851D4B68CC3D57423 | 新建 30 tests |
| gateway/test/alerts-http.test.mjs | 314 | EA98DFA56D12707F1F57DABB78164F2C1E8A7153B13CB137AF6792BBEA1C0641 | 新建 14 tests |

## 4. 接口与行为变化

### 4.1 新增管理端接口（均在 isWrite→requireRole(session,'admin') 与 CSRF 守卫之后，沿用既有鉴权栈）

- `GET /admin-api/alerts`：筛选（type/severity/status）、游标 `s<seq>`、limit 1..100（缺省 20）。
  响应键：schemaVersion、scope:'alerts'、generatedAt、gatewayId、filters、counts{all,open,acknowledged,recovered,bySeverity}、countBasis、source{connected,lastAcceptedAt,lastReconcileError,evaluation:'derived-on-read'}、items、nextCursor、truncated。
  行为：先以 `mode:'read'` 同步 reconcile（只做开启/恢复的迁移，不累加 occurrences、不推进 revision），派生失败如实抛错（503 / 507 / 400），不返回空列表冒充正常。
- `GET /admin-api/alerts/{alertId}`：返回单条完整记录（含 acks/notes/evidence/relatedTaskIds），恒带 executed:false、hardwareControl:false；跨设备/不存在统一 `alert_not_found`。
- `POST /admin-api/alerts/{alertId}/ack`：body `{expectedRevision, note?≤500}`；只追加 acks、revision+1、state→acknowledged（已恢复的告警不因确认回退）；重复提交同一动作返回 duplicate:true 且不再改版本。
- `POST /admin-api/alerts/{alertId}/note`：body `{expectedRevision, text 1..500}`；只追加 notes，不改变"是否仍在发生"。
- 幂等键：`sha256(alertId|action|expectedRevision|sha256(内容))`，先于 revision 校验；键保存在 acks[]/notes[].key 上，重启后精确重试仍识别为 duplicate。
- 错误码状态映射（catch 内显式前置，先于既有正则）：alert_store_full/alert_event_limit → 507，alert_persist_failed/alert_store_not_ready/alert_reconcile_failed → 503，alert_revision_conflict → 409，alert_not_found → 404，invalid_alert_query/invalid_alert_note/invalid_alert_actor → 400；鉴权仍走既有 401/403 分支。

### 4.2 派生规则（纯函数，gateway/alerts.mjs:111 evaluate / deriveFaults）

- 从无上报（hasSession=false）不产生任何告警，也不伪造时间；reconcile 返回 evaluated:false。
- 帧年龄 age（优先接入时间，其次帧时间）：age<10s 无 stale；[10s,60s) telemetry_stale；≥60s device_offline（else-if，绝不同时产出 stale）。
- reason ∈ {invalid_hsp_sample, hardware_read_failed, hardware_file_too_large, invalid_receive_time, unknown} → collection_error（subject=reason 原串）；read_only_hardware 正常不产告警；未知 reason 且无时间证据 → collection_error/unknown_reason。
- 在线（新鲜且 deviceOnline）且 quality.temperatureValid/humidityValid 为 false → sensor_channel_invalid/th；gasValid 为 false → sensor_channel_invalid/gas（th/gas 分单）。
- 任务 status=failed 且 error 不在 BENIGN_TASK_ERRORS → model_task_failed（subject=pipeline）；安全规则 verdict ∈ {block,needs_human} 绝不产告警（成功与失败均不产）。
- 合并键 gatewayId+type+subject：未恢复期间只累加 lastAt/occurrences/basis；恢复后再次发生新建 alertId。

### 4.3 持久化

- 追加链行：`{kind:'audit', gatewayId, data:{event:'alert_state', scope:'alert', actor, alert}}`，open() 只重放三者同时成立的行；与 pipeline_state / human_review_saved 同构，未改动 cloud-history.mjs 的 kind 白名单（契约 v1.1 §4 已记录该口径）。
- 容量 2000 条（alert_store_full）、单条告警 200 事件（alert_event_limit）、写失败 alert_persist_failed；超限一律抛错，不淘汰旧记录、不返回成功。
- 发生合并落盘节流 ALERT_MERGE_WRITE_INTERVAL_MS=10s：内存每次照常累加；首次发生、恢复、确认、备注一律立即落盘；revision 只在落盘时 +1，故内存 revision 恒等于已落盘 revision，重启重放不会出现版本回退导致的假 409。
- basis.detail 只放代码/阈值/时间差，对 sk-*/Bearer 形态文本做 [redacted] 兜底；日志与响应不含模型密钥、设备令牌、家庭 Wi-Fi 密码（测试用口令与设备令牌均为一次性假值，未写入本文件）。

### 4.4 生产者钩子

- 采集入库成功后（history.append 之后、设备响应之前）`await reconcileAlerts(gatewayId,'device')`：best-effort，失败只记 lastReconcileError（仅错误码字符串），不影响设备侧 200。
- 模型任务结束（PipelineTasks onFinish 路径）`void reconcileAlerts(gatewayId,'system')`：不阻塞任务收尾。
- 列表 source.lastReconcileError 回传最近一次派生失败码；成功后清空。

## 5. 每条失败用例的修法

实现阶段共出现 5 条失败用例，逐条根因与修法：

1. 单元 #11「恢复后再发生新建 alertId」：断言写成"列表只剩 1 条"。实际列表含已恢复旧单 → 改为断言 2 条（新 open 在前、旧 recovered 在后）并核对 alertId 不同。
2. 单元 #16「重启重放」：fixture 用 `lastAcceptedAt=NOW-20_000` + reason=invalid_hsp_sample，同一设备同时派生 collection_error 与 telemetry_stale，重放后 2 条记录。改为新鲜帧 + 单一 reason，只断言一条记录的往返一致性。
3. 单元 #18「事件上限 alert_event_limit」：原断言 occurrences=4/revision=4。实际 #persist 在 `this.meta.set` 之前抛出，失败不推进内存计数 → 断言 occurrences=3/revision=3，并额外断言"写失败后旧记录仍在"。
4. 单元 #28「节流窗口内重启不误报 409」：根因是实现 bug —— `persistedAt` 取了 CloudHistory 的 `row.recordedAt`（墙钟 Date.now，cloud-history.mjs:33），与注入的 now 不同轴，`now-persistedAt` 恒为负导致节流永不生效、revision 永不推进。修法：#persist 增 `now` 形参并把 `persistedAt` 记为逻辑 now，四个调用点补实参。同时把 #merge 的"实质变化"判据从整段 basis（含每帧变化的 sampleAgeMs/observedAt）改为语义指纹 {basis.code, evidence.ref[], relatedTaskIds[], state}，避免节流被高频细节击穿。
5. HTTP 分页「游标 s<seq> 两页不重叠」：根因是 list() 原本用 `meta.seq < bound` 过滤。恢复会重写旧告警的行号（lastAt 早但 seq 新），使 lastAt 降序与 seq 顺序不一致，导致第二页重复返回第一页条目。修法：游标改为"上一页最后一条"的锚点语义——按当前排序找到该 seq 的位置再取其后一段；找不到该行时退回 seq<bound。契约要求的 lastAt 降序 + seq tiebreak 未变。

## 6. 测试原始计数（本次实跑）

- `cd gateway; node --test "test/alerts.test.mjs"`
  `# tests 30 / # pass 30 / # fail 0 / # skipped 0 / # duration_ms 227.9408`
- `cd gateway; node --test "test/alerts-http.test.mjs"`
  `# tests 14 / # pass 14 / # fail 0 / # skipped 0 / # duration_ms 1611.2133`
- 全量回归 `cd gateway; node --test "test/*.test.mjs"`
  `# tests 277 / # pass 276 / # fail 0 / # cancelled 0 / # skipped 1 / # todo 0 / # duration_ms 3441.7361`

对比基线：233 → 277 tests（+44 = 30 单元 + 14 HTTP），fail 0，skipped 仍为 1（hsp-bridge-integration，本机无 PowerShell 7），跳过项未增加。

lead 追加的三条硬约束均有测试：立即落盘（首次/确认/备注/恢复各断言行数 1→2→3→4）、GET 的 mode='read' 不累加 occurrences 也不推进 revision（单元 + HTTP 双重断言）、节流窗口内重启 revision 仍为 1 且可直接用于确认；另有安全拒止四种组合不产 model_alert、写失败响应无 saved 且旧记录保留（单元 + HTTP）。

## 7. 限制与未验收项

- 真实设备未验收：HH-HSP101 / DAYU200 未接入本机联调，帧构造均按 validateHspFrame 的字段契约在测试内生成（真实串口/HTTP 采集链路未跑）。
- 真实模型未验收：测试 fetchFn 一律抛错，model_task_failed 的派生用构造任务验证；end-to-end 模型失败→告警未在真实 provider 上验证。
- 容量与事件上限用构造实例验证（capacity/eventLimit 注入），未在真实 2000 条哈希链上做压测；磁盘写满/断电等物理故障未模拟，alert_persist_failed 由真实 CloudHistory 抛错路径覆盖。
- 前端未对接：admin-ui 属他人范围，本次只交付接口；页面渲染与交互未验收。
- 多实例/多进程并发未涉及：依赖 cloud-history 既有 writer lock，单实例语义下验收。
- 契约 v1.1 §4 的 audit 落盘口径与 10s 节流为 lead 批准的偏差；HTTP 详情返回扁平完整记录（不加 envelope），列表项为摘要 —— 如前端需要 envelope 需另行确认。

## 8. 下一步

1. admin-ui（ALERT-CENTER-WEB-20261103）对接 4 条接口，按 countBasis 文案渲染计数。
2. 真实设备联调：接 HH-HSP101 帧 → 断流 10s/60s 观察 stale/offline 迁移与恢复。
3. 真实模型失败演练：一个失败任务是否只产 1 条 model_task_failed 且后续 completed 能恢复。
4. 容量压测：接近 2000 条时列表性能与 507 行为。

## 9. 锁状态

- 独占锁 tmp/collaboration-locks/ALERT-CENTER-GATEWAY-20261103.lock：status 已改为 `RELEASED`（文件保留，未删除）。
- 本文件是最终交接；如需继续该任务请重新认领锁。
