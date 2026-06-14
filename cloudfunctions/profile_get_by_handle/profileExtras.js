/**
 * profileExtras — 档案扩展派生的云端解析（队友与对手 / 近期排名走势 / 最近游戏）。
 * display-safe：把 openid/handle 键控的关系图解析成含 name/emoji 的数组，**绝不下发 openid**；
 * 排名走势只取名次数字、最近游戏剥房间码 —— 公开端点合规（对位 web player-profile.html，但去房间跳转）。
 *
 * ⚠️ 本文件 vendored 双份：profile_get_by_handle/ 为 canonical，profile_get/ 为同步副本。改一处要同步另一处。
 */
const REL_LIMIT = 40;   // 关系图节点上限（防超大文档 + 控制 in 查询规模）
const TREND_LIMIT = 10; // 走势点数（对位 web recentRankings 10）
const GAMES_LIMIT = 10;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * 关系图 {key:{games,wins,winRate?}} → [{name,emoji,handle,games,wins,winRate}]。
 * resolve(key) → {name,emoji,handle} | null（key 为 openid 或 handle，由调用方决定解析源）。
 */
function relationsFromMap(rawMap, resolve) {
  if (!rawMap || typeof rawMap !== 'object') return [];
  const out = [];
  for (const [key, v] of Object.entries(rawMap)) {
    const games = Math.max(0, Math.round(num(v && v.games)));
    if (games <= 0) continue;
    const wins = Math.min(games, Math.max(0, Math.round(num(v && v.wins))));
    const r = resolve(key) || {};
    const raw = Number(v && v.winRate);
    out.push({
      name: String(r.name || r.handle || '牌友'),
      emoji: String(r.emoji || '🙂'),
      handle: String(r.handle || ''),
      games,
      wins,
      winRate: Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : wins / games
    });
    if (out.length >= REL_LIMIT) break;
  }
  return out;
}

/** sessionHistory {gameKey:{ranking,...}} → 最近 N 局名次（旧→新，仅数字，剥房间码） */
function rankTrendFromSessions(sessionHistory) {
  if (!sessionHistory || typeof sessionHistory !== 'object') return [];
  return Object.values(sessionHistory)
    .map((s) => num(s && s.ranking))
    .filter((v) => v >= 1)
    .slice(-TREND_LIMIT); // Object key 序 = 插入序（旧→新）
}

/** web recentRankings [n,...]（新→旧）→ 旧→新 的最近 N（与 chart 横轴方向一致） */
function rankTrendFromWeb(recentRankings) {
  if (!Array.isArray(recentRankings)) return [];
  return recentRankings.map(Number).filter((v) => Number.isFinite(v) && v >= 1).slice(0, TREND_LIMIT).reverse();
}

/** wx sessionHistory → 最近 N 局摘要（新→旧）：mode 数字→'NP'、剥房间码/日期 */
function recentGamesFromSessions(sessionHistory) {
  if (!sessionHistory || typeof sessionHistory !== 'object') return [];
  return Object.values(sessionHistory).slice(-GAMES_LIMIT).reverse().map((s) => ({
    date: '',
    mode: num(s && s.mode) ? `${num(s.mode)}P` : '',
    ranking: num(s && s.ranking),
    teamWon: !!(s && s.teamWon),
    honors: Array.isArray(s && s.honorsEarned) ? s.honorsEarned.slice(0, 16).map((t) => String(t).slice(0, 16)) : []
  }));
}

/** web recentGames → 最近 N 局摘要（新→旧）：剥房间码，保留 日期/模式/名次/胜负/荣誉 */
function recentGamesFromWeb(recentGames) {
  if (!Array.isArray(recentGames)) return [];
  return recentGames.slice(0, GAMES_LIMIT).map((g) => ({
    date: String((g && g.date) || '').slice(0, 10),
    mode: String((g && g.mode) || ''),
    ranking: num(g && g.ranking),
    teamWon: !!(g && g.teamWon),
    honors: Array.isArray(g && g.honorsEarned) ? g.honorsEarned.slice(0, 16).map((t) => String(t).slice(0, 16)) : []
  }));
}

/** 收集关系图全部 key（openid 或 handle），去重 + 限量（控制 in 查询规模） */
function relationKeys(partners, opponents) {
  const set = new Set();
  for (const m of [partners, opponents]) {
    if (m && typeof m === 'object') for (const k of Object.keys(m)) set.add(String(k));
  }
  return [...set].slice(0, REL_LIMIT * 2);
}

module.exports = {
  relationsFromMap,
  rankTrendFromSessions,
  rankTrendFromWeb,
  recentGamesFromSessions,
  recentGamesFromWeb,
  relationKeys
};
