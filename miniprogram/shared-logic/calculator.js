// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: src/game/calculator.js @ b5c6a6699cd1e743804a1a283cb33bf481e263cf
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
import { normalizePlayerCountMode } from './playerCountMode.js';

/**
 * Game Calculator - Pure Calculation Logic
 * Extracted from app.js lines 1418-1465
 * All functions are pure (no side effects, no state access)
 */

/**
 * Parse and validate ranking input
 * @param {string} text - Input text (e.g., "1 2", "13", "1,3")
 * @param {number} need - Expected number of ranks (2 for 4-player, 3 for 6-player, 4 for 8-player)
 * @returns {{ok: boolean, ranks?: number[], msg?: string}}
 */
export function parseRanks(text, need) {
  if (!text) {
    return { ok: false, msg: '请输入名次' };
  }

  const trimmed = String(text).trim();
  const maxRank = need === 2 ? 4 : (need === 3 ? 6 : 8);

  // Try parsing as continuous digits (e.g., "13" for ranks 1,3)
  const digitRegex = new RegExp(`^[0-9]{${need}}$`);
  if (digitRegex.test(trimmed)) {
    const digits = trimmed.split('');
    const nums = digits.map(d => parseInt(d, 10));

    // Validate ranges
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] < 1 || nums[i] > maxRank) {
        return { ok: false, msg: '名次超出范围' };
      }
    }

    // Check for duplicates
    const seen = {};
    for (let i = 0; i < nums.length; i++) {
      if (seen[nums[i]]) {
        return { ok: false, msg: '名次不能重复' };
      }
      seen[nums[i]] = true;
    }

    // Sort and return
    nums.sort((a, b) => a - b);
    return { ok: true, ranks: nums };
  }

  // Try parsing as space/comma separated (e.g., "1 3", "1,3")
  const parts = trimmed.replace(/[^0-9]+/g, ' ').trim().split(/\s+/);

  if (parts.length !== need) {
    return { ok: false, msg: `需要 ${need} 个名次` };
  }

  const nums = [];
  for (let i = 0; i < parts.length; i++) {
    const n = parseInt(parts[i], 10);
    if (!(n >= 1 && n <= maxRank)) {
      return { ok: false, msg: `名次必须在 1~${maxRank}` };
    }
    nums.push(n);
  }

  // Check for duplicates
  const seen = {};
  for (let i = 0; i < nums.length; i++) {
    if (seen[nums[i]]) {
      return { ok: false, msg: '名次不能重复' };
    }
    seen[nums[i]] = true;
  }

  // Sort and return
  nums.sort((a, b) => a - b);
  return { ok: true, ranks: nums };
}

/**
 * Sum array of numbers
 * @param {number[]} arr - Array to sum
 * @returns {number} Sum
 */
export function sum(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];
  }
  return total;
}

/**
 * Calculate score sum from ranks using point map
 * @param {number[]} ranks - Array of ranking positions
 * @param {Object} pointMap - Map of position to points (e.g., {1: 5, 2: 4, ...})
 * @returns {number} Total score
 */
export function scoreSum(ranks, pointMap) {
  let total = 0;
  for (let i = 0; i < ranks.length; i++) {
    total += (pointMap[ranks[i]] || 0);
  }
  return total;
}

/**
 * Determine upgrade tier from score difference
 * @param {number} diff - Score difference (our team - opponent team)
 * @param {Object} thresholds - Threshold object with {g3, g2, g1}
 * @returns {number} Upgrade levels (0, 1, 2, or 3)
 */
export function tier(diff, thresholds) {
  if (diff >= thresholds.g3) return 3;
  if (diff >= thresholds.g2) return 2;
  if (diff >= thresholds.g1) return 1;
  return 0;
}

/**
 * Calculate next level from current level + increment
 * @param {string} currentLevel - Current level (2-A)
 * @param {number} increment - Number of levels to upgrade
 * @returns {string} New level
 */
export function nextLevel(currentLevel, increment) {
  const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const currentIndex = Math.max(0, LEVELS.indexOf(currentLevel));
  const newIndex = Math.min(LEVELS.length - 1, currentIndex + increment);
  return LEVELS[newIndex];
}

/**
 * Calculate upgrade from ranking positions
 * @param {string|number} mode - Game mode ('4', '6', or '8')
 * @param {number[]} ranks - Sorted array of winning team's ranks
 * @param {Object} config - Game configuration object
 * @param {boolean} must1 - Whether position 1 is required for upgrade
 * @returns {{upgrade: number, details: Object}}
 */
export function calculateUpgrade(mode, ranks, config, must1 = true) {
  let upgrade = 0;
  let details = {};
  const normalizedMode = normalizePlayerCountMode(mode);
  if (!normalizedMode) {
    console.error(`calculateUpgrade: invalid mode ${mode}`);
    return { upgrade: 0, details: { error: 'invalid_mode', received: mode } };
  }

  // Validate ranks length matches mode — silently producing upgrade=0 for short
  // arrays masks bugs in upstream collection.
  const expectedLength = normalizedMode / 2;
  if (!Array.isArray(ranks) || ranks.length !== expectedLength) {
    console.error(`calculateUpgrade: mode ${mode} requires ${expectedLength} ranks, got`, ranks);
    return { upgrade: 0, details: { error: 'invalid_ranks_length', expected: expectedLength, received: ranks?.length } };
  }

  if (normalizedMode === 4) {
    // 4-player mode: Use fixed upgrade table
    const key = `${ranks[0]},${ranks[1]}`;
    upgrade = config.c4[key] || 0;
    details = {
      mode: '4-player',
      combination: key,
      upgradeTable: config.c4
    };
  } else if (normalizedMode === 6) {
    // 6-player mode: Calculate score difference
    const ourScore = scoreSum(ranks, config.p6);
    const allPoints = [1, 2, 3, 4, 5, 6].map(r => config.p6[r] || 0);
    const totalScore = sum(allPoints);
    const oppScore = totalScore - ourScore;
    const diff = ourScore - oppScore;

    // Check must1 requirement
    if (must1 && ranks.indexOf(1) === -1) {
      upgrade = 0;
    } else {
      upgrade = tier(diff, config.t6);
    }

    details = {
      mode: '6-player',
      ourScore,
      oppScore,
      difference: diff,
      hasFirstPlace: ranks.indexOf(1) !== -1,
      thresholds: config.t6
    };
  } else if (normalizedMode === 8) {
    // Special case: Complete sweep (1,2,3,4) grants 4-level upgrade
    if (
      ranks.length === 4 &&
      ranks[0] === 1 &&
      ranks[1] === 2 &&
      ranks[2] === 3 &&
      ranks[3] === 4
    ) {
      upgrade = 4;
      details = {
        mode: '8-player',
        sweepBonus: true
      };
    } else {
      // 8-player mode: Calculate score difference
      const ourScore = scoreSum(ranks, config.p8);
      const allPoints = [1, 2, 3, 4, 5, 6, 7, 8].map(r => config.p8[r] || 0);
      const totalScore = sum(allPoints);
      const oppScore = totalScore - ourScore;
      const diff = ourScore - oppScore;

      // Check must1 requirement
      if (must1 && ranks.indexOf(1) === -1) {
        upgrade = 0;
      } else {
        upgrade = tier(diff, config.t8);
      }

      details = {
        mode: '8-player',
        ourScore,
        oppScore,
        difference: diff,
        hasFirstPlace: ranks.indexOf(1) !== -1,
        thresholds: config.t8
      };
    }
  }

  return { upgrade, details };
}
