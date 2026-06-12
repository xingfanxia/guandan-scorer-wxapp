/**
 * profile_get_by_handle — 查任意池内玩家的档案（web players.html 对位；战绩公开）。
 * pool 概要（web 老战绩）+ 若已绑定微信，并出 players 文档的小程序战绩（含天梯）。
 * 不回传 openid —— 绑定关系只以 bound 布尔暴露。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const handle = String((event && event.handle) || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(handle)) return { ok: false, error: 'invalid_handle' };

  const db = cloud.database();
  const pool = await db.collection('pool').doc(handle).get().catch(() => null);
  if (!pool || !pool.data) return { ok: false, error: 'not_found' };

  const p = pool.data;
  let profile = null;
  if (p.boundOpenid) {
    const doc = await db.collection('players').doc(p.boundOpenid).get().catch(() => null);
    if (doc && doc.data) {
      profile = {
        displayName: doc.data.displayName || '',
        avatarUrl: doc.data.avatarUrl || '',
        stats: doc.data.stats || null
      };
    }
  }

  return {
    ok: true,
    pool: {
      handle: p.handle,
      displayName: p.displayName || '',
      emoji: p.emoji || '🙂',
      tagline: p.tagline || '',
      webStats: p.webStats || {},
      bound: Boolean(p.boundOpenid)
    },
    profile
  };
};
