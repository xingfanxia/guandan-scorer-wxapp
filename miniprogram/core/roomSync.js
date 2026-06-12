/**
 * roomSync — 云房间双通道同步（WXAPP-3）。
 *
 * 房主侧：createRoom + pushSnapshot（version CAS，冲突拉新版本重推；失败按 5s
 * 退避自动重试，连续 3 次才打扰用户）。
 * 围观侧：watchRoom = db.watch 实时通道 + 心跳轮询。轮询**永不停**：watch 健康时
 * 降频到 30s 兜底（防 watch 无 onError 静默死亡），watch 报错时升频到 5s 接管。
 *
 * 依赖 wx.cloud（app.onLaunch 已 init）。本文件可 Node 测试的纯函数只有
 * buildRoomSnapshot；其余依赖 wx 全局。
 */
import { ROOMS_COLLECTION } from './cloudConfig.js';

const POLL_FAST_MS = 5000;   // watch 不健康时
const POLL_SLOW_MS = 30000;  // watch 健康时的心跳兜底
const PUSH_DEBOUNCE_MS = 800;
const PUSH_RETRY_MS = 5000;
const PUSH_MAX_CONSECUTIVE_FAILURES = 3;

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

/**
 * 房主端房间会话：绑定 store 自动推送。
 * @param {Object} store - gameStore 实例
 * @param {Object} [opts]
 * @param {{code: string, version: number}|null} [opts.initial] - 持久化恢复的房间
 * @param {(session: {code: string|null, version: number}) => void} [opts.onSessionChange] - code/version 变化时回调（持久化挂点）
 */
export function createOwnerRoomSession(store, { initial, onSessionChange } = {}) {
  let code = (initial && initial.code) || null;
  let version = (initial && initial.version) || 0;
  let pushTimer = null;
  let pushing = false;
  let dirty = false;
  let consecutiveFailures = 0;

  function notifySession() {
    if (onSessionChange) onSessionChange({ code, version });
  }

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

  function onPushFailure(why) {
    consecutiveFailures += 1;
    console.error(`[roomSync] 推送失败（连续 ${consecutiveFailures} 次）:`, why);
    if (consecutiveFailures >= PUSH_MAX_CONSECUTIVE_FAILURES) {
      wx.showToast({ title: '房间同步持续失败，检查网络', icon: 'none' });
      consecutiveFailures = 0; // 重新计数，避免持续骚扰
    }
    schedulePush(PUSH_RETRY_MS); // 真实重试
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
        // 认领座位等服务端 version+1，或同房主多端并发：拉到当前版本重推
        version = result.currentVersion;
        result = await callRoomWrite(snapshot);
      }
      if (result.ok) {
        version = result.version;
        consecutiveFailures = 0;
        notifySession();
      } else if (result.error === 'room_not_found') {
        // 房间没了（被清理/环境重置）：放弃这个 code，下次「开围观」重建
        code = null;
        version = 0;
        notifySession();
        wx.showToast({ title: '房间已失效，重新开围观即可', icon: 'none' });
      } else {
        onPushFailure(`${result.error} ${result.detail || ''}`);
      }
    } catch (err) {
      onPushFailure(err);
    } finally {
      pushing = false;
      if (dirty) {
        dirty = false;
        schedulePush();
      }
    }
  }

  function schedulePush(delay = PUSH_DEBOUNCE_MS) {
    if (!code) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, delay);
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
      notifySession();
      return { ok: true, code };
    },

    /**
     * 与当前房间脱钩（开新一局时用）：旧房间留在云端封存，本会话不再推送；
     * 下一次开打/开围观会创建全新房间 —— 统计/投票/认领严格跟房间走。
     */
    detach() {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
      code = null;
      version = 0;
      notifySession();
    },

    destroy() {
      unsubscribe();
      if (pushTimer) clearTimeout(pushTimer);
      code = null;
    }
  };
}

/** 围观端：watch + 心跳轮询（永不全灭）。返回 {stop, refresh}。 */
export function watchRoom(code, { onSnapshot, onStatus }) {
  const db = wx.cloud.database();
  const normalized = String(code || '').trim().toUpperCase();
  let stopped = false;
  let watcher = null;
  let pollTimer = null;
  let pollInterval = POLL_FAST_MS;
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

  function setPolling(interval) {
    if (stopped) return;
    if (pollTimer && pollInterval === interval) return;
    pollInterval = interval;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollOnce, interval);
  }

  function startWatch() {
    if (stopped) return;
    try {
      watcher = db.collection(ROOMS_COLLECTION).where({ _id: normalized }).watch({
        onChange(snap) {
          if (snap.docs && snap.docs.length > 0) {
            setPolling(POLL_SLOW_MS); // watch 健康 → 轮询降频为心跳兜底
            emit(snap.docs[0], 'watch');
          }
          if (onStatus) onStatus({ channel: 'watch', error: false });
        },
        onError(err) {
          console.error('[roomSync] watch 断开，轮询升频接管:', err);
          watcher = null;
          if (onStatus) onStatus({ channel: 'watch', error: true });
          setPolling(POLL_FAST_MS);
          if (!rebuildTimer && !stopped) {
            rebuildTimer = setTimeout(() => {
              rebuildTimer = null;
              startWatch();
            }, POLL_FAST_MS * 3);
          }
        }
      });
    } catch (err) {
      console.error('[roomSync] watch 建立失败，纯轮询:', err);
      setPolling(POLL_FAST_MS);
    }
  }

  startWatch();
  setPolling(POLL_FAST_MS);
  pollOnce(); // 首屏立即拉一次

  return {
    /** 页面 onShow 等时机的主动重同步 */
    refresh: pollOnce,
    stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (rebuildTimer) clearTimeout(rebuildTimer);
      if (watcher) {
        watcher.close().catch(() => {});
        watcher = null;
      }
    }
  };
}
