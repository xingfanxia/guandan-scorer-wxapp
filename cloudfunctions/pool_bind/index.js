/**
 * pool_bind — 微信用户一次性绑定 web 版玩家身份（openid ↔ handle，双向唯一）。
 * 绑定时把 webStats 一次性并入 players/{openid} 档案（幂等：stats.webImport.handle 守卫）。
 * 解绑不开放（防战绩反复横跳）—— 绑错了找房主/管理员在控制台清 boundOpenid。
 */
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const WEB_BASE = 'https://gd.ax0x.ai';

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (err) { reject(new Error('bad JSON')); }
      });
    }).on('error', reject);
  });
}

const LADDER_BASE = 1000;

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

// 镜像 miniprogram/core/ladder.js seedLadderRating —— 改那边记得同步这里
function seedLadderRating(webStats) {
  const s = Math.max(0, Number(webStats && webStats.sessionsPlayed) || 0);
  if (s <= 0) return LADDER_BASE;
  const won = Math.min(s, Math.max(0, Number(webStats.sessionsWon) || 0));
  const winRate = won / s;
  const avgRank = Number(webStats.avgRankingPerSession);
  const rankNorm = Number.isFinite(avgRank) && avgRank >= 1
    ? (4.5 - Math.min(avgRank, 8)) / 3.5
    : 0;
  const conf = Math.min(s, 20) / 20;
  const rating = Math.round(LADDER_BASE + conf * (250 * rankNorm + 300 * (winRate - 0.5)));
  return Math.max(700, Math.min(1300, rating));
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const handle = String((event && event.handle) || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(handle)) return { ok: false, error: 'invalid_handle' };

  const db = cloud.database();
  const _ = db.command;

  // 我已经绑过别人？（openid 侧唯一）
  const mine = await db.collection('pool').where({ boundOpenid: OPENID }).limit(1).get().catch(() => null);
  if (mine && mine.data.length > 0) {
    if (mine.data[0].handle === handle) return { ok: true, already: true };
    return { ok: false, error: 'already_bound', message: `你已绑定 @${mine.data[0].handle}，每人只能绑一次` };
  }

  // handle 侧唯一：原子先到先得
  const res = await db.collection('pool')
    .where({ _id: handle, boundOpenid: _.exists(false) })
    .update({ data: { boundOpenid: OPENID, boundAt: db.serverDate() } })
    .catch(() => ({ stats: { updated: 0 } }));
  if (res.stats.updated !== 1) {
    const doc = await db.collection('pool').doc(handle).get().catch(() => null);
    if (!doc || !doc.data) return { ok: false, error: 'handle_not_found' };
    if (doc.data.boundOpenid === OPENID) return { ok: true, already: true };
    return { ok: false, error: 'handle_taken', message: '这个玩家已被别人绑定' };
  }

  // webStats 一次性并入 openid 档案：绑定时单人实时拉完整战绩（含荣誉/连胜/局数），
  // web 不可达时回退池内列表概要（导入时只存了概要 —— 见 pool_import 的 3 秒预算取舍）
  const pool = await db.collection('pool').doc(handle).get();
  let w = (pool.data && pool.data.webStats) || {};
  try {
    const detail = await getJson(`${WEB_BASE}/api/players/${encodeURIComponent(handle)}`);
    const full = (detail.player || detail).stats;
    if (full && typeof full === 'object') w = full;
  } catch (err) {
    console.error('pool_bind live fetch failed, fallback to pool summary:', String(err.message || err));
  }
  try {
    await db.createCollection('players');
  } catch (err) { /* 已存在 */ }

  const existing = await db.collection('players').doc(OPENID).get().catch(() => null);
  const doc = (existing && existing.data) || { _id: OPENID, displayName: '', avatarUrl: '', stats: freshStats() };
  doc.stats = { ...freshStats(), ...doc.stats };

  if (!doc.stats.webImport || doc.stats.webImport.handle !== handle) {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    doc.stats.sessionsPlayed += num(w.sessionsPlayed);
    doc.stats.sessionsWon += num(w.sessionsWon);
    doc.stats.longestWinStreak = Math.max(doc.stats.longestWinStreak, num(w.longestWinStreak));
    doc.stats.totalGames += num(w.roundsPlayed);
    doc.stats.rankingSum += Math.min(8, num(w.avgRankingPerRound)) * num(w.roundsPlayed);
    doc.stats.rankingGames += num(w.roundsPlayed);
    doc.stats.mvpVotes += num(w.mvpVotes);
    doc.stats.burdenVotes += num(w.burdenVotes);
    for (const [title, count] of Object.entries(w.honors || {})) {
      const t = String(title).slice(0, 16);
      const c = num(count);
      if (t && c > 0) doc.stats.honors[t] = (doc.stats.honors[t] || 0) + c;
    }
    doc.stats.webImport = { handle, importedAt: new Date().toISOString() };
    if (!doc.displayName && pool.data.displayName) doc.displayName = pool.data.displayName;
    // 天梯起评分：没挣过分才垫底（webStats 折算），挣过的分永不覆盖
    const lad = doc.stats.ladder;
    if (!lad || !Number(lad.sessions)) {
      const seed = seedLadderRating(w);
      doc.stats.ladder = { rating: seed, sessions: 0, peak: seed };
    }
  }

  try {
    const data = {
      displayName: doc.displayName,
      avatarUrl: doc.avatarUrl,
      stats: _.set(doc.stats),
      updatedAt: db.serverDate()
    };
    if (existing && existing.data) {
      await db.collection('players').doc(OPENID).update({ data });
    } else {
      await db.collection('players').doc(OPENID).set({
        data: { displayName: doc.displayName, avatarUrl: doc.avatarUrl, stats: doc.stats, updatedAt: db.serverDate() }
      });
    }
  } catch (err) {
    console.error('pool_bind merge failed:', err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }

  return { ok: true, handle, imported: true };
};
