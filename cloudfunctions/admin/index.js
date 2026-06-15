/**
 * admin — 战绩审核后台（claim / whoami / list / reject）。审批（approve）走 profile_sync 的 approveId 分支。
 * 身份：云函数只能拿 openid，拿不到微信号 —— 故管理员本人在小程序里输入「引导口令」一次性把自己
 * openid 登记进 admins 集合（claim）。口令 = 管理员微信号，仅作 bootstrap token（非 AppSecret/session_key，
 * 不是客户端密钥；比对在服务端）。日后可挪到云函数环境变量。
 *
 * action:
 *   claim  {secret}  口令对 → 把调用者 openid 写入 admins（幂等）
 *   whoami           回 { isAdmin }
 *   list             管理员：列 pending_sessions（status=pending），不下发 submitterOpenid
 *   reject {id}      管理员：丢弃一条 pending
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CLAIM_SECRET = 'AXAXAX0x'; // 管理员微信号，引导口令（server-only）

async function isAdmin(db, openid) {
  if (!openid) return false;
  try {
    const r = await db.collection('admins').doc(openid).get();
    return !!(r && r.data);
  } catch (err) {
    return false;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };
  const db = cloud.database();
  const action = String((event && event.action) || '');

  if (action === 'claim') {
    if (String((event && event.secret) || '') !== CLAIM_SECRET) return { ok: false, error: 'bad_secret' };
    try { await db.createCollection('admins'); } catch (e) { /* 已存在 */ }
    const ex = await db.collection('admins').doc(OPENID).get().catch(() => null);
    if (!(ex && ex.data)) {
      await db.collection('admins').doc(OPENID).set({ data: { claimedAt: db.serverDate() } });
    }
    return { ok: true, isAdmin: true, claimed: !(ex && ex.data) };
  }

  const admin = await isAdmin(db, OPENID);
  if (action === 'whoami') return { ok: true, isAdmin: admin };
  if (!admin) return { ok: false, error: 'not_admin' };

  if (action === 'list') {
    const res = await db.collection('pending_sessions')
      .where({ status: 'pending' })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
      .catch(() => ({ data: [] }));
    // openid 不出端点：只回展示字段
    const items = res.data.map((d) => ({
      id: d._id,
      code: d.code || '',
      mode: d.mode || '',
      summary: d.summary || `房间 ${d.code || ''}`,
      createdAt: d.createdAt || null
    }));
    return { ok: true, items };
  }

  if (action === 'reject') {
    const id = String((event && event.id) || '');
    if (!id) return { ok: false, error: 'no_id' };
    await db.collection('pending_sessions').doc(id).remove().catch(() => {});
    return { ok: true, removed: true };
  }

  return { ok: false, error: 'bad_action' };
};
