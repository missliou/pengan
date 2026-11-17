// 网络访问统一适配层。
// 原则：
// 1) 每个函数标注它对应的后端接口——[已有] 现有 gateway 电脑测试服务已实现；
//    [待实现] 云端管理 API 尚未存在，调用会明确失败，绝不假装成功。
// 2) 后端不可达时抛 ApiError{kind:'offline'}，界面据此显示"未连接"。
// 3) 本层不写任何密钥；密钥只在"保存配置"的请求体里短暂经过，不进日志、不进存储。
import { getEnv } from './env.js';
export const getWeather = (options={}) => request('/weather',{...options,base:ADMIN(),maxBytes:65536,timeoutMs:10000});
export const generateWeatherAdvice = (body,options={}) => request('/weather/advice',{...options,base:ADMIN(),method:'POST',body,maxBytes:32768,timeoutMs:35000});
export const listCropImages = (params={},options={}) => request('/crop-reviews'+(params.beforeSeq?'?beforeSeq='+encodeURIComponent(params.beforeSeq):''),{...options,base:ADMIN(),maxBytes:262144});
export const getCropReview = (id,options={}) => request('/crop-reviews?mediaId='+encodeURIComponent(id),{...options,base:ADMIN(),maxBytes:32768});
export const getCropReviewVersions = (id,options={}) => request('/crop-reviews?history=1&mediaId='+encodeURIComponent(id),{...options,base:ADMIN(),maxBytes:131072});
export const saveCropReview = (body,options={}) => request('/crop-reviews',{...options,base:ADMIN(),method:'POST',body,maxBytes:32768});
let sessionCsrf = '';
export function clearAdminSession() { sessionCsrf = ''; }
function rememberSession(value) {
  sessionCsrf = '';
  if (value?.authenticated !== true || !['admin','viewer'].includes(value.user?.role) || typeof value.user?.username !== 'string' || typeof value.csrfToken !== 'string' || !value.csrfToken) throw new ApiError('管理会话协议无效', {kind:'parse'});
  sessionCsrf = value.csrfToken; return value;
}

export class ApiError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = opts.kind || 'error';        // offline | http | parse | not_implemented | forbidden
    this.status = opts.status || 0;
    this.code = opts.code || '';              // 后端返回的 error 字段
  }
}

async function readText(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ApiError('响应超过大小限制', { kind: 'parse' });
    return text;
  }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new ApiError('响应超过大小限制', { kind: 'parse' }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ApiError('响应不是有效的UTF-8文本', { kind: 'parse' }); }
}

async function request(path, { method = 'GET', body, headers = {}, base, signal, gatewayId, maxBytes: responseLimit, timeoutMs } = {}) {
  const root = base ?? getEnv().API_BASE;
  const url = root + path + (gatewayId ? (path.includes('?') ? '&' : '?') + 'gatewayId=' + encodeURIComponent(gatewayId) : '');
  const deadline = AbortSignal.timeout(timeoutMs ?? (method === 'GET' ? 9000 : 35000));
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const init = { method, headers: { Accept: 'application/json', ...headers }, redirect: 'error', credentials: 'same-origin', signal: combined };
  if (method !== 'GET' && sessionCsrf) init.headers['x-pengan-csrf'] = sessionCsrf;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  let response, text;
  try {
    response = await fetch(url, init);
    const maxBytes = path.startsWith('/agent/history') ? 2 * 1024 * 1024 : path.startsWith('/reports/') || path.startsWith('/hardware/history') ? 1024 * 1024 : 65536;
    text = await readText(response, responseLimit ?? maxBytes);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw new ApiError('页面已变化，旧请求已取消', { kind: 'stale' });
    if (combined.aborted) throw new ApiError(method === 'GET' ? '读取超时，请重试' : '操作超时，结果未确认，请刷新配置核对', { kind: 'timeout' });
    // fetch 直接抛错 = 网络层失败（服务未启动 / 断网 / CORS）。
    throw new ApiError(method === 'GET' ? '后端不可达' : '连接中断，操作结果未确认，请刷新配置核对', { kind: 'offline' });
  }
  if (!response.ok) {
    if (response.status === 401) { const hadSession = Boolean(sessionCsrf); clearAdminSession(); if (hadSession && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('pengan-session-expired')); }
    let code = '';
    try { const raw = (JSON.parse(text) || {}).error; if (typeof raw === 'string' && /^[a-z0-9_]{1,80}$/.test(raw)) code = raw; } catch { /* 非 JSON 错误体 */ }
    const kind = response.status === 401 || response.status === 403 ? 'forbidden' : 'http';
    throw new ApiError(code ? `请求失败（${code}）` : `请求失败 HTTP ${response.status}`, { kind, status: response.status, code });
  }
  try { return text.length ? JSON.parse(text) : null; }
  catch { throw new ApiError('响应格式无效', { kind: 'parse' }); }
}

