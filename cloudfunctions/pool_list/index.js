/**
 * pool_list — 玩家池列表（选人器/绑定页用；走函数绕集合读权限）。
 * 返回精简字段 + 是否已被绑定 + 是否绑定给我。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const db = cloud.database();
  try {
    const res = await db.collection('pool').limit(100).get();
    const players = res.data.map(p => ({
      handle: p.handle,
      displayName: p.displayName,
      emoji: p.emoji,
      tagline: p.tagline,
      sessionsPlayed: (p.webStats && p.webStats.sessionsPlayed) || 0,
      bound: Boolean(p.boundOpenid),
      boundToMe: Boolean(p.boundOpenid && p.boundOpenid === OPENID)
    }));
    players.sort((a, b) => b.sessionsPlayed - a.sessionsPlayed);
    return { ok: true, players };
  } catch (err) {
    // pool 集合尚未导入 → 空池
    return { ok: true, players: [] };
  }
};
