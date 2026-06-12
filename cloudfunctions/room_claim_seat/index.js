/**
 * room_claim_seat — 座位认领：玩家用微信身份绑定房间内座位（playerId）。
 * 原子性：where 条件带 `claims.<playerId>` 不存在 → 先到先得；
 * 一个 openid 同房间只允许认领一个座位（换座先 release）。
 * event: { code, playerId, action: 'claim' | 'release', profile?: {nickname, avatarUrl} }
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const code = String((event && event.code) || '').trim().toUpperCase();
  const playerId = Number(event && event.playerId);
  const action = (event && event.action) || 'claim';
  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) return { ok: false, error: 'invalid_code' };
  if (!Number.isSafeInteger(playerId) || playerId < 1) return { ok: false, error: 'invalid_player' };

  const db = cloud.database();
  const _ = db.command;
  const field = `claims.${playerId}`;

  const room = await db.collection('rooms').doc(code).get().catch(() => null);
  if (!room || !room.data) return { ok: false, error: 'room_not_found' };
  const claims = room.data.claims || {};

  // 座位必须是快照里的真实玩家 —— 防孤儿 claim 把用户锁死在不存在的座位上
  const players = (room.data.snapshot && room.data.snapshot.players) || [];
  if (!players.some(p => p && p.id === playerId)) {
    return { ok: false, error: 'seat_not_found', message: '这个座位不存在（房主可能改过玩家名单）' };
  }

  if (action === 'release') {
    const mine = claims[String(playerId)];
    if (!mine || mine.openid !== OPENID) return { ok: false, error: 'not_your_seat' };
    // version+1：让围观端的 watch/轮询版本去重通道放行这次 claims 变更
    await db.collection('rooms').doc(code).update({
      data: { [field]: _.remove(), version: _.inc(1), updatedAt: db.serverDate() }
    });
    return { ok: true };
  }

  // claim：同 openid 不许霸多个座位（读-判-写的小竞态对朋友局可接受）
  for (const [pid, claim] of Object.entries(claims)) {
    if (claim && claim.openid === OPENID && Number(pid) !== playerId) {
      return { ok: false, error: 'already_claimed_other', seat: Number(pid), message: '你已认领其他座位，先释放再换座' };
    }
  }

  const profile = (event && event.profile) || {};
  const nickname = String(profile.nickname || '').slice(0, 32);
  const avatarUrl = String(profile.avatarUrl || '').slice(0, 512);

  try {
    const res = await db.collection('rooms')
      .where({ _id: code, [field]: _.exists(false) })
      .update({
        data: {
          [field]: {
            openid: OPENID,
            nickname,
            avatarUrl,
            claimedAt: db.serverDate()
          },
          version: _.inc(1), // 围观端版本去重通道放行
          updatedAt: db.serverDate()
        }
      });
    if (res.stats.updated === 1) return { ok: true };

    const fresh = await db.collection('rooms').doc(code).get().catch(() => null);
    const taken = fresh && fresh.data && fresh.data.claims && fresh.data.claims[String(playerId)];
    if (taken && taken.openid === OPENID) return { ok: true }; // 自己重复点 = 幂等成功
    return { ok: false, error: 'seat_taken', message: '这个座位刚被别人认领了' };
  } catch (err) {
    console.error('room_claim_seat failed:', err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }
};
