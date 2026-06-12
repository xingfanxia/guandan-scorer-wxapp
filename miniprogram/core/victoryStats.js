/**
 * victoryStats — 胜利结算的纯计算（Node 可测）：
 * - aggregateSession：从 history.playerRankings 聚合每个玩家的本场数据（喂 profile_sync）
 * - computeSessionMvp：全场最低平均排名（web 版同算法）
 * - computeSessionHonors：本场 16 荣誉得主（vendored honorLogic，与 web 同算法）
 */
import { calculateHonorsFromData } from '../shared-logic/honorLogic.js';
import { HONOR_TITLES_BY_KEY } from '../shared-logic/honorCatalog.js';

export function aggregateSession(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  const players = Array.isArray(state.players) ? state.players : [];
  const winnerKey = state.gameStatus && state.gameStatus.winnerKey;

  const byId = new Map();
  for (const entry of history) {
    const rankings = entry && entry.playerRankings;
    if (!rankings || typeof rankings !== 'object') continue;
    for (const [rankStr, p] of Object.entries(rankings)) {
      const rank = Number(rankStr);
      if (!p || !Number.isSafeInteger(rank) || rank < 1) continue;
      const lastRank = Number(entry.mode) || Object.keys(rankings).length;
      let acc = byId.get(p.id);
      if (!acc) {
        acc = { id: p.id, name: p.name, emoji: p.emoji, team: p.team, games: 0, rankSum: 0, firstPlaces: 0, lastPlaces: 0, rankings: [] };
        byId.set(p.id, acc);
      }
      acc.games += 1;
      acc.rankSum += rank;
      acc.rankings.push(rank);
      if (rank === 1) acc.firstPlaces += 1;
      if (rank === lastRank) acc.lastPlaces += 1;
    }
  }

  const winnerTeam = winnerKey === 't1' ? 1 : winnerKey === 't2' ? 2 : null;
  const ids = [...byId.keys()];
  const result = [];
  for (const acc of byId.values()) {
    const sameTeam = players.filter(p => p.team === acc.team && p.id !== acc.id).map(p => p.id);
    const otherTeam = players.filter(p => p.team !== acc.team).map(p => p.id);
    result.push({
      ...acc,
      avgRanking: acc.games > 0 ? acc.rankSum / acc.games : 0,
      teamWon: winnerTeam !== null && acc.team === winnerTeam,
      partnerIds: sameTeam.filter(id => ids.includes(id)),
      opponentIds: otherTeam.filter(id => ids.includes(id))
    });
  }
  result.sort((a, b) => a.id - b.id);

  return { gamesInSession: history.length, players: result };
}

/**
 * 本场 16 荣誉得主（与 web 版同算法）：返回 {playerId: [honorTitle...]}。
 * 注意 UI 渲染须经 honorDisplay.displayHonorTitle（「赌徒」→ 合规别名）。
 */
export function computeSessionHonors(state) {
  const agg = aggregateSession(state);
  if (agg.players.length === 0) return {};
  const allStats = {};
  for (const p of agg.players) {
    allStats[p.id] = {
      games: p.games,
      rankings: p.rankings,
      firstPlaceCount: p.firstPlaces,
      lastPlaceCount: p.lastPlaces
    };
  }
  const players = agg.players.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, team: p.team }));
  const totalPlayers = Number(state.mode) || players.length;
  const honors = calculateHonorsFromData(players, allStats, totalPlayers);

  const byPlayer = {};
  for (const [key, honor] of Object.entries(honors || {})) {
    const title = HONOR_TITLES_BY_KEY[key];
    const pid = honor && honor.player && honor.player.id;
    if (!title || !pid) continue;
    if (!byPlayer[pid]) byPlayer[pid] = [];
    byPlayer[pid].push(title);
  }
  return byPlayer;
}

/** 全场最低平均排名为 MVP；并列依次比头游次数、id（稳定） */
export function computeSessionMvp(state) {
  const agg = aggregateSession(state);
  const candidates = agg.players.filter(p => p.games > 0);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    a.avgRanking - b.avgRanking ||
    b.firstPlaces - a.firstPlaces ||
    a.id - b.id
  );
  return candidates[0];
}
