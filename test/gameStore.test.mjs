import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameStore, STORAGE_KEY } from '../miniprogram/core/gameStore.js';
import { isValidRoomSnapshotPayload } from '../miniprogram/shared-logic/roomSnapshotValidation.js';

/** 内存版 storage 适配器（镜像 wx.{get,set}StorageSync 的注入面） */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => map.set(k, v),
    dump: () => Object.fromEntries(map)
  };
}

/** 固定时钟：每次调用 +1000ms，起点 2026-06-12T00:00:00Z */
function fakeNow(start = 1781136000000) {
  let t = start;
  return () => (t += 1000);
}

function freshStore(overrides = {}) {
  return createGameStore({ storage: fakeStorage(), now: fakeNow(), ...overrides });
}

/** 建一个 4 人局并配满玩家 */
function fourPlayerStore(extra = {}) {
  const store = freshStore(extra);
  store.setMode('4');
  store.addPlayer({ name: '老王', emoji: '🐶', team: 1 });
  store.addPlayer({ name: '老李', emoji: '🐱', team: 1 });
  store.addPlayer({ name: '老张', emoji: '🐭', team: 2 });
  store.addPlayer({ name: '老赵', emoji: '🐰', team: 2 });
  return store;
}

describe('gameStore — 初始化与持久化', () => {
  it('默认状态：双队打2、无回合主、历史为空、strict/must1/autoNext 默认开', () => {
    const s = freshStore().getState();
    assert.deepEqual(s.teamLevels, { t1: '2', t2: '2' });
    assert.equal(s.roundLevel, '2');
    assert.equal(s.roundOwner, null);
    assert.equal(s.nextRoundBase, null);
    assert.deepEqual(s.aFail, { t1: 0, t2: 0 });
    assert.deepEqual(s.history, []);
    assert.equal(s.gameStatus.ended, false);
    assert.deepEqual(s.prefs, { strictA: true, must1: true, autoNext: true });
  });

  it('每次变更都写入 storage；同一 storage 新建 store 可还原一致状态', () => {
    const storage = fakeStorage();
    const a = createGameStore({ storage, now: fakeNow() });
    a.setMode('6');
    a.addPlayer({ name: '甲', emoji: '🐶', team: 1 });
    a.setPreference('strictA', false);

    const b = createGameStore({ storage, now: fakeNow() });
    assert.deepEqual(b.getState(), a.getState());
  });

  it('storage 里是损坏数据时回退默认状态而不抛', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: { mode: '99', teamLevels: '坏的' } });
    const s = createGameStore({ storage, now: fakeNow() }).getState();
    assert.equal(s.roundLevel, '2');
    assert.deepEqual(s.teamLevels, { t1: '2', t2: '2' });
  });

  it('getState 返回副本：外部改不动内部状态', () => {
    const store = freshStore();
    const s = store.getState();
    s.teamLevels.t1 = 'A';
    assert.equal(store.getState().teamLevels.t1, '2');
  });
});

describe('gameStore — 玩家管理', () => {
  it('addPlayer 分配自增 id；满员（mode 人数）后拒绝', () => {
    const store = fourPlayerStore();
    const res = store.addPlayer({ name: '多余', emoji: '🐸', team: 1 });
    assert.equal(res.ok, false);
    assert.match(res.msg, /满/);
    assert.equal(store.getState().players.length, 4);
  });

  it('removePlayer / updatePlayer 生效', () => {
    const store = fourPlayerStore();
    const first = store.getState().players[0];
    store.updatePlayer(first.id, { name: '王哥' });
    assert.equal(store.getState().players[0].name, '王哥');
    store.removePlayer(first.id);
    assert.equal(store.getState().players.length, 3);
    assert.ok(!store.getState().players.some(p => p.id === first.id));
  });
});

