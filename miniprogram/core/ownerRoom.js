/**
 * 房主房间会话单例：index 页建房/分享共用，绑定全局 store 自动推送。
 * code/version 持久化到 wx storage —— 小程序被系统回收重启后房间不失联。
 */
import { getStore } from './appStore.js';
import { createOwnerRoomSession } from './roomSync.js';
import { wxStorage } from './wxStorage.js';

const ROOM_KEY = 'gd_wxapp_room_v1';

let session = null;

export function getOwnerSession() {
  if (!session) {
    const saved = wxStorage.get(ROOM_KEY);
    const initial = saved && typeof saved.code === 'string' && Number.isSafeInteger(saved.version)
      ? saved
      : null;
    session = createOwnerRoomSession(getStore(), {
      initial,
      onSessionChange: ({ code, version }) => {
        wxStorage.set(ROOM_KEY, code ? { code, version } : null);
      }
    });
  }
  return session;
}
