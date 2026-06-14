/**
 * profile_get — 读自己的玩家档案（openid 维度；走函数绕开集合读权限）。
 * partners/opponents 以**别人的** openid 为 key —— 不下发原始 openid；
 * 经 pool 反查显示名后，以 display-safe 数组（含 name/emoji）下发『队友与对手』，
 * 走势/最近游戏从 sessionHistory 取数字摘要（剥房间码）。对位 web player-profile.html。
 */
const cloud = require('wx-server-sdk');
const {
  relationsFromMap, rankTrendFromSessions, recentGamesFromSessions, relationKeys
} = require('./profileExtras.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/** openid → {name,emoji,handle}：第三方 openid 经 pool 反查显示名，绝不下发 openid 本身 */
async function resolveByOpenids(db, openids) {
  const map = new Map();
  if (!openids.length) return map;
  const _ = db.command;
  const res = await db.collection('pool').where({ boundOpenid: _.in(openids) }).limit(100).get().catch(() => ({ data: [] }));
  for (const d of res.data) {
    if (d.boundOpenid) map.set(d.boundOpenid, { name: d.displayName || d.handle, emoji: d.emoji || '🙂', handle: d.handle });
  }
  return map;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const db = cloud.database();
  const res = await db.collection('players').doc(OPENID).get().catch(() => null);
  if (!res || !res.data) return { ok: true, openid: OPENID, profile: null };
  const profile = { ...res.data };
  if (profile.stats && typeof profile.stats === 'object') {
    const { partners, opponents, ...safe } = profile.stats;
    // 队友/对手反查显示名后以 display-safe 数组下发（无第三方 openid）
    const keys = relationKeys(partners, opponents);
    const nameByOpenid = await resolveByOpenids(db, keys);
    const resolve = (k) => nameByOpenid.get(k) || null;
    safe.relations = {
      partners: relationsFromMap(partners, resolve),
      opponents: relationsFromMap(opponents, resolve)
    };
    safe.rankTrend = rankTrendFromSessions(profile.stats.sessionHistory);
    safe.recentGames = recentGamesFromSessions(profile.stats.sessionHistory);
    profile.stats = safe;
  }
  return { ok: true, openid: OPENID, profile };
};
