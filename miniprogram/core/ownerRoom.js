/**
 * 房主房间会话单例：index 页建房/分享共用，绑定全局 store 自动推送。
 * code/version 持久化到 wx storage —— 小程序被系统回收重启后房间不失联。
 */
import { getStore } from './appStore.js';
import { createOwnerRoomSession } from './roomSync.js';
import { wxStorage } from './wxStorage.js';

const ROOM_KEY = 'gd_wxapp_room_v1';

let session = null;
let codeListeners = [];
let lastCode = null;

/**
 * 订阅房间码变化（建房 / detach / 后台 room_not_found 清空 都会触发，仅 code 真正变化时）。
 * 让页面展示的 roomCode 与会话真实 code 锁步 —— 否则房间被后台清空（room_not_found）时
 * 页面仍显示旧房号、分享卡片/「进房间」把围观者引到失效房间（2026-06-19 调查根因）。
 * 返回取消订阅函数。
 */
export function subscribeOwnerCode(cb) {
  codeListeners.push(cb);
  return () => { codeListeners = codeListeners.filter((f) => f !== cb); };
}

export function getOwnerSession() {
  if (!session) {
    const saved = wxStorage.get(ROOM_KEY);
    const initial = saved && typeof saved.code === 'string' && Number.isSafeInteger(saved.version)
      ? saved
      : null;
    lastCode = initial ? initial.code : null;
    session = createOwnerRoomSession(getStore(), {
      initial,
      onSessionChange: ({ code, version }) => {
        wxStorage.set(ROOM_KEY, code ? { code, version } : null);
        const c = code || '';
        if (c !== (lastCode || '')) {
          lastCode = code || null;
          for (const cb of codeListeners) cb(c);
        }
      }
    });
  }
  return session;
}
