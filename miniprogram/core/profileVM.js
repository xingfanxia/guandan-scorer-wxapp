/**
 * 玩家档案展示派生（纯函数，Node 可测）：players.stats → 档案页/玩家查询页共用 VM。
 * 荣誉经合规别名 + caption；成就读时派生（与 web 同一套 vendored 逻辑），不落库。
 */
import { checkAchievements, ACHIEVEMENTS } from '../shared-logic/achievementLogic.js';
import { normalizeHonorCounter } from '../shared-logic/honorCatalog.js';
import { displayHonorTitle, displayHonorCaption, displayAchievementBadge } from './honorDisplay.js';

export const LADDER_DEFAULT = { rating: 1000, sessions: 0, peak: 1000 };

const REL_LABELS = {
  bestPartner: '大佬带我躺赢',
  worstPartner: '偷着乐吧',
  hardestOpponent: '既生瑜何生亮',
  easiestOpponent: '这是送分来的'
};

/** 单条队友/对手关系归一：胜率夹到 [0,1]、wins≤games、缺失 winRate 用 wins/games 推算 */
function normRel(r) {
  const games = Math.max(0, Math.round(Number(r && r.games) || 0));
  const wins = Math.min(games, Math.max(0, Math.round(Number(r && r.wins) || 0)));
  const inferred = games > 0 ? wins / games : 0;
  const raw = Number(r && r.winRate);
  const winRate = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : inferred));
  const pctNum = Math.round(winRate * 1000) / 10; // 一位小数
  return {
    name: String((r && r.name) || (r && r.handle) || '牌友'),
    emoji: String((r && r.emoji) || '🙂'),
    handle: String((r && r.handle) || ''),
    games, wins, winRate, pctNum,
    pct: pctNum.toFixed(1),
    // 配色与 web partnersChart 一致：≥60% 赢色、≥50% 蓝、否则败色
    tone: winRate >= 0.6 ? 'win' : winRate >= 0.5 ? 'mid' : 'loss'
  };
}

/** 4 格摘要项：套上行话 label + 队友赢色 / 对手败色基调 */
function relCell(row, key, tone) {
  if (!row) return null;
  return { ...row, label: REL_LABELS[key], summaryTone: tone };
}

/**
 * 队友与对手派生（对位 web player-profile.html renderPartnerRivalStats）：
 * 队友按胜率降序 → 最佳=首、最弱=末；对手按胜率升序 → 最强(最难赢)=首、最弱=末。
 * 单个时不重复成最弱。relations.partners/opponents 由云函数解析（含 name/emoji，无 openid）。
 */
function buildRelations(relations) {
  if (!relations || typeof relations !== 'object') return null;
  const partners = (Array.isArray(relations.partners) ? relations.partners : []).map(normRel);
  const opponents = (Array.isArray(relations.opponents) ? relations.opponents : []).map(normRel);
  if (partners.length === 0 && opponents.length === 0) return null;

  const pByRate = [...partners].sort((a, b) => b.winRate - a.winRate);
  const oByRate = [...opponents].sort((a, b) => a.winRate - b.winRate);
  const bestPartner = pByRate[0] || null;
  const worstPartner = pByRate.length > 1 ? pByRate[pByRate.length - 1] : null;
  const hardestOpponent = oByRate[0] || null;
  const easiestOpponent = oByRate.length > 1 ? oByRate[oByRate.length - 1] : null;

  return {
    partnerCount: partners.length,
    opponentCount: opponents.length,
    bestPartner: relCell(bestPartner, 'bestPartner', 'win'),
    worstPartner: relCell(worstPartner, 'worstPartner', 'loss'),
    hardestOpponent: relCell(hardestOpponent, 'hardestOpponent', 'loss'),
    easiestOpponent: relCell(easiestOpponent, 'easiestOpponent', 'win'),
    // 「所有队友/所有对手」列表：都按胜率降序（赢得多的在前）；key 唯一供 wx:key
    allPartners: pByRate.map(withKey),
    allOpponents: [...opponents].sort((a, b) => b.winRate - a.winRate).map(withKey)
  };
}

/** 列表行补稳定 key（handle 可能为空 —— 未解析的 web 关系回退序号） */
function withKey(r, i) {
  return { ...r, key: r.handle || `i${i}` };
}

