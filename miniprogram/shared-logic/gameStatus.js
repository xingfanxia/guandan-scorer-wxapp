// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/gameStatus.js @ 00f6ef6409271ff2e8e1d900c40464ac6136f2b3
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
const VALID_TEAM_KEYS = new Set(['t1', 't2']);

export function openGameStatus() {
  return {
    ended: false,
    winnerKey: null,
    winnerName: null,
    reason: null
  };
}

function normalizeWinnerKey(value) {
  return VALID_TEAM_KEYS.has(value) ? value : null;
}

function normalizeDisplayString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getHistoryEntries(historyOrState) {
  if (Array.isArray(historyOrState)) return historyOrState;
  if (
    historyOrState &&
    typeof historyOrState === 'object' &&
    !Array.isArray(historyOrState)
  ) {
    if (Array.isArray(historyOrState.history)) return historyOrState.history;
    if (Array.isArray(historyOrState.hist)) return historyOrState.hist;
  }
  return [];
}

function normalizeCompletedStatus(status) {
  if (!status?.ended) return null;

  return {
    ended: true,
    winnerKey: normalizeWinnerKey(status.winnerKey),
    winnerName: normalizeDisplayString(status.winnerName),
    reason: normalizeDisplayString(status.reason) || 'A_LEVEL_CLEARED'
  };
}

function latestHistoryEntry(history) {
  const entries = getHistoryEntries(history);
  return entries.length > 0
    ? entries[entries.length - 1]
    : null;
}

function historyEntryClaimsCompleted(historyEntry) {
  return Boolean(
    normalizeCompletedStatus(historyEntry?.gameStatus) ||
    isClearingANote(historyEntry?.aNote)
  );
}

function matchingCompletedHistoryWinner(historyEntry, winnerKey) {
  if (!historyEntryClaimsCompleted(historyEntry)) return null;
  const historyWinnerKey = normalizeWinnerKey(historyEntry?.winKey);
  return historyWinnerKey === winnerKey ? historyWinnerKey : null;
}

function completedStatusWithWinner(status, historyEntry = null) {
  const completedStatus = normalizeCompletedStatus(status);
  if (!completedStatus) return null;

  const fallbackWinnerKey = historyEntryClaimsCompleted(historyEntry)
    ? normalizeWinnerKey(historyEntry?.winKey)
    : null;
  const winnerKey = completedStatus.winnerKey || fallbackWinnerKey || null;
  if (!winnerKey) return null;

  return {
    ...completedStatus,
    winnerKey,
    winnerName: completedStatus.winnerName ||
      (matchingCompletedHistoryWinner(historyEntry, winnerKey) ? normalizeDisplayString(historyEntry?.win) : null) ||
      null
  };
}

export function isClearingANote(note) {
  if (typeof note !== 'string') return false;
  return note.includes('A级通关') &&
    note.includes('在自己的A级') &&
    !note.includes('不通关') &&
    !note.includes('未通关') &&
    !note.includes('不能通关');
}

export function deriveGameStatusFromHistory(history) {
  const latestGame = latestHistoryEntry(history);
  if (!latestGame) return openGameStatus();

  const structuredStatus = completedStatusWithWinner(latestGame?.gameStatus, latestGame);
  if (structuredStatus) {
    return structuredStatus;
  }

  if (isClearingANote(latestGame?.aNote)) {
    const winnerKey = normalizeWinnerKey(latestGame.winKey);
    if (!winnerKey) return openGameStatus();
    return {
      ended: true,
      winnerKey,
      winnerName: normalizeDisplayString(latestGame.win),
      reason: 'A_LEVEL_CLEARED'
    };
  }

  return openGameStatus();
}

export function resolveGameStatus(status, history) {
  const latestGame = latestHistoryEntry(history);
  const latestStructuredStatus = completedStatusWithWinner(latestGame?.gameStatus, latestGame);
  const completedStatus = completedStatusWithWinner(status, latestGame);
  if (
    latestStructuredStatus &&
    completedStatus &&
    latestStructuredStatus.winnerKey !== completedStatus.winnerKey
  ) {
    return latestStructuredStatus;
  }

  if (completedStatus) {
    return completedStatus;
  }

  const derivedStatus = deriveGameStatusFromHistory(history);
  return derivedStatus?.ended ? derivedStatus : openGameStatus();
}
