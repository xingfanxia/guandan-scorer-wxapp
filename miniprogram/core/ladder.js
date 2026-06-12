/**
 * 天梯分（WXAPP-9）—— 简化 ELO，按「场」结算。spec 见 docs/PLAN.md WXAPP-9。
 *
 * 因素：己队均分 vs 对队均分（强队赢弱队加分少、爆冷多得）+ 个人场内表现
 * （场均名次相对中位的偏移，同队内拉开差距）。
 *
 * 纯函数，服务端权威实现在 cloudfunctions/profile_sync 里 CJS 镜像同算法
 * （同 voteSessionKey 镜像先例 —— 改这里记得同步那边）。
 */

export const LADDER_BASE = 1000;
export const LADDER_TEAM_K = 32; // 队伍胜负增量上限
export const LADDER_PERF_K = 16; // 个人表现增量系数（实际区间约 ±8）

/**
 * 一场的天梯增量。
 * @param {Object} input
 * @param {number} input.mode - 人数（4/6/8），名次中位与表现归一用
 * @param {1|2} input.winnerTeam - 获胜队
 * @param {Array<{id: number|string, team: 1|2, rating?: number, avgRanking?: number|null}>} input.players
 *   全部上场玩家：rating 缺省按 LADDER_BASE 计入队伍均分；avgRanking 为 null/缺省时该人表现增量为 0
 * @returns {Map<string, number>} playerId(String) → 整数增量；输入不成立（任一队为空）→ 全 0
 */
export function computeLadderDeltas({ mode, winnerTeam, players }) {
  const list = Array.isArray(players) ? players : [];
  const deltas = new Map(list.map(p => [String(p.id), 0]));

  const t1 = list.filter(p => Number(p.team) === 1);
  const t2 = list.filter(p => Number(p.team) === 2);
  if (t1.length === 0 || t2.length === 0 || (winnerTeam !== 1 && winnerTeam !== 2)) {
    return deltas;
  }

  const ratingOf = (p) => (Number.isFinite(Number(p.rating)) ? Number(p.rating) : LADDER_BASE);
  const avg = (team) => team.reduce((s, p) => s + ratingOf(p), 0) / team.length;
  const avg1 = avg(t1);
  const avg2 = avg(t2);

  // E1 = 队1 期望胜率；强队期望高 → 赢了 (S−E) 小 → 加分少
  const e1 = 1 / (1 + Math.pow(10, (avg2 - avg1) / 400));
  const teamDelta1 = LADDER_TEAM_K * ((winnerTeam === 1 ? 1 : 0) - e1);
  const teamDelta2 = -teamDelta1; // 零和

  const n = Number(mode) || list.length;
  const midRank = (n + 1) / 2;

  for (const p of list) {
    const teamDelta = Number(p.team) === 1 ? teamDelta1 : teamDelta2;
    const avgRanking = Number(p.avgRanking);
    // 表现偏移 ∈ [−0.5, +0.5]（场均第 1 名 → +0.5；垫底 → −0.5）
    const perf = Number.isFinite(avgRanking) && avgRanking >= 1 && n > 1
      ? (midRank - Math.min(avgRanking, n)) / (n - 1)
      : 0;
    deltas.set(String(p.id), Math.round(teamDelta + LADDER_PERF_K * perf));
  }
  return deltas;
}

/** 把一场的增量应用到单人 ladder 累计（{rating, sessions, peak}，缺省补全） */
export function applyLadderDelta(ladder, delta) {
  const cur = ladder && typeof ladder === 'object' ? ladder : {};
  const rating = Math.max(0, Math.round(
    (Number.isFinite(Number(cur.rating)) ? Number(cur.rating) : LADDER_BASE) + (Number(delta) || 0)
  ));
  const sessions = (Number.isFinite(Number(cur.sessions)) ? Number(cur.sessions) : 0) + 1;
  const peak = Math.max(rating, Number.isFinite(Number(cur.peak)) ? Number(cur.peak) : LADDER_BASE);
  return { rating, sessions, peak };
}
