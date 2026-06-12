/**
 * GameStore — 单机计分编排层（WXAPP-2）。
 *
 * 语义对齐 web 版 src/game/rules.js（applyGameResult/advanceToNextRound）与
 * src/game/history.js（rollback/reset）：守卫链、回滚快照字段、history entry
 * schema 完全一致（用 vendor 的 roomSnapshotValidation 做契约校验），这样
 * WXAPP-3 云房间直接复用同一份 snapshot 结构。
 *
 * 与 web 版的差异（刻意为之）：
 * - 无 state/config/events 单例 —— 纯工厂函数，storage 与时钟注入（可测）。
 * - 不做 confirm/alert —— 确认交互归 UI 层。
 * - playerStats 同步是 WXAPP-4 范围，回滚快照暂不含 prevPlayerStats
 *   （web 的 buildRollbackSnapshot 对 undefined 容忍，schema 兼容）。
 */
import { parseRanks, calculateUpgrade, nextLevel } from '../shared-logic/calculator.js';
import { checkALevelRules, DEFAULT_TEAM_NAMES } from '../shared-logic/aLevelLogic.js';
import { openGameStatus, resolveGameStatus } from '../shared-logic/gameStatus.js';
import { DEFAULT_RULES } from '../shared-logic/ruleConfig.js';
import { normalizePlayerCountMode } from '../shared-logic/playerCountMode.js';
import { isValidRoomSnapshotPayload } from '../shared-logic/roomSnapshotValidation.js';

export const STORAGE_KEY = 'gd_wxapp_game_v1';

const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALID_TEAM_KEYS = new Set(['t1', 't2']);
const PREF_KEYS = new Set(['strictA', 'must1', 'autoNext']);

const clone = (v) => JSON.parse(JSON.stringify(v));
const isValidLevel = (lvl) => LEVELS.includes(String(lvl));

