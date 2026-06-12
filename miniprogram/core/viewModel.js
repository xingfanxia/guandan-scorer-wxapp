/** 纯展示派生（Node 可测）：index / room / history 三页共用，避免文案逻辑分叉。 */
import { aggregateSession, computeSessionHonors } from './victoryStats.js';
import { displayHonorTitle, displayHonorCaption } from './honorDisplay.js';

/**
 * 本场统计面板 VM（history / room 共用）：
 * 每玩家 平均排名/头游/垫底/局数 + 本场荣誉（合规别名渲染）。
 */
export function buildSessionStatsVM(state) {
  const agg = aggregateSession(state);
  const honors = computeSessionHonors(state);
  const rows = agg.players
    .map(p => ({
      id: p.id,
      emoji: p.emoji,
      name: p.name,
      team: p.team,
      games: p.games,
      avg: p.avgRanking.toFixed(2),
      first: p.firstPlaces,
      last: p.lastPlaces
    }))
    .sort((a, b) => Number(a.avg) - Number(b.avg));

  const honorRows = [];
  for (const [pid, titles] of Object.entries(honors)) {
    const p = agg.players.find(x => x.id === Number(pid));
    if (!p) continue;
    for (const t of titles) {
      honorRows.push({ title: displayHonorTitle(t), caption: displayHonorCaption(t), emoji: p.emoji, name: p.name });
    }
  }

  return {
    rows,
    honorRows,
    gamesInSession: agg.gamesInSession,
    honorsUnlocked: agg.gamesInSession >= 5 // MIN_HONOR_GAMES（不足时 UI 提示再打几局）
  };
}

/** 记分牌区 VM：eyebrow 文案 + 展示字段 */
export function buildBoardVM(s) {
  const ended = Boolean(s.gameStatus && s.gameStatus.ended);
  let eyebrow;
  if (ended) {
    eyebrow = `${(s.gameStatus && s.gameStatus.winnerName) || ''} 已通关`;
  } else if (s.nextRoundBase) {
    eyebrow = `待进入下一局 · 打${s.nextRoundBase}`;
  } else if (s.roundOwner) {
    eyebrow = `本局打${s.roundLevel} · ${s.teamNames[s.roundOwner]}的级`;
  } else {
    eyebrow = `本局打${s.roundLevel} · 新开局`;
  }
  return {
    ended,
    eyebrow,
    teamNames: s.teamNames,
    teamLevels: s.teamLevels,
    aFail: s.aFail,
    roundOwner: s.roundOwner,
    nextRoundBase: s.nextRoundBase,
    strictA: Boolean(s.prefs && s.prefs.strictA)
  };
}

/** 历史行 VM（最新在前）；rankingLine = 该局全员名次（web 版「组合」列对位） */
export function buildHistoryRows(history) {
  const total = history.length;
  return history
    .map((entry, i) => {
      const rankings = entry.playerRankings && typeof entry.playerRankings === 'object'
        ? entry.playerRankings
        : {};
      const rankingLine = Object.keys(rankings)
        .map(Number)
        .filter(Number.isSafeInteger)
        .sort((a, b) => a - b)
        .map(r => `${r}.${rankings[r].emoji || ''}${rankings[r].name || ''}`)
        .join('  ');
      return {
        seq: i + 1,
        win: String(entry.win || ''),
        winKey: String(entry.winKey || 't1'),
        combo: String(entry.combo || ''),
        up: Number(entry.up || 0),
        newLevel: String(entry.winKey === 't2' ? entry.t2 : entry.t1),
        aNote: String(entry.aNote || ''),
        rankingLine,
        ts: String(entry.ts || ''),
        isLatest: i === total - 1
      };
    })
    .reverse();
}
