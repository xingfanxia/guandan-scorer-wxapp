/**
 * room_get — 围观端只读房间（保证可用的读通道）。
 *
 * 为什么要这个函数：围观端原本只走客户端 db.watch/get，依赖控制台把 rooms 集合
 * 权限设成「所有用户可读」—— 这是个易丢/易被环境重置抹掉的人工步骤，丢了则**所有
 * 非房主都进不去房间**（实测事故）。本函数用云函数管理端权限直读，绕开客户端读权限，
 * 让围观在权限没设对时也能轮询拿到比分（watch 仍是设了权限后的实时快通道）。
 *
 * 下发前经 roomView.sanitizeRoomForViewer 脱敏：绝不下发 openid。
 * event: { code }
 */
const cloud = require('wx-server-sdk');
const { sanitizeRoomForViewer } = require('./roomView.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const code = String((event && event.code) || '').trim().toUpperCase();
  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) {
    return { ok: false, error: 'invalid_code' };
  }

  const db = cloud.database();
  try {
    const res = await db.collection('rooms').doc(code).get();
    if (!res || !res.data) return { ok: false, error: 'room_not_found' };
    return { ok: true, room: sanitizeRoomForViewer(res.data, OPENID) };
  } catch (err) {
    // doc 不存在时 SDK 抛错（而非返回空）→ 归一成 room_not_found
    const msg = String((err && err.errMsg) || err);
    if (/not exist|does not exist|cannot find|-502004/i.test(msg)) {
      return { ok: false, error: 'room_not_found' };
    }
    // detail 只进服务端日志，不下发客户端（客户端只判 r.ok）
    console.error('room_get failed:', msg);
    return { ok: false, error: 'db_error' };
  }
};
