/**
 * roomView — 围观端只读视图的纯派生（room_get 云函数用）。
 *
 * 为什么存在：围观端读房间不再依赖客户端 db 读权限（控制台「所有用户可读」是
 * 易丢的人工步骤）。room_get 用云函数管理端权限直读房间 doc，再经本函数脱敏下发：
 *   - 绝不下发 openid（对位 profileExtras 的「不下发 openid」合规线）；
 *   - ownerOpenid → isOwner 布尔（调用者是否房主，服务端判）；
 *   - claims.<seatId>.openid → mine 布尔（这个座位是否调用者认领的）。
 *
 * 纯函数、零宿主依赖 → Node 可直接 require 测试（test/roomView.test.mjs）。
 */

/**
 * @param {Object|null} doc - rooms 集合原始文档（含 ownerOpenid / claims.<id>.openid）
 * @param {string} viewerOpenid - 调用者 openid（getWXContext().OPENID）
 * @returns {Object|null} 脱敏后的围观视图，doc 为空时返回 null
 */
function sanitizeRoomForViewer(doc, viewerOpenid) {
  if (!doc) return null;

  // 透传围观需要的字段，显式剥掉含身份/无用的字段
  const { ownerOpenid, claims, votes, _openid, ...rest } = doc;

  const me = String(viewerOpenid || '');
  const safeClaims = {};
  for (const [seatId, c] of Object.entries(claims || {})) {
    if (!c) continue;
    safeClaims[seatId] = {
      nickname: String(c.nickname || ''),
      mine: Boolean(me && c.openid === me)
    };
  }

  return {
    ...rest, // _id, mode, snapshot, version, voteEpoch, createdAt, updatedAt, finishedAt
    claims: safeClaims,
    isOwner: Boolean(me && ownerOpenid === me)
  };
}

module.exports = { sanitizeRoomForViewer };
