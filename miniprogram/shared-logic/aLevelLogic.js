// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/aLevelLogic.js @ 00f6ef6409271ff2e8e1d900c40464ac6136f2b3
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
import { normalizePlayerCountMode } from './playerCountMode.js';

/**
 * A-Level Rules — pure algorithm (zero host dependency).
 *
 * Canonical implementation of the A-level victory/failure rules, extracted from
 * src/game/rules.js so the wxapp sibling repo can vendor it without forking rule
 * logic. src/game/rules.js#checkALevelRules is a thin wrapper that gathers state
 * and delegates here.
 *
 * Rule modes:
 *   Clear condition: a team must win on its own A round, without last place.
 *   Strict A: own-A failures accumulate across all player counts; 3 failures demote that team to 2.
 *   Lenient A: own-A failures do not accumulate; teams stay at A until a valid clear.
 *
 * No state is written here: failure-counter changes are returned in `aFailUpdates`
 * for the caller to apply, keeping this checker safe for previews and tests.
 */

export const DEFAULT_TEAM_NAMES = Object.freeze({
  t1: '蓝队',
  t2: '红队'
});

/**
 * Evaluate A-level rules for a finished round.
 *
 * @param {Object} input
 * @param {string} input.winnerKey - Winning team key ('t1' or 't2')
 * @param {number[]} input.ranks - Winning team's ranking positions
 * @param {string|number} input.mode - Game mode ('4', '6', or '8')
 * @param {{t1: string, t2: string}} input.teamLevels - Current levels ('2'..'A') per team
 * @param {string|null} input.roundOwner - Team whose level this round was played at (null on first round)
 * @param {string} input.roundLevel - Level card of this round ('2'..'A')
 * @param {boolean} input.strictA - Strict-A preference (failures accumulate, 3 → demote to 2)
 * @param {{t1: number, t2: number}} [input.aFailCounts] - Accumulated own-A failure counts per team
 * @param {{t1: string, t2: string}} [input.teamNames] - Display names used in notes
 * @returns {{aNote: string, finalWin: boolean, winnerNewLevel?: string|null, loserNewLevel?: string|null, aTeam?: string|null, aFailUpdates?: Object, error?: string}}
 */
export function checkALevelRules({
  winnerKey,
  ranks,
  mode,
  teamLevels,
  roundOwner,
  roundLevel,
  strictA,
  aFailCounts = { t1: 0, t2: 0 },
  teamNames = DEFAULT_TEAM_NAMES
}) {
  const aFailEnabled = strictA;
  const getTeamName = (team) => teamNames?.[team] || DEFAULT_TEAM_NAMES[team] || String(team);

  const notes = [];
  let finalWin = false;
  let aTeam = null;
  let winnerNewLevel = null;
  let loserNewLevel = null;
  const aFailUpdates = {};
  const loserKey = winnerKey === 't1' ? 't2' : 't1';
  const winnerStartedAtA = teamLevels[winnerKey] === 'A';
  const loserStartedAtA = teamLevels[loserKey] === 'A';
  const roundOwnerStartedAtA = roundOwner ? teamLevels[roundOwner] === 'A' : false;
  const normalizedMode = normalizePlayerCountMode(mode);
  if (!normalizedMode) {
    return {
      aNote: '模式无效',
      finalWin: false,
      aFailUpdates: {},
      error: 'invalid_mode'
    };
  }

  // No team at A-level → no special rules apply
  if (!winnerStartedAtA && !loserStartedAtA) {
    return { aNote: '', finalWin };
  }

  const lastRank = normalizedMode;
  const winnerHasLast = ranks.indexOf(lastRank) >= 0;
  // Guard roundOwner === null (first-round / brand-new game)
  const roundOwnerName = roundOwner ? getTeamName(roundOwner) : '未定';
  const isRoundAtA = roundLevel === 'A';
  const winnerOwnARound = winnerStartedAtA && isRoundAtA && roundOwner === winnerKey;
  const ownerOwnARound = isRoundAtA && roundOwner && roundOwnerStartedAtA;

  /**
   * Preview the next A-fail counter for a team. Returns the new count + whether
   * the team is demoted. Outside strict mode this is a no-op (returns null).
   * The actual state write happens in the caller, keeping this rule
   * checker safe for previews and tests.
   */
  function previewAFail(team) {
    if (!aFailEnabled) return null;
    const current = aFailCounts?.[team] ?? 0;
    const next = current + 1;
    if (next >= 3) {
      aFailUpdates[team] = 0;
      return { count: next, demoted: true };
    }
    aFailUpdates[team] = next;
    return { count: next, demoted: false };
  }

  function applyFailTo(team, reason) {
    const teamName = getTeamName(team);
    const fail = previewAFail(team);

    if (fail) {
      let note = `${teamName} A级失败（${reason}）→ A${fail.count}`;
      if (fail.demoted) {
        note += '｜累计3次失败，仅该队重置到2';
        if (team === winnerKey) {
          winnerNewLevel = '2';
        } else {
          loserNewLevel = '2';
        }
      } else if (team === winnerKey) {
        winnerNewLevel = teamLevels[team];
      }
      notes.push(note);
      return;
    }

    if (team === winnerKey) {
      winnerNewLevel = teamLevels[team];
    }
    notes.push(`${teamName} ${reason}，不通关，继续打到通关`);
  }

  if (winnerStartedAtA) {
    const winnerName = getTeamName(winnerKey);
    aTeam = winnerKey;

    if (winnerHasLast) {
      if (winnerOwnARound) {
        applyFailTo(winnerKey, '在自己的A级胜方含末游');
      } else {
        winnerNewLevel = teamLevels[winnerKey];
        const tail = aFailEnabled ? '但A失败不计' : '继续打到通关';
        notes.push(`${winnerName} 在对方回合（${roundOwnerName}的级）胜但含末游，不通关，${tail}`);
      }
    } else if (!winnerOwnARound) {
      if (roundLevel !== 'A') {
        notes.push(`${winnerName} A级胜利（但本局级牌为${roundLevel}，需在自己的A级获胜才能通关）`);
      } else {
        notes.push(`${winnerName} A级胜利（但在${roundOwnerName}的回合，需在自己的A级获胜才能通关）`);
      }
      winnerNewLevel = teamLevels[winnerKey];
    } else {
      finalWin = true;
      notes.push(`${winnerName} A级通关（胜方无末游，在自己的A级）`);
    }
  }

  if (!finalWin && ownerOwnARound && roundOwner !== winnerKey) {
    // Covers the losing team's own-A round too: roundOwner === loserKey at A implies
    // ownerOwnARound, so no separate loser branch is needed (one existed pre-extraction
    // in rules.js but was unreachable).
    aTeam = roundOwner;
    applyFailTo(roundOwner, '在自己的A级未取胜');
  } else if (!finalWin && loserStartedAtA && roundOwner !== loserKey) {
    const loserName = getTeamName(loserKey);
    const tail = aFailEnabled ? '，A失败不计' : '';
    notes.push(`${loserName} 在对方回合（${roundOwnerName}的级）未胜${tail}`);
  }

  return {
    aNote: notes.join('｜'),
    finalWin,
    winnerNewLevel,
    loserNewLevel,
    aTeam,
    aFailUpdates
  };
}
