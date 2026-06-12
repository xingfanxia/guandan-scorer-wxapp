/**
 * profile_sync — 房主在结算时把本场战绩/投票结果入库到 players 集合（openid 维度）。
 *
 * 幂等：战绩按 gameKey（syncedSessions）、投票按 voteKey（votingHistory）各自去重，
 * 重复提交安全。字段名对齐 web 版 player:handle schema（sessionsPlayed/sessionsWon/
 * longestWinStreak/honors/partners/opponents/mvpVotes/burdenVotes…），使 vendored
 * achievementLogic.checkAchievements 可直接吃 stats 推导成就（成就不落库，读时派生）。
 *
 * event: {
 *   code,                      // 房间码（必须是房主调用）
 *   gameKey?, sessions?: [{ openid, displayName, avatarUrl, mode, teamWon,
 *     gamesInSession, avgRanking, firstPlaces, lastPlaces,
 *     partnerOpenids: [], opponentOpenids: [], honorsEarned: [title] }],
 *   voteKey?, voteTallies?: [{ openid, mvp, burden }]   // 每个玩家收到的票数
 * }
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_SESSION_HISTORY = 200;

function freshStats() {
  return {
    sessionsPlayed: 0,
    sessionsWon: 0,
    currentWinStreak: 0,
    longestWinStreak: 0,
    totalGames: 0,
    firstPlaceCount: 0,
    lastPlaceCount: 0,
    rankingSum: 0,
    rankingGames: 0,
    mvpVotes: 0,
    burdenVotes: 0,
    honors: {},
    partners: {},
    opponents: {},
    modeBreakdown: { '4P': 0, '6P': 0, '8P': 0 },
    sessionHistory: {},
    votingHistory: {}
  };
}

function nonNeg(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function applySession(stats, s, gameKey) {
  if (stats.sessionHistory[gameKey]) return false; // 幂等：已入库
  const won = Boolean(s.teamWon);
  stats.sessionsPlayed += 1;
  if (won) {
    stats.sessionsWon += 1;
    stats.currentWinStreak += 1;
    stats.longestWinStreak = Math.max(stats.longestWinStreak, stats.currentWinStreak);
  } else {
    stats.currentWinStreak = 0;
  }
  const games = Math.min(500, Math.max(0, Math.floor(nonNeg(s.gamesInSession))));
  stats.totalGames += games;
  stats.firstPlaceCount += Math.min(games, Math.floor(nonNeg(s.firstPlaces)));
  stats.lastPlaceCount += Math.min(games, Math.floor(nonNeg(s.lastPlaces)));
  stats.rankingSum += nonNeg(s.avgRanking) * games;
  stats.rankingGames += games;

  const modeKey = `${['4', '6', '8'].includes(String(s.mode)) ? s.mode : '4'}P`;
  stats.modeBreakdown[modeKey] = (stats.modeBreakdown[modeKey] || 0) + 1;

  for (const title of Array.isArray(s.honorsEarned) ? s.honorsEarned : []) {
    const t = String(title).slice(0, 16);
    if (t) stats.honors[t] = (stats.honors[t] || 0) + 1;
  }
  for (const pid of Array.isArray(s.partnerOpenids) ? s.partnerOpenids : []) {
    const key = String(pid);
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const rel = stats.partners[key] || { games: 0, wins: 0 };
    rel.games += 1;
    if (won) rel.wins += 1;
    stats.partners[key] = rel;
  }
  for (const pid of Array.isArray(s.opponentOpenids) ? s.opponentOpenids : []) {
    const key = String(pid);
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const rel = stats.opponents[key] || { games: 0, wins: 0 };
    rel.games += 1;
    if (won) rel.wins += 1;
    stats.opponents[key] = rel;
  }

  // sessionHistory 封顶：超限时删最旧（key 含 ts 前缀可排序性不保证，简单按插入序近似）
  const keys = Object.keys(stats.sessionHistory);
  if (keys.length >= MAX_SESSION_HISTORY) delete stats.sessionHistory[keys[0]];
  stats.sessionHistory[gameKey] = {
    mode: String(s.mode),
    teamWon: won,
    gamesInSession: games,
    ranking: nonNeg(s.avgRanking),
    firstPlaces: Math.floor(nonNeg(s.firstPlaces)),
    lastPlaces: Math.floor(nonNeg(s.lastPlaces)),
    honorsEarned: (Array.isArray(s.honorsEarned) ? s.honorsEarned : []).map(t => String(t).slice(0, 16))
  };
  return true;
}

function applyVotes(stats, tally, voteKey) {
  if (stats.votingHistory[voteKey]) return false;
  const mvp = Math.min(1000, Math.floor(nonNeg(tally.mvp)));
  const burden = Math.min(1000, Math.floor(nonNeg(tally.burden)));
  stats.mvpVotes += mvp;
  stats.burdenVotes += burden;
  stats.votingHistory[voteKey] = { mvp, burden };
  return true;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const code = String((event && event.code) || '').trim().toUpperCase();
  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) return { ok: false, error: 'invalid_code' };

  const db = cloud.database();
  const room = await db.collection('rooms').doc(code).get().catch(() => null);
  if (!room || !room.data) return { ok: false, error: 'room_not_found' };
  if (room.data.ownerOpenid !== OPENID) return { ok: false, error: 'not_owner' };

  try {
    await db.createCollection('players');
  } catch (err) { /* 已存在 */ }

  const gameKey = event.gameKey ? String(event.gameKey).slice(0, 256) : null;
  const sessions = Array.isArray(event.sessions) ? event.sessions.slice(0, 16) : [];
  const voteKey = event.voteKey ? String(event.voteKey).slice(0, 256) : null;
  const voteTallies = Array.isArray(event.voteTallies) ? event.voteTallies.slice(0, 16) : [];

  const touched = new Map(); // openid → {doc, exists}

  async function loadPlayer(openid) {
    if (touched.has(openid)) return touched.get(openid);
    const res = await db.collection('players').doc(openid).get().catch(() => null);
    const entry = res && res.data
      ? { doc: res.data, exists: true }
      : { doc: { _id: openid, displayName: '', avatarUrl: '', stats: freshStats() }, exists: false };
    // 旧文档可能缺新字段：补齐
    entry.doc.stats = { ...freshStats(), ...entry.doc.stats };
    touched.set(openid, entry);
    return entry;
  }

  let applied = 0;
  let skipped = 0;

  if (gameKey) {
    for (const s of sessions) {
      const openid = String(s && s.openid || '');
      if (!openid) continue;
      const entry = await loadPlayer(openid);
      if (applySession(entry.doc.stats, s, gameKey)) applied++; else skipped++;
      if (s.displayName) entry.doc.displayName = String(s.displayName).slice(0, 32);
      if (s.avatarUrl) entry.doc.avatarUrl = String(s.avatarUrl).slice(0, 512);
    }
  }

  if (voteKey) {
    for (const t of voteTallies) {
      const openid = String(t && t.openid || '');
      if (!openid) continue;
      const entry = await loadPlayer(openid);
      if (applyVotes(entry.doc.stats, t, voteKey)) applied++; else skipped++;
    }
  }

  for (const [openid, entry] of touched) {
    const data = {
      displayName: entry.doc.displayName,
      avatarUrl: entry.doc.avatarUrl,
      stats: entry.doc.stats,
      updatedAt: db.serverDate()
    };
    if (entry.exists) {
      await db.collection('players').doc(openid).update({ data });
    } else {
      await db.collection('players').doc(openid).set({ data });
    }
  }

  return { ok: true, applied, skipped, players: touched.size };
};
