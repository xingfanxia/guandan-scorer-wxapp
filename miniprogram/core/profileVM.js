/**
 * 玩家档案展示派生（纯函数，Node 可测）：players.stats → 档案页/玩家查询页共用 VM。
 * 荣誉经合规别名 + caption；成就读时派生（与 web 同一套 vendored 逻辑），不落库。
 */
import { checkAchievements, ACHIEVEMENTS } from '../shared-logic/achievementLogic.js';
import { displayHonorTitle, displayHonorCaption } from './honorDisplay.js';

export const LADDER_DEFAULT = { rating: 1000, sessions: 0, peak: 1000 };

/** @returns {null | {summary, statCells, honorRows, achievementRows, ladder}} stats 为空/没打过 → null */
export function buildProfileVM(stats) {
  if (!stats || !Number(stats.sessionsPlayed)) return null;

  const winRate = stats.sessionsPlayed > 0 ? stats.sessionsWon / stats.sessionsPlayed : 0;
  const avgRank = stats.rankingGames > 0 ? stats.rankingSum / stats.rankingGames : 0;
  const ladder = stats.ladder && Number.isFinite(Number(stats.ladder.rating))
    ? { rating: Number(stats.ladder.rating), sessions: Number(stats.ladder.sessions) || 0, peak: Number(stats.ladder.peak) || Number(stats.ladder.rating) }
    : { ...LADDER_DEFAULT };

  const statCells = [
    { label: '总局数', value: String(stats.totalGames) },
    { label: '最长连胜', value: String(stats.longestWinStreak) },
    { label: '平均名次', value: avgRank ? avgRank.toFixed(2) : '—' },
    { label: '头游', value: String(stats.firstPlaceCount) },
    { label: '垫底', value: String(stats.lastPlaceCount) },
    { label: '最C/最闹票', value: `${stats.mvpVotes}/${stats.burdenVotes}` },
    { label: '天梯分', value: String(ladder.rating) },
    { label: '天梯峰值', value: String(ladder.peak) },
    { label: '天梯场次', value: String(ladder.sessions) }
  ];

  const honorRows = Object.entries(stats.honors || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([title, count]) => ({
      title: displayHonorTitle(title),
      caption: displayHonorCaption(title),
      count: Number(count)
    }))
    .sort((a, b) => b.count - a.count);

  const sessionKeys = Object.keys(stats.sessionHistory || {});
  const last = sessionKeys.length > 0 ? stats.sessionHistory[sessionKeys[sessionKeys.length - 1]] : null;
  const earned = checkAchievements({ ...stats, sessionWinRate: winRate }, last || undefined) || [];
  const achievementRows = earned
    .filter((id) => ACHIEVEMENTS[id])
    .map((id) => ({ id, name: ACHIEVEMENTS[id].name, badge: ACHIEVEMENTS[id].badge, desc: ACHIEVEMENTS[id].desc }));

  return {
    summary: {
      sessionsPlayed: Number(stats.sessionsPlayed),
      winRate: `${Math.round(winRate * 100)}%`,
      ladder: ladder.rating
    },
    statCells,
    honorRows,
    achievementRows,
    ladder
  };
}
