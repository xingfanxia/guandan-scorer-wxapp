/**
 * roomSync — 云房间双通道同步（WXAPP-3）。
 *
 * 房主侧：createRoom + pushSnapshot（version CAS，冲突时拉新版本重试一次）。
 * 围观侧：watchRoom = db.watch 实时通道 + 轮询兜底（watch 官方无自动重连承诺，
 * onError 后兜底轮询接管并周期性尝试重建 watch）。
 *
 * 依赖 wx.cloud（app.onLaunch 已 init）。本文件不进 Node 测试（wx 全局），
 * 可测逻辑（节流/快照构造）拆为纯函数导出。
 */
import { ROOMS_COLLECTION } from './cloudConfig.js';

const POLL_INTERVAL_MS = 5000;
const PUSH_DEBOUNCE_MS = 800;

/** 从 store 状态构造房间快照（纯函数，Node 可测）：只放围观需要的字段 */
export function buildRoomSnapshot(state) {
  return {
    mode: state.mode,
    players: state.players,
    teamNames: state.teamNames,
    teamLevels: state.teamLevels,
    aFail: state.aFail,
    roundLevel: state.roundLevel,
    roundOwner: state.roundOwner,
    nextRoundBase: state.nextRoundBase,
    gameStatus: state.gameStatus,
    history: state.history,
    prefs: state.prefs
  };
}

/** 房主端房间会话：绑定 store，自动推送 */
export function createOwnerRoomSession(store) {
  let code = null;
  let version = 0;
  let pushTimer = null;
  let pushing = false;
  let dirty = false;

  async function callRoomWrite(snapshot) {
    const res = await wx.cloud.callFunction({
      name: 'room_write',
      data: {
        code,
        baseVersion: version,
        snapshot,
        finished: Boolean(snapshot.gameStatus && snapshot.gameStatus.ended)
      }
    });
    return res.result || { ok: false, error: 'empty_result' };
  }

  async function pushNow() {
    if (!code || pushing) {
      dirty = dirty || pushing;
      return;
    }
    pushing = true;
    try {
      const snapshot = buildRoomSnapshot(store.getState());
      let result = await callRoomWrite(snapshot);
      if (!result.ok && result.error === 'version_conflict' && Number.isSafeInteger(result.currentVersion)) {
        // 同房主多端并发的兜底：拉到当前版本重推一次
        version = result.currentVersion;
        result = await callRoomWrite(snapshot);
      }
      if (result.ok) {
        version = result.version;
      } else {
        console.error('[roomSync] 推送失败:', result.error, result.detail || '');
        wx.showToast({ title: '房间同步失败，重试中', icon: 'none' });
      }
    } catch (err) {
      console.error('[roomSync] 推送异常:', err);
    } finally {
      pushing = false;
      if (dirty) {
        dirty = false;
        schedulePush();
      }
    }
  }

  function schedulePush() {
    if (!code) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
  }

  const unsubscribe = store.subscribe(() => schedulePush());

  return {
    getCode: () => code,

    async create() {
      if (code) return { ok: true, code };
      const snapshot = buildRoomSnapshot(store.getState());
      const res = await wx.cloud.callFunction({ name: 'room_create', data: { snapshot } });
      const result = res.result || {};
      if (!result.ok) {
        console.error('[roomSync] 建房失败:', result.error, result.detail || '');
        return { ok: false, msg: '建房失败，稍后再试' };
      }
      code = result.code;
      version = result.version;
      return { ok: true, code };
    },

    destroy() {
      unsubscribe();
      if (pushTimer) clearTimeout(pushTimer);
      code = null;
    }
  };
}

/** 围观端：watch + 轮询兜底。返回 stop()。 */
export function watchRoom(code, { onSnapshot, onStatus }) {
  const db = wx.cloud.database();
  const normalized = String(code || '').trim().toUpperCase();
  let stopped = false;
  let watcher = null;
  let pollTimer = null;
  let lastVersion = 0;
  let rebuildTimer = null;

  function emit(doc, channel) {
    if (!doc || stopped) return;
    if (Number.isSafeInteger(doc.version) && doc.version <= lastVersion) return;
    lastVersion = doc.version || lastVersion;
    onSnapshot(doc, channel);
  }

  async function pollOnce() {
    try {
      const res = await db.collection(ROOMS_COLLECTION).doc(normalized).get();
      emit(res.data, 'poll');
    } catch (err) {
      console.error('[roomSync] 轮询失败:', err);
      if (onStatus) onStatus({ channel: 'poll', error: true });
    }
  }

  function startPolling() {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
    pollOnce();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startWatch() {
    if (stopped) return;
    try {
      watcher = db.collection(ROOMS_COLLECTION).where({ _id: normalized }).watch({
        onChange(snap) {
          if (snap.docs && snap.docs.length > 0) {
            stopPolling(); // 实时通道活着，省下轮询调用量
            emit(snap.docs[0], 'watch');
          }
          if (onStatus) onStatus({ channel: 'watch', error: false });
        },
        onError(err) {
          console.error('[roomSync] watch 断开，轮询接管:', err);
          watcher = null;
          if (onStatus) onStatus({ channel: 'watch', error: true });
          startPolling();
          // 周期性尝试重建实时通道
          if (!rebuildTimer && !stopped) {
            rebuildTimer = setTimeout(() => {
              rebuildTimer = null;
              startWatch();
            }, POLL_INTERVAL_MS * 3);
          }
        }
      });
    } catch (err) {
      console.error('[roomSync] watch 建立失败，纯轮询:', err);
      startPolling();
    }
  }

  startWatch();
  startPolling(); // 首屏先拉一次，watch 接管后自动停

  return {
    stop() {
      stopped = true;
      stopPolling();
      if (rebuildTimer) clearTimeout(rebuildTimer);
      if (watcher) {
        watcher.close().catch(() => {});
        watcher = null;
      }
    }
  };
}
