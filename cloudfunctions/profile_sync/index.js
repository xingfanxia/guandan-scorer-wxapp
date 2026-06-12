/**
 * profile_sync — 房主在结算时把本场战绩/投票结果入库到 players 集合（openid 维度）。
 *
 * 安全模型（2026-06-12 review 加固）：
 * - 仅房主可调，且房间必须已通关（gameStatus.ended）。
 * - openid 白名单 = 服务端回读 room.claims（认领即同意入库）；client 传来的
 *   sessions/voteTallies 里不在白名单的 openid 一律丢弃。displayName/avatarUrl
 *   以 claims 为准（服务端权威），不信 client。
 * - gameKey/voteKey 由服务端从房间快照派生（镜像 shared-logic/voteSessionKey.js
 *   的 deriveGameSessionKey/deriveVoteSessionKey —— 改那边记得同步这里），
 *   client 无法旋转 key 绕过幂等。
 * - 票数不信 client：服务端直接从 votes 集合按 voteKey 聚合。
 * - 战绩数值仍由房主侧计算（服务端只做上界钳制）—— 房主最多只能影响
 *   「在他房间里真实认领过」的玩家，这是当前权限模型下的最优收敛。
 *
 * 幂等：战绩按 gameKey（sessionHistory）、投票按 voteKey（votingHistory）去重。
 * 字段名对齐 web 版 player:handle schema，使 vendored checkAchievements 可直接
 * 吃 stats 推导成就（成就读时派生，不落库）。
 *
 * event: { code }   // 就这一个——其余服务端自取
 *        + sessions: [{ openid, mode, teamWon, gamesInSession, avgRanking,
 *            firstPlaces, lastPlaces, partnerOpenids, opponentOpenids,
 *            honorsEarned }]（房主侧 buildProfileSessions 产物，服务端过滤）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_SESSION_HISTORY = 200;
const MAX_RANK = 8;

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

const safeRelKey = (key) =>
  key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

/** 镜像 shared-logic/voteSessionKey.js 的派生逻辑（CJS 版，服务端权威） */
function deriveKeys(code, snapshot, voteEpoch) {
  const history = Array.isArray(snapshot.history) ? snapshot.history : [];
  const last = history.length > 0 ? history[history.length - 1] : null;
  const status = snapshot.gameStatus || {};
  if (!status.ended || history.length === 0) return null;
  const winnerKey = status.winnerKey || (last && last.winKey) || 'unknown';
  const endedAt = (last && (last.gameEndedAt || last.ts)) || 'ended';
  const enc = (parts) => parts.map(p => encodeURIComponent(String(p))).join(':');
  return {
    gameKey: enc([code, 'game', history.length, winnerKey, endedAt]),
    voteKey: enc([code, 'vote', history.length, winnerKey, endedAt, voteEpoch])
  };
}

function applySession(stats, s, gameKey, authoritativeMode) {
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
  const games = Math.min(500, Math.floor(nonNeg(s.gamesInSession)));
  const avgRanking = Math.min(MAX_RANK, nonNeg(s.avgRanking));
  stats.totalGames += games;
  stats.firstPlaceCount += Math.min(games, Math.floor(nonNeg(s.firstPlaces)));
  stats.lastPlaceCount += Math.min(games, Math.floor(nonNeg(s.lastPlaces)));
  stats.rankingSum += avgRanking * games;
  stats.rankingGames += games;

  stats.modeBreakdown[`${authoritativeMode}P`] = (stats.modeBreakdown[`${authoritativeMode}P`] || 0) + 1;

  for (const title of Array.isArray(s.honorsEarned) ? s.honorsEarned.slice(0, 16) : []) {
    const t = String(title).slice(0, 16);
    if (t) stats.honors[t] = (stats.honors[t] || 0) + 1;
  }
  for (const pid of Array.isArray(s.partnerOpenids) ? s.partnerOpenids : []) {
    const key = String(pid);
    if (!safeRelKey(key)) continue;
    const rel = stats.partners[key] || { games: 0, wins: 0 };
    rel.games += 1;
    if (won) rel.wins += 1;
    stats.partners[key] = rel;
  }
  for (const pid of Array.isArray(s.opponentOpenids) ? s.opponentOpenids : []) {
    const key = String(pid);
    if (!safeRelKey(key)) continue;
    const rel = stats.opponents[key] || { games: 0, wins: 0 };
    rel.games += 1;
    if (won) rel.wins += 1;
    stats.opponents[key] = rel;
  }

  const keys = Object.keys(stats.sessionHistory);
  if (keys.length >= MAX_SESSION_HISTORY) delete stats.sessionHistory[keys[0]];
  stats.sessionHistory[gameKey] = {
    mode: authoritativeMode,
    teamWon: won,
    gamesInSession: games,
    ranking: avgRanking,
    firstPlaces: Math.floor(nonNeg(s.firstPlaces)),
    lastPlaces: Math.floor(nonNeg(s.lastPlaces)),
    honorsEarned: (Array.isArray(s.honorsEarned) ? s.honorsEarned.slice(0, 16) : []).map(t => String(t).slice(0, 16))
  };
  return true;
}

