# 交接：QWEN-HUMAN-REVIEW-20261103（人工审核中心）

- 任务 ID：QWEN-HUMAN-REVIEW-20261103
- 执行者：Qwen-3.8
- 日期：2026-11-03
- 汇总状态：**待汇总**（共享待办/进度由协调者 Codex 维护，本任务未改写）
- 锁：`tmp/collaboration-locks/HUMAN-REVIEW-20261103.lock`

## 1. 目标 / 范围

按用户指派开发"人工审核中心"：needs_human 队列与筛选、详情展示（问题/原始阶段结果/风险原因/RAG 引用/阶段事件）、admin 通过/驳回+意见（viewer 只读）、人工意见独立追加不改原模型结论、硬规则 block 不可人工通过、防重复提交与版本校验、复用既有认证/CSRF/设备隔离/持久化审计、演示数据显式隔离、补权限/并发/重启/隔离测试并构建 Web 产物。UI 要求动效丰富、美观。

## 2. 基线（接手时实际核对）

- `gateway/cloud-server.mjs` 213 行：已有 pipeline/tasks、knowledge、audit、会话鉴权路由；错误映射统一在末尾 catch。
- `gateway/pipeline-tasks.mjs` 39 行：任务快照逐事件落盘为 `pipeline_state` 审计行；`list()` 最近 50、视图上限 100。
- `gateway/agent-audit.mjs` `composeAudit()`：verdict ∈ allow/needs_human/block；硬规则或结构规则命中→block（authoritative=rules）；模型 verdict=block 加严（authoritative=model）；needs_human 触发条件为阶段失败/高风险/置信度<0.7/伪造证据。
- `gateway/cloud-history.mjs`：哈希链保留文件；`key` 幂等（同 key 同内容返回原行、异内容报 `history_key_conflict`）；字段名含 password/token/secret/api_key/wifi_ssid 拒绝落盘。
- 前端 67 项测试通过（Codex ADMIN-UI-FIX + CLOUD-RAG-PIPELINE 后基线）。
- 协作锁：全部 completed/RELEASED（用户已确认无活跃写入者）。

## 3. 修改文件

新增：
- `gateway/human-review.mjs` — HumanReview 模块（队列派生/详情/提交/幂等/拦截）
- `gateway/test/human-review.test.mjs` — 25 项单元/集成回归
- `gateway/test/human-review-http.test.mjs` — 10 项真实 HTTP 鉴权回归
- `admin-ui/src/pages/review.js` — 人工审核页（队列/详情/提交区/演示模式）
- `admin-ui/test/review.test.mjs` — 18 项页面行为回归
- `docs/人工审核中心接口契约.md` — 完整契约与错误码表

修改（均在认领范围内）：
- `gateway/cloud-server.mjs` — 仅新增 `/admin-api/review*` 三条路由 + HumanReview 初始化接线 + 返回值暴露（未改任何既有路由/中间件/错误映射）
- `admin-ui/src/lib/api.js` — 新增 listReviewQueue/readReviewTask/submitReview（标注 [已有]）
- `admin-ui/src/lib/data-source.js` — 审核读写接入 read/write 通道（写走 MutationGate + admin 角色）
- `admin-ui/src/app.js` — 注册「人工审核」导航；**修复侧栏指示灯**：只有可确证状态的页面画灯（overview/devices/model/review），其余不画；review 点带待审数量徽标与脉冲动画；resetContext 清 reviewPending
- `admin-ui/styles.css` — 审核页样式组（行选中共振条、RAG 卡交错入场、意见滑入、徽标 pop、warn 点脉冲）
- `admin-ui/dist/**` — build.mjs 重建，src↔dist SHA256 一致

未触碰：openharmony/、firmware/、gateway 既有业务模块与既有测试、SDK、他人旧锁、待办.md、进度.md、output/。

## 4. 行为变化 / 接口影响

- 新接口：GET `/admin-api/review`、GET/POST `/admin-api/review/{taskId}`（契约见 docs/人工审核中心接口契约.md）。
- 新审计事件：`human_review_requested`（路由层）、`human_review_saved`（HumanReview 权威记录，带 key=`human-review-{taskId}-{seq}` 幂等）。
- 语义要点：人工意见独立追加，`result.audit` 原样不动；block 一律拒绝 approve（不落任何记录）；allow 拒绝人工决策；version=事件数，过期即拒；精确重试 duplicate:true；并发不同意见 → review_conflict。
- 前端指示灯口径变化（对既有页面的唯一可见改动）：无信号页面不再显示灰点。这是响应用户对"有的亮有的不亮"的反馈——灰死点会被误读为故障。
- 不下发设备控制：本功能无任何控制路径，返回体恒 executed:false/deviceCommandIssued:false。

