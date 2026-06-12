/**
 * room_write — 房主推送最新房间快照。
 * 安全模型：仅 ownerOpenid 可写（where 条件含 ownerOpenid）；
 * version CAS（where version=baseVersion + inc(1)）防并发覆盖 —— stats.updated===0 即冲突。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAX_SNAPSHOT_BYTES = 200 * 1024;

function isStructurallyValidSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES) return false;
  if (!Array.isArray(snapshot.history)) return false;
  if (!snapshot.teamLevels || typeof snapshot.teamLevels !== 'object') return false;
  if (!['4', '6', '8'].includes(String(snapshot.mode))) return false;
  return true;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, error: 'no_openid' };
  }
  const code = String((event && event.code) || '').trim().toUpperCase();
  const baseVersion = event && event.baseVersion;
  const snapshot = event && event.snapshot;
  const finished = Boolean(event && event.finished);

  if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) {
    return { ok: false, error: 'invalid_code' };
  }
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 1) {
    return { ok: false, error: 'invalid_version' };
  }
  if (!isStructurallyValidSnapshot(snapshot)) {
    return { ok: false, error: 'invalid_snapshot' };
  }

  const db = cloud.database();
  const _ = db.command;

  try {
    const res = await db.collection('rooms')
      .where({ _id: code, ownerOpenid: OPENID, version: baseVersion })
      .update({
        data: {
          // _.set：整对象替换。普通嵌套对象是合并语义，快照删字段时围观端会读到僵尸数据
          snapshot: _.set(snapshot),
          mode: String(snapshot.mode),
          version: _.inc(1),
          updatedAt: db.serverDate(),
          finishedAt: finished ? db.serverDate() : null
        }
      });

    if (res.stats.updated === 1) {
      return { ok: true, version: baseVersion + 1 };
    }

    // 没更到：分辨 不存在 / 不是房主 / 版本冲突，给客户端可操作的错误
    const doc = await db.collection('rooms').doc(code).get().catch(() => null);
    if (!doc || !doc.data) return { ok: false, error: 'room_not_found' };
    if (doc.data.ownerOpenid !== OPENID) return { ok: false, error: 'not_owner' };
    return { ok: false, error: 'version_conflict', currentVersion: doc.data.version };
  } catch (err) {
    console.error('room_write failed:', err);
    return { ok: false, error: 'db_error', detail: String((err && err.errMsg) || err) };
  }
};
