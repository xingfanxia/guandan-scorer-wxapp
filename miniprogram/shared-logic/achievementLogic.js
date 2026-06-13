// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/achievementLogic.js @ ba119979e8c2f37db2eb388d56e955f7c9ef7ccc
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
import {
  CURRENT_HONOR_COUNT,
  HONOR_TITLES_BY_KEY,
  countCurrentHonors,
  normalizeHonorCounter
} from './honorCatalog.js';

const UNSAFE_RELATION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// Achievement definitions
export const ACHIEVEMENTS = {
  // Milestone Achievements (4)
  newbie: { name: '初来乍到', badge: '🐣', desc: '完成第一场游戏' },
  started: { name: '小试牛刀', badge: '⭐', desc: '完成10场游戏' },
  veteran: { name: '百战老兵', badge: '🎖️', desc: '完成100场游戏' },
  legend: { name: '千场传奇', badge: '👑', desc: '完成1000场游戏' },

  // Performance Achievements (4)
  first_win: { name: '首胜', badge: '🩸', desc: '赢得第一场游戏' },
  streak_5: { name: '连胜达人', badge: '🔥', desc: '连胜5场' },
  streak_10: { name: '十连胜', badge: '⚡', desc: '连胜10场' },
  champion: { name: '常胜将军', badge: '🏅', desc: '胜率70%以上（至少20场）' },

  // Honor Collection Achievements (4)
  honor_5: { name: '荣誉猎手', badge: '🎯', desc: '获得5种不同荣誉' },
  honor_10: { name: '荣誉收藏家', badge: '🏛️', desc: '获得10种不同荣誉' },
  honor_all: { name: '全荣誉大师', badge: '💎', desc: `获得全部${CURRENT_HONOR_COUNT}种荣誉` },
  lubu_10: { name: '吕布专业户', badge: '⚔️', desc: '获得吕布10次' },

  // Social/Team Achievements (3)
  social_butterfly: { name: '社交蝴蝶', badge: '🦋', desc: '与20+不同玩家对局' },
  marathon: { name: '马拉松战士', badge: '🏃', desc: '单场游戏超过50轮' },
  quick_finish: { name: '闪电战', badge: '⚡', desc: '单场游戏少于15轮获胜' },

  // Fun/Special Achievements (2 active — comeback/sweep/iron_will were
  // defined but never checked because their detection requires data the
  // session-sync flow doesn't currently track [mid-session level deltas,
  // opponent final levels, contextual loss-streak history]. Per SIMPLED
  // "Lean", removed rather than left as dead definitions.)
  perfect: { name: '完美表现', badge: '✨', desc: '单场游戏场均排名1.5以内' },
  unlucky: { name: '天选之子', badge: '🎲', desc: '单场5次以上垫底仍获胜' }
};

export const ACHIEVEMENT_COUNT = Object.keys(ACHIEVEMENTS).length;

function relationKeyIsSafe(key) {
  return typeof key === 'string' &&
    key.trim().length > 0 &&
    !UNSAFE_RELATION_KEYS.has(key.trim().toLowerCase());
}

function relationHasGames(value) {
  if (!value || typeof value !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(value, 'games')) return false;

  const games = Number(value.games);
  return Number.isFinite(games) && games > 0;
}

export function countDistinctProfileRelations(playerStats = {}) {
  const relationHandles = new Set();

  for (const relationMap of [playerStats.partners, playerStats.opponents]) {
    if (!relationMap || typeof relationMap !== 'object') continue;
    for (const key of Object.keys(relationMap)) {
      const normalized = key.trim().toLowerCase();
      if (relationKeyIsSafe(normalized) && relationHasGames(relationMap[key])) {
        relationHandles.add(normalized);
      }
    }
  }

  return relationHandles.size;
}

/**
 * Check which achievements a player has earned
 * @param {Object} playerStats - Player stats object
 * @param {Object} lastSession - Last session data (optional, for session-specific achievements)
 * @returns {Array} Array of achievement IDs earned
 */
export function checkAchievements(playerStats = {}, lastSession = null) {
  const earned = [];
  const sessionsPlayed = playerStats.sessionsPlayed ?? playerStats.gamesPlayed ?? 0;
  const sessionsWon = playerStats.sessionsWon ?? playerStats.wins ?? 0;
  const winRate = playerStats.sessionWinRate ?? playerStats.winRate ?? 0;

  // Milestone achievements
  if (sessionsPlayed >= 1) earned.push('newbie');
  if (sessionsPlayed >= 10) earned.push('started');
  if (sessionsPlayed >= 100) earned.push('veteran');
  if (sessionsPlayed >= 1000) earned.push('legend');

  // Performance achievements
  if (sessionsWon >= 1) earned.push('first_win');
  if (playerStats.longestWinStreak >= 5) earned.push('streak_5');
  if (playerStats.longestWinStreak >= 10) earned.push('streak_10');
  if (sessionsPlayed >= 20 && winRate >= 0.7) {
    earned.push('champion');
  }

  // Honor collection achievements
  const normalizedHonors = normalizeHonorCounter(playerStats.honors || {});
  const uniqueHonors = countCurrentHonors(normalizedHonors);
  if (uniqueHonors >= 5) earned.push('honor_5');
  if (uniqueHonors >= 10) earned.push('honor_10');
  if (uniqueHonors >= CURRENT_HONOR_COUNT) earned.push('honor_all');
  if ((normalizedHonors[HONOR_TITLES_BY_KEY.mvp] || 0) >= 10) earned.push('lubu_10');

  // Social/team achievements
  if (countDistinctProfileRelations(playerStats) >= 20) {
    earned.push('social_butterfly');
  }

  // Session-specific achievements (if lastSession provided)
  if (lastSession) {
    const rounds = lastSession.gamesInSession || 0;
    const avgRank = lastSession.ranking || 999;

    if (rounds > 50) earned.push('marathon');
    if (rounds < 15 && lastSession.teamWon) earned.push('quick_finish');
    if (avgRank <= 1.5) earned.push('perfect');
    if (lastSession.lastPlaces >= 5 && lastSession.teamWon) earned.push('unlucky');
  }

  return earned;
}

/**
 * Get newly unlocked achievements
 * @param {Array} oldAchievements - Previously earned achievement IDs
 * @param {Array} newAchievements - Currently earned achievement IDs
 * @returns {Array} Newly unlocked achievement IDs
 */
export function getNewAchievements(oldAchievements = [], newAchievements = []) {
  const oldAchievementSet = new Set(Array.isArray(oldAchievements) ? oldAchievements : []);
  const currentAchievements = Array.isArray(newAchievements) ? newAchievements : [];
  return currentAchievements.filter(id => !oldAchievementSet.has(id));
}
