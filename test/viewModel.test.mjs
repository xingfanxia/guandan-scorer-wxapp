import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardVM, buildHistoryRows } from '../miniprogram/core/viewModel.js';
import { buildRoomSnapshot } from '../miniprogram/core/roomSync.js';

const baseState = {
  mode: '4',
  players: [{ id: 1, name: '老王', emoji: '🐶', team: 1 }],
  teamNames: { t1: '蓝队', t2: '红队' },
  teamLevels: { t1: '5', t2: '2' },
  aFail: { t1: 0, t2: 0 },
  roundLevel: '5',
  roundOwner: 't1',
  nextRoundBase: null,
  winner: 't1',
  gameStatus: { ended: false, winnerKey: null, winnerName: null, reason: null },
  history: [],
  prefs: { strictA: true, must1: true, autoNext: true },
  sessionStartTime: 0,
  playerSeq: 1
};

describe('viewModel.buildBoardVM — eyebrow 文案', () => {
  it('正常回合：本局打X · 队伍的级', () => {
    const vm = buildBoardVM(baseState);
    assert.equal(vm.eyebrow, '本局打5 · 蓝队的级');
    assert.equal(vm.ended, false);
    assert.equal(vm.strictA, true);
  });

  it('新开局（无 roundOwner）', () => {
    const vm = buildBoardVM({ ...baseState, roundOwner: null, roundLevel: '2' });
    assert.equal(vm.eyebrow, '本局打2 · 新开局');
  });

  it('待进入下一局（手动模式挂起）', () => {
    const vm = buildBoardVM({ ...baseState, nextRoundBase: '8' });
    assert.equal(vm.eyebrow, '待进入下一局 · 打8');
  });

  it('已通关', () => {
    const vm = buildBoardVM({
      ...baseState,
      gameStatus: { ended: true, winnerKey: 't1', winnerName: '蓝队', reason: 'A_LEVEL_CLEARED' }
    });
    assert.equal(vm.ended, true);
    assert.equal(vm.eyebrow, '蓝队 已通关');
  });
});

describe('viewModel.buildHistoryRows', () => {
  const history = [
    { win: '蓝队', winKey: 't1', combo: '(1,2)', up: 3, t1: '5', t2: '2', aNote: '', ts: 'a' },
    { win: '红队', winKey: 't2', combo: '(1,3)', up: 2, t1: '5', t2: '4', aNote: '某注记', ts: 'b' }
  ];

  it('最新在前、newLevel 取胜方等级、isLatest 只标最新', () => {
    const rows = buildHistoryRows(history);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].seq, 2);
    assert.equal(rows[0].newLevel, '4'); // t2 胜 → 取 t2 等级
    assert.equal(rows[0].isLatest, true);
    assert.equal(rows[1].seq, 1);
    assert.equal(rows[1].newLevel, '5');
    assert.equal(rows[1].isLatest, false);
  });

  it('空历史返回空数组', () => {
    assert.deepEqual(buildHistoryRows([]), []);
  });
});

describe('roomSync.buildRoomSnapshot', () => {
  it('只带围观需要的字段，不带 playerSeq/sessionStartTime 等本机内部态', () => {
    const snap = buildRoomSnapshot(baseState);
    assert.deepEqual(Object.keys(snap).sort(), [
      'aFail', 'gameStatus', 'history', 'mode', 'nextRoundBase',
      'players', 'prefs', 'roundLevel', 'roundOwner', 'teamLevels', 'teamNames'
    ]);
    assert.equal(snap.mode, '4');
    assert.equal(snap.teamLevels.t1, '5');
  });
});

describe('viewModel.buildHistoryRows — 逐局全员排名行（web 组合列对位）', () => {
  it('rankingLine 按名次升序拼接 emoji+名字；缺 playerRankings 时为空串', () => {
    
    const rows = buildHistoryRows([
      {
        win: '蓝队', winKey: 't1', combo: '(1,2)', up: 3, t1: '5', t2: '2', ts: 'x',
        playerRankings: {
          2: { id: 2, name: '塔', emoji: '🍎', team: 1 },
          1: { id: 1, name: '超', emoji: '🐸', team: 1 },
          4: { id: 4, name: '大', emoji: '🐢', team: 2 },
          3: { id: 3, name: '姐', emoji: '🐱', team: 2 }
        }
      },
      { win: '红队', winKey: 't2', combo: '(1,3)', up: 2, t1: '5', t2: '4', ts: 'y' }
    ]);
    assert.equal(rows[1].rankingLine, '1.🐸超  2.🍎塔  3.🐱姐  4.🐢大');
    assert.equal(rows[0].rankingLine, '');
  });
});
