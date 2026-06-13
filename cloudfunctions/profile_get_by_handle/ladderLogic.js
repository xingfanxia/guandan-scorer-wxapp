// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/ladderLogic.js @ b5c6a6699cd1e743804a1a283cb33bf481e263cf
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
/**
 * 天梯分（ladder rating）—— 简化 ELO，按「场」（整场通关）结算，不按局。
 *
 * 权重哲学（2026-06-12 用户调参）：个人表现 > 胜负 —— 输了但个人名次好要被激励
 * （小加分或只扣一点点），赢了躺平的混子保底 +1 不白嫖大分。
 * 队伍项：己队均分 vs 对队均分的期望胜率（强队赢弱队加分少、爆冷多得）。
 *
 * Pure ESM, zero host deps. The web ladder-sync endpoint + display import this
 * directly. ALGORITHMICALLY IDENTICAL to the guandan-scorer-wxapp sibling's
 * `miniprogram/core/ladder.js`, whose seedLadderRating CJS-mirrors into FOUR
 * cloudfunctions/{profile_sync, pool_bind, pool_list, profile_get_by_handle}
 * — 改算法两个 repo 都要同步。Spec: wxapp docs/PLAN.md WXAPP-9.
 */

const LADDER_BASE = 1000;
const LADDER_TEAM_K = 24;       // 队伍胜负项上限
const LADDER_PERF_K = 28;       // 个人表现项系数（实际区间约 ±14，> 队伍项）
const LADDER_WINNER_FLOOR = 1;  // 胜方保底
const LADDER_LOSER_GAIN_CAP = 6; // 负方加分封顶（输局高光最多 +6）

/**
 * 一场的天梯增量。
 * @param {Object} input
 * @param {number} input.mode - 人数（4/6/8），名次中位与表现归一用
 * @param {1|2} input.winnerTeam - 获胜队（非法值 → 全 0，宁可不动不可错判方向）
 * @param {Array<{id: number|string, team: 1|2, rating?: number, avgRanking?: number|null}>} input.players
 *   全部上场玩家：rating 缺省按 LADDER_BASE 计入队伍均分；avgRanking 为 null/缺省时该人表现项为 0
 * @returns {Map<string, number>} playerId(String) → 整数增量；输入不成立（任一队为空）→ 全 0
 */
function computeLadderDeltas({ mode, winnerTeam, players }) {
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

  const n = Number(mode) || list.length;
  const midRank = (n + 1) / 2;

  for (const p of list) {
    const won = Number(p.team) === winnerTeam;
    const teamDelta = Number(p.team) === 1 ? teamDelta1 : -teamDelta1;
    const avgRanking = Number(p.avgRanking);
    // 表现偏移 ∈ [−0.5, +0.5]（场均第 1 名 → +0.5；垫底 → −0.5）
    const perf = Number.isFinite(avgRanking) && avgRanking >= 1 && n > 1
      ? (midRank - Math.min(avgRanking, n)) / (n - 1)
      : 0;
    let delta = Math.round(teamDelta + LADDER_PERF_K * perf);
    // 胜方保底（赢了不倒扣）；负方高光封顶（输局打神了小加分，但不超过 +6）
    delta = won ? Math.max(LADDER_WINNER_FLOOR, delta) : Math.min(LADDER_LOSER_GAIN_CAP, delta);
    deltas.set(String(p.id), delta);
  }
  return deltas;
}

/**
 * 起评分：从 web 版历史战绩折算首次天梯分（同口径：名次为主、胜负为辅）。
 * 起评分 = 1000 + 置信度×(250×(4.5−场均名次)/3.5 + 300×(胜率−0.5))，钳 [700,1300]；
 * 置信度 = min(场次,20)/20 —— 场次少贴 1000 起步。只在 ladder.sessions===0 时用，
 * 永不覆盖已挣的分。场均名次按 8 人局中位 4.5 归一（web 历史以 8 人局为主，
 * 混入 4/6 人局的失真被权重和钳制兜住）。
 * @param {{sessionsPlayed?: number, sessionsWon?: number, avgRankingPerSession?: number}} webStats
 */
function seedLadderRating(webStats) {
  const s = Math.max(0, Number(webStats && webStats.sessionsPlayed) || 0);
  if (s <= 0) return LADDER_BASE;
  const won = Math.min(s, Math.max(0, Number(webStats.sessionsWon) || 0));
  const winRate = won / s;
  const avgRank = Number(webStats.avgRankingPerSession);
  const rankNorm = Number.isFinite(avgRank) && avgRank >= 1
    ? (4.5 - Math.min(avgRank, 8)) / 3.5
    : 0;
  const conf = Math.min(s, 20) / 20;
  const rating = Math.round(LADDER_BASE + conf * (250 * rankNorm + 300 * (winRate - 0.5)));
  return Math.max(700, Math.min(1300, rating));
}

/** 把一场的增量应用到单人 ladder 累计（{rating, sessions, peak}，缺省补全） */
function applyLadderDelta(ladder, delta) {
  const cur = ladder && typeof ladder === 'object' ? ladder : {};
  const rating = Math.max(0, Math.round(
    (Number.isFinite(Number(cur.rating)) ? Number(cur.rating) : LADDER_BASE) + (Number(delta) || 0)
  ));
  const sessions = (Number.isFinite(Number(cur.sessions)) ? Number(cur.sessions) : 0) + 1;
  const peak = Math.max(rating, Number.isFinite(Number(cur.peak)) ? Number(cur.peak) : LADDER_BASE);
  return { rating, sessions, peak };
}

module.exports = { LADDER_BASE, LADDER_TEAM_K, LADDER_PERF_K, LADDER_WINNER_FLOOR, LADDER_LOSER_GAIN_CAP, computeLadderDeltas, seedLadderRating, applyLadderDelta };
