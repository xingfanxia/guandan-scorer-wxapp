// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/honorLogic.js @ 00f6ef6409271ff2e8e1d900c40464ac6136f2b3
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
import { resolvePlayerCountMode } from './playerCountMode.js';

export const MIN_HONOR_GAMES = 5;

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
 */
export function calculateHonorsFromData(players = [], allStats = {}, totalPlayers = 8) {
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

  const mvp = bestBy(eligible, (a, b) =>
    (a.globalImpactScore - b.globalImpactScore) ||
    (b.avg - a.avg) ||
    (a.firstCount - b.firstCount)
  );
  assign('mvp', mvp, mvp?.globalImpactScore.toFixed(2));

  const burden = bestBy(eligible, (a, b) =>
    (a.globalBurdenScore - b.globalBurdenScore) ||
    (a.avg - b.avg) ||
    (a.lastCount - b.lastCount)
  );
  assign('burden', burden, burden?.globalBurdenScore.toFixed(2));

  const stable = bestBy(
    eligible.filter(metric => metric.avg <= mid && metric.variance <= totalPlayers),
    (a, b) =>
      (a.stabilityScore - b.stabilityScore) ||
      (b.variance - a.variance) ||
      (b.avg - a.avg)
  );
  assign('stable', stable, stable?.variance.toFixed(2));

  const rollercoaster = bestBy(
    eligible.filter(metric => metric.movement >= Math.max(4, metric.games - 1)),
    (a, b) =>
      (a.volatilityScore - b.volatilityScore) ||
      (a.movement - b.movement) ||
      (a.variance - b.variance)
  );
  assign('rollercoaster', rollercoaster, rollercoaster?.movement);

  const comeback = bestBy(
    eligible.filter(metric => metric.improvement > 1 && metric.lateAvg <= mid),
    (a, b) =>
      (a.improvement - b.improvement) ||
      (b.lateAvg - a.lateAvg) ||
      (a.topHalfRate - b.topHalfRate)
  );
  assign('comeback', comeback, comeback ? `+${comeback.improvement.toFixed(1)}` : null);

  const fanche = bestBy(
    eligible.filter(metric => metric.crashes > 0),
    (a, b) =>
      (a.crashes - b.crashes) ||
      (a.movement - b.movement) ||
      (a.variance - b.variance)
  );
  assign('fanche', fanche, fanche?.crashes);

  const gambler = bestBy(
    eligible.filter(metric => metric.firstCount > 0 && metric.lastCount > 0),
    (a, b) => {
      const scoreA = Math.sqrt(a.firstRate * a.lastRate) * (a.firstCount + a.lastCount);
      const scoreB = Math.sqrt(b.firstRate * b.lastRate) * (b.firstCount + b.lastCount);
      return (scoreA - scoreB) || (a.movement - b.movement);
    }
  );
  assign('gambler', gambler, gambler ? `${gambler.firstCount}冠${gambler.lastCount}末` : null);

  const complete = bestBy(
    eligible.filter(metric => metric.uniqueRanks.size >= totalPlayers),
    (a, b) =>
      (a.uniqueRanks.size - b.uniqueRanks.size) ||
      (a.uniqueRanks.size / a.games - b.uniqueRanks.size / b.games) ||
      (a.movement - b.movement)
  );
  assign('complete', complete, complete ? `${complete.uniqueRanks.size}/${totalPlayers}` : null);

  const streak = bestBy(
    eligible.filter(metric => metric.bestTopHalfStreak >= 3),
    (a, b) =>
      (a.bestTopHalfStreak - b.bestTopHalfStreak) ||
      (a.topHalfRate - b.topHalfRate) ||
      (b.avg - a.avg)
  );
  assign('streak', streak, streak?.bestTopHalfStreak);

  const median = bestBy(
    eligible.filter(metric => metric.teammateAvg !== null && metric.teammateDelta > 0),
    (a, b) =>
      (a.teamAnchorScore - b.teamAnchorScore) ||
      (a.teammateDelta - b.teammateDelta) ||
      (a.teammateLeadRate - b.teammateLeadRate) ||
      (b.avg - a.avg)
  );
  assign('median', median, median ? `+${median.teammateDelta.toFixed(1)}` : null);

  const carp = bestBy(
    eligible.filter(metric => metric.comebackArcScore > 1.5 && metric.lateAvg <= mid),
    (a, b) =>
      (a.comebackArcScore - b.comebackArcScore) ||
      (a.improvement - b.improvement) ||
      (b.lateAvg - a.lateAvg)
  );
  assign('carp', carp, carp ? `+${carp.improvement.toFixed(1)}` : null);

  const nonstick = bestBy(
    eligible.filter(metric => metric.lastCount === 0 && metric.teammateAvg !== null),
    (a, b) =>
      (a.floorCoreScore - b.floorCoreScore) ||
      (a.supportFloorRate - b.supportFloorRate) ||
      (a.teammateDelta - b.teammateDelta) ||
      (b.worstRank - a.worstRank) ||
      (b.avg - a.avg)
  );
  assign('nonstick', nonstick, nonstick ? `+${nonstick.teammateDelta.toFixed(1)}` : null);

  const frequent = bestBy(
    eligible.filter(metric =>
      metric.changes >= 2 &&
      metric.topHalfRate >= 0.75 &&
      metric.avg <= midRank &&
      metric.bestTopHalfStreak >= 3 &&
      metric.teamEdgeRate >= 0.5
    ),
    (a, b) =>
      (a.tempoCoreScore - b.tempoCoreScore) ||
      (a.teamEdgeRate - b.teamEdgeRate) ||
      (a.topHalfRate - b.topHalfRate) ||
      (a.changeRate - b.changeRate) ||
      (b.avg - a.avg)
  );
  assign('frequent', frequent, frequent ? `${Math.round(frequent.teamEdgeRate * 100)}%` : null);

  const burnout = bestBy(
    eligible.filter(metric =>
      metric.decline > 1 &&
      metric.earlyAvg <= midRank &&
      metric.lateAvg > midRank &&
      metric.lateBottomHalfRate >= 0.5
    ),
    (a, b) =>
      (a.burnoutScore - b.burnoutScore) ||
      (a.decline - b.decline) ||
      (a.lateBottomHalfRate - b.lateBottomHalfRate) ||
      (a.avg - b.avg)
  );
  assign('burnout', burnout, burnout ? `+${burnout.decline.toFixed(1)}` : null);

  const almost = bestBy(
    eligible.filter(metric => metric.firstCount === 0 && metric.secondCount > 0),
    (a, b) =>
      (a.secondCount - b.secondCount) ||
      (b.avg - a.avg) ||
      (a.topHalfRate - b.topHalfRate)
  );
  assign('almost', almost, almost ? `${almost.secondCount}次第2` : null);

  const resilient = bestBy(
    eligible.filter(metric => metric.pressureRebounds > 0 && metric.topHalfRate >= 0.35),
    (a, b) =>
      (a.resilienceScore - b.resilienceScore) ||
      (a.pressureRecoveryRate - b.pressureRecoveryRate) ||
      (a.sustainedRecoveryRate - b.sustainedRecoveryRate) ||
      (b.pressureRate - a.pressureRate) ||
      (a.pressureRebounds - b.pressureRebounds) ||
      (b.avg - a.avg)
  );
  assign('resilient', resilient, resilient ? `${resilient.pressureRebounds}/${resilient.pressureRounds}` : null);

  return honors;
}

