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
 * event: { code, sessions }
 *   sessions: [{ playerId, teamWon, gamesInSession, avgRanking, firstPlaces,
 *     lastPlaces, partnerPlayerIds, opponentPlayerIds, honorsEarned, handle? }]
 *   （房主侧 buildProfileSessions 产物，playerId 维度 —— openid 解析全在服务端）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_SESSION_HISTORY = 200;
const MAX_RANK = 8;

// 天梯分（WXAPP-9）：vendored CJS 镜像，源 shared/ladderLogic.js（改算法改 web repo + sync:shared）
const { LADDER_BASE, computeLadderDeltas, applyLadderDelta, seedLadderRating } = require('./ladderLogic.js');

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
    ladder: { rating: LADDER_BASE, sessions: 0, peak: LADDER_BASE },
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

/** 管理员判定：admins 集合 doc(openid) 存在即是。集合不存在/无 doc → 非管理员（安全默认） */
async function isAdmin(db, openid) {
  if (!openid) return false;
  try {
    const r = await db.collection('admins').doc(openid).get();
    return !!(r && r.data);
  } catch (err) {
    return false;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const db = cloud.database();
  const _ = db.command;
  const callerIsAdmin = await isAdmin(db, OPENID);

  // 审核队列（防房主伪造自家战绩）：非管理员的入库进 pending_sessions，管理员审批后才真正 apply。
  // approveId = 管理员审批一条 pending —— 绕开房主闸，用 pending 里的 code+sessions 重跑同一套 apply。
  const approveId = String((event && event.approveId) || '');
  const approveMode = !!approveId;
  let pendingDoc = null;
  if (approveMode) {
    if (!callerIsAdmin) return { ok: false, error: 'not_admin' };
    const pd = await db.collection('pending_sessions').doc(approveId).get().catch(() => null);
    if (!pd || !pd.data) return { ok: false, error: 'pending_not_found' };
    if (pd.data.status && pd.data.status !== 'pending') return { ok: true, already: true };
    pendingDoc = pd.data;
  }

  const code = approveMode
    ? String((pendingDoc && pendingDoc.code) || '')
    : String((event && event.code) || '').trim().toUpperCase();
  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) return { ok: false, error: 'invalid_code' };

  const room = await db.collection('rooms').doc(code).get().catch(() => null);
  if (!room || !room.data) return { ok: false, error: 'room_not_found' };
  // 房主闸：普通入库须本人是房主；审批模式由管理员代跑，跳过（已验过 admin）
  if (!approveMode && room.data.ownerOpenid !== OPENID) return { ok: false, error: 'not_owner' };

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
  // pool 文档一次查全（两用：① 未认领座位的绑定兜底 ② 天梯起评分的 web 历史）
  const allHandles = snapshotPlayers
    .filter(p => p && p.handle)
    .map(p => String(p.handle).toLowerCase());
  const poolByHandle = new Map();
  if (allHandles.length > 0) {
    const _cmd = db.command;
    const poolRes = await db.collection('pool')
      .where({ handle: _cmd.in(allHandles) })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }));
    for (const d of poolRes.data) poolByHandle.set(d.handle, d);
    // 绑定兜底（认领过的座位不覆盖）
    for (const p of snapshotPlayers) {
      if (!p || !p.handle || openidByPlayerId.has(p.id)) continue;
      const pool = poolByHandle.get(String(p.handle).toLowerCase());
      if (pool && pool.boundOpenid) {
        openidByPlayerId.set(p.id, pool.boundOpenid);
        if (!identityByOpenid.has(pool.boundOpenid)) {
          identityByOpenid.set(pool.boundOpenid, { nickname: pool.displayName, avatarUrl: '' });
        }
      }
    }
  }
  const webStatsByPlayerId = new Map();
  for (const p of snapshotPlayers) {
    if (!p || !p.handle) continue;
    const pool = poolByHandle.get(String(p.handle).toLowerCase());
    if (pool && pool.webStats) webStatsByPlayerId.set(p.id, pool.webStats);
  }

  if (openidByPlayerId.size === 0) {
    return { ok: false, error: 'no_claims', message: '没有可归属的玩家：让牌友认领座位或绑定玩家池身份' };
  }

  const authoritativeMode = ['4', '6', '8'].includes(String(snapshot.mode)) ? String(snapshot.mode) : '4';

  // 非管理员、非审批模式 → 入审核队列，不直接 apply（房主可伪造自家战绩，故需管理员把关）。
  // 存原始 event.sessions + code，审批时由管理员重跑（重新从房间解析归属，gameKey 幂等防重复入库）。
  if (!approveMode && !callerIsAdmin) {
    const rawSessions = Array.isArray(event.sessions) ? event.sessions.slice(0, 16) : [];
    const names = snapshotPlayers.filter(p => p && p.handle).map(p => p.name).slice(0, 12).join('、');
    await db.collection('pending_sessions').add({
      data: {
        code,
        sessions: rawSessions,
        submitterOpenid: OPENID,
        mode: authoritativeMode,
        summary: `房间 ${code} · ${authoritativeMode}人 · ${openidByPlayerId.size} 人可归属${names ? ' · ' + names : ''}`,
        status: 'pending',
        createdAt: db.serverDate()
      }
    });
    return { ok: true, pending: true, message: '已提交，等管理员审核后入库' };
  }

  const eventSessions = approveMode ? (pendingDoc && pendingDoc.sessions) : event.sessions;
  const sessions = (Array.isArray(eventSessions) ? eventSessions.slice(0, 16) : [])
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

    // 天梯分：评分只取服务端 players 文档（client 不可注入）。
    // 没挣过分的人（含未绑定）用 web 历史折算起评分计入队伍均分 —— 期望胜率比裸 1000 准。
    const ladderByOpenid = new Map();
    for (const [openid, entry] of touched) {
      ladderByOpenid.set(openid, entry.doc.stats.ladder || null);
    }
    const ratingFor = (playerId) => {
      const openid = openidByPlayerId.get(playerId);
      const lad = openid ? ladderByOpenid.get(openid) : null;
      if (lad && Number(lad.sessions) > 0 && Number.isFinite(Number(lad.rating))) return Number(lad.rating);
      return seedLadderRating(webStatsByPlayerId.get(playerId));
    };
    const avgRankingByPlayerId = new Map(sessions.map(s => [Number(s.playerId), Math.min(MAX_RANK, nonNeg(s.avgRanking))]));
    // winnerKey 容错对齐 deriveKeys：gameStatus 缺失时回退末局 winKey；都非法 → winnerTeam=0，
    // computeLadderDeltas 退化为全 0（宁可这场不动天梯，不能错判方向）
    const lastEntry = (Array.isArray(snapshot.history) && snapshot.history[snapshot.history.length - 1]) || null;
    const winnerKey = (snapshot.gameStatus && snapshot.gameStatus.winnerKey) || (lastEntry && lastEntry.winKey);
    const winnerTeam = winnerKey === 't1' ? 1 : winnerKey === 't2' ? 2 : 0;
    const ladderDeltas = computeLadderDeltas({
      mode: Number(authoritativeMode),
      winnerTeam,
      players: snapshotPlayers.map(p => ({
        id: p.id,
        team: Number(p.team),
        rating: ratingFor(p.id),
        avgRanking: avgRankingByPlayerId.has(Number(p.id)) ? avgRankingByPlayerId.get(Number(p.id)) : null
      }))
    });

    for (const s of sessions) {
      const openid = openidByPlayerId.get(Number(s.playerId));
      const entry = touched.get(openid);
      const filtered = {
        ...s,
        partnerOpenids: mapIds(s.partnerPlayerIds),
        opponentOpenids: mapIds(s.opponentPlayerIds)
      };
      if (applySession(entry.doc.stats, filtered, keys.gameKey, authoritativeMode)) {
        applied++;
        // 与战绩同一道 gameKey 幂等闸：只有新入库的场次才动天梯分。
        // 首次入梯（sessions=0）：用 web 历史起评分垫底，不覆盖已挣的分
        const lad = entry.doc.stats.ladder;
        if ((!lad || !Number(lad.sessions)) && webStatsByPlayerId.has(Number(s.playerId))) {
          const seed = seedLadderRating(webStatsByPlayerId.get(Number(s.playerId)));
          entry.doc.stats.ladder = { rating: seed, sessions: 0, peak: seed };
        }
        entry.doc.stats.ladder = applyLadderDelta(entry.doc.stats.ladder, ladderDeltas.get(String(s.playerId)) || 0);
      } else skipped++;
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
    // 审批模式：apply 成功后把 pending 标记为已批（幂等：gameKey 已挡重复入库）
    if (approveMode) {
      await db.collection('pending_sessions').doc(approveId)
        .update({ data: { status: 'approved', approvedBy: OPENID, approvedAt: db.serverDate() } })
        .catch(() => {});
    }
  } catch (err) {
    console.error('profile_sync failed:', err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }

  return { ok: true, applied, skipped, players: touched.size, approved: approveMode };
};