/** 近期排名走势：旧→新的名次序列（云函数已剥房间码，仅数字）；轴上限 ≥8 */
function buildRankTrend(rankTrend) {
  const pts = (Array.isArray(rankTrend) ? rankTrend : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v >= 1);
  if (pts.length === 0) return null;
  return { points: pts, max: Math.max(8, Math.ceil(Math.max(...pts))) };
}

const MODE_TEXT = { '4P': '4人', '6P': '6人', '8P': '8人', 4: '4人', 6: '6人', 8: '8人' };

/** 最近游戏行（最多 10 条）：日期 / 模式 / 名次 / 胜负 / 当场荣誉 */
function buildRecentGames(recentGames) {
  if (!Array.isArray(recentGames)) return [];
  return recentGames.slice(0, 10).map((g, i) => {
    const rank = Number(g && g.ranking);
    const d = g && g.date ? String(g.date).slice(0, 10) : '';
    const won = !!(g && g.teamWon);
    const honors = Array.isArray(g && g.honors) ? g.honors.map((h) => displayHonorTitle(String(h))).filter(Boolean) : [];
    return {
      seq: i,
      dateText: d,
      modeText: MODE_TEXT[g && g.mode] || (g && g.mode ? String(g.mode) : ''),
      rankText: Number.isFinite(rank) ? (Math.round(rank * 10) / 10).toString() : '—',
      resultText: won ? '胜' : '负',
      tone: won ? 'win' : 'loss',
      honors,
      honorsText: honors.join(' · ')
    };
  });
}

/** @returns {null | {summary, statCells, honorRows, achievementRows, ladder, relations, rankTrend, recentGames}} stats 为空/没打过 → null */
export function buildProfileVM(stats) {
  if (!stats || !Number(stats.sessionsPlayed)) return null;

  const winRate = stats.sessionsPlayed > 0 ? stats.sessionsWon / stats.sessionsPlayed : 0;
  const avgRank = stats.rankingGames > 0 ? stats.rankingSum / stats.rankingGames : 0;
  const ladder = stats.ladder && Number.isFinite(Number(stats.ladder.rating))
    ? { rating: Number(stats.ladder.rating), sessions: Number(stats.ladder.sessions) || 0, peak: Number(stats.ladder.peak) || Number(stats.ladder.rating) }
    : { ...LADDER_DEFAULT };

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // 数值格：源字段为 null/undefined（如 web 端不跟踪头游/垫底）→ 略过该格，不显示「null」
  const cell = (label, raw) => (raw === null || raw === undefined ? null : { label, value: String(raw) });
  const statCells = [
    cell('总局数', stats.totalGames),
    cell('当前连胜', stats.currentWinStreak),
    cell('最长连胜', stats.longestWinStreak),
    { label: '平均名次', value: avgRank ? avgRank.toFixed(2) : '—' },
    cell('头游', stats.firstPlaceCount),
    cell('垫底', stats.lastPlaceCount),
    { label: '最C/最闹票', value: `${num(stats.mvpVotes)}/${num(stats.burdenVotes)}` },
    { label: '天梯分', value: String(ladder.rating) },
    { label: '天梯峰值', value: String(ladder.peak) },
    { label: '天梯场次', value: String(ladder.sessions) }
  ].filter(Boolean);

  // normalizeHonorCounter：web 迁移来的 legacy 荣誉名（小丑/连胜王…）归一到现行 16 项，
  // 保证每行都有 caption、同义项计数不分裂
  const honorRows = Object.entries(normalizeHonorCounter(stats.honors || {}))
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
    .map((id) => ({ id, name: ACHIEVEMENTS[id].name, badge: displayAchievementBadge(ACHIEVEMENTS[id].badge), desc: ACHIEVEMENTS[id].desc }));

  return {
    summary: {
      sessionsPlayed: Number(stats.sessionsPlayed),
      winRate: `${Math.round(winRate * 100)}%`,
      ladder: ladder.rating
    },
    statCells,
    honorRows,
    achievementRows,
    ladder,
    relations: buildRelations(stats.relations),
    rankTrend: buildRankTrend(stats.rankTrend),
    recentGames: buildRecentGames(stats.recentGames)
  };
}