function applyVotes(stats, tally, voteKey) {
  if (stats.votingHistory[voteKey]) return false;
  const mvp = Math.min(1000, Math.floor(nonNeg(tally.mvp)));
  const burden = Math.min(1000, Math.floor(nonNeg(tally.burden)));
  if (mvp === 0 && burden === 0) return false;
  stats.mvpVotes += mvp;
  stats.burdenVotes += burden;
  stats.votingHistory[voteKey] = { mvp, burden };
  return true;
}

/** 区分「文档不存在」与瞬时 DB 错误 —— 后者必须中止，否则会用 freshStats 覆盖玩家累计数据 */
async function loadPlayerDoc(db, openid) {
  try {
    const res = await db.collection('players').doc(openid).get();
    return res && res.data ? res.data : null;
  } catch (err) {
    const msg = String((err && err.errMsg) || err);
    if (/not exist|does not exist|DOCUMENT_NOT_FOUND|-502004/i.test(msg)) return null;
    throw err; // 瞬时错误：上抛中止本次 sync
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const code = String((event && event.code) || '').trim().toUpperCase();
  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) return { ok: false, error: 'invalid_code' };

  const db = cloud.database();
  const _ = db.command;
  const room = await db.collection('rooms').doc(code).get().catch(() => null);
  if (!room || !room.data) return { ok: false, error: 'room_not_found' };
  if (room.data.ownerOpenid !== OPENID) return { ok: false, error: 'not_owner' };

  const snapshot = room.data.snapshot || {};
  const keys = deriveKeys(code, snapshot, Number(room.data.voteEpoch || 0));
  if (!keys) return { ok: false, error: 'game_not_ended', message: '比赛还没通关，通关后再入库' };

  // playerId → openid 归属解析：座位认领优先，pool 绑定（handle）兜底 —— 全在服务端
  const claims = room.data.claims || {};
  const snapshotPlayers = Array.isArray(snapshot.players) ? snapshot.players : [];
  const openidByPlayerId = new Map();
  const identityByOpenid = new Map(); // 展示名/头像的权威来源

  for (const [playerId, claim] of Object.entries(claims)) {
    if (claim && claim.openid) {
      openidByPlayerId.set(Number(playerId), claim.openid);
      identityByOpenid.set(claim.openid, { nickname: claim.nickname, avatarUrl: claim.avatarUrl });
    }
  }
  // pool 绑定兜底（认领过的座位不覆盖）
  const handles = snapshotPlayers
    .filter(p => p && p.handle && !openidByPlayerId.has(p.id))
    .map(p => String(p.handle).toLowerCase());
  if (handles.length > 0) {
    const _cmd = db.command;
    const poolRes = await db.collection('pool')
      .where({ handle: _cmd.in(handles), boundOpenid: _cmd.exists(true) })
      .get()
      .catch(() => ({ data: [] }));
    const boundByHandle = new Map(poolRes.data.map(d => [d.handle, d]));
    for (const p of snapshotPlayers) {
      if (!p || !p.handle || openidByPlayerId.has(p.id)) continue;
      const pool = boundByHandle.get(String(p.handle).toLowerCase());
      if (pool && pool.boundOpenid) {
        openidByPlayerId.set(p.id, pool.boundOpenid);
        if (!identityByOpenid.has(pool.boundOpenid)) {
          identityByOpenid.set(pool.boundOpenid, { nickname: pool.displayName, avatarUrl: '' });
        }
      }
    }
  }

  if (openidByPlayerId.size === 0) {
    return { ok: false, error: 'no_claims', message: '没有可归属的玩家：让牌友认领座位或绑定玩家池身份' };
  }

  const authoritativeMode = ['4', '6', '8'].includes(String(snapshot.mode)) ? String(snapshot.mode) : '4';
  const sessions = (Array.isArray(event.sessions) ? event.sessions.slice(0, 16) : [])
    .filter(s => s && openidByPlayerId.has(Number(s.playerId)));

  // 票数服务端自取：votes 集合按 voteKey 聚合，playerId → openid 经归属表映射
  const voteByOpenid = new Map();
  try {
    const votesRes = await db.collection('votes')
      .where({ code, sessionKey: keys.voteKey })
      .limit(100)
      .get();
    for (const v of votesRes.data) {
      for (const [playerId, openid] of openidByPlayerId) {
        const acc = voteByOpenid.get(openid) || { mvp: 0, burden: 0 };
        if (playerId === v.mvp) acc.mvp += 1;
        if (playerId === v.burden) acc.burden += 1;
        voteByOpenid.set(openid, acc);
      }
    }
  } catch (err) {
    // votes 集合不存在（无人投票）→ 零票，正常
  }

  try {
    await db.createCollection('players');
  } catch (err) { /* 已存在 */ }

  const touched = new Map();
  let applied = 0;
  let skipped = 0;

  try {
    const sessionOpenids = sessions.map(s => openidByPlayerId.get(Number(s.playerId)));
    const targets = new Set([...sessionOpenids, ...voteByOpenid.keys()]);
    for (const openid of targets) {
      const existing = await loadPlayerDoc(db, openid);
      const doc = existing || { _id: openid, displayName: '', avatarUrl: '', stats: freshStats() };
      doc.stats = { ...freshStats(), ...doc.stats };
      touched.set(openid, { doc, exists: Boolean(existing) });
    }

    const mapIds = (ids) => (Array.isArray(ids) ? ids : [])
      .map(id => openidByPlayerId.get(Number(id)))
      .filter(Boolean);

    for (const s of sessions) {
      const openid = openidByPlayerId.get(Number(s.playerId));
      const entry = touched.get(openid);
      const filtered = {
        ...s,
        partnerOpenids: mapIds(s.partnerPlayerIds),
        opponentOpenids: mapIds(s.opponentPlayerIds)
      };
      if (applySession(entry.doc.stats, filtered, keys.gameKey, authoritativeMode)) applied++; else skipped++;
      const identity = identityByOpenid.get(openid) || {};
      if (identity.nickname) entry.doc.displayName = String(identity.nickname).slice(0, 32);
      if (identity.avatarUrl) entry.doc.avatarUrl = String(identity.avatarUrl).slice(0, 512);
    }

    for (const [openid, tally] of voteByOpenid) {
      const entry = touched.get(openid);
      if (applyVotes(entry.doc.stats, tally, keys.voteKey)) applied++; else skipped++;
    }

    for (const [openid, entry] of touched) {
      const data = {
        displayName: entry.doc.displayName,
        avatarUrl: entry.doc.avatarUrl,
        // _.set：整对象替换。普通嵌套对象在 update 里是合并语义，
        // 会让 sessionHistory 的封顶淘汰永不生效 → 文档无限膨胀
        stats: _.set(entry.doc.stats),
        updatedAt: db.serverDate()
      };
      if (entry.exists) {
        await db.collection('players').doc(openid).update({ data });
      } else {
        await db.collection('players').doc(openid).set({
          data: { displayName: entry.doc.displayName, avatarUrl: entry.doc.avatarUrl, stats: entry.doc.stats, updatedAt: db.serverDate() }
        });
      }
    }
  } catch (err) {
    console.error('profile_sync failed:', err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }

  return { ok: true, applied, skipped, players: touched.size };
};
