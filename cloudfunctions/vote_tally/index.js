/**
 * vote_tally — 聚合某 sessionKey 的投票计数（任何人可查；走函数绕开集合读权限）。
 * 返回 {counts: {mvp: {playerId: n}, burden: {playerId: n}}, total, myVote}
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_VOTES = 100; // 朋友局体验版 ≤31 人，100 封顶足够

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const code = String((event && event.code) || '').trim().toUpperCase();
  const sessionKey = String((event && event.sessionKey) || '');
  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) return { ok: false, error: 'invalid_code' };
  if (!sessionKey) return { ok: false, error: 'invalid_session_key' };

  const db = cloud.database();
  try {
    const res = await db.collection('votes')
      .where({ code, sessionKey })
      .limit(MAX_VOTES)
      .get();

    const counts = { mvp: {}, burden: {} };
    let myVote = null;
    for (const v of res.data) {
      counts.mvp[v.mvp] = (counts.mvp[v.mvp] || 0) + 1;
      counts.burden[v.burden] = (counts.burden[v.burden] || 0) + 1;
      if (v.openid === OPENID) myVote = { mvp: v.mvp, burden: v.burden };
    }
    return { ok: true, counts, total: res.data.length, myVote };
  } catch (err) {
    // votes 集合还没建（无人投过）→ 空计票
    return { ok: true, counts: { mvp: {}, burden: {} }, total: 0, myVote: null };
  }
};