function notImplemented(feature, method, path, base) {
  const e = new ApiError(`${feature}：后端接口未实现`, { kind: 'not_implemented' });
  e.method = method; e.path = path; e.base = base;
  return Promise.reject(e);
}

const ADMIN = () => getEnv().ADMIN_API_BASE;
export const getAgentPrompts = (options={}) => request('/agent/prompts',{...options,base:ADMIN()});
export const listMedia = (params={}, options={}) => request('/media?'+new URLSearchParams(params),{...options,base:ADMIN(),maxBytes:262144});
export const uploadMedia = (body, options={}) => request('/media',{...options,base:ADMIN(),method:'POST',body});
export const getStorageStatus = (options={}) => request('/storage',{...options,base:ADMIN()});
export const mediaContentUrl = (id,options={}) => ADMIN()+'/media/'+encodeURIComponent(id)+'/content?gatewayId='+encodeURIComponent(options.gatewayId||'');

// ===== 服务与总览 =====

// [已有] GET /api/health  健康、模式、transport、hardwareConnected
export const getHealth = (options = {}) => request('/health', options);

// [已有] GET /api/observations  真实模式当前观测快照（含 hardware.source/reason/时效）
export const getObservations = (options = {}) => request('/observations', options);

// [已有] GET /api/agent/status  模型配置状态（configured/provider/model/connectionCheck 等）
export const getModelStatus = (options = {}) => request('/agent/status', options);

// [已有] GET /api/device  模拟网关快照（真实模式被禁用；仅用于识别是否在模拟服务上）
export const getDeviceSnapshot = () => request('/device');

// ===== 模型配置（电脑网关现有实现，云端需以管理员鉴权重写）=====

// [已有] GET /api/agent/config  返回配置状态 + csrfToken（configStatus 含 keySaved，不含明文 key）
export const getModelConfig = (options = {}) => request('/agent/config', options);

// [已有] POST /api/agent/config  保存/替换/清除配置。必须带 x-pengan-config-token 头。
//        body: { provider, model, key?, workspaceId?, clearKey? }
export const saveModelConfig = (config, csrfToken) =>
  request('/agent/config', { method: 'POST', body: config, headers: csrfToken ? { 'x-pengan-config-token': csrfToken } : {} });

// [已有] POST /api/agent/test {}  手动连接测试（仅合成问题 + verify_connection，不发现场数据/照片）
export const testModelConnection = () => request('/agent/test', { method: 'POST', body: {} });

// ===== 历史与记录 =====

// [已有] GET /api/hardware/history?limit=&beforeSeq=  真实采集历史（存储状态 + items）
export const getHardwareHistory = ({ limit = 50, beforeSeq } = {}, options = {}) => {
  let q = '/hardware/history?limit=' + encodeURIComponent(String(limit));
  if (beforeSeq != null) q += '&beforeSeq=' + encodeURIComponent(String(beforeSeq));
  return request(q, options);
};

