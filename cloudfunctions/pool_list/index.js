/**
 * pool_list — 玩家池列表（选人器/绑定页/玩家天梯页用；走函数绕集合读权限）。
 * 返回精简字段 + 是否已被绑定 + 是否绑定给我；已绑定玩家并出小程序侧
 * 天梯分与场次（players 集合一次 in 查询 join，不回传 openid）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const db = cloud.database();
  const _ = db.command;
  try {
    const res = await db.collection('pool').limit(100).get();

    const boundOpenids = res.data.map(p => p.boundOpenid).filter(Boolean);
    const playerByOpenid = new Map();
    if (boundOpenids.length > 0) {
      const pr = await db.collection('players')
        .where({ _id: _.in(boundOpenids) })
        .limit(100)
        .get()
        .catch(() => ({ data: [] }));
      for (const d of pr.data) playerByOpenid.set(d._id, d);
    }

    const players = res.data.map(p => {
      const doc = p.boundOpenid ? playerByOpenid.get(p.boundOpenid) : null;
      const stats = doc && doc.stats ? doc.stats : null;
      const ladder = stats && stats.ladder;
      return {
        handle: p.handle,
        displayName: p.displayName,
        emoji: p.emoji,
        tagline: p.tagline,
        sessionsPlayed: (p.webStats && p.webStats.sessionsPlayed) || 0,
        bound: Boolean(p.boundOpenid),
        boundToMe: Boolean(p.boundOpenid && p.boundOpenid === OPENID),
        ladder: ladder && Number.isFinite(Number(ladder.rating)) ? Number(ladder.rating) : null,
        wxSessions: stats ? Number(stats.sessionsPlayed) || 0 : 0
      };
    });
    // 天梯榜序：有评分在前按分数，其余按 web 场次
    players.sort((a, b) =>
      (b.ladder === null ? -1 : b.ladder) - (a.ladder === null ? -1 : a.ladder) ||
      b.sessionsPlayed - a.sessionsPlayed
    );
    return { ok: true, players };
  } catch (err) {
    // pool 集合尚未导入 → 空池
    return { ok: true, players: [] };
  }
};
