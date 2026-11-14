// 分页与筛选纯函数（与 DOM 无关，可被 Node 直接 import 做主机测试）。
// 现有后端接口只提供 limit/beforeSeq 游标；本页按"已取回数据"做客户端分页与筛选，
// 服务端条件查询属于 [待实现]，接口就绪后本模块只是兼容层。

// items 里每条至少有 { seq }。返回当前页条目与页信息。
export function paginate(items, page, pageSize) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: current, pageCount, total, start, end: Math.min(total, start + pageSize) };
}

// 关键字筛选：只在 textOf 明确给出的字段上做不区分大小写包含匹配。
export function filterRows(rows, query, textOf) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => textOf(row).toLowerCase().includes(q));
}

// 按读数有效性筛选：mode = 'all' | 'valid' | 'unknown'
export function filterByValidity(rows, mode, validOf) {
  if (mode === 'valid') return rows.filter(validOf);
  if (mode === 'unknown') return rows.filter((r) => !validOf(r));
  return rows;
}

// 按时间范围筛选（毫秒）。start/end 为 null 表示不设限。
export function filterByRange(rows, start, end, timeOf) {
  return rows.filter((row) => {
    const t = timeOf(row);
    if (!Number.isFinite(t) || t <= 0) return start === null && end === null; // 时间未知的行：无范围限制时保留，有限制时排除
    if (start !== null && t < start) return false;
    if (end !== null && t > end) return false;
    return true;
  });
}

// 导出前校验：只导出当前筛选视图里的行，返回 CSV 文本。
// 未知值一律留空（与既有 CSV 导出口径一致），绝不填 0 或猜测。
export function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map((c) => esc(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => esc(c.value(row))).join(','));
  return head + '\r\n' + body.join('\r\n') + (body.length ? '\r\n' : '');
}
