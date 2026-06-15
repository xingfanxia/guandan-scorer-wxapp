/**
 * rankChart — 近期排名走势折线图（对位 web player-profile.html recentRankingsChart）。
 * 几何与绘制分层（仿 poster.js）：rankChartGeometry 纯函数算坐标（Node 可测），
 * paintRankChart 吃 ctx 落墨。轴反转：名次 1（最好）在顶、max 在底。
 *
 * 主题色为 DESIGN.md §2 token 的 canvas 镜像（canvas 取不到 CSS 变量，与 poster.js 同例外，
 * 见 DESIGN.md §10）—— 改 tokens 时这里要同步。
 */
export const RANK_CHART_PAD = { left: 30, right: 14, top: 14, bottom: 24 };

const RANK_CHART_THEME = {
  light: {
    accent: '#15694B', accentSoft: 'rgba(21,105,75,0.12)',
    win: '#15694B', blue: '#2A5DB0', loss: '#B6403B',
    grid: 'rgba(27,34,30,0.10)', ink: '#5A655E', surface: '#FFFFFF'
  },
  dark: {
    accent: '#46B98D', accentSoft: 'rgba(70,185,141,0.18)',
    win: '#46B98D', blue: '#7CACFF', loss: '#FF8077',
    grid: 'rgba(240,243,239,0.12)', ink: '#9AA69E', surface: '#1A201C'
  }
};

export function rankChartColors(theme) {
  return RANK_CHART_THEME[theme === 'dark' ? 'dark' : 'light'];
}

const toneOf = (r) => (r <= 1.5 ? 'win' : r <= 3.5 ? 'blue' : 'loss');

/**
 * @param {number[]} points 名次序列（旧→新）
 * @param {number} max 轴上限（≥8）
 * @param {number} w,h CSS 像素尺寸
 * @returns {null | {pts:[{x,y,r,tone}], gridY:[{val,y}]}}
 */
export function rankChartGeometry(points, max, w, h) {
  const arr = (Array.isArray(points) ? points : []).map(Number).filter((v) => Number.isFinite(v) && v >= 1);
  if (arr.length === 0) return null;
  const M = Math.max(8, Math.ceil(Number(max) || 8));
  const { left, right, top, bottom } = RANK_CHART_PAD;
  const plotW = Math.max(1, w - left - right);
  const plotH = Math.max(1, h - top - bottom);
  const yOf = (r) => {
    const rr = Math.min(M, Math.max(1, r));
    return M > 1 ? top + ((rr - 1) / (M - 1)) * plotH : top;
  };
  const n = arr.length;
  const xOf = (i) => (n <= 1 ? left + plotW / 2 : left + (i / (n - 1)) * plotW);
  const pts = arr.map((r, i) => ({ x: xOf(i), y: yOf(r), r, tone: toneOf(r) }));
  const mid = Math.round((1 + M) / 2);
  const gridVals = [...new Set([1, mid, M])].filter((v) => v >= 1 && v <= M);
  const gridY = gridVals.map((val) => ({ val, y: yOf(val) }));
  return { pts, gridY };
}

/** 落墨：网格 + y 轴 #N 标签 + 半透明填充 + 折线 + 名次点（按 tone 配色） */
export function paintRankChart(ctx, geo, w, h, theme) {
  if (!ctx || !geo) return;
  const c = rankChartColors(theme);
  const { left, right, top, bottom } = RANK_CHART_PAD;
  ctx.clearRect(0, 0, w, h);

  // 网格线 + y 标签
  ctx.lineWidth = 1;
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  for (const g of geo.gridY) {
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    ctx.moveTo(left, g.y);
    ctx.lineTo(w - right, g.y);
    ctx.stroke();
    ctx.fillStyle = c.ink;
    ctx.textAlign = 'right';
    ctx.fillText('#' + g.val, left - 6, g.y + 3);
  }

  const pts = geo.pts;
  // 填充区域（折线下方到底边）
  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, h - bottom);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1].x, h - bottom);
    ctx.closePath();
    ctx.fillStyle = c.accentSoft;
    ctx.fill();
    // 折线
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 名次点（白环 + tone 实心）
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = p.tone === 'win' ? c.win : p.tone === 'blue' ? c.blue : c.loss;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.surface;
    ctx.stroke();
  }
}
