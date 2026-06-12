/**
 * profileSession — 战绩入库 payload 的纯构造（Node 可测）。
 * 按 playerId 维度构造；openid 归属解析（claims ∪ pool 绑定）全部在服务端
 * profile_sync 内完成 —— 客户端不接触任何 openid 映射。
 */
import { aggregateSession, computeSessionHonors } from './victoryStats.js';

/**
 * @param {Object} state - gameStore 状态
 * @returns {Array} profile_sync 的 sessions 入参（playerId 维度，含可选 handle）
 */
export function buildProfileSessions(state) {
  const agg = aggregateSession(state);
  const honors = computeSessionHonors(state);
  const handleOf = new Map(
    (state.players || []).filter(p => p.handle).map(p => [p.id, p.handle])
  );

  return agg.players.map(p => ({
    playerId: p.id,
    handle: handleOf.get(p.id) || null,
    mode: state.mode,
    teamWon: p.teamWon,
    gamesInSession: p.games,
    avgRanking: p.avgRanking,
    firstPlaces: p.firstPlaces,
    lastPlaces: p.lastPlaces,
    partnerPlayerIds: p.partnerIds,
    opponentPlayerIds: p.opponentIds,
    honorsEarned: honors[p.id] || []
  }));
}