describe('gameStore — previewResult（升级预览，零副作用）', () => {
  it('4人局 "12" → 双上升3、打5；不改任何状态', () => {
    const store = fourPlayerStore();
    const before = store.getState();
    const p = store.previewResult('t1', '12');
    assert.equal(p.ok, true);
    assert.deepEqual(p.ranks, [1, 2]);
    assert.equal(p.upgrade, 3);
    assert.equal(p.newLevel, '5');
    assert.deepEqual(store.getState(), before);
  });

  it('非法输入透传 parseRanks 的错误', () => {
    const store = fourPlayerStore();
    const p = store.previewResult('t1', '11');
    assert.equal(p.ok, false);
    assert.match(p.msg, /重复/);
  });
});

describe('gameStore — applyResult（autoNext 默认流）', () => {
  it('开局 t1 双上：升到5、回合自动进入、roundOwner=t1、历史1条且通过 web 版 snapshot 校验', () => {
    const store = fourPlayerStore();
    const res = store.applyResult('t1', [1, 2]);
    assert.equal(res.applied, true);
    assert.equal(res.finalWin, false);

    const s = store.getState();
    assert.equal(s.teamLevels.t1, '5');
    assert.equal(s.teamLevels.t2, '2');
    assert.equal(s.roundLevel, '5');
    assert.equal(s.roundOwner, 't1');
    assert.equal(s.nextRoundBase, null);
    assert.equal(s.history.length, 1);

    const entry = s.history[0];
    assert.equal(entry.combo, '(1,2)');
    assert.equal(entry.up, 3);
    assert.equal(entry.winKey, 't1');
    assert.equal(entry.t1, '5');
    assert.equal(entry.round, '2');
    // 与 web 版同 schema：必须通过 vendor 的房间快照校验器
    assert.equal(isValidRoomSnapshotPayload({ state: { history: s.history } }), true);
  });

  it('非法 winnerKey / 非法 ranks 被拒且零副作用', () => {
    const store = fourPlayerStore();
    assert.equal(store.applyResult('t3', [1, 2]).applied, false);
    assert.equal(store.applyResult('t1', [1, 1]).applied, false);
    assert.equal(store.applyResult('t1', [1]).applied, false);
    assert.equal(store.getState().history.length, 0);
  });
});

describe('gameStore — 手动进局（autoNext=false）', () => {
  it('应用后挂起 nextRoundBase；再次应用被 pending 拦；advance 后回合推进、owner=上局赢家', () => {
    const store = fourPlayerStore();
    store.setPreference('autoNext', false);

    const res = store.applyResult('t2', [1, 2]);
    assert.equal(res.applied, true);
    let s = store.getState();
    assert.equal(s.teamLevels.t2, '5');
    assert.equal(s.roundLevel, '2'); // 本局不动
    assert.equal(s.nextRoundBase, '5');

    const blocked = store.applyResult('t2', [1, 2]);
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'pending_next_round');

    const adv = store.advanceToNextRound();
    assert.equal(adv.advanced, true);
    s = store.getState();
    assert.equal(s.roundLevel, '5');
    assert.equal(s.roundOwner, 't2');
    assert.equal(s.nextRoundBase, null);

    assert.equal(store.advanceToNextRound().advanced, false); // 没有挂起就拒绝
  });
});

