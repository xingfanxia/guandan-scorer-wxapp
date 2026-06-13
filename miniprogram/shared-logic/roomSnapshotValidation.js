// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/roomSnapshotValidation.js @ b5c6a6699cd1e743804a1a283cb33bf481e263cf
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
import { getHistoryEntries, isClearingANote, resolveGameStatus } from './gameStatus.js';
import { isValidRuleSettings } from './ruleConfig.js';

const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const PREFERENCE_KEYS = ['must1', 'autoNext', 'autoApply', 'strictA'];
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_PHOTO_DATA_URL_LENGTH = 150000;
const MAX_ROOM_PLAYERS = 8;
const PHOTO_DATA_URL_RE = /^data:image\/(?:jpeg|png|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidLevel(value) {
  return LEVELS.includes(String(value));
}

function isValidAFail(value) {
  if (value === undefined || value === null) return true;
  return Number.isInteger(value) && value >= 0 && value <= 2;
}

function isValidTeamKey(value) {
  return value === 't1' || value === 't2';
}

function isValidOptionalTeamKey(value) {
  return value === undefined || value === null || isValidTeamKey(value);
}

function isValidOptionalPlayerTeam(value) {
  return value === undefined ||
    value === null ||
    value === 1 ||
    value === 2 ||
    value === '1' ||
    value === '2';
}

function canonicalizePlayerTeam(value) {
  if (value === 1 || value === 2) return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed === '1' || trimmed === 'A') return 1;
  if (trimmed === '2' || trimmed === 'B') return 2;
  return value;
}

function canonicalizePlayerLike(value) {
  if (!isObject(value)) return value;
  return {
    ...value,
    team: canonicalizePlayerTeam(value.team)
  };
}

function canonicalizePlayers(players) {
  if (!Array.isArray(players)) return players;
  return players.map(canonicalizePlayerLike);
}

function canonicalizeHistoryPlayerRankings(playerRankings) {
  if (!isObject(playerRankings)) return playerRankings;
  return Object.fromEntries(
    Object.entries(playerRankings).map(([rank, player]) => [
      rank,
      canonicalizePlayerLike(player)
    ])
  );
}

function canonicalizeHistory(history) {
  if (!Array.isArray(history)) return history;
  return history.map(entry => {
    if (!isObject(entry)) return entry;
    return {
      ...entry,
      playerRankings: canonicalizeHistoryPlayerRankings(entry.playerRankings)
    };
  });
}

function isValidOptionalPhotoDataUrl(value) {
  if (value === undefined) return true;
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  return value.length <= MAX_PHOTO_DATA_URL_LENGTH && PHOTO_DATA_URL_RE.test(value);
}

function isValidOptionalLevel(value) {
  return value === undefined || value === null || isValidLevel(value);
}

function isValidTeamSetting(value) {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.color !== undefined && (typeof value.color !== 'string' || !HEX_COLOR_RE.test(value.color))) {
    return false;
  }
  return true;
}

function isValidPreferenceSettings(settings) {
  if (!settings) return true;
  return PREFERENCE_KEYS.every(key =>
    settings[key] === undefined || typeof settings[key] === 'boolean'
  );
}

function isValidPlayer(player) {
  if (!isObject(player)) return false;
  if (!Number.isSafeInteger(player.id) || player.id <= 0) return false;
  if (!isValidOptionalPlayerTeam(player.team)) return false;
  if (player.name !== undefined && typeof player.name !== 'string') return false;
  if (player.emoji !== undefined && typeof player.emoji !== 'string') return false;
  if (player.handle !== undefined && typeof player.handle !== 'string') return false;
  if (!isValidOptionalPhotoDataUrl(player.photoBase64)) return false;
  if (player.photo !== undefined && typeof player.photo !== 'string') return false;
  return true;
}

