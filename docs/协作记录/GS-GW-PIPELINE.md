# GS-GW-PIPELINE 交接：三阶段只读智能体管线（decision → generate → verify）

执行者：gw-pipeline（gateway 执行者）  任务书：m00001  日期：20261102

## 1. 结论

管线已实现并通过全部测试：新建 `gateway/agent-audit.mjs`（硬规则 + 三态合成）与 `gateway/agent-pipeline.mjs`（三阶段编排），
在 `gateway/runtime.mjs` 暴露 `POST /api/agent/pipeline`，响应严格符合 `docs/三阶段智能体管线契约.md`（该契约文件未改动）。
新增 27 条 node:test 用例（要求 ≥12），全量测试 **183 tests / 182 pass / 0 fail / 1 skipped**，原基线 149/148/1 未被打破。

## 2. 授权内改动清单（逐条，含 agent.mjs 专项说明）

### 2.1 新建 `gateway/agent-audit.mjs`（178 行，纯函数，无 I/O）

- `PIPELINE_LIMITS`：`{maxAgeMs:15000, futureSkewMs:1000, co:30, co2:1500, maxSteps:4, summaryMax:2000, reasonMax:1000, maxRunMsMin:1000, maxRunMsMax:20000, defaultMaxRunMs:20000}`，
  逐项对齐 `openharmony/entry/src/main/ets/services/SafetyEngine.ets` 的 `check(env, now)`：15s 时效、未来偏移 1000ms、CO≥30、CO₂≥1500、急停、离线、读数非法。阈值仅用于软件演示，**不是国标**。
- `normalizeEnvironment(input, now)`：把实物帧/模拟帧/ArkTS EnvSnapshot 归一成 `{emergency, sensorOnline, sampledAt(number|NaN), co, co2}`。
- `evidenceSnapshot(environment)` → `{env:{...environment}}`；`resolveEvidenceRef(snapshot, ref, environment)` 只解析真实快照里的路径，解析不到返回 `null`（这是「编造 ref 被拦下」的唯一入口）。
- `environmentRules(environment, now)`：R-ESTOP / R-SENSOR-OFFLINE / R-SAMPLE-STALE / R-CO-INVALID / R-CO2-INVALID / R-CO / R-CO2，每条 `{ruleId, passed, detail}`。
- `planRules(plan, candidates)`：R-ACTION（动作不在 `agent.mjs` 的 `ALLOWED` 中）、R-PLAN（**直接调用 `agent.mjs` 的 `validatePlan` 判定**，同源不另造白名单/时长校验）。
- `requiresConfirmation(verdict, action)` → `verdict === 'allow' ? false : action !== 'query_environment'`（放行即不确认）。
- `composeAudit({ruleHits, stageFailures, decision, modelVerdict, fabricatedEvidence, missingEvidence})`：三态合成，优先级见 §3。

### 2.2 新建 `gateway/agent-pipeline.mjs`（约 224 行）

- 导出：`PIPELINE_STAGES=['decision','generate','verify']`、`PIPELINE_MODEL_TIMEOUT_MS=12000`、`PIPELINE_BUDGET_MS=40000`、`stageErrorCode()`、`validateDecision()`、`validateGeneratedPlan()`、`validateAuditOutput()`、`class AgentPipeline`。
- 网络层可注入：构造函数 `{provider, model, key, workspaceId, fetchFn = fetch, readEnvironment, readMemory, now = Date.now, stageTimeoutMs, budgetMs}`；
  `stageTimeoutMs` 被钳位到 ≤12000、`budgetMs` 钳位到 ≤40000。**测试全程零密钥零真实网络**。