/** history entry 的 ts 是 zh-CN 格式化字符串 —— 与 web 版 src/core/utils.js#now() 同款，校验器强制 string */
function formatTs(ms) {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function isValidWinnerRanks(ranks, mode) {
  if (!Array.isArray(ranks)) return false;
  if (ranks.length !== mode / 2) return false;
  const seen = new Set();
  for (const rank of ranks) {
    if (!Number.isSafeInteger(rank) || rank < 1 || rank > mode) return false;
    if (seen.has(rank)) return false;
    seen.add(rank);
  }
  return true;
}

function defaultState(now) {
  return {
    mode: '4',
    players: [],
    playerSeq: 0,
    teamNames: { ...DEFAULT_TEAM_NAMES },
    teamLevels: { t1: '2', t2: '2' },
    aFail: { t1: 0, t2: 0 },
    roundLevel: '2',
    roundOwner: null,
    nextRoundBase: null,
    winner: 't1',
    gameStatus: openGameStatus(),
    history: [],
    prefs: { strictA: true, must1: true, autoNext: true },
    sessionStartTime: now()
  };
}

/** 宽容 hydrate：核心字段任何一处不合法就整体回退默认（损坏的本地缓存不值得抢救） */
function hydrate(raw, now) {
  const base = defaultState(now);
  if (!raw || typeof raw !== 'object') return base;
  const ok =
    normalizePlayerCountMode(raw.mode) &&
    raw.teamLevels && isValidLevel(raw.teamLevels.t1) && isValidLevel(raw.teamLevels.t2) &&
    isValidLevel(raw.roundLevel) &&
    Array.isArray(raw.players) &&
    Array.isArray(raw.history) &&
    raw.prefs && typeof raw.prefs === 'object';
  if (!ok) return base;
  return { ...base, ...clone(raw) };
}

/**
 * @param {Object} [opts]
 * @param {{get(k:string):any, set(k:string, v:any):void}} [opts.storage] - wx storage 适配器；缺省为内存空实现
 * @param {() => number} [opts.now] - 时钟注入（测试用固定时钟）
 * @param {(state: Object) => void} [opts.onChange] - 每次状态落盘后回调（房间同步推送的挂点）
 */
export function createGameStore({ storage, now, onChange } = {}) {
  const clock = now || (() => Date.now());
  const store = storage || { get: () => null, set: () => {} };
  const listeners = onChange ? [onChange] : [];

  let state = hydrate(store.get(STORAGE_KEY), clock);

  function persist() {
    const snapshot = clone(state);
    store.set(STORAGE_KEY, snapshot);
    for (const fn of listeners) {
      try {
        fn(snapshot);
      } catch (err) {
        console.error('[gameStore] onChange listener failed:', err);
      }
    }
  }

  function modeCount() {
    return normalizePlayerCountMode(state.mode) || 4;
  }

  function currentEnded() {
    return resolveGameStatus(state.gameStatus, state.history).ended;
  }

  /** 本场已开打（有历史）→ 名单/分队/人数冻结，换 = 开新一局（重置） */
  function sessionLocked() {
    return state.history.length > 0;
  }
  const LOCKED_MSG = '本场已开打 —— 改人数/名单/分队要先开新一局（重置）';

  /** 当前局面跑一次纯 A 级规则（零副作用，preview 与 apply 共用） */
  function runALevelRules(winnerKey, ranks, mode) {
    return checkALevelRules({
      winnerKey,
      ranks,
      mode,
      teamLevels: { ...state.teamLevels },
      roundOwner: state.roundOwner,
      roundLevel: state.roundLevel,
      strictA: state.prefs.strictA,
      aFailCounts: { ...state.aFail },
      teamNames: { ...state.teamNames }
    });
  }

  return {
    getState: () => clone(state),

    /** 订阅状态变更（返回退订函数）。房间推送、页面联动用。 */
    subscribe(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    /** 测试/迁移专用：直接覆盖部分状态。页面代码禁止调用。 */
    __seed(partial) {
      Object.assign(state, clone(partial));
      persist();
    },

    setMode(mode) {
      const normalized = normalizePlayerCountMode(mode);
      if (!normalized) return { ok: false, msg: '模式只能是 4/6/8 人' };
      if (sessionLocked() && String(normalized) !== state.mode) {
        return { ok: false, msg: LOCKED_MSG };
      }
      if (state.players.length > normalized) {
        return { ok: false, msg: `当前已有 ${state.players.length} 名玩家，先移除再切到 ${normalized} 人局` };
      }
      state.mode = String(normalized);
      persist();
      return { ok: true };
    },

    setPreference(key, value) {
      if (!PREF_KEYS.has(key)) return { ok: false, msg: `未知设置项 ${key}` };
      state.prefs[key] = Boolean(value);
      persist();
      return { ok: true };
    },

    setTeamName(teamKey, name) {
      if (!VALID_TEAM_KEYS.has(teamKey)) return { ok: false, msg: '队伍只能是 t1/t2' };
      const trimmed = String(name || '').trim();
      if (!trimmed) return { ok: false, msg: '队名不能为空' };
      state.teamNames[teamKey] = trimmed;
      persist();
      return { ok: true };
    },

    addPlayer({ name, emoji, team, handle }) {
      if (sessionLocked()) return { ok: false, msg: LOCKED_MSG };
      const cap = modeCount();
      if (state.players.length >= cap) {
        return { ok: false, msg: `人满了：${cap} 人局最多 ${cap} 名玩家` };
      }
      const trimmed = String(name || '').trim();
      if (!trimmed) return { ok: false, msg: '玩家得有个名字' };
      if (team !== 1 && team !== 2) return { ok: false, msg: '先选好队伍' };
      // 单队上限 = mode/2，否则 3v1 这类配队能录满名次却永远无法开打
      const teamCap = cap / 2;
      if (state.players.filter(p => p.team === team).length >= teamCap) {
        return { ok: false, msg: `这队满了：每队最多 ${teamCap} 人` };
      }
      const normalizedHandle = typeof handle === 'string' && /^[a-z0-9_-]{2,32}$/.test(handle.toLowerCase())
        ? handle.toLowerCase()
        : null;
      if (normalizedHandle && state.players.some(p => p.handle === normalizedHandle)) {
        return { ok: false, msg: `@${normalizedHandle} 已经在场上了` };
      }
      const player = {
        id: ++state.playerSeq,
        name: trimmed,
        emoji: emoji || '🙂',
        team,
        // 玩家池身份（可选）：handle 已绑微信时，战绩入库自动归属（见 profile_sync）
        ...(normalizedHandle ? { handle: normalizedHandle } : {})
      };
      state.players.push(player);
      persist();
      return { ok: true, player: clone(player) };
    },

    updatePlayer(id, patch) {
      const player = state.players.find(p => p.id === id);
      if (!player) return { ok: false, msg: '玩家不存在' };
      if (patch.name !== undefined) {
        const trimmed = String(patch.name).trim();
        if (!trimmed) return { ok: false, msg: '玩家得有个名字' };
        player.name = trimmed;
      }
      if (patch.emoji !== undefined) player.emoji = patch.emoji;
      if (patch.team !== undefined) {
        if (patch.team !== 1 && patch.team !== 2) return { ok: false, msg: '队伍只能是 1/2' };
        if (patch.team !== player.team && sessionLocked()) {
          return { ok: false, msg: LOCKED_MSG };
        }
        if (patch.team !== player.team) {
          const teamCap = modeCount() / 2;
          if (state.players.filter(p => p.team === patch.team).length >= teamCap) {
            return { ok: false, msg: `那队满了：每队最多 ${teamCap} 人` };
          }
        }
        player.team = patch.team;
      }
      persist();
      return { ok: true };
    },

    /** 随机分队：现有玩家洗牌后前一半进蓝队、后一半进红队。rand 注入可测。 */
    shuffleTeams(rand = Math.random) {
      if (sessionLocked()) return { ok: false, msg: LOCKED_MSG };
      const n = state.players.length;
      if (n < 2) return { ok: false, msg: '至少要 2 名玩家才能分队' };
      if (n % 2 !== 0) return { ok: false, msg: '人数得是偶数才能均分两队' };
      const shuffled = [...state.players];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const half = n / 2;
      shuffled.forEach((p, idx) => {
        p.team = idx < half ? 1 : 2;
      });
      state.players = shuffled;
      persist();
      return { ok: true };
    },

    removePlayer(id) {
      if (sessionLocked()) return { ok: false, msg: LOCKED_MSG };
      const before = state.players.length;
      state.players = state.players.filter(p => p.id !== id);
      if (state.players.length === before) return { ok: false, msg: '玩家不存在' };
      persist();
      return { ok: true };
    },

    /**
     * 升级预览（录满名次后的确认条）：零副作用。
     * @returns {{ok:boolean, msg?:string, ranks?:number[], upgrade?:number, newLevel?:string, finalWin?:boolean, aNote?:string}}
     */
    previewResult(winnerKey, ranksText) {
      if (!VALID_TEAM_KEYS.has(winnerKey)) return { ok: false, msg: '队伍只能是 t1/t2' };
      const mode = modeCount();
      const parsed = parseRanks(ranksText, mode / 2);
      if (!parsed.ok) return parsed;

      const calc = calculateUpgrade(String(mode), parsed.ranks, DEFAULT_RULES, state.prefs.must1);
      let newLevel = nextLevel(state.teamLevels[winnerKey], calc.upgrade);
      const aResult = runALevelRules(winnerKey, parsed.ranks, String(mode));
      if (aResult.winnerNewLevel !== null && aResult.winnerNewLevel !== undefined) {
        newLevel = aResult.winnerNewLevel;
      }
      return {
        ok: true,
        ranks: parsed.ranks,
        upgrade: calc.upgrade,
        newLevel,
        finalWin: Boolean(aResult.finalWin),
        aNote: aResult.aNote || ''
      };
    },

    /**
     * 应用一局结果。语义 = web 版 applyGameResult。
     * @param {string} winnerKey - 't1' | 't2'
     * @param {number[]} ranks - 胜方名次（已排序或未排序均可，内部不再排序——调用方传 parseRanks 产物）
     * @param {Object} [playerRankings] - 名次→玩家明细（UI 层构造，进 history entry）
     */
    applyResult(winnerKey, ranks, playerRankings = {}) {
      if (!VALID_TEAM_KEYS.has(winnerKey)) {
        return { applied: false, reason: 'invalid_winner' };
      }
      const normalizedMode = normalizePlayerCountMode(state.mode);
      if (!normalizedMode) {
        return { applied: false, reason: 'invalid_mode' };
      }
      if (!isValidWinnerRanks(ranks, normalizedMode)) {
        return { applied: false, reason: 'invalid_ranks' };
      }
      if (currentEnded()) {
        return {
          applied: false,
          reason: 'game_already_ended',
          message: '比赛已通关。请先撤销通关局或重置整场比赛，再应用新的结果。'
        };
      }
      if (state.nextRoundBase) {
        return {
          applied: false,
          reason: 'pending_next_round',
          message: `请先进入下一局（${state.nextRoundBase}），再应用新的结果。`
        };
      }

      const calc = calculateUpgrade(String(normalizedMode), ranks, DEFAULT_RULES, state.prefs.must1);
      if (calc.details?.error) {
        return { applied: false, reason: calc.details.error };
      }

      const autoNext = state.prefs.autoNext;
      const loserKey = winnerKey === 't1' ? 't2' : 't1';
      const thisRound = state.roundLevel;
      const previousAppliedWinner = [...state.history]
        .reverse()
        .find(entry => entry?.winKey === 't1' || entry?.winKey === 't2')
        ?.winKey || 't1';

      // 回滚快照 —— 字段名与 web 版完全一致
      const snapshot = {
        prevT1Lvl: state.teamLevels.t1,
        prevT1A: state.aFail.t1,
        prevT2Lvl: state.teamLevels.t2,
        prevT2A: state.aFail.t2,
        prevRound: thisRound,
        prevRoundOwner: state.roundOwner,
        prevNextRoundBase: state.nextRoundBase,
        prevWinner: previousAppliedWinner,
        prevGameStatus: clone(state.gameStatus)
      };

      let winnerNewLevel = nextLevel(state.teamLevels[winnerKey], calc.upgrade);
      let loserNewLevel = state.teamLevels[loserKey];

      const aLevelResult = runALevelRules(winnerKey, ranks, String(normalizedMode));
      if (aLevelResult.winnerNewLevel !== null && aLevelResult.winnerNewLevel !== undefined) {
        winnerNewLevel = aLevelResult.winnerNewLevel;
      }
      if (aLevelResult.loserNewLevel !== null && aLevelResult.loserNewLevel !== undefined) {
        loserNewLevel = aLevelResult.loserNewLevel;
      }

      // A 级覆盖之后再取下局基准，降级路径才能推进到正确等级（web 版同注释）
      const nextBaseByRule = winnerNewLevel;

      const winnerName = state.teamNames[winnerKey];
      const gameStatus = aLevelResult.finalWin
        ? { ended: true, winnerKey, winnerName, reason: 'A_LEVEL_CLEARED' }
        : openGameStatus();

      const finalLevels = { ...state.teamLevels };
      finalLevels[winnerKey] = winnerNewLevel;
      finalLevels[loserKey] = loserNewLevel;

      const ts = clock();
      const historyEntry = {
        ts: formatTs(ts),
        mode: String(normalizedMode),
        combo: '(' + ranks.join(',') + ')',
        ranks: [...ranks],
        up: calc.upgrade,
        win: winnerName,
        winKey: winnerKey,
        t1: finalLevels.t1,
        t2: finalLevels.t2,
        round: thisRound,
        aNote: aLevelResult.aNote,
        gameStatus,
        sessionDuration: Math.max(0, ts - state.sessionStartTime),
        gameEndedAt: aLevelResult.finalWin ? new Date(ts).toISOString() : null,
        ...snapshot,
        playerRankings: playerRankings || {}
      };

      if (!isValidRoomSnapshotPayload({ state: { history: [...state.history, historyEntry] } })) {
        return { applied: false, reason: 'invalid_history_entry' };
      }

      if (aLevelResult.aFailUpdates && typeof aLevelResult.aFailUpdates === 'object') {
        for (const [teamKey, count] of Object.entries(aLevelResult.aFailUpdates)) {
          state.aFail[teamKey] = count;
        }
      }

      state.winner = winnerKey;
      state.teamLevels = finalLevels;

      if (autoNext || aLevelResult.finalWin) {
        state.roundLevel = String(nextBaseByRule);
        state.roundOwner = winnerKey;
        state.nextRoundBase = null;
      } else {
        state.roundLevel = String(thisRound);
        state.nextRoundBase = String(nextBaseByRule);
      }

      state.gameStatus = gameStatus;
      state.history.push(historyEntry);
      persist();

      return {
        applied: true,
        finalWin: aLevelResult.finalWin,
        historyEntry: clone(historyEntry),
        message: aLevelResult.finalWin
          ? `🎉 ${winnerName} A级通关！`
          : (autoNext
            ? `已记一局，打${nextBaseByRule}。`
            : `已记一局。下局级牌：${nextBaseByRule}。`)
      };
    },

    /** 手动模式进入下一局。语义 = web 版 advanceToNextRound。 */
    advanceToNextRound() {
      if (!state.nextRoundBase) {
        return { advanced: false, message: '没有待进入的下一局（或已自动进入）。' };
      }
      if (currentEnded()) {
        return {
          advanced: false,
          reason: 'game_already_ended',
          message: '比赛已通关。请先撤销通关局或重置整场比赛，再进入下一局。'
        };
      }
      const lastWinner = state.history.length > 0
        ? state.history[state.history.length - 1].winKey
        : null;

      state.roundLevel = state.nextRoundBase;
      if (lastWinner) state.roundOwner = lastWinner;
      state.nextRoundBase = null;
      persist();
      return { advanced: true, message: '已进入下一局' };
    },

    /** 回滚到第 index 局之前（删除该局及之后全部记录）。确认交互归 UI 层。 */
    rollbackTo(index) {
      const history = state.history;
      if (index < 0 || index >= history.length) {
        return { success: false, reason: 'invalid_index' };
      }
      const entry = history[index];
      if (
        !entry ||
        !isValidLevel(entry.prevT1Lvl) ||
        !isValidLevel(entry.prevT2Lvl) ||
        !isValidLevel(entry.prevRound)
      ) {
        return { success: false, reason: 'missing_snapshot' };
      }
      const prevNextRoundBase = entry.prevNextRoundBase ?? null;
      if (prevNextRoundBase !== null && !isValidLevel(prevNextRoundBase)) {
        return { success: false, reason: 'missing_snapshot' };
      }

      let prevRoundOwner;
      if (entry.prevRoundOwner !== undefined) {
        prevRoundOwner = VALID_TEAM_KEYS.has(entry.prevRoundOwner) ? entry.prevRoundOwner : null;
      } else if (index > 0) {
        const previousWinner = history[index - 1]?.winKey;
        prevRoundOwner = VALID_TEAM_KEYS.has(previousWinner) ? previousWinner : null;
      } else {
        prevRoundOwner = null;
      }

      const priorHistoryWinner = index > 0 ? history[index - 1]?.winKey : null;
      const prevWinner = (VALID_TEAM_KEYS.has(entry.prevWinner) && entry.prevWinner) ||
        (VALID_TEAM_KEYS.has(priorHistoryWinner) ? priorHistoryWinner : 't1');

      state.teamLevels = { t1: String(entry.prevT1Lvl), t2: String(entry.prevT2Lvl) };
      state.aFail = {
        t1: Number.isSafeInteger(entry.prevT1A) ? entry.prevT1A : 0,
        t2: Number.isSafeInteger(entry.prevT2A) ? entry.prevT2A : 0
      };
      state.roundLevel = String(entry.prevRound);
      state.roundOwner = prevRoundOwner;
      state.nextRoundBase = prevNextRoundBase === null ? null : String(prevNextRoundBase);
      state.winner = prevWinner;
      state.gameStatus = entry.prevGameStatus
        ? clone(entry.prevGameStatus)
        : openGameStatus();
      state.history = history.slice(0, index);
      persist();
      return { success: true, message: '已回滚。' };
    },

    undoLast() {
      if (state.history.length === 0) {
        return { success: false, reason: 'empty_history' };
      }
      return this.rollbackTo(state.history.length - 1);
    },

    /** 重置整场比赛。确认交互归 UI 层。 */
    resetGame(preservePlayers = true) {
      const players = preservePlayers ? state.players : [];
      const playerSeq = preservePlayers ? state.playerSeq : 0;
      const { mode, teamNames, prefs } = state;
      state = defaultState(clock);
      state.mode = mode;
      state.teamNames = teamNames;
      state.prefs = prefs;
      state.players = players;
      state.playerSeq = playerSeq;
      persist();
      return {
        success: true,
        message: preservePlayers ? '已重置比赛（保留玩家）' : '已重置整场比赛'
      };
    }
  };
}
