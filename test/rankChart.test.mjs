import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankChartGeometry, RANK_CHART_PAD } from '../miniprogram/core/rankChart.js';

describe('rankChart.rankChartGeometry（近期排名走势几何）', () => {
  it('空/单点的边界处理', () => {
    assert.equal(rankChartGeometry([], 8, 300, 120), null);
    const one = rankChartGeometry([3], 8, 300, 120);
    assert.equal(one.pts.length, 1);
    // 单点居中
    const plotW = 300 - RANK_CHART_PAD.left - RANK_CHART_PAD.right;
    assert.equal(Math.round(one.pts[0].x), Math.round(RANK_CHART_PAD.left + plotW / 2));
  });

  it('名次 1 在顶、max 在底（轴反转：好名次在上）', () => {
    const g = rankChartGeometry([1, 8], 8, 300, 120);
    const top = RANK_CHART_PAD.top;
    const bottom = 120 - RANK_CHART_PAD.bottom;
    // 第一点 rank=1 → y 在顶；第二点 rank=8 → y 在底
    assert.ok(Math.abs(g.pts[0].y - top) < 0.5, 'rank1 应贴顶');
    assert.ok(Math.abs(g.pts[1].y - bottom) < 0.5, 'rankMax 应贴底');
    // x 均匀：首点贴左 plot 边、末点贴右 plot 边
    assert.equal(Math.round(g.pts[0].x), RANK_CHART_PAD.left);
    assert.equal(Math.round(g.pts[1].x), 300 - RANK_CHART_PAD.right);
  });

  it('点色按名次：1=win，≤3=blue，否则 loss', () => {
    const g = rankChartGeometry([1, 3, 5], 8, 300, 120);
    assert.equal(g.pts[0].tone, 'win');
    assert.equal(g.pts[1].tone, 'blue');
    assert.equal(g.pts[2].tone, 'loss');
  });

  it('gridY 含 #1 与 #max 两条参考线', () => {
    const g = rankChartGeometry([2, 4], 8, 300, 120);
    const vals = g.gridY.map(r => r.val);
    assert.ok(vals.includes(1));
    assert.ok(vals.includes(8));
  });
});
