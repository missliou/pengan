// 手写 SVG 折线趋势图。零依赖、可被 Node import 做主机单测（只依赖字符串输出）。
// 铁律：只绘制实际有效数据点；无效/缺失点保持缺口，绝不连线跨越缺口伪造趋势。

const W = 640, H = 190, PAD = { top: 12, right: 14, bottom: 24, left: 48 };

function niceBounds(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { lo, hi, step };
}

// points: Array<{t:number, v:number|null}>（按时间升序）。v=null 表示该时刻无有效读数 → 断开。
// 返回 SVG 字符串（内部全部数值化，不含外部文本注入面；标签文本由调用方在 DOM 层加）。
export function renderTrendSvg(points, opts = {}) {
  const color = opts.color || 'var(--c-primary, #0f766e)';
  const unit = opts.unit || '';
  const valid = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (valid.length === 0) return { svg: null, plotted: 0, gaps: points.length - valid.length };

  const tMin = valid[0].t, tMax = valid[valid.length - 1].t;
  const vMin = Math.min(...valid.map((p) => p.v)), vMax = Math.max(...valid.map((p) => p.v));
  const b = niceBounds(vMin, vMax);
  if (!b) return { svg: null, plotted: 0, gaps: points.length };

  const sx = (t) => tMax === tMin ? (W - PAD.right) : PAD.left + ((t - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const sy = (v) => PAD.top + (1 - (v - b.lo) / (b.hi - b.lo)) * (H - PAD.top - PAD.bottom);

  // 断线分段：null 或时间无效即切开。
  const segments = [];
  let seg = [];
  for (const p of points) {
    if (Number.isFinite(p.t) && Number.isFinite(p.v)) seg.push(`${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`);
    else { if (seg.length) segments.push(seg); seg = []; }
  }
  if (seg.length) segments.push(seg);

  const grid = [];
  for (let v = b.lo; v <= b.hi + 1e-9; v += b.step) {
    const y = sy(v).toFixed(1);
    grid.push(`<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="rgba(148,163,184,.25)" stroke-width="1" stroke-dasharray="3 3"/>`);
    const label = (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)) + (unit ? unit : '');
    grid.push(`<text x="${PAD.left - 8}" y="${Number(y) + 4}" text-anchor="end" font-size="11" fill="var(--c-text-dim, #64748b)">${label}</text>`);
  }

  const paths = segments.map((s) => s.length === 1
    ? `<circle class="trend-dot" cx="${s[0].split(',')[0]}" cy="${s[0].split(',')[1]}" r="3" fill="${color}"/>`
    : `<polyline points="${s.join(' ')}" class="trend-line" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`).join('');

  const dots = valid.length <= 60 ? valid.map((p) => `<circle class="trend-dot" cx="${sx(p.t).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="2.8" fill="${color}"/>`).join('') : '';

  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="有效读数趋势（共${valid.length}点，缺口${points.length - valid.length}处）" preserveAspectRatio="none">${grid.join('')}${paths}${dots}</svg>`;
  return { svg, plotted: valid.length, gaps: points.length - valid.length };
}