describe('gameStore — A 级规则接入', () => {
  it('自己的A级、无末游双上 → 通关：gameStatus.ended、再应用被 game_already_ended 拦', () => {
    const store = fourPlayerStore({});
    store.__seed({ teamLevels: { t1: 'A', t2: 'K' }, roundLevel: 'A', roundOwner: 't1' });
    const res = store.applyResult('t1', [1, 2]);
    assert.equal(res.applied, true);
    assert.equal(res.finalWin, true);
    assert.match(res.message, /通关/);

    const s = store.getState();
    assert.equal(s.gameStatus.ended, true);
    assert.equal(s.gameStatus.winnerKey, 't1');
    assert.equal(s.gameStatus.reason, 'A_LEVEL_CLEARED');

    const blocked = store.applyResult('t1', [1, 2]);
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'game_already_ended');
  });

  it('strict 第3次A级失败 → 该队重置到2，回合推进到2（降级路径推进）', () => {
    const store = fourPlayerStore();
    store.__seed({
      teamLevels: { t1: 'A', t2: 'K' },
      roundLevel: 'A',
      roundOwner: 't1',
      aFail: { t1: 2, t2: 0 }
    });
    const res = store.applyResult('t1', [1, 4]); // 含末游(4人局末游=4)
    assert.equal(res.applied, true);
    assert.equal(res.finalWin, false);

    const s = store.getState();
    assert.equal(s.teamLevels.t1, '2');
    assert.equal(s.aFail.t1, 0);
    assert.equal(s.roundLevel, '2'); // nextBaseByRule 用 A 级覆盖后的等级
    assert.match(s.history[0].aNote, /重置到2/);
  });

  it('lenient 下含末游不计数', () => {
    const store = fourPlayerStore();
    store.setPreference('strictA', false);
    store.__seed({ teamLevels: { t1: 'A', t2: 'K' }, roundLevel: 'A', roundOwner: 't1' });
    store.applyResult('t1', [1, 4]);
    assert.deepEqual(store.getState().aFail, { t1: 0, t2: 0 });
  });
});

describe('gameStore — 撤销 / 回滚 / 重置', () => {
  it('undoLast 精确还原应用前状态（等级/aFail/回合/owner/nextRoundBase/gameStatus/历史）', () => {
    const store = fourPlayerStore();
    store.applyResult('t1', [1, 2]);
    const mid = store.getState();
    store.applyResult('t2', [1, 2]);

    const res = store.undoLast();
    assert.equal(res.success, true);
    const s = store.getState();
    assert.deepEqual(s.teamLevels, mid.teamLevels);
    assert.deepEqual(s.aFail, mid.aFail);
    assert.equal(s.roundLevel, mid.roundLevel);
    assert.equal(s.roundOwner, mid.roundOwner);
    assert.equal(s.nextRoundBase, mid.nextRoundBase);
    assert.deepEqual(s.gameStatus, mid.gameStatus);
    assert.equal(s.history.length, 1);
  });

  it('撤销通关局后比赛恢复可继续', () => {
    const store = fourPlayerStore();
    store.__seed({ teamLevels: { t1: 'A', t2: 'K' }, roundLevel: 'A', roundOwner: 't1' });
    store.applyResult('t1', [1, 2]);
    assert.equal(store.getState().gameStatus.ended, true);

    store.undoLast();
    assert.equal(store.getState().gameStatus.ended, false);
    assert.equal(store.applyResult('t1', [1, 2]).applied, true);
  });

  it('空历史 undo 拒绝；rollbackTo(0) 清空全部历史', () => {
    const store = fourPlayerStore();
    assert.equal(store.undoLast().success, false);

    store.applyResult('t1', [1, 2]);
    store.applyResult('t1', [1, 3]);
    store.applyResult('t2', [1, 2]);
    const res = store.rollbackTo(0);
    assert.equal(res.success, true);
    const s = store.getState();
    assert.equal(s.history.length, 0);
    assert.deepEqual(s.teamLevels, { t1: '2', t2: '2' });
    assert.equal(s.roundLevel, '2');
  });

  it('resetGame(preservePlayers=true) 清比分留玩家；false 连玩家一起清', () => {
    const store = fourPlayerStore();
    store.applyResult('t1', [1, 2]);
    store.resetGame(true);
    let s = store.getState();
    assert.equal(s.players.length, 4);
    assert.deepEqual(s.teamLevels, { t1: '2', t2: '2' });
    assert.equal(s.history.length, 0);
    assert.equal(s.gameStatus.ended, false);

    store.resetGame(false);
    s = store.getState();
    assert.equal(s.players.length, 0);
  });
});

