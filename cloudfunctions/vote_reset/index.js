/**
 * vote_reset — 房主清空某 sessionKey 的投票（重新开一轮投票窗口）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const code = String((event && event.code) || '').trim().toUpperCase();
  const sessionKey = String((event && event.sessionKey) || '');
  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) return { ok: false, error: 'invalid_code' };
  if (!sessionKey) return { ok: false, error: 'invalid_session_key' };

  const db = cloud.database();
  const room = await db.collection('rooms').doc(code).get().catch(() => null);
  if (!room || !room.data) return { ok: false, error: 'room_not_found' };
  if (room.data.ownerOpenid !== OPENID) return { ok: false, error: 'not_owner' };

  try {
    const res = await db.collection('votes').where({ code, sessionKey }).remove();
    return { ok: true, removed: res.stats.removed };
  } catch (err) {
    console.error('vote_reset failed:', err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }
};
