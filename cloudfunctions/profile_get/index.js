/**
 * profile_get — 读自己的玩家档案（openid 维度；走函数绕开集合读权限）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const db = cloud.database();
  const res = await db.collection('players').doc(OPENID).get().catch(() => null);
  if (!res || !res.data) return { ok: true, openid: OPENID, profile: null };
  return { ok: true, openid: OPENID, profile: res.data };
};