- 主入口 `pipeline({prompt, mode})`（故意不叫 `run`，避免与 test runner 名称混淆）。`status()` → `{configured, provider, model, executesDevices:false, readOnlyPipeline:true}`。
- 三个 `tool_choice` 强制工具：`report_decision` / `propose_pipeline_plan` / `audit_plan`，温度 0.1，复用 `agent.mjs` 的 `ENDPOINTS`、`endpointFor`、`providerOptions`、`bounded`、`readModelResponse`（100000 字节上限原样复用）。
- 短路：环境硬规则命中 → 三个 stage 全 `blocked`、`calls=0`、`decision=null`、`plan=null`、`verdict=block`（**不花钱、不碰模型**）。
- 模型未配置/无 key → 三个 stage 全 `failed`、`error='model_unavailable'`、`calls=0`、`verdict=needs_human`，HTTP 仍是 200（契约 §2，不用 5xx）。
- 阶段级联：decision 失败 → generate/verify `blocked`；generate 失败 → verify `blocked`。
- evidence 防编造：模型只能给 `{ref, note}`，`value/observedAt/fresh` 由服务端从真实快照填充；解析不到的 ref 从 `plan.evidence` 剔除并计入 `missingEvidence`，`fabricatedEvidence > 0` 强制 `verdict !== 'allow'`。
- `stage.error` 稳定码：`timeout` / `invalid_output` / `model_unavailable`（映射覆盖 `ai_analysis_timeout`、`pipeline_timeout`、`TimeoutError`、`AbortError` 与全部 `INVALID_OUTPUT_CODES`）。
- `validateGeneratedPlan` 只判形状（summary 为 string、steps 为 array、evidence ≤8 且 ref 为 string≤80），**故意不抛 `validatePlan` 的结构错误**：越权动作与非法 `maxRunMs` 必须由 R-ACTION/R-PLAN 判成 `block`，而不是变成含糊的阶段失败。
- 踩坑记录（勿回退）：`AbortSignal.timeout()` 的计时器是 unref 的，单靠它会在无其它句柄时让 `await` 永远挂起（node:test 报 `Promise resolution is still pending but the event loop has already resolved`）。
  `runStage` 里额外挂一个 ref 的 `setTimeout` 兜底 `Promise.race`，并在 `finally` 中 `clearTimeout`；abort 语义仍走 `agent.mjs` 的 `bounded(task, signal)`。

### 2.3 新建 `gateway/test/agent-pipeline.test.mjs`（27 个 test，全部通过）

覆盖（对应任务书验收第 2 条逐项）：

| 要求 | 用例要点 |
| --- | --- |
| 三种 verdict 各 ≥1 | allow（低风险正常路径）、block（多条硬规则）、needs_human（confidence 0.42 / riskLevel high / verify 抛错） |
| 模型 allow 但规则 block 仍 block | 模型返回 allow + `open_door` 越界动作 → `block`、`authoritative='rules'`、reasons 含「模型不得放宽规则」 |
| confidence<0.7 → needs_human | `confidence:0.42` → verdict needs_human |
| 低风险无硬规则 → allow 且 requiresConfirmation=false | 断言 `plan.steps.every(s => s.requiresConfirmation === false)` |
| 动作越界 → block | `open_door` → R-ACTION passed=false |
| ventilate maxRunMs 越界 → block | `maxRunMs:30000` → R-PLAN passed=false |
| 模型超时/抛错 → stage failed 且 verdict≠allow | `stageTimeoutMs:20` → `stage[0].error='timeout'`、states `['failed','blocked','blocked']`、calls=1；`TypeError('fetch failed')` → `model_unavailable` |
| calls 计数正确 | 环境短路 calls=0；未配置 calls=0；单阶段超时 calls=1；verify 抛错 calls=3 |
| executed / hardwareControl 恒 false | 每个用例断言 |
| stages 恰 3 条固定序 | `deepEqual(stages.map(s => s.stage), ['decision','generate','verify'])` |
| 编造 evidence ref 被拦下 | `env.radonPpm`、`device.secret` 被剔除 + 进 `missingEvidence` + verdict≠allow |
| 阈值一致 | CO=30 与 CO₂=1500 边界同时命中、15001ms 过期、`now+2000` 未来偏移 |
| 契约字段集（不多不少） | 逐个对象断言字段名单：root 16 项、Stage 7 项、Decision 6 项、Candidate 5 项、Plan 3 项、PlanStep 5 项、Evidence 4 项、Audit 6 项、RuleHit 3 项、Memory 2 项 |
| 端点可用性（集成） | 实物模式 `POST /api/agent/pipeline` → 200（mode hardware、verdict block、calls 0），同一进程 `/api/agent/plan` 仍 403；模拟模式端到端 allow、calls 3 |

### 2.4 `gateway/agent.mjs`：**只加 6 个 export 关键字，零行为变化**