describe('gameStore — 全程联调：4人局从打2到通关', () => {
  it('t1 连续双上 2→5→8→J→A，A 局无末游通关', () => {
    const store = fourPlayerStore();
    const expectedRounds = ['5', '8', 'J', 'A'];
    for (const lvl of expectedRounds) {
      const res = store.applyResult('t1', [1, 2]);
      assert.equal(res.applied, true);
      assert.equal(res.finalWin, false);
      assert.equal(store.getState().roundLevel, lvl);
      assert.equal(store.getState().roundOwner, 't1');
    }
    // 现在 t1 在 A、自己的 A 级回合
    const final = store.applyResult('t1', [1, 2]);
    assert.equal(final.finalWin, true);
    const s = store.getState();
    assert.equal(s.gameStatus.ended, true);
    assert.equal(s.history.length, 5);
    assert.equal(isValidRoomSnapshotPayload({ state: { history: s.history } }), true);
  });
});

describe('gameStore — 8人局（单设备即可完整运行，玩家=座位非账号）', () => {
  it('8 个座位由房主一台设备管理：sweep [1,2,3,4] 升 4 级，2→6', () => {
    const store = freshStore();
    store.setMode('8');
    const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
    names.forEach((n, i) => {
      const res = store.addPlayer({ name: n, emoji: '🙂', team: i < 4 ? 1 : 2 });
      assert.equal(res.ok, true, `第 ${i + 1} 个座位应能添加`);
    });
    assert.equal(store.getState().players.length, 8);

    // t1 四人包揽 1,2,3,4 = sweep → 升 4 级
    const res = store.applyResult('t1', [1, 2, 3, 4]);
    assert.equal(res.applied, true);
    const s = store.getState();
    assert.equal(s.teamLevels.t1, '6'); // 2 + 4
    assert.equal(s.roundLevel, '6');
    assert.equal(s.roundOwner, 't1');
  });

  it('8人局非 sweep 走 t8 阈值；末游=8 在 A 级判定生效', () => {
    const store = freshStore();
    store.setMode('8');
    for (let i = 0; i < 8; i++) store.addPlayer({ name: `P${i + 1}`, emoji: '🙂', team: i < 4 ? 1 : 2 });
    store.__seed({ teamLevels: { t1: 'A', t2: 'K' }, roundLevel: 'A', roundOwner: 't1' });

    // t1 拿 1,2,3,8 —— 含末游(8)，自己的A级 → 失败计 1 次
    const res = store.applyResult('t1', [1, 2, 3, 8]);
    assert.equal(res.applied, true);
    assert.equal(res.finalWin, false);
    assert.deepEqual(store.getState().aFail, { t1: 1, t2: 0 });
  });
});

describe('gameStore — 会话锁定（开打后名单/分队/人数冻结，换人数=开新一局）', () => {
  it('开打后 setMode 拒绝并提示开新一局', () => {
    const store = fourPlayerStore();
    store.applyResult('t1', [1, 2]);
    const res = store.setMode('8');
    assert.equal(res.ok, false);
    assert.match(res.msg, /新一局|重置/);
    assert.equal(store.getState().mode, '4');
  });

  it('开打后 加人/删人/换队/随机分队 全部拒绝；改名/换表情仍允许', () => {
    const store = fourPlayerStore();
    store.applyResult('t1', [1, 2]);
    const pid = store.getState().players[0].id;

    assert.equal(store.addPlayer({ name: '新', emoji: '🙂', team: 1 }).ok, false);
    assert.equal(store.removePlayer(pid).ok, false);
    assert.equal(store.updatePlayer(pid, { team: 2 }).ok, false);
    assert.equal(store.shuffleTeams(() => 0.5).ok, false);
    assert.equal(store.updatePlayer(pid, { name: '王哥' }).ok, true);
    assert.equal(store.getState().players[0].name, '王哥');
  });

  it('重置后解锁：可换模式、改名单', () => {
    const store = fourPlayerStore();
    store.applyResult('t1', [1, 2]);
    store.resetGame(true);
    assert.equal(store.setMode('8').ok, true);
    assert.equal(store.addPlayer({ name: '五', emoji: '🙂', team: 1 }).ok, true);
  });
});