## 5. 实际执行的验证（TDD 全程）

| 套件 | 命令 | 结果 |
|---|---|---|
| RED 确认 | 后端/前端新测试先跑 | 均如期失败（模块缺失/断言不符） |
| human-review.test.mjs | node --test | **25/25 通过** |
| human-review-http.test.mjs | node --test | **10/10 通过**（真实 startCloudServer + Cookie/CSRF/Origin/scrypt） |
| gateway 全量 | node --experimental-strip-types --test "test/*.test.mjs" | **233 项：232 通过 / 1 跳过 / 0 失败**（跳过=hsp-bridge-integration，本机无 PowerShell 7，既有环境限制） |
| admin-ui 全量 | npm test | **88 项：88 通过 / 0 失败**（新增 18 项审核页测试） |
| 端到端冒烟 | 一次性脚本（随机凭据、临时目录用后即删） | **25/25 PASS**：静态产物含审核页与样式、未认证 401、空队列如实 0、真实管线任务（无 CO/CO₂→硬规则 block、calls=0）、block 不混入 needs_human 待办、canApprove=false、**人工通过 block 被拒且不留记录**、viewer 提交 403、过期版本 400、admin 驳回留痕成功且 finalVerdict 仍 block、精确重试幂等、仅一条意见、原模型结论未修改、审计含两类事件、**重启后队列/意见/原结论恢复且仍拦截通过** |
| 构建 | node build.mjs | dist 重建成功；review.js/api.js/data-source.js/app.js src↔dist 哈希一致；styles.css 含新增类 |

过程中发现并修正的实现缺陷（均由测试逼出）：①open() 只扫一次导致运行时新任务不可见→改 seq 游标增量同步；②submit 手动 push 与 #sync 双计→统一走 #sync；③HTTP 冒烟初版预期 needs_human 实为 block——产品行为正确，是脚本预期错，改为端到端验证 block 拦截路径；④测试夹具两处标签不一致（running 任务无 verdict、blocked 详情 taskId）→修夹具。

## 6. 浏览器实拍（结果：部分完成，如实记录）

- 实拍环境经 HTTP 响应核验正确：预览服务提供的 `review.js`/`app.js`/`styles.css` 与最新构建产物逐字节一致（含「人工审核」导航注册）。
- 第一轮实拍：DOM 断言全部达成——左侧存在「人工审核」、演示模式下「通过（人工确认）」与「驳回」均 disabled、页面无 null 字样；但 agent 返回的截图对应画面实际停在"运行总览"（用户也指出点位错误），**该张不能作为审核页布局证据**。已保存为 `admin-ui/screenshots/review-demo.jpg` 仅作留档，不用于宣称审核页目视验收。
- 补拍被浏览器通道收束中断（preview_control_resume_required），未再重复发起。
- 结论：**审核页的功能行为有 DOM 级证据与 18 项页面测试支撑；像素级目视布局验收未完成**，待浏览器通道恢复后由任一执行者补一张真正的审核页截图即可关闭此项。

## 7. 失败与限制（未验收项）

- Ubuntu/TLS 部署未实测（无云环境）；生产 nginx 反代下 Cookie/CSRF 行为未验证。
- 真实 DAYU200 上报任务后的审核流未验收（本机无设备）。
- 真实 DeepSeek 产生的 needs_human 任务的审核体验未验收（零密钥，全走桩/硬规则路径）。
- 浏览器目视布局验收受工具中断影响，见 §6。
- 审核队列仍是窗口视图（≤100 任务），非全量归档查询。
- 额度：本账号额度余量不可读取，记未知；未声称监控 3% 停止线。

## 8. 未完成项 / 下一步

1. 人工结论接执行链路（当前只留痕）——需单独设计，不能就地改写 audit。
2. 服务端分页/条件查询就绪后，队列从窗口视图切换为请求驱动。
3. 有云环境后按契约文档做 Ubuntu 部署 + HTTPS 下的审核链路复验。
4. 请 Codex 复核 `cloud-server.mjs` 的三处新增行与前端 app.js 指示灯改动。

## 9. 锁释放情况

见文末收尾标记。
