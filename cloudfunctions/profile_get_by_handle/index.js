/**
 * profile_get_by_handle — 查任意池内玩家的档案（web players.html 对位；战绩公开）。
 * pool 概要（web 老战绩）+ 若已绑定微信，并出 players 文档的小程序战绩（含天梯）；
 * 未绑定玩家则实时拉 web /api/players/{handle} 全量战绩归一成档案 stats（含荣誉/连胜/
 * 局数/票数），让 web-only 玩家也有完整档案（对齐 web 版，2026-06-13）。
 * 不回传 openid：绑定关系只以 bound 布尔暴露；stats 白名单回传 ——
 * partners/opponents 以 openid 为 key、sessionHistory 的 gameKey 内嵌房间码，
 * 公开端点一律剥离（2026-06-12 review HIGH 修复）。
 */
const cloud = require('wx-server-sdk');
const { LADDER_BASE, seedLadderRating } = require('./ladderLogic.js');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const WEB_BASE = 'https://gd.ax0x.ai';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(data)); } catch (err) { reject(new Error('bad JSON')); }
      });
    });
    req.on('error', reject);
    // 公开端点 + handle 可枚举：上游挂死时 4s 即弃（destroy 走 error→reject→catch 回退），
    // 不让单次调用把并发槽钉到平台超时（review 2026-06-13 MEDIUM 修复）
    req.setTimeout(4000, () => req.destroy(new Error('web timeout')));
  });
}


/**
 * web 全量战绩 → 档案 stats 形状（buildProfileVM 直接消费）。
 * web 字段名与小程序不同：roundsPlayed=总局数、avgRankingPerRound=场均名次；
 * web 不跟踪头游/垫底累计 → 留 null，VM 自动略过该格（不编造数字）。
 * 仅聚合数值 + 荣誉 + 分模式；partners/opponents/sessionHistory（含房间码/对手身份）一律不回传。
 */
function webStatsToProfileStats(w) {
  if (!w || typeof w !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const rounds = num(w.roundsPlayed);
  const avgR = Number(w.avgRankingPerRound);
  const honors = {};
  for (const [t, c] of Object.entries(w.honors || {})) {
    const n = num(c);
    const title = String(t).slice(0, 16);
    if (title && n > 0) honors[title] = n;
  }
  const mode = (w.modeBreakdown && typeof w.modeBreakdown === 'object') ? w.modeBreakdown : null;
  const seed = seedLadderRating(w);
  return {
    sessionsPlayed: num(w.sessionsPlayed),
    sessionsWon: num(w.sessionsWon),
    currentWinStreak: num(w.currentWinStreak),
    longestWinStreak: num(w.longestWinStreak),
    totalGames: rounds,
    // 头游/垫底：web 端无累计字段（API 回 null）→ 不提供，档案该格自动省略
    firstPlaceCount: null,
    lastPlaceCount: null,
    rankingSum: Number.isFinite(avgR) ? Math.min(8, avgR) * rounds : 0,
    rankingGames: rounds,
    mvpVotes: num(w.mvpVotes),
    burdenVotes: num(w.burdenVotes),
    honors,
    ...(mode ? { modeBreakdown: mode } : {}),
    // web 无天梯实结 → 注入折算起评分，档案天梯三格显示起评分（场次 0）
    ladder: { rating: seed, sessions: 0, peak: seed }
  };
}

/** 聚合数值与荣誉可公开；按 openid 键控/含房间码的字段绝不出端点（已绑定玩家走这条） */
function publicStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const pick = [
    'sessionsPlayed', 'sessionsWon', 'currentWinStreak', 'longestWinStreak',
    'totalGames', 'firstPlaceCount', 'lastPlaceCount', 'rankingSum', 'rankingGames',
    'mvpVotes', 'burdenVotes', 'honors', 'modeBreakdown', 'ladder'
  ];
  const safe = {};
  for (const key of pick) {
    if (stats[key] !== undefined) safe[key] = stats[key];
  }
  return safe;
}

exports.main = async (event) => {
  const handle = String((event && event.handle) || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(handle)) return { ok: false, error: 'invalid_handle' };

  const db = cloud.database();
  const pool = await db.collection('pool').doc(handle).get().catch(() => null);
  if (!pool || !pool.data) return { ok: false, error: 'not_found' };

  const p = pool.data;
  let profile = null;
  if (p.boundOpenid) {
    // 已绑定：小程序档案（已含并入的 web 历史）
    const doc = await db.collection('players').doc(p.boundOpenid).get().catch(() => null);
    if (doc && doc.data) {
      profile = {
        displayName: doc.data.displayName || '',
        avatarUrl: doc.data.avatarUrl || '',
        stats: publicStats(doc.data.stats),
        source: 'wx'
      };
    }
  } else {
    // 未绑定：实时拉 web 全量战绩 → 完整档案。web 不可达 → profile 置 null（不从 3 字段概要
    // 编造「总局数 0 / 连胜 0」假富档案，也不让概要触发场次成就 —— 前端回退展示池内 3 格概要 +
    // 「暂不可用」提示，所见即真（review 2026-06-13 MEDIUM/LOW 修复）
    try {
      const detail = await getJson(`${WEB_BASE}/api/players/${encodeURIComponent(handle)}`);
      const node = detail && (detail.player || detail);
      const full = webStatsToProfileStats(node && node.stats);
      if (full && full.sessionsPlayed > 0) {
        profile = { displayName: p.displayName || '', avatarUrl: '', stats: full, source: 'web' };
      }
    } catch (err) {
      console.error('profile_get_by_handle live fetch failed:', String((err && err.message) || err));
    }
  }

  return {
    ok: true,
    pool: {
      handle: p.handle,
      displayName: p.displayName || '',
      emoji: p.emoji || '🙂',
      tagline: p.tagline || '',
      webStats: p.webStats || {},
      bound: Boolean(p.boundOpenid)
    },
    profile
  };
};
