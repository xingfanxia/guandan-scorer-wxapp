/**
 * vote_submit — 围观者/玩家提交 MVP(最C)/最闹 投票。
 * 幂等：votes 集合 _id = `${code}:${sessionKey}:${openid}`，同人重投 = 覆盖自己那票。
 * sessionKey 由客户端用 vendored voteSessionKey 派生（同一快照两端推导一致）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const code = String((event && event.code) || '').trim().toUpperCase();
  const sessionKey = String((event && event.sessionKey) || '');
  const vote = (event && event.vote) || {};

  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) return { ok: false, error: 'invalid_code' };
  if (!sessionKey || sessionKey.length > 256) return { ok: false, error: 'invalid_vote_session' };
  const mvp = Number(vote.mvp);
  const burden = Number(vote.burden);
  if (!Number.isSafeInteger(mvp) || !Number.isSafeInteger(burden)) {
    return { ok: false, error: 'invalid_vote' };
  }
  if (mvp === burden) return { ok: false, error: 'same_player', message: '最C和最闹不能投同一个人' };

  const db = cloud.database();
  try {
    await db.createCollection('votes');
  } catch (err) { /* 已存在 */ }

  const room = await db.collection('rooms').doc(code).get().catch(() => null);
  if (!room || !room.data) return { ok: false, error: 'room_not_found' };

  const docId = `${code}:${sessionKey}:${OPENID}`;
  const data = {
    code,
    sessionKey,
    openid: OPENID,
    mvp,
    burden,
    votedAt: db.serverDate()
  };

  try {
    await db.collection('votes').doc(docId).set({ data }); // set = upsert，天然幂等
    return { ok: true };
  } catch (err) {
    console.error('vote_submit failed:', err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }
};
