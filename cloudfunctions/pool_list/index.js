/**
 * pool_list — 玩家池列表（选人器/绑定页/玩家天梯页用；走函数绕集合读权限）。
 * 返回精简字段 + 是否已被绑定 + 是否绑定给我；已绑定玩家并出小程序侧
 * 天梯分与场次（players 集合一次 in 查询 join，不回传 openid）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 镜像 miniprogram/core/ladder.js seedLadderRating —— 改那边记得同步这里
const LADDER_BASE = 1000;
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
  const rating = Math.round(LADDER_BASE + conf * (500 * (winRate - 0.5) + 100 * rankNorm));
  return Math.max(700, Math.min(1300, rating));
}

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
      // 挣过分用真分；没挣过（含未绑定）用 web 历史折算起评分（现算不落库，确定性）
      const earned = Boolean(ladder && Number(ladder.sessions) > 0 && Number.isFinite(Number(ladder.rating)));
      return {
        handle: p.handle,
        displayName: p.displayName,
        emoji: p.emoji,
        tagline: p.tagline,
        sessionsPlayed: (p.webStats && p.webStats.sessionsPlayed) || 0,
        bound: Boolean(p.boundOpenid),
        boundToMe: Boolean(p.boundOpenid && p.boundOpenid === OPENID),
        ladder: earned ? Number(ladder.rating) : seedLadderRating(p.webStats),
        ladderProvisional: !earned,
        wxSessions: stats ? Number(stats.sessionsPlayed) || 0 : 0
      };
    });
    // 天梯榜序：按分数（起评分也参与），同分按 web 场次
    players.sort((a, b) => b.ladder - a.ladder || b.sessionsPlayed - a.sessionsPlayed);
    return { ok: true, players };
  } catch (err) {
    // pool 集合尚未导入 → 空池
    return { ok: true, players: [] };
  }
};