function isValidGameStatus(status) {
  if (status === undefined) return true;
  if (!isObject(status)) return false;
  if (status.ended !== undefined && typeof status.ended !== 'boolean') return false;
  if (!isValidOptionalTeamKey(status.winnerKey)) return false;
  if (
    status.winnerName !== undefined &&
    status.winnerName !== null &&
    typeof status.winnerName !== 'string'
  ) {
    return false;
  }
  if (
    status.reason !== undefined &&
    status.reason !== null &&
    typeof status.reason !== 'string'
  ) {
    return false;
  }
  if (status.ended !== true) {
    return status.winnerKey == null &&
      status.winnerName == null &&
      status.reason == null;
  }
  return true;
}

function isValidPlayers(players) {
  if (players === undefined) return true;
  if (!Array.isArray(players)) return false;
  if (players.length > MAX_ROOM_PLAYERS) return false;

  const ids = new Set();
  for (const player of players) {
    if (!isValidPlayer(player)) return false;
    if (ids.has(player.id)) return false;
    ids.add(player.id);
  }

  return true;
}

function getValidPlayerIds(players) {
  if (!Array.isArray(players) || !isValidPlayers(players)) return null;

  const ids = new Set();
  for (const player of players) {
    ids.add(player.id);
  }

  return ids;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isOptionalNonNegativeSafeInteger(value) {
  return value === undefined || value === null || isNonNegativeSafeInteger(value);
}

function isValidStatsRecord(stats, maxRank = 8) {
  if (!isObject(stats)) return false;
  if (!isNonNegativeSafeInteger(stats.games)) return false;
  if (!isNonNegativeSafeInteger(stats.totalRank)) return false;
  if (
    stats.firstPlaceCount !== undefined &&
    (!isNonNegativeSafeInteger(stats.firstPlaceCount) || stats.firstPlaceCount > stats.games)
  ) {
    return false;
  }
  if (
    stats.lastPlaceCount !== undefined &&
    (!isNonNegativeSafeInteger(stats.lastPlaceCount) || stats.lastPlaceCount > stats.games)
  ) {
    return false;
  }
  if (stats.rankings !== undefined) {
    if (!Array.isArray(stats.rankings) || stats.rankings.length > stats.games) return false;
    for (const rank of stats.rankings) {
      if (!Number.isSafeInteger(rank) || rank < 1 || rank > maxRank) return false;
    }
  }
  return true;
}

function maxRankForMode(mode) {
  if (mode === undefined || mode === null) return 8;
  const normalized = String(mode);
  if (normalized === '4') return 4;
  if (normalized === '6') return 6;
  if (normalized === '8') return 8;
  return null;
}

function isValidRanks(ranks, mode) {
  if (ranks === undefined) return true;
  if (!Array.isArray(ranks)) return false;
  const maxRank = maxRankForMode(mode);
  if (!maxRank || ranks.length > maxRank) return false;
  const seen = new Set();
  for (const rank of ranks) {
    if (!Number.isSafeInteger(rank) || rank < 1 || rank > maxRank) return false;
    if (seen.has(rank)) return false;
    seen.add(rank);
  }
  return true;
}

function isValidHistoryPlayerRanking(player) {
  if (!isObject(player)) return false;
  if (!Number.isSafeInteger(player.id) || player.id <= 0) return false;
  if (player.name !== undefined && typeof player.name !== 'string') return false;
  if (player.emoji !== undefined && typeof player.emoji !== 'string') return false;
  if (!isValidOptionalPlayerTeam(player.team)) return false;
  return true;
}

function isValidHistoryPlayerRankings(playerRankings, mode) {
  if (playerRankings === undefined) return true;
  if (!isObject(playerRankings)) return false;
  const maxRank = maxRankForMode(mode);
  if (!maxRank) return false;
  const seenPlayerIds = new Set();

  for (const [rankKey, player] of Object.entries(playerRankings)) {
    if (!/^[1-8]$/.test(rankKey)) return false;
    const rank = Number(rankKey);
    if (rank < 1 || rank > maxRank) return false;
    if (!isValidHistoryPlayerRanking(player)) return false;
    if (seenPlayerIds.has(player.id)) return false;
    seenPlayerIds.add(player.id);
  }

  return true;
}

function isValidHistoryEntry(entry) {
  if (!isObject(entry)) return false;
  if (entry.ts !== undefined && typeof entry.ts !== 'string') return false;
  if (entry.mode !== undefined && !['4', '6', '8'].includes(String(entry.mode))) return false;
  if (!isValidRanks(entry.ranks, entry.mode)) return false;
  if (entry.combo !== undefined && typeof entry.combo !== 'string') return false;
  if (entry.up !== undefined && !Number.isSafeInteger(entry.up)) return false;
  if (entry.win !== undefined && typeof entry.win !== 'string') return false;
  if (!isValidOptionalTeamKey(entry.winKey)) return false;
  if (!isValidOptionalLevel(entry.t1)) return false;
  if (!isValidOptionalLevel(entry.t2)) return false;
  if (!isValidOptionalLevel(entry.round)) return false;
  if (entry.aNote !== undefined && typeof entry.aNote !== 'string') return false;
  if (!isValidGameStatus(entry.gameStatus)) return false;
  if (!isValidOptionalLevel(entry.prevT1Lvl)) return false;
  if (!isOptionalNonNegativeSafeInteger(entry.prevT1A)) return false;
  if (!isValidOptionalLevel(entry.prevT2Lvl)) return false;
  if (!isOptionalNonNegativeSafeInteger(entry.prevT2A)) return false;
  if (!isValidOptionalLevel(entry.prevRound)) return false;
  if (!isValidOptionalTeamKey(entry.prevRoundOwner)) return false;
  if (!isValidOptionalLevel(entry.prevNextRoundBase)) return false;
  if (!isValidOptionalTeamKey(entry.prevWinner)) return false;
  if (!isValidGameStatus(entry.prevGameStatus)) return false;
  if (!isOptionalNonNegativeSafeInteger(entry.sessionDuration)) return false;
  if (
    entry.gameEndedAt !== undefined &&
    entry.gameEndedAt !== null &&
    typeof entry.gameEndedAt !== 'string'
  ) {
    return false;
  }
  if (!isValidHistoryPlayerRankings(entry.playerRankings, entry.mode)) return false;
  return true;
}

function isValidHistory(history) {
  if (history === undefined) return true;
  if (!Array.isArray(history)) return false;
  return history.every(isValidHistoryEntry);
}

function hasResolvableCompletedStatus(status, history) {
  const historyEntries = Array.isArray(history) ? history : [];
  const latestEntry = historyEntries.length ? historyEntries[historyEntries.length - 1] : null;
  const claimsCompleted = status?.ended === true ||
    latestEntry?.gameStatus?.ended === true ||
    isClearingANote(latestEntry?.aNote);

  if (!claimsCompleted) return true;

  const resolvedStatus = resolveGameStatus(status, historyEntries);
  return resolvedStatus.ended === true && isValidTeamKey(resolvedStatus.winnerKey);
}

export function canonicalizeRoomSnapshotPayload(data) {
  if (!isObject(data)) return data;
  const canonicalData = {
    ...data,
    players: canonicalizePlayers(data.players)
  };
  if (!isObject(data.state)) return canonicalData;

  const stateWithCanonicalHistory = {
    ...data.state,
    history: canonicalizeHistory(data.state.history),
    hist: canonicalizeHistory(data.state.hist)
  };
  const historyEntries = getHistoryEntries(stateWithCanonicalHistory);
  const rawGameStatus = stateWithCanonicalHistory.gameStatus;
  const canResolveGameStatus = rawGameStatus === undefined || isValidGameStatus(rawGameStatus);
  const gameStatus = canResolveGameStatus && hasResolvableCompletedStatus(rawGameStatus, historyEntries)
    ? resolveGameStatus(rawGameStatus, historyEntries)
    : rawGameStatus;

  const state = {
    ...stateWithCanonicalHistory,
    gameStatus
  };

  if (gameStatus?.ended && isValidTeamKey(gameStatus.winnerKey)) {
    state.winner = gameStatus.winnerKey;
    state.nextRoundBase = null;
  }

  return {
    ...canonicalData,
    state
  };
}

function isValidPlayerStats(playerStats, players) {
  if (playerStats === undefined) return true;
  if (!isObject(playerStats)) return false;

  const playerIds = getValidPlayerIds(players);
  const maxStatsRank = playerIds ? Math.min(Math.max(playerIds.size, 1), 8) : 8;

  for (const [playerIdKey, stats] of Object.entries(playerStats)) {
    if (!/^[1-9]\d*$/.test(playerIdKey)) return false;
    const playerId = Number(playerIdKey);
    if (!Number.isSafeInteger(playerId)) return false;
    if (playerIds && !playerIds.has(playerId)) return false;
    if (!isValidStatsRecord(stats, maxStatsRank)) return false;
  }

  return true;
}

function isValidCurrentRanking(ranking, players) {
  if (ranking === undefined) return true;
  if (!isObject(ranking)) return false;

  const playerIds = getValidPlayerIds(players);
  const maxRankingSlot = playerIds ? Math.min(Math.max(playerIds.size, 1), 8) : 8;
  const seenPlayers = new Set();

  for (const [rankKey, playerId] of Object.entries(ranking)) {
    if (!/^[1-8]$/.test(rankKey)) return false;
    const rank = Number(rankKey);
    if (rank > maxRankingSlot) return false;
    if (!Number.isSafeInteger(playerId) || playerId <= 0) return false;
    if (seenPlayers.has(playerId)) return false;
    if (playerIds && !playerIds.has(playerId)) return false;
    seenPlayers.add(playerId);
  }

  return true;
}

function hasDependentPlayerEntries(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

export function isValidRoomSnapshotPayload(data) {
  if (!isObject(data)) return false;
  if (data.settings !== undefined && !isObject(data.settings)) return false;
  if (data.state !== undefined && !isObject(data.state)) return false;
  if (!isValidTeamSetting(data.settings?.t1) || !isValidTeamSetting(data.settings?.t2)) return false;
  if (!isValidPreferenceSettings(data.settings)) return false;
  if (!isValidRuleSettings(data.settings)) return false;

  if (data.state?.teams !== undefined) {
    const teams = data.state.teams;
    if (!isObject(teams) || !isObject(teams.t1) || !isObject(teams.t2)) return false;
    if (!isValidLevel(teams.t1.lvl) || !isValidLevel(teams.t2.lvl)) return false;
    if (!isValidAFail(teams.t1.aFail) || !isValidAFail(teams.t2.aFail)) return false;
  }

  if (data.state?.roundLevel !== undefined && !isValidLevel(data.state.roundLevel)) return false;
  if (!isValidOptionalTeamKey(data.state?.roundOwner)) return false;
  if (!isValidOptionalLevel(data.state?.nextRoundBase)) return false;
  if (!isValidOptionalTeamKey(data.state?.winner)) return false;
  if (!isValidGameStatus(data.state?.gameStatus)) return false;
  if (!isValidHistory(data.state?.history)) return false;
  if (!isValidHistory(data.state?.hist)) return false;
  if (!hasResolvableCompletedStatus(data.state?.gameStatus, getHistoryEntries(data.state))) return false;
  if (
    data.players === undefined &&
    (
      hasDependentPlayerEntries(data.playerStats) ||
      hasDependentPlayerEntries(data.currentRanking)
    )
  ) {
    return false;
  }
  if (!isValidPlayers(data.players)) return false;
  if (!isValidPlayerStats(data.playerStats, data.players)) return false;
  if (!isValidCurrentRanking(data.currentRanking, data.players)) return false;
  return true;
}