// [已有] GET /api/agent/history?limit=  AI 文字分析历史
export const getAnalysisHistory = ({ limit = 20, beforeSeq } = {}, options = {}) =>
  request('/agent/history?limit=' + encodeURIComponent(String(limit)) + (beforeSeq != null ? '&beforeSeq='+encodeURIComponent(String(beforeSeq)) : ''), options);

// [已有] GET /api/reports/latest  真实会话报告（当前快照 + 最近窗口，非完整历史）
export const getRealReport = (options = {}) => request('/reports/latest', options);

// ===== 以下云端管理能力：后端尚未实现，明确占位并如实报错 =====

// [待实现] 管理端登录 / 会话 / 退出
export const adminLogin = async (credentials) => { clearAdminSession(); return rememberSession(await request('/session/login', {base:ADMIN(),method:'POST',body:credentials})); };
export const adminLogout = async () => { try { return await request('/session/logout',{base:ADMIN(),method:'POST',body:{}}); } finally { clearAdminSession(); } };
export const adminSession = async () => rememberSession(await request('/session',{base:ADMIN()}));

// [待实现] 设备管理（列表 / 关联 / 配对令牌 / 诊断）
export const listDevices = (options = {}) => request('/devices',{...options,base:ADMIN()});

// POST /admin-api/devices/token  仅 admin。令牌明文只出现这一次，服务端只保存 SHA-256 摘要。
export const issueDeviceToken = (body = {}, options = {}) =>
  request('/devices/token', {...options, base:ADMIN(), method:'POST', body, timeoutMs:15000});
export const getDeviceDetail = () => notImplemented('设备详情', 'GET', '/devices/{id}', ADMIN());

// [待实现] 服务端分页 / 条件筛选 / 服务端导出
export const queryRecords = () => notImplemented('条件化记录查询', 'GET', '/records', ADMIN());
export const exportRecords = () => notImplemented('服务端导出', 'POST', '/records/export', ADMIN());

// [待实现] AI 任务过程留痕（规划 / 工具调用 / 保存结果 的持久化审计流）
export const getAgentTasks = () => notImplemented('AI 任务过程记录', 'GET', '/agent/tasks', ADMIN());

// [待实现] 系统状态与审计（后端 / 存储 / 配置变更 / 登录事件）
export const getSystemStatus = () => notImplemented('系统状态', 'GET', '/system/status', ADMIN());
export const getAuditEvents = (options = {}) => request('/audit?limit=50',{...options,base:ADMIN()});

// [待实现] 实时推送（当前总览只能轮询）
export const subscribeLive = () => notImplemented('实时推送', 'GET', '/events', ADMIN());

export const API = {
  request, ApiError, notImplemented,
  getHealth, getObservations, getModelStatus, getDeviceSnapshot,
  getModelConfig, saveModelConfig, testModelConnection,
  getHardwareHistory, getAnalysisHistory, getRealReport,
  adminLogin, adminLogout, adminSession,
  listDevices, getDeviceDetail, queryRecords, exportRecords,
  getAgentTasks, getSystemStatus, getAuditEvents, subscribeLive,
};

// Authenticated cloud RAG and durable pipeline task APIs.
export const startPipeline = (body, options = {}) => request('/agent/pipeline', {...options, method:'POST', body, timeoutMs:10000});
export const listPipelineTasks = (options = {}) => request('/pipeline/tasks', {...options, base:ADMIN(), maxBytes:262144});
export const readPipelineTask = (id, options = {}) => request('/pipeline/tasks/'+encodeURIComponent(id), {...options, base:ADMIN(), maxBytes:262144});
export const listKnowledge = (options = {}) => request('/knowledge', {...options, base:ADMIN(), maxBytes:262144});
export const saveKnowledge = (body, options = {}) => request('/knowledge', {...options, base:ADMIN(), method:'POST', body, timeoutMs:10000});
export const searchKnowledge = (body, options = {}) => request('/knowledge/search', {...options, base:ADMIN(), method:'POST', body, timeoutMs:10000, maxBytes:262144});

