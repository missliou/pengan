// 时间与数值格式化，以及后端字段的人类可读映射。
// 原则：缺值就是"未知/未接入"，不补 0、不补假数据。

const pad = (n) => String(n).padStart(2, '0');

export const fmtTaskState = value => ({running:'处理中',completed:'已完成',failed:'失败',queued:'等待处理'})[value] || '状态未知';
export const fmtVerdict = value => ({allow:'通过',block:'规则拦截',needs_human:'待人工复核'})[value] || '尚未判定';

export function fmtDateTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '未知';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '未知';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// "3 分钟前" 相对时间，超过一天回落到绝对日期。
export function fmtRelative(ts, now = Date.now()) {
  if (!Number.isFinite(ts) || ts <= 0) return '未知';
  const diff = now - ts;
  if (diff < 0) return '刚刚（时钟超前）';
  if (diff < 60_000) return Math.round(diff / 1000) + ' 秒前';
  if (diff < 3_600_000) return Math.round(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + ' 小时前';
  return fmtDateTime(ts);
}

export function fmtAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '未知';
  if (ms < 1000) return ms + ' 毫秒';
  if (ms < 60_000) return (ms / 1000).toFixed(1) + ' 秒';
  return (ms / 60_000).toFixed(1) + ' 分钟';
}

export function fmtValue(value, unit = '', digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '未知';
  return value.toFixed(digits) + (unit ? ' ' + unit : '');
}

// 来源标签：真实实现有 serial/http/unknown(/dayu-direct) 四值。
// 这里显式列举，绝不写 `=== 'http' ? … : 'serial'` 那种会把 unknown 误标成串口的二分。
const SOURCE_LABEL = {
  serial: '串口',
  http: '局域网HTTP',
  unknown: '未知来源',
  'dayu-direct': 'DAYU200直采',
};
export function fmtSource(source) {
  if (source === null || source === undefined || source === '') return '未知来源';
  return SOURCE_LABEL[source] || ('未知来源（' + String(source) + '）');
}
export function sourceKind(source) {
  if (source === 'serial' || source === 'http' || source === 'dayu-direct') return 'info';
  return 'unknown'; // unknown / 其它一律不假装成串口
}

// 读取原因码 → 中文。reason 恒为 read_only_hardware 于成功帧，成败看 deviceOnline。
const REASON_LABEL = {
  read_only_hardware: '只读真实采集',
  telemetry_stale: '遥测过期',
  invalid_receive_time: '接收时间无效',
  invalid_hsp_sample: '样本无效',
  hardware_not_connected: '设备未连接',
  hardware_read_failed: '读取失败',
  hardware_file_too_large: '样本文件过大',
  invalid_hsp_identity: '设备身份不符',
  invalid_hsp_quality: '质量字段无效',
  invalid_hsp_climate: '温湿度越界',
  invalid_hsp_adc: 'ADC 越界',
  // 原生直采自有原因码（DirectTelemetry.ets）
  board_not_configured: '未配置设备地址',
  board_http_failed: '设备请求失败',
  board_telemetry_unavailable: '设备遥测暂不可用',
  board_frame_too_large: '设备帧过大',
  board_sample_too_slow: '设备响应过慢',
  board_duplicate_frame: '重复帧（未更新）',
  board_sample_not_updating: '样本长时间未更新',
  board_address_changed: '地址已变更',
};
export function fmtReason(reason) {
  if (!reason) return '';
  return REASON_LABEL[reason] || reason;
}

const AI_ERROR_LABEL = {
  ai_not_configured: '模型尚未配置',
  ai_provider_http_401: '密钥校验失败',
  ai_provider_http_403: '账户无当前调用权限',
  ai_provider_http_404: '模型或接口不存在',
  ai_provider_http_429: '模型服务限流',
  ai_provider_http_400: '请求不被支持（核对工具/图像能力）',
  ai_analysis_timeout: '模型请求超时',
  ai_busy_try_later: '模型正处理其它请求',
  ai_connection_failed: '模型连接失败',
  ai_invalid_json: '模型返回格式异常',
  ai_response_too_large: '模型返回过大',
  ai_missing_connection_tool: '未获得有效工具回执',
  ai_invalid_tool_arguments: '工具参数无效',
  invalid_ai_config: '配置字段无效',
  key_required_for_provider: '该服务商需要密钥',
  config_save_failed: '配置保存失败',
  ai_config_load_failed: '配置读取失败',
  config_token_required: '缺少配置令牌（CSRF）',
  origin_denied: '来源被拒绝',
};
export function fmtAiError(code) {
  if (!code) return '未知错误';
  return AI_ERROR_LABEL[code] || (code.startsWith('ai_provider_http_') ? `模型服务 HTTP ${code.slice(17)}` : code);
}

export function fmtBytes(n) {
  if (!Number.isInteger(n) || n < 0) return '未知';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
