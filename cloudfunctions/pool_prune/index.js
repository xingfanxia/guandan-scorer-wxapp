/**
 * pool_prune — 从 pool 集合删除测试/废弃玩家条目（管理工具）。
 * 安全自限：只动「测试标记」条目 —— handle 以 `test_` 开头，或 displayName 以 test/测试 开头。
 * 无论谁调用都碰不到真实玩家。两种用法：
 *   - 指定删：wx.cloud.callFunction({ name:'pool_prune', data:{ handles:['test_xxx', ...] } })
 *   - 扫描删：wx.cloud.callFunction({ name:'pool_prune', data:{ scanTest:true } }) —— 扫全池删所有测试标记条目
 * 若测试玩家曾绑定，连带删其 players 文档（boundOpenid）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TEST_HANDLE = /^test_[a-z0-9_-]{1,27}$/;
const TEST_NAME = /^(test|测试)/i;

/** 测试标记：handle 或 displayName 命中即视为可删（自限，绝不碰真实玩家） */
function isTestDoc(handle, displayName) {
  return TEST_HANDLE.test(String(handle || '').toLowerCase()) || TEST_NAME.test(String(displayName || ''));
}

async function removeDoc(db, h, doc) {
  if (doc.boundOpenid) {
    await db.collection('players').doc(doc.boundOpenid).remove().catch(() => {});
  }
  const res = await db.collection('pool').doc(h).remove().catch(() => ({ stats: { removed: 0 } }));
  return res.stats && res.stats.removed > 0;
}

exports.main = async (event) => {
  const db = cloud.database();
  const removed = [];
  const missing = [];
  const rejected = [];

  // 扫描模式：全池扫测试标记条目并删（含 m_ 前缀但 displayName 为测试名的历史脏数据）
  if (event && event.scanTest) {
    const res = await db.collection('pool').limit(200).get().catch(() => ({ data: [] }));
    for (const d of res.data) {
      if (!isTestDoc(d.handle, d.displayName)) continue;
      if (await removeDoc(db, d._id || d.handle, d)) removed.push(d.handle || d._id);
    }
    return { ok: true, removed, missing, rejected, mode: 'scan' };
  }

  // 指定删：只接受 test_ 前缀 handle（非 test_ 一律拒）
  const requested = Array.isArray(event && event.handles) ? event.handles : [];
  const handles = requested.map((h) => String(h).toLowerCase());
  for (const h of handles) {
    if (!TEST_HANDLE.test(h)) { rejected.push(h); continue; }
    const doc = await db.collection('pool').doc(h).get().catch(() => null);
    if (!doc || !doc.data) { missing.push(h); continue; }
    if (await removeDoc(db, h, doc.data)) removed.push(h);
  }
  return { ok: true, removed, missing, rejected };
};
