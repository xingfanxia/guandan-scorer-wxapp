// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/voteSessionKey.js @ b5c6a6699cd1e743804a1a283cb33bf481e263cf
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
import { getHistoryEntries, resolveGameStatus } from './gameStatus.js';

function normalizeRoomCode(roomCode) {
  return String(roomCode || '').trim().toUpperCase();
}

function latestHistoryEntry(history) {
  const entries = getHistoryEntries(history);
  return entries.length > 0
    ? entries[entries.length - 1]
    : null;
}

export function deriveVoteSessionKey({
  roomCode,
  gameStatus,
  history,
  finishedAt,
  endGameVotesHistory
} = {}) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) return null;

  const historyEntries = getHistoryEntries(history);
  const latestGame = latestHistoryEntry(historyEntries);
  const effectiveStatus = resolveGameStatus(gameStatus, historyEntries);
  if (!effectiveStatus?.ended) return null;

  const voteEpoch = Array.isArray(endGameVotesHistory) ? endGameVotesHistory.length : 0;
  const historyLength = historyEntries.length;
  const winnerKey = effectiveStatus?.winnerKey || latestGame?.winKey || 'unknown';
  const endedAt = latestGame?.gameEndedAt || finishedAt || latestGame?.ts || 'ended';

  return [
    normalizedRoomCode,
    'vote',
    historyLength,
    winnerKey,
    endedAt,
    voteEpoch
  ].map(part => encodeURIComponent(String(part))).join(':');
}

export function deriveGameSessionKey({
  roomCode,
  gameStatus,
  history,
  finishedAt
} = {}) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) return null;

  const historyEntries = getHistoryEntries(history);
  const latestGame = latestHistoryEntry(historyEntries);
  const effectiveStatus = resolveGameStatus(gameStatus, historyEntries);
  if (!effectiveStatus?.ended) return null;

  const historyLength = historyEntries.length;
  const winnerKey = effectiveStatus?.winnerKey || latestGame?.winKey || 'unknown';
  const endedAt = latestGame?.gameEndedAt || finishedAt || latestGame?.ts || 'ended';

  return [
    normalizedRoomCode,
    'game',
    historyLength,
    winnerKey,
    endedAt
  ].map(part => encodeURIComponent(String(part))).join(':');
}

export function deriveVoteSessionKeyFromRoom(roomCode, room) {
  if (!room) return null;

  return deriveVoteSessionKey({
    roomCode,
    gameStatus: room?.state?.gameStatus,
    history: room?.state,
    finishedAt: room?.finishedAt,
    endGameVotesHistory: room?.endGameVotesHistory
  });
}

export function deriveGameSessionKeyFromRoom(roomCode, room) {
  if (!room) return null;

  return deriveGameSessionKey({
    roomCode,
    gameStatus: room?.state?.gameStatus,
    history: room?.state,
    finishedAt: room?.finishedAt
  });
}

export function deriveGameProfileHistoryKey(roomCode, room, fallbackSessionKey = null) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) return roomCode;

  const sessionKey = deriveGameSessionKeyFromRoom(normalizedRoomCode, room);
  return sessionKey || fallbackSessionKey || null;
}

export function deriveVoteProfileHistoryKey(roomCode, room, votingHistory = {}, fallbackSessionKey = null) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) return roomCode;

  const sessionKey = deriveVoteSessionKeyFromRoom(normalizedRoomCode, room);
  if (!sessionKey) return fallbackSessionKey || normalizedRoomCode;

  const voteEpoch = Array.isArray(room?.endGameVotesHistory)
    ? room.endGameVotesHistory.length
    : 0;

  // Backward compatibility for data synced before vote-session keys existed:
  // first-epoch room votes used the bare room code as their idempotency key.
  // Reusing that key only for epoch 0 prevents one deploy from double-counting
  // already-synced current votes, while reset/new vote windows get distinct keys.
  if (
    voteEpoch === 0 &&
    votingHistory &&
    Object.prototype.hasOwnProperty.call(votingHistory, normalizedRoomCode) &&
    !Object.prototype.hasOwnProperty.call(votingHistory, sessionKey)
  ) {
    return normalizedRoomCode;
  }

  return sessionKey;
}
