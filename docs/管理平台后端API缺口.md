# 管理平台后端 API 缺口清单（admin-ui 依赖）

任务：QWEN-CLOUD-ADMIN-UI-20261102（前端 Qwen-3.8）· 日期：2026-11-02
更新：QWEN-ADMIN-UI-SESSION-20261102 · 2026-11-02（据实核对 `gateway/cloud-server.mjs` 与本机 30 项契约验证）
交给：协调者（Codex）与后端负责人。本文件只提契约，不改后端；`gateway/` 业务与鉴权不在前端所有权内。

## 0. 现状

2026-11-02 Codex复核更正：`admission=unknown_denied`表示人员入棚安全准入未知/拒止，不是遥测接入失败。缺少CO/CO₂与执行器时保留拒止语义；无需为在线设备删除该字段或改成允许。设备页用在线状态、通道质量和reason表达采集情况。该项不属于后端缺陷。

前端所有请求经统一适配层 `admin-ui/src/lib/api.js`，逐函数标注 `[已有]`/`[待实现]`。
- `[已有]`：真实模式网关现有端点，已在 Windows 本机端到端联调通过（见交接）。
- **云端管理端已实现**（Codex，`gateway/cloud-server.mjs` + `cloud-security.mjs`）：管理会话登录/恢复/退出、admin/viewer 角色、CSRF、Origin 校验、设备列表、审计事件、设备令牌接入与按 gatewayId 隔离。本轮已用真实后端逐项验证字段契约（30 项全通过）。
- `[待实现]`：仅剩服务端条件查询/导出、AI 任务独立审计流、实时推送、系统状态聚合端点。

### 本轮据实更正（原清单第 1、3、6 项已不再是缺口）

| 原缺口 | 实际状态 | 证据 |
|---|---|---|
| 1. 管理会话鉴权 | **已实现** | `POST /admin-api/session/login` 返回 `{authenticated,user:{username,role},csrfToken}` + HttpOnly `SameSite=Strict` cookie；`GET /admin-api/session` 同结构（含 csrfToken，故前端刷新不掉线）；无会话访问 `/admin-api/devices` 返回 **401**；错误 CSRF 写配置返回 **403** |
| 2. 模型配置云端化 | **部分已实现** | `GET/POST /api/agent/config`、`POST /api/agent/test` 已在云端鉴权下工作，配置持久化到 `dataDir/model-config.json`（非 tmp）；写操作要求 admin 角色 |
| 3. 设备列表 | **已实现** | `GET /admin-api/devices` → `{items:[{schemaVersion,gatewayId,mode,simulated,hardware}]}`，hardware 为完整实时快照 |
| 6. 审计事件 | **已实现** | `GET /admin-api/audit?limit=&beforeSeq=`，记录 `login_success`/`login_failed`/`logout`/`model_config_change*`/`model_test_requested`/`permission_denied`/`device_*_requested` |


## 1. 管理会话与鉴权（最高优先，公网暴露前必须完成）

| 接口 | 请求 | 响应 | 说明 |
|---|---|---|---|
| POST `/admin-api/session/login` | `{username, password}` | 200 `{authenticated:true, expiresAt}`（会话建议 httpOnly+Secure Cookie）；401 `{error:"invalid_credentials"}` | 登录限速与失败锁定由后端负责；前端不保存任何凭据 |
| POST `/admin-api/session/logout` | 会话 Cookie | 200 | 退出后旧会话立即失效 |
| GET `/admin-api/session` | 会话 Cookie | 200 `{authenticated, expiresAt}` / 401 | 前端进入平台先探测此接口 |

要求：
- 管理员会话与**设备接入令牌**必须分离（需求文档：不能用隐藏按钮代替鉴权）。
- 所有 `/admin-api/*` 与现有 `/api/agent/config` 写路径在未鉴权时一律 401/403。现有 csrfToken 只防 CSRF，不防未登录访问，云端必须叠加真实鉴权。
- 会话失效时前端已有处理路径（`ApiError.kind='forbidden'` → 回登录门并提示）。

## 2. 模型配置（云端形态）

