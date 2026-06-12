/**
 * profile_get — 读自己的玩家档案（openid 维度；走函数绕开集合读权限）。
 * partners/opponents 以**别人的** openid 为 key —— 即使是本人端点也剥离
 * （第三方 openid 不下发任何客户端；2026-06-12 review 修复）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const db = cloud.database();
  const res = await db.collection('players').doc(OPENID).get().catch(() => null);
  if (!res || !res.data) return { ok: true, openid: OPENID, profile: null };
  const profile = { ...res.data };
  if (profile.stats && typeof profile.stats === 'object') {
    const { partners, opponents, ...safe } = profile.stats;
    profile.stats = safe;
  }
  return { ok: true, openid: OPENID, profile };
};