// ===== 人工审核中心（后端 gateway/human-review.mjs 已实现并接线）=====

// [已有] GET /admin-api/review?gatewayId=&verdict=&reviewStatus=&limit=
//        队列由持久化审计链派生；admin/viewer 均可读。
export const listReviewQueue = ({verdict = 'needs_human', reviewStatus = null, limit = 50} = {}, options = {}) => {
  let q = '/review?verdict=' + encodeURIComponent(String(verdict));
  if (reviewStatus) q += '&reviewStatus=' + encodeURIComponent(String(reviewStatus));
  q += '&limit=' + encodeURIComponent(String(limit));
  return request(q, {...options, base:ADMIN(), maxBytes:262144});
};

// [已有] GET /admin-api/review/{taskId}  详情：问题、阶段结果、风险原因、RAG 引用、事件与历史意见。
export const readReviewTask = (taskId, options = {}) =>
  request('/review/' + encodeURIComponent(String(taskId)), {...options, base:ADMIN(), maxBytes:262144});

// [已有] POST /admin-api/review/{taskId}  提交人工意见（仅 admin；需 CSRF 头，由 request 自动附带）。
//        body: { taskId, decision:'approve'|'reject', comment, version }
//        服务端拒绝基于过期版本的提交；精确重试幂等；硬规则 block 不可通过。
export const submitReview = ({taskId, ...body} = {}, options = {}) =>
  request('/review/' + encodeURIComponent(String(taskId)), {...options, base:ADMIN(), method:'POST', body, timeoutMs:15000});

// ===== 告警中心（契约 docs/告警中心接口契约.md 第 5 节；后端 gateway/alerts.mjs）=====
// 计数与口径由服务端返回（counts / countBasis），本层只搬运，不在前端重算。

// GET /admin-api/alerts?gatewayId=&type=&severity=&status=&cursor=&limit=
// 响应含 counts、countBasis、source、items 与不透明游标 nextCursor（末页为 null）。
export const listAlerts = ({type = null, severity = null, status = null, cursor = null, limit = 20} = {}, options = {}) => {
  let q = '/alerts?limit=' + encodeURIComponent(String(limit));
  if (type) q += '&type=' + encodeURIComponent(String(type));
  if (severity) q += '&severity=' + encodeURIComponent(String(severity));
  if (status) q += '&status=' + encodeURIComponent(String(status));
  if (cursor) q += '&cursor=' + encodeURIComponent(String(cursor));
  return request(q, {...options, base:ADMIN(), maxBytes:262144});
};

// GET /admin-api/alerts/{alertId}  单条完整记录（acks / notes / evidence / relatedTaskIds）。
export const readAlert = (alertId, options = {}) =>
  request('/alerts/' + encodeURIComponent(String(alertId)), {...options, base:ADMIN(), maxBytes:262144});

// POST /admin-api/alerts/{alertId}/ack  仅 admin；需 CSRF 头（request 自动附带）。
// body: {expectedRevision, note?}；服务端校验 revision，冲突返回 alert_revision_conflict(409)。
export const acknowledgeAlert = ({alertId, expectedRevision, note} = {}, options = {}) => {
  const body = {expectedRevision};
  if (typeof note === 'string' && note) body.note = note;
  return request('/alerts/' + encodeURIComponent(String(alertId)) + '/ack', {...options, base:ADMIN(), method:'POST', body, timeoutMs:15000});
};

// POST /admin-api/alerts/{alertId}/note  仅 admin；备注只追加，禁止覆盖既有 acks/notes。
export const noteAlert = ({alertId, expectedRevision, text} = {}, options = {}) =>
  request('/alerts/' + encodeURIComponent(String(alertId)) + '/note', {...options, base:ADMIN(), method:'POST', body:{expectedRevision, text}, timeoutMs:15000});