现有 `[已有]` 端点可作为实现参考，但云端需鉴权化并持久化到**非 tmp 目录**（需求：配置保存于持久目录）：
- GET `/admin-api/model/config` → `{configured, provider, model, keySaved, workspaceId}`，**永不返回明文 key**（现网关 `configStatus` 已符合，保持）
- POST `/admin-api/model/config` → 保存/替换/`clearKey:true` 清除
- POST `/admin-api/model/test` → 与现有 `/api/agent/test` 相同语义（合成问题 + verify_connection，不发现场数据/照片）
- 保存成功响应应带 `configEpoch`（或等价版本号），前端用它丢弃配置变更后的迟到测试结果——现有 `connectionCheck` 复位语义可保留。

## 3. 设备管理与诊断

| 接口 | 响应要点 |
|---|---|
| GET `/admin-api/devices` | `[{deviceId, role: "collector"|"gateway", displayName, online, lastSeenAt, source}]`；DAYU200 自身心跳当前无处上报，接口实现依赖链路 B 落地 |
| GET `/admin-api/devices/{id}` | 详情 + 最近上报统计 + 诊断字段（固件版本、重启次数若有遥测）|
| POST `/admin-api/devices/{id}/pair` | 配对码/设备令牌签发，**方案待产品决策**（一次性码 vs 预置令牌），定案前保持 501 |

## 4. 记录查询与服务端导出

现前端为"取回 ≤200 条窗口 + 客户端筛选/分页/导出"。服务端化契约：

```
GET /admin-api/records?type=observation|analysis
    &from=<ms>&to=<ms>&device=<id>&validity=all|valid|unknown
    &q=<关键字>&limit=<1-200>&cursor=<opaque>
→ {items:[…与现有 history 相同条目形状…], nextCursor, totalEstimate, storage:{…}}
```

```
POST /admin-api/records/export {type, 同上筛选, format:"csv"|"json"}
→ {exportId}；GET /admin-api/records/export/{exportId} → 文件流
```
导出内容必须脱敏（无密钥/令牌/家庭密码/照片），并在审计中登记一次导出事件。分页沿用现有 `beforeSeq` 语义亦可，前端已兼容。

## 5. AI 任务过程流

GET `/admin-api/agent/tasks?limit=&device=` → 按任务组织：问题、规划、每次工具调用（名称/入参摘要/回执/耗时）、分析依据快照时间、持久化结果/失败原因。现有 toolTrace 只嵌在分析历史里，独立审计流尚未有存储。

## 6. 系统状态与审计

- GET `/admin-api/system/status` → `{nodeVersion, uptimeSec, diskFree, memoryRss, db:{records,bytes}, queue:{pendingAnalyses}, version, build}`
- GET `/admin-api/audit?from=&type=login|config_write|export|error` → 事件流 `{at,type,actor,summary}`；**日志脱敏硬要求**：不得含密钥、令牌、完整请求体（现 `serve.mjs` 只记方法+路径可作为实现基线）。

## 7. 实时推送（低优先）

GET `/admin-api/events`（SSE）→ `health`/`observation`/`analysis-saved` 事件。实现前前端以 10s 轮询代替。

## 8. 与本清单无关但前端受影响的已知后端问题

1. `gateway/runtime.mjs:166` `/api/health` 的 `transport` 二分（`source==='http'?'wifi-http':'serial-http'`）会把 `unknown` 显示为 `serial-http`——已在 `QWEN-HSP-SOURCE-SWEEP-20261102-Qwen.md` 登记，等后端修复；前端 `fmtSource` 不受影响。
2. `hsp-http.mjs` 的 `uptime_ms` 判重在板子重启后误判重复——待 `sessionBootId` 决策，影响总览页"最后采样"新鲜度。

## 9. 集成顺序建议

1（鉴权）→ 2（模型配置云端化，含持久目录）→ 4（查询/导出去窗口化）→ 3（设备，依赖链路 B）→ 5/6 → 7。
在 1 完成前，本平台只应绑定回环/受控局域网（README 已写同等警告）。
