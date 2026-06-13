// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/honorLogic.js @ b5c6a6699cd1e743804a1a283cb33bf481e263cf
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
import { resolvePlayerCountMode } from './playerCountMode.js';

export const MIN_HONOR_GAMES = 5;

/**
 * Anti-sweep cap: a single player may hold at most this many POSITIVE honors.
 * Without it, the session's strongest player tops nearly every positive metric
 * simultaneously (吕布 + 石佛 + 连段王 + 团队中轴 + 保底核心 + 节奏核心 + 抗压王…),
 * which makes the awards meaningless. Negatives (阿斗/翻车王/燃尽王) and neutral
 * quirks (波动王/赌徒/大满贯/棋差一着) stay uncapped — they're diagnostic, not a
 * sweep concern, and spreading "shame" honors would be less truthful.
 */
export const MAX_POSITIVE_HONORS_PER_PLAYER = 2;

/**
 * Honor algorithms — pure computation half of src/stats/honors.js (zero host deps,
 * vendored by the guandan-scorer-wxapp sibling repo). Rendering/meta stay in src/stats/.
 * 改荣誉算法改这里，改完让 wxapp repo 跑 npm run sync:shared。
 */
/**
 * Calculate POPULATION variance (divides by N, not N-1).
 *
 * For n=1, the only datapoint equals the mean → variance is 0. That's
 * mathematically correct (no spread in a single observation) but
 * uninformative for volatility honors, where "this player has played one
 * game" should not classify them as stable. Honors globally require at least
 * 5 valid rankings before awarding, which keeps variance-based awards from
 * firing on small samples — DO NOT call calculateVariance from a context that
 * lacks a similar small-sample guard.
 *
 * Population (N) is intentional: we treat each player's session-level
 * rankings as a complete observed history, not a sample drawn from a
 * larger distribution. Bessel's correction (N-1) would be appropriate
 * if we were estimating population variance from a sample, but here
 * "the population" is "this player's actual games to date".
 *
 * @param {number[]} rankings
 * @returns {number} variance (0 if rankings empty/null)
 */
function calculateVariance(rankings) {
  if (!rankings || rankings.length === 0) return 0;

  const mean = rankings.reduce((sum, val) => sum + val, 0) / rankings.length;
  const squaredDiffs = rankings.map(val => Math.pow(val - mean, 2));
  return squaredDiffs.reduce((sum, val) => sum + val, 0) / rankings.length;
}

function normalizeRankings(rankings, totalPlayers) {
  if (!Array.isArray(rankings)) return [];

  return rankings
    .map(rank => Number(rank))
    .filter(rank =>
      Number.isSafeInteger(rank) &&
      rank >= 1 &&
      rank <= totalPlayers
    );
}

export function resolveHonorPlayerCount(modeValue, fallbackCount = 8) {
  return resolvePlayerCountMode(modeValue, fallbackCount);
}

/**
 * Calculate honors from explicit player/stat data.
 *
 * @param {object} [options]
 * @param {boolean} [options.applyCap=true] - When true (the default, what the UI
 *   renders), no player may hold more than MAX_POSITIVE_HONORS_PER_PLAYER positive
 *   honors — overflow redistributes to the next-best qualifier (anti-sweep). Pass
 *   false to get the raw, uncapped per-honor winners (each honor → its top scorer),
 *   e.g. to test scoring independent of assignment.
 */
