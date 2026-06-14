/**
 * pool_add — 在小程序里手动新建玩家，落入 pool 集合（替代「手动输入只进本地内存、不进 DB」的旧行为）。
 * 之前 pool 只能从 web 版（pool_import）导入 —— 只玩小程序、从没打过 web 的新牌友无法成为可追踪玩家。
 * 本函数补上这条入池路径：生成内部 handle（pool 主键 = handle，须 latin；中文名进 displayName），
 * 不绑 openid（保持未绑定，任何人日后可认领/绑定，与 web 迁移来的未绑定玩家同语义）。
 *
 * 去重：按 displayName（trim 后）命中已有玩家则复用其 handle —— 朋友局里同名即同人，
 * 避免每局重输「老王」刷出一堆重复 pool 文档。
 *
 * 合规：仅存昵称/emoji/签名，零金钱字段。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 生成 latin 内部 handle（pool 主键），形如 m<base36 时间><4 位随机>，恒匹配 [a-z0-9_-]{2,32}。
 * 测试用昵称（test/测试 开头）→ 前缀 test_，让 pool_prune 能一键清掉（冒烟/QA 用可丢弃玩家）。
 */
function genHandle(displayName) {
  const isTest = /^(test|测试)/i.test(displayName || '');
  const prefix = isTest ? 'test_' : 'm';
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}${t}${r}`.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const displayName = String((event && event.displayName) || '').trim().slice(0, 20);
  if (!displayName) return { ok: false, error: 'empty_name' };
  const emoji = String((event && event.emoji) || '🙂').slice(0, 8) || '🙂';
  const tagline = String((event && event.tagline) || '').slice(0, 64);

  const db = cloud.database();
  try {
    await db.createCollection('pool');
  } catch (err) { /* 已存在 */ }

  // 去重：同名（trim 后精确匹配）复用，不再新建。朋友局同名即同人。
  try {
    const dup = await db.collection('pool').where({ displayName }).limit(1).get();
    if (dup && dup.data && dup.data.length > 0) {
      const d = dup.data[0];
      return { ok: true, handle: d.handle, displayName: d.displayName, emoji: d.emoji, created: false, reused: true };
    }
  } catch (err) { /* 查询失败不阻塞新建 */ }

  // 生成不冲突的 handle（碰撞概率极低，仍探一次存在性兜底）
  let handle = genHandle(displayName);
  const existing = await db.collection('pool').doc(handle).get().catch(() => null);
  if (existing && existing.data) handle = (genHandle(displayName) + Math.random().toString(36).slice(2, 4)).slice(0, 32);
  handle = handle.slice(0, 32);

  const data = {
    handle,
    displayName,
    emoji,
    tagline,
    webStats: { sessionsPlayed: 0, sessionsWon: 0, avgRankingPerSession: 0 },
    source: 'wxapp',
    createdAt: db.serverDate()
    // boundOpenid 故意不写：新建玩家保持未绑定，与 web 迁移玩家同语义
  };

  try {
    await db.collection('pool').doc(handle).set({ data });
  } catch (err) {
    console.error('pool_add set failed:', handle, err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }

  return { ok: true, handle, displayName, emoji, created: true };
};
