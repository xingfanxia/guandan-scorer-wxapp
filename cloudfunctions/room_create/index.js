/**
 * room_create — 建房：生成 6 位房间码（3字母+3数字交替，防碰撞重试）、初始化单文档。
 * 身份：getWXContext().OPENID 即房主，免 AppSecret。
 * 校验边界（设计决策，见 docs/PLAN.md）：云函数做结构/权限/大小检查；
 * 完整游戏语义校验在客户端 store 层 —— 唯一写入方是房主本人，朋友局威胁模型下足够。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去 I/O 防混淆
const DIGITS = '23456789'; // 去 0/1 防混淆
const MAX_ATTEMPTS = 5;
const MAX_SNAPSHOT_BYTES = 200 * 1024;

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const pool = i % 2 === 0 ? LETTERS : DIGITS;
    code += pool[Math.floor(Math.random() * pool.length)];
  }
  return code;
}

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
  const snapshot = event && event.snapshot;
  if (!isStructurallyValidSnapshot(snapshot)) {
    return { ok: false, error: 'invalid_snapshot' };
  }

  const db = cloud.database();

  // 集合不存在时建一个（幂等；权限规则仍需控制台设「所有用户可读，仅创建者可写」）
  try {
    await db.createCollection('rooms');
  } catch (err) {
    // 已存在 → 正常路径
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    try {
      await db.collection('rooms').add({
        data: {
          _id: code,
          ownerOpenid: OPENID,
          mode: String(snapshot.mode),
          snapshot,
          version: 1,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          finishedAt: null,
          votes: {}
        }
      });
      return { ok: true, code, version: 1 };
    } catch (err) {
      // _id 冲突（已存在）→ 重试下一个码；其他错误直接抛给客户端看见
      const msg = String((err && err.errMsg) || err);
      if (!/already exists|duplicate/i.test(msg)) {
        console.error('room_create add failed:', err);
        return { ok: false, error: 'db_error', detail: msg };
      }
    }
  }
  return { ok: false, error: 'code_collision', detail: `连续 ${MAX_ATTEMPTS} 次房间码碰撞` };
};