export function calculateHonorsFromData(players = [], allStats = {}, totalPlayers = 8, options = {}) {
  // Match the null-tolerant contract of every other input (corrupted snapshots
  // may pass null/garbage): the default param only substitutes for undefined.
  const opts = options && typeof options === 'object' ? options : {};
  const applyCap = opts.applyCap !== false;
  const positiveHonorCap = applyCap ? MAX_POSITIVE_HONORS_PER_PLAYER : Infinity;
  const playerList = Array.isArray(players) ? players : [];
  const statsByPlayer = allStats && typeof allStats === 'object' && !Array.isArray(allStats)
    ? allStats
    : {};

  totalPlayers = resolveHonorPlayerCount(totalPlayers, playerList.length);
  const honors = {};
  const minGames = MIN_HONOR_GAMES;
  const mid = Math.ceil(totalPlayers / 2);
  const midRank = (totalPlayers + 1) / 2;
  const topTierThreshold = Math.max(1, Math.ceil(totalPlayers / 3));
  const bottomTierThreshold = totalPlayers - topTierThreshold + 1;

  function average(values) {
    return values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  }

  function resolveTeamNumber(team) {
    const value = Number(team);
    return value === 1 || value === 2 ? value : null;
  }

  const playerRows = playerList
    .map(player => {
      if (!player || typeof player !== 'object') return null;

      const stats = statsByPlayer[player.id];
      const rankings = normalizeRankings(stats?.rankings, totalPlayers);
      return { player, stats, rankings, team: resolveTeamNumber(player.team) };
    })
    .filter(Boolean);

  const eligible = playerRows
    .map(row => {
      const { player, stats, rankings, team } = row;
      if (!stats || rankings.length < minGames) {
        return null;
      }

      const games = rankings.length;
      const totalRank = rankings.reduce((sum, rank) => sum + rank, 0);
      const firstCount = rankings.filter(rank => rank === 1).length;
      const lastCount = rankings.filter(rank => rank === totalPlayers).length;
      const avg = totalRank / games;
      const variance = calculateVariance(rankings);
      const firstRate = firstCount / games;
      const lastRate = lastCount / games;
      const topHalfRate = rankings.filter(rank => rank <= mid).length / games;
      const bottomHalfRate = rankings.filter(rank => rank > mid).length / games;
      const uniqueRanks = new Set(rankings);
      const bestRank = Math.min(...rankings);
      const worstRank = Math.max(...rankings);
      const rankRange = worstRank - bestRank;
      let movement = 0;
      let changes = 0;
      let topHalfStreak = 0;
      let bestTopHalfStreak = 0;
      let bottomHalfStreak = 0;
      let bestBottomHalfStreak = 0;
      let crashes = 0;
      let leaps = 0;
      let pressureRounds = 0;
      let pressureRebounds = 0;

      for (let i = 0; i < rankings.length; i++) {
        const rank = rankings[i];
        if (rank >= bottomTierThreshold) {
          pressureRounds++;
        }

        if (rank <= mid) {
          topHalfStreak++;
          bottomHalfStreak = 0;
        } else {
          bottomHalfStreak++;
          topHalfStreak = 0;
        }
        bestTopHalfStreak = Math.max(bestTopHalfStreak, topHalfStreak);
        bestBottomHalfStreak = Math.max(bestBottomHalfStreak, bottomHalfStreak);

        if (i === 0) continue;
        const prev = rankings[i - 1];
        movement += Math.abs(rank - prev);
        if (rank !== prev) changes++;
        if (prev <= topTierThreshold && rank >= bottomTierThreshold) crashes++;
        if (prev >= bottomTierThreshold && rank <= topTierThreshold) leaps++;
        if (prev >= bottomTierThreshold && rank <= mid) pressureRebounds++;
      }

      let teammateAvgTotal = 0;
      let teammateContextRounds = 0;
      let teammateLeadRounds = 0;
      let supportFloorRounds = 0;
      let teamAvgTotal = 0;
      let opponentAvgTotal = 0;
      let teamContextRounds = 0;
      let teamEdgeRounds = 0;

      if (team !== null) {
        for (let i = 0; i < rankings.length; i++) {
          const rank = rankings[i];
          const teammateRanks = playerRows
            .filter(other => other !== row && other.team === team)
            .map(other => other.rankings[i])
            .filter(Number.isFinite);
          const teamRanks = playerRows
            .filter(other => other.team === team)
            .map(other => other.rankings[i])
            .filter(Number.isFinite);
          const opponentRanks = playerRows
            .filter(other => other.team !== null && other.team !== team)
            .map(other => other.rankings[i])
            .filter(Number.isFinite);

          const teammateRoundAvg = average(teammateRanks);
          if (teammateRoundAvg !== null) {
            teammateContextRounds++;
            teammateAvgTotal += teammateRoundAvg;
            if (rank < teammateRoundAvg) teammateLeadRounds++;
            if (rank <= mid && teammateRoundAvg > mid) supportFloorRounds++;
          }

          const teamRoundAvg = average(teamRanks);
          const opponentRoundAvg = average(opponentRanks);
          if (teamRoundAvg !== null && opponentRoundAvg !== null) {
            teamContextRounds++;
            teamAvgTotal += teamRoundAvg;
            opponentAvgTotal += opponentRoundAvg;
            if (teamRoundAvg < opponentRoundAvg) teamEdgeRounds++;
          }
        }
      }

      const segmentSize = Math.max(2, Math.floor(rankings.length / 3));
      const early = rankings.slice(0, segmentSize);
      const late = rankings.slice(-segmentSize);
      const earlyAvg = early.reduce((sum, rank) => sum + rank, 0) / early.length;
      const lateAvg = late.reduce((sum, rank) => sum + rank, 0) / late.length;
      const improvement = earlyAvg - lateAvg;
      const decline = lateAvg - earlyAvg;
      const lateBottomHalfRate = late.filter(rank => rank > mid).length / late.length;
      const lateLastRate = late.filter(rank => rank === totalPlayers).length / late.length;
      const secondCount = rankings.filter(rank => rank === 2).length;
      const pressureRate = pressureRounds / games;
      const pressureRecoveryRate = pressureRounds > 0 ? pressureRebounds / pressureRounds : 0;
      const sustainedRecoveryRate = Math.max(0, topHalfRate - pressureRate);
      const changeRate = games > 1 ? changes / (games - 1) : 0;
      const teammateAvg = teammateContextRounds > 0 ? teammateAvgTotal / teammateContextRounds : null;
      const teammateDelta = teammateAvg !== null ? teammateAvg - avg : 0;
      const teammateLeadRate = teammateContextRounds > 0 ? teammateLeadRounds / teammateContextRounds : 0;
      const supportFloorRate = teammateContextRounds > 0 ? supportFloorRounds / teammateContextRounds : 0;
      const teamAvg = teamContextRounds > 0 ? teamAvgTotal / teamContextRounds : null;
      const opponentAvg = teamContextRounds > 0 ? opponentAvgTotal / teamContextRounds : null;
      const teamEdgeRate = teamContextRounds > 0 ? teamEdgeRounds / teamContextRounds : 0;
      const dominanceScore = (firstRate * 2.2) + topHalfRate + ((totalPlayers + 1 - avg) / totalPlayers);
      const burdenScore = (lastRate * 2.2) + bottomHalfRate + (avg / totalPlayers);
      const stabilityScore = topHalfRate + ((totalPlayers + 1 - avg) / totalPlayers) - (variance / totalPlayers);
      const volatilityScore = movement + (variance * 2) + rankRange;
      const comebackArcScore = improvement + (leaps * 0.75) +
        (earlyAvg >= bottomTierThreshold && lateAvg <= topTierThreshold ? 2 : 0);
      const burnoutScore = (decline * 2) + (lateBottomHalfRate * 2) +
        lateLastRate + (bestBottomHalfStreak / games);
      const resilienceScore = (pressureRecoveryRate * 4) + (topHalfRate * 2) +
        sustainedRecoveryRate + (Math.min(pressureRebounds, 3) * 0.25) -
        Math.max(0, avg - midRank);
      const fastAttackScore = (topHalfRate * 3) +
        (changeRate * 1.5) +
        (((totalPlayers + 1 - avg) / totalPlayers) * 2) +
        (bestTopHalfStreak / games) +
        Math.max(0, midRank - earlyAvg) -
        (variance / totalPlayers) -
        lastRate;
      const globalImpactScore = dominanceScore +
        (Math.max(0, teammateDelta) * 0.8) +
        (teammateLeadRate * 0.8) +
        (teamEdgeRate * 0.5);
      const globalBurdenScore = burdenScore +
        (Math.max(0, -teammateDelta) * 0.8) +
        ((teammateContextRounds > 0 ? 1 - teammateLeadRate : 0) * 0.35);
      const teamAnchorScore = (Math.max(0, teammateDelta) * 1.4) +
        (teammateLeadRate * 1.2) +
        (supportFloorRate * 1.4) +
        (topHalfRate * 0.8) +
        (teamEdgeRate * 0.5) -
        (variance / totalPlayers) -
        (Math.max(0, avg - midRank) * 0.25);
      const floorCoreScore = (Math.max(0, teammateDelta) * 1.5) +
        (supportFloorRate * 2) +
        (1 - lastRate) +
        ((totalPlayers + 1 - worstRank) / totalPlayers) +
        (teamEdgeRate * 0.5) -
        (Math.max(0, avg - midRank) * 0.2);
      const tempoCoreScore = fastAttackScore +
        (teammateLeadRate * 1.1) +
        (teamEdgeRate * 1.1) +
        (Math.max(0, teammateDelta) * 0.5);

      return {
        player,
        stats,
        rankings,
        games,
        firstCount,
        lastCount,
        avg,
        variance,
        firstRate,
        lastRate,
        topHalfRate,
        bottomHalfRate,
        uniqueRanks,
        bestRank,
        worstRank,
        rankRange,
        movement,
        changes,
        crashes,
        leaps,
        pressureRate,
        pressureRounds,
        pressureRebounds,
        pressureRecoveryRate,
        sustainedRecoveryRate,
        changeRate,
        bestTopHalfStreak,
        bestBottomHalfStreak,
        earlyAvg,
        lateAvg,
        improvement,
        decline,
        lateBottomHalfRate,
        lateLastRate,
        secondCount,
        dominanceScore,
        burdenScore,
        stabilityScore,
        volatilityScore,
        comebackArcScore,
        burnoutScore,
        resilienceScore,
        fastAttackScore,
        teammateAvg,
        teammateDelta,
        teammateLeadRate,
        supportFloorRate,
        teamAvg,
        opponentAvg,
        teamEdgeRate,
        globalImpactScore,
        globalBurdenScore,
        teamAnchorScore,
        floorCoreScore,
        tempoCoreScore
      };
    })
    .filter(Boolean);

  if (eligible.length === 0) return honors;

  function bestBy(candidates, compare) {
    return candidates.reduce((best, candidate) => {
      if (!best) return candidate;
      return compare(candidate, best) > 0 ? candidate : best;
    }, null);
  }

  function assign(key, metric, score) {
    if (metric) {
      honors[key] = {
        player: metric.player,
        score,
        stats: {
          ...metric.stats,
          games: metric.games,
          totalRank: metric.avg * metric.games,
          firstPlaceCount: metric.firstCount,
          lastPlaceCount: metric.lastCount,
          rankings: metric.rankings
        }
      };
    }
  }

  // Honor specs — one per award. Each carries the SAME filter, comparator, and
  // score string as the original independent bestBy(...) calls; the assignment
  // loop below adds the anti-sweep cap on top without touching the scoring.
  //
  // `positive: true` marks an award subject to MAX_POSITIVE_HONORS_PER_PLAYER.
  // Positive specs are ordered flagship-first (mvp — always truthful) then by
  // descending filter strictness (节奏核心's 5-condition gate → 石佛's broad
  // avg≤mid gate). Narrow honors claim their often-sole qualifier before broad
  // honors exhaust a strong player's cap, which maximizes spread. Order among
  // the uncapped (negative / neutral) specs is irrelevant — they're independent.
  const honorSpecs = [
    {
      key: 'mvp', positive: true, flagship: true, // assigned first, always the genuine best
      filter: () => true,
      compare: (a, b) =>
        (a.globalImpactScore - b.globalImpactScore) ||
        (b.avg - a.avg) ||
        (a.firstCount - b.firstCount),
      score: m => m.globalImpactScore.toFixed(2)
    },
    {
      key: 'frequent', positive: true,
      filter: m =>
        m.changes >= 2 &&
        m.topHalfRate >= 0.75 &&
        m.avg <= midRank &&
        m.bestTopHalfStreak >= 3 &&
        m.teamEdgeRate >= 0.5,
      compare: (a, b) =>
        (a.tempoCoreScore - b.tempoCoreScore) ||
        (a.teamEdgeRate - b.teamEdgeRate) ||
        (a.topHalfRate - b.topHalfRate) ||
        (a.changeRate - b.changeRate) ||
        (b.avg - a.avg),
      score: m => `${Math.round(m.teamEdgeRate * 100)}%`
    },
    {
      key: 'resilient', positive: true,
      filter: m => m.pressureRebounds > 0 && m.topHalfRate >= 0.35,
      compare: (a, b) =>
        (a.resilienceScore - b.resilienceScore) ||
        (a.pressureRecoveryRate - b.pressureRecoveryRate) ||
        (a.sustainedRecoveryRate - b.sustainedRecoveryRate) ||
        (b.pressureRate - a.pressureRate) ||
        (a.pressureRebounds - b.pressureRebounds) ||
        (b.avg - a.avg),
      score: m => `${m.pressureRebounds}/${m.pressureRounds}`
    },
    {
      key: 'carp', positive: true,
      filter: m => m.comebackArcScore > 1.5 && m.lateAvg <= mid,
      compare: (a, b) =>
        (a.comebackArcScore - b.comebackArcScore) ||
        (a.improvement - b.improvement) ||
        (b.lateAvg - a.lateAvg),
      score: m => `+${m.improvement.toFixed(1)}`
    },
    {
      key: 'comeback', positive: true,
      filter: m => m.improvement > 1 && m.lateAvg <= mid,
      compare: (a, b) =>
        (a.improvement - b.improvement) ||
        (b.lateAvg - a.lateAvg) ||
        (a.topHalfRate - b.topHalfRate),
      score: m => `+${m.improvement.toFixed(1)}`
    },
    {
      key: 'nonstick', positive: true,
      filter: m => m.lastCount === 0 && m.teammateAvg !== null,
      compare: (a, b) =>
        (a.floorCoreScore - b.floorCoreScore) ||
        (a.supportFloorRate - b.supportFloorRate) ||
        (a.teammateDelta - b.teammateDelta) ||
        (b.worstRank - a.worstRank) ||
        (b.avg - a.avg),
      score: m => `+${m.teammateDelta.toFixed(1)}`
    },
    {
      key: 'median', positive: true,
      filter: m => m.teammateAvg !== null && m.teammateDelta > 0,
      compare: (a, b) =>
        (a.teamAnchorScore - b.teamAnchorScore) ||
        (a.teammateDelta - b.teammateDelta) ||
        (a.teammateLeadRate - b.teammateLeadRate) ||
        (b.avg - a.avg),
      score: m => `+${m.teammateDelta.toFixed(1)}`
    },
    {
      key: 'streak', positive: true,
      filter: m => m.bestTopHalfStreak >= 3,
      compare: (a, b) =>
        (a.bestTopHalfStreak - b.bestTopHalfStreak) ||
        (a.topHalfRate - b.topHalfRate) ||
        (b.avg - a.avg),
      score: m => m.bestTopHalfStreak
    },
    {
      key: 'stable', positive: true,
      filter: m => m.avg <= mid && m.variance <= totalPlayers,
      compare: (a, b) =>
        (a.stabilityScore - b.stabilityScore) ||
        (b.variance - a.variance) ||
        (b.avg - a.avg),
      score: m => m.variance.toFixed(2)
    },
    {
      key: 'burden', // flagship (negative) — uncapped, always the genuine worst
      filter: () => true,
      compare: (a, b) =>
        (a.globalBurdenScore - b.globalBurdenScore) ||
        (a.avg - b.avg) ||
        (a.lastCount - b.lastCount),
      score: m => m.globalBurdenScore.toFixed(2)
    },
    {
      key: 'fanche',
      filter: m => m.crashes > 0,
      compare: (a, b) =>
        (a.crashes - b.crashes) ||
        (a.movement - b.movement) ||
        (a.variance - b.variance),
      score: m => m.crashes
    },
    {
      key: 'burnout',
      filter: m =>
        m.decline > 1 &&
        m.earlyAvg <= midRank &&
        m.lateAvg > midRank &&
        m.lateBottomHalfRate >= 0.5,
      compare: (a, b) =>
        (a.burnoutScore - b.burnoutScore) ||
        (a.decline - b.decline) ||
        (a.lateBottomHalfRate - b.lateBottomHalfRate) ||
        (a.avg - b.avg),
      score: m => `+${m.decline.toFixed(1)}`
    },
    {
      key: 'rollercoaster',
      filter: m => m.movement >= Math.max(4, m.games - 1),
      compare: (a, b) =>
        (a.volatilityScore - b.volatilityScore) ||
        (a.movement - b.movement) ||
        (a.variance - b.variance),
      score: m => m.movement
    },
    {
      key: 'gambler',
      filter: m => m.firstCount > 0 && m.lastCount > 0,
      compare: (a, b) => {
        const scoreA = Math.sqrt(a.firstRate * a.lastRate) * (a.firstCount + a.lastCount);
        const scoreB = Math.sqrt(b.firstRate * b.lastRate) * (b.firstCount + b.lastCount);
        return (scoreA - scoreB) || (a.movement - b.movement);
      },
      score: m => `${m.firstCount}冠${m.lastCount}末`
    },
    {
      key: 'complete',
      filter: m => m.uniqueRanks.size >= totalPlayers,
      compare: (a, b) =>
        (a.uniqueRanks.size - b.uniqueRanks.size) ||
        (a.uniqueRanks.size / a.games - b.uniqueRanks.size / b.games) ||
        (a.movement - b.movement),
      score: m => `${m.uniqueRanks.size}/${totalPlayers}`
    },
    {
      key: 'almost',
      filter: m => m.firstCount === 0 && m.secondCount > 0,
      compare: (a, b) =>
        (a.secondCount - b.secondCount) ||
        (b.avg - a.avg) ||
        (a.topHalfRate - b.topHalfRate),
      score: m => `${m.secondCount}次第2`
    }
  ];

  // Processing order for the anti-sweep cap:
  //   1. flagship positives (mvp) first — assigned before any derived honor can
  //      cap the genuine best player, so 吕布 is always truthful;
  //   2. remaining positive honors most-constrained-first (fewest qualifiers —
  //      the MRV heuristic) so a scarce honor claims its qualifier before a broad
  //      honor exhausts that player's cap; ties broken by declared spec order;
  //   3. uncapped (negative / neutral) honors, order irrelevant.
  // Without (2), a narrow honor processed late can find all its qualifiers
  // already capped and be needlessly deferred to pass 2 (over-capping a player),
  // when claiming its scarce qualifier first would have spread it cleanly.
  const qualifierCount = new Map(
    honorSpecs.map(spec => [spec.key, eligible.filter(spec.filter).length])
  );
  const positiveSpecs = honorSpecs.filter(spec => spec.positive);
  const otherSpecs = honorSpecs.filter(spec => !spec.positive);
  const assignmentOrder = [
    ...positiveSpecs.filter(spec => spec.flagship),
    ...positiveSpecs
      .filter(spec => !spec.flagship)
      .map(spec => ({ spec, index: honorSpecs.indexOf(spec) }))
      .sort((a, b) =>
        (qualifierCount.get(a.spec.key) - qualifierCount.get(b.spec.key)) ||
        (a.index - b.index)
      )
      .map(entry => entry.spec),
    ...otherSpecs
  ];

  // Two-pass assignment so the cap SPREADS without ever producing a false
  // "本场无人" on an honor that real players earned:
  //
  //   Pass 1 — assign each honor to its best UNCAPPED qualifier. Once a player
  //     holds the cap they're skipped, so positive honors spread across players.
  //     A positive honor whose every qualifier is already capped is DEFERRED.
  //   Pass 2 — award each deferred honor to its best qualifier, ignoring the
  //     cap. This only fires when a roster can't fill an honor within the cap
  //     (e.g. a 4-player two-pair game where all five "strength" honors resolve
  //     to the same two players) — there, a real already-decorated winner beats
  //     a misleading empty card. In a healthy 8-player session pass 2 never
  //     fires and the cap holds strictly.
  //
  // With applyCap === false the cap is Infinity, so nothing is ever deferred and
  // each honor simply goes to its top scorer — identical to the pre-cap behavior.
  const positiveHonorsHeld = new Map();
  const heldCount = id => positiveHonorsHeld.get(id) || 0;
  const recordHonor = id => positiveHonorsHeld.set(id, heldCount(id) + 1);
  const deferredPositives = [];

  for (const spec of assignmentOrder) {
    const qualified = eligible.filter(spec.filter);
    if (qualified.length === 0) continue;

    if (!spec.positive) {
      const winner = bestBy(qualified, spec.compare);
      assign(spec.key, winner, spec.score(winner));
      continue;
    }

    const uncapped = qualified.filter(m => heldCount(m.player.id) < positiveHonorCap);
    if (uncapped.length === 0) {
      deferredPositives.push({ spec, qualified }); // every qualifier capped — fill in pass 2
      continue;
    }
    const winner = bestBy(uncapped, spec.compare);
    recordHonor(winner.player.id);
    assign(spec.key, winner, spec.score(winner));
  }

  for (const { spec, qualified } of deferredPositives) {
    const winner = bestBy(qualified, spec.compare);
    recordHonor(winner.player.id);
    assign(spec.key, winner, spec.score(winner));
  }

  return honors;
}

