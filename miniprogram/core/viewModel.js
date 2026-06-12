/** 纯展示派生（Node 可测）：index / room / history 三页共用，避免文案逻辑分叉。 */

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

/** 历史行 VM（最新在前） */
export function buildHistoryRows(history) {
  const total = history.length;
  return history
    .map((entry, i) => ({
      seq: i + 1,
      win: String(entry.win || ''),
      winKey: String(entry.winKey || 't1'),
      combo: String(entry.combo || ''),
      up: Number(entry.up || 0),
      newLevel: String(entry.winKey === 't2' ? entry.t2 : entry.t1),
      aNote: String(entry.aNote || ''),
      ts: String(entry.ts || ''),
      isLatest: i === total - 1
    }))
    .reverse();
}
