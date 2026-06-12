/** 房主房间会话单例：index 页建房/分享共用，绑定全局 store 自动推送。 */
import { getStore } from './appStore.js';
import { createOwnerRoomSession } from './roomSync.js';

let session = null;

export function getOwnerSession() {
  if (!session) {
    session = createOwnerRoomSession(getStore());
  }
  return session;
}
