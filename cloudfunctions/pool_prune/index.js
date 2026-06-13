/**
 * pool_prune — 从 pool 集合删除测试/废弃玩家条目（管理工具）。
 * 安全自限：只删 handle 以 `test_` 开头的条目 —— 无论谁调用都动不了真实玩家。
 * 调用：wx.cloud.callFunction({ name: 'pool_prune', data: { handles: ['test_xxx', ...] } })
 * 若该测试玩家曾绑定（极少见），连带删其 players 文档（boundOpenid）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TEST_HANDLE = /^test_[a-z0-9_-]{1,27}$/;

exports.main = async (event) => {
  const db = cloud.database();
  const requested = Array.isArray(event && event.handles) ? event.handles : [];
  const handles = requested.map((h) => String(h).toLowerCase());
  const accepted = handles.filter((h) => TEST_HANDLE.test(h));
  const rejected = handles.filter((h) => !TEST_HANDLE.test(h)); // 非 test_ 前缀一律拒删

  const removed = [];
  const missing = [];
  for (const h of accepted) {
    const doc = await db.collection('pool').doc(h).get().catch(() => null);
    if (!doc || !doc.data) { missing.push(h); continue; }
    // 绑定过则连带清 players 档案（测试玩家通常未绑定，兜底处理）
    if (doc.data.boundOpenid) {
      await db.collection('players').doc(doc.data.boundOpenid).remove().catch(() => {});
    }
    const res = await db.collection('pool').doc(h).remove().catch(() => ({ stats: { removed: 0 } }));
    if (res.stats && res.stats.removed > 0) removed.push(h);
  }
  return { ok: true, removed, missing, rejected };
};