| 行号 | 改动 | 原因 | 是否影响既有 `/api/agent/plan` |
| --- | --- | --- | --- |
| L2 | `const ENDPOINTS` → `export const ENDPOINTS` | 管线复用端点表，不另造 | 否，纯导出 |
| L3 | `const endpointFor` → `export const endpointFor` | 复用 qwen 工作空间特化逻辑 | 否 |
| L4 | `const ALLOWED` → `export const ALLOWED` | R-ACTION 与 `validatePlan` 用**同一份**动作白名单 | 否 |
| L6 | `const providerOptions` → `export const providerOptions` | 复用 thinking 关闭选项 | 否 |
| L7 | `async function bounded` → `export async function bounded` | 复用 abort→`ai_analysis_timeout` 语义 | 否 |
| L13 | `async function readModelResponse` → `export async function readModelResponse` | 复用 100000 字节响应上限 | 否 |

没有修改任何函数体、常量值、错误码或调用顺序；`validatePlan`（L23）与 `AgentPlanner`（L32）原本就是 `export`，未动。既有 `gateway/test/agent.test.mjs` 与 `integration.test.mjs` 全部照旧通过（全量 0 fail 可证）。

### 2.5 `gateway/runtime.mjs`：4 处接线（最小改动）

- **L9**：`import {AgentPipeline} from './agent-pipeline.mjs';`
- **L72-76**：`pipelineEnvironment(mode)` —— `hardware` 走 `readHspTelemetry(hardwareFile)`（即既有实物快照读取，只读）；`simulation` 走 `{...snapshot().frame, source:'simulation', simulated:true, deviceOnline:snapshot().deviceOnline}`。
- **L77-85**：`pipelineMemory()` —— 仅当 `analysisStore.status().healthy === true` 才 `analysisStore.read({limit:8})`，校验 `simulated===false && historical===true && isCurrent===false` 后取 `items.map(row => row.seq).filter(Number.isSafeInteger)`；任何异常返回 `[]`（**只读，绝不 append**）。
- **L86-87**：`pipelineFor = () => new AgentPipeline({...planner 的 provider/model/key/workspaceId/fetchFn, readEnvironment: pipelineEnvironment, readMemory: pipelineMemory})`，每次请求按当前 planner 配置构造，配置热更新即时生效。
- **L186**：POST 白名单加入 `'/api/agent/pipeline'`。
- **L230-235**：新分支 `else if(req.url === '/api/agent/pipeline')` —— `planning||configuring` 忙则 429 `ai_busy_try_later`；`prompt` 非 string / 空白 / 长度 >2000 → 400 `invalid_prompt`；否则 `planning=true; try{ send(200, await pipelineFor().pipeline({prompt, mode: isHardware?'hardware':'simulation'})) } finally{ planning=false }`。
- **L180 硬件禁列未动**：仍是 `['/api/device','/api/command','/api/demo/scenario','/api/agent/plan']`，`/api/agent/pipeline` **不在**其中，所以 `isHardware=true` 时该端点可用（集成用例已证 200）。

### 2.6 明确未触碰

`openharmony/**`、`gateway/test/` 下其他既有测试、`待办.md`、`进度.md`、`deepseek开发进度.md`、`docs/三阶段智能体管线契约.md` 全部未改动。
特别说明：`AGENTS.md` 要求每次结束更新 `待办.md`/`进度.md`，但本任务书把这些文件列入禁止触碰，**任务书优先**，故本轮未更新，由 lead 汇总。

## 3. 契约第 4 节语义实现（三态合成优先级）

`composeAudit` 的实际判定顺序：

1. 环境硬规则或结构硬规则（R-ACTION/R-PLAN）任一命中 → `verdict='block'`、`authoritative='rules'`；即使模型说 `allow`，仍 `block` 并追加理由：**「模型结论为 allow，但硬规则命中，最终仍为 block：模型不得放宽规则」**（模型只能加严不能放宽）。
2. 否则任一 stage `failed` → `needs_human`（`allow` 永不出现在失败路径）。
3. 否则 `decision.riskLevel === 'high'` → `needs_human`。
4. 否则 `decision.confidence < 0.7` → `needs_human`。
5. 否则存在编造 evidence（`fabricatedEvidence > 0`）→ `needs_human`。
6. 否则模型 `block`/`needs_human` → 取更严者，`authoritative='model'`。
7. 其余 → `allow`，且 `plan.steps[].requiresConfirmation` / `decision.candidates[].requiresConfirmation` 一律 `false`（用户已拍板：风险不高直接放行）。

