// 浏览器端状态存放。
// 硬约束：localStorage 只允许放白名单里的非敏感界面偏好；
// 密钥、令牌、现场数据一律不写入浏览器持久存储（需求第六节）。

const ALLOWED_KEYS = new Set(['ui.sidebarOpen', 'ui.lastProvider', 'ui.lastModel', 'ui.demoMode', 'ui.pageSize', 'ui.navCollapsed']);
const PREFIX = 'pengan-admin.';

function safeStorage() {
  try {
    const t = '__pengan_probe__';
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return localStorage;
  } catch { return null; } // 隐私模式 / 禁用存储时静默降级为内存
}

const memory = new Map();
const store = safeStorage();

export function getPref(key, fallback = null) {
  if (!ALLOWED_KEYS.has(key)) throw new Error('非白名单存储键被拒绝：' + key);
  try {
    const raw = store ? store.getItem(PREFIX + key) : memory.get(key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function setPref(key, value) {
  if (!ALLOWED_KEYS.has(key)) throw new Error('非白名单存储键被拒绝：' + key);
  const raw = JSON.stringify(value);
  try { if (store) store.setItem(PREFIX + key, raw); else memory.set(key, raw); } catch { /* 存满等异常按无持久化处理 */ }
}

export function clearPrefs() {
  for (const key of ALLOWED_KEYS) {
    try { if (store) store.removeItem(PREFIX + key); else memory.delete(key); } catch { /* 忽略 */ }
  }
}
