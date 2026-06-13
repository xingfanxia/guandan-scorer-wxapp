/**
 * pool_list — 玩家池列表（选人器/绑定页/玩家天梯页用；走函数绕集合读权限）。
 * 返回精简字段 + 是否已被绑定 + 是否绑定给我；已绑定玩家并出小程序侧
 * 天梯分与场次（players 集合一次 in 查询 join，不回传 openid）。
 */
const cloud = require('wx-server-sdk');
const { LADDER_BASE, seedLadderRating } = require('./ladderLogic.js');

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

    const CALIBRATION_GAMES = 3; // 累计 3 场历史（web + 小程序合计）才进正式榜
    const players = res.data.map(p => {
      const doc = p.boundOpenid ? playerByOpenid.get(p.boundOpenid) : null;
      const stats = doc && doc.stats ? doc.stats : null;
      const ladder = stats && stats.ladder;
      // 天梯结算场次（只有小程序通关结算才 +1，与 web 并入的 sessionsPlayed 无关）
      const ladSessions = ladder ? Number(ladder.sessions) || 0 : 0;
      // 挣过分用真分；没挣过（含未绑定）用 web 历史折算起评分（现算不落库，确定性）
      const earned = ladSessions > 0 && Number.isFinite(Number(ladder.rating));
      // 历史总场次：绑定后 players.sessionsPlayed 已含 web 并入值 —— 直接用，别再和 webStats 相加；
      // 未绑定回退 webStats。这是「校准」依据 —— 老牌友凭 web 历史就该进榜，不必再打满小程序局。
      const totalSessions = stats && Number(stats.sessionsPlayed) > 0
        ? Number(stats.sessionsPlayed)
        : (p.webStats && Number(p.webStats.sessionsPlayed)) || 0;
      // 待校准：历史总场次 < 3（真·新人才沉底）；有战绩历史的老牌友直接参与正式排名
      const provisional = totalSessions < CALIBRATION_GAMES;
      return {
        handle: p.handle,
        displayName: p.displayName,
        emoji: p.emoji,
        tagline: p.tagline,
        sessionsPlayed: (p.webStats && p.webStats.sessionsPlayed) || 0,
        bound: Boolean(p.boundOpenid),
        boundToMe: Boolean(p.boundOpenid && p.boundOpenid === OPENID),
        ladder: earned ? Number(ladder.rating) : seedLadderRating(p.webStats),
        ladderSessions: ladSessions,
        provisional,
        ladderProvisional: provisional, // 兼容旧字段（首页选人器等）
        calibrationLeft: Math.max(0, CALIBRATION_GAMES - totalSessions),
        wxSessions: ladSessions,
        // seeded：分数是 web 历史折算起评分（未在小程序实结）—— 与「待校准」独立，
        // 用于 UI 的 * 标记。挣过分的玩家 earned=true → 无 *。
        seeded: !earned,
        totalSessions
      };
    });
    // 天梯榜序：已校准（≥3 场）按真分降序在前；待校准全部沉底（内部按起评分降序）
    players.sort((a, b) =>
      (a.provisional ? 1 : 0) - (b.provisional ? 1 : 0) ||
      b.ladder - a.ladder ||
      b.totalSessions - a.totalSessions
    );
    return { ok: true, players };
  } catch (err) {
    // pool 集合尚未导入 → 空池
    return { ok: true, players: [] };
  }
};