## 4. 只读与红线自证

- `executed:false`、`hardwareControl:false` 是**唯一一处**字面量：`gateway/agent-pipeline.mjs:165` 的 `base` 对象（`const base={kind:'agent_pipeline',...,executed:false,hardwareControl:false}`），全文件再无对这两个键的赋值路径，因此任何分支（短路 block、未配置、阶段失败、allow）都不可能出现 `true`；测试侧有 5 处显式断言（含实物模式集成用例）。
- 不执行设备动作：管线不引用 `broker`/`publish`，`plan.steps[].processed` 恒 `false`。
- 不写硬件历史、不写分析历史：`readMemory` 只调用 `analysisStore.read()`；`agent-pipeline.mjs` 与 `agent-audit.mjs` 内没有 `write`/`append` 调用。
- `memory.used` = 实际引用成功的条数（`sources` 形如 `['analysis-history:12','analysis-history:11']`），记忆不可用时为 0 且 `sources=[]`。
- 无密钥：代码、测试、本文档都不含任何真实密钥；测试用的 `'test-key'` 是假值。
- 无 Web 套壳 / H5 / Flutter / RN 依赖；纯 Node ESM。

## 5. 实测证据（原样粘贴）

完整命令（工作目录 `C:\Users\ASUS\Documents\ChatGPT\基于开源鸿蒙的比赛`）：

1. ```powershell
   cd gateway; node --test "test/agent-pipeline.test.mjs"
   ```

   输出原始行：
   ```
   # tests 27
   # pass 27
   # fail 0
   # cancelled 0
   # skipped 0
   ```

2. ```powershell
   cd gateway; node --test "test/*.test.mjs"
   ```

   输出原始行（exit code 0）：
   ```
   # tests 183
   # suites 0
   # pass 182
   # fail 0
   # cancelled 0
   # skipped 1
   # todo 0
   # duration_ms 1889.035
   ```

基线对比：开工前 149 tests / 148 pass / 1 skipped / 0 fail → 现在 183 tests / 182 pass / 1 skipped / 0 fail。
新增 34 条中本任务占 27 条，另 7 条来自并行执行者 native-agent-ui（不同文件）；`# skipped 1` 与 `# fail 0` 均保持不变。

## 6. 已知限制 / 未跑项（不含糊）

1. **真实 DeepSeek 调用未验收**：本轮无密钥、无真实网络，全部走注入的 `fetchFn` 桩。用户配好密钥后需人工跑一次真实调用（`POST /api/agent/pipeline`，`/api/agent/config` 配置后）。
2. **实物模式下管线恒定 block（fail closed）**：`gateway/hsp-telemetry.mjs` 产出的快照里 `coPpm`/`co2Ppm` 恒为 `null`、`coValid`/`co2Valid` 恒为 `false`，因此 `R-CO-INVALID`/`R-CO2-INVALID` 必然命中 → `verdict='block'`、`calls=0`。这是当前硬件数据源的客观限制，方向正确（宁可拦下不放行），但意味着实物模式现在还看不到 `allow`。集成用例断言的就是这个 block。
3. `待办.md` / `进度.md` 未更新（任务书禁止触碰），需由 lead 汇总。
4. 管线与既有 `/api/agent/plan`、`/api/agent/analyze` 共用 `planning` 忙标志，并发请求会得到 429 `ai_busy_try_later`（与既有端点行为一致，非 bug）。
5. 端点只接受 `prompt`（≤2000 字符），不接受外部传入的环境/记忆参数——环境与记忆一律服务端只读取用，防注入。

## 7. 建议的后续动作

- lead 汇总时把本文档要点并入 `进度.md`，并在 `待办.md` 勾掉本项。
- 用户配密钥后做一次真实链路验收，重点看：`provider`/`model` 回显、`calls=3`、`stages[].durationMs` 是否在预算内。
- 若后续硬件侧补齐 CO/CO₂ 读数（`coValid/co2Valid`），实物模式的 `allow` 路径才会出现；在那之前不要在文档里声称实物模式已放行。
