import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSession, computeSessionMvp } from '../miniprogram/core/victoryStats.js';

/** 构造一条带 playerRankings 的 history entry（4人局） */
function entry(winKey, rankToPlayer) {
  const playerRankings = {};
  for (const [rank, p] of Object.entries(rankToPlayer)) {
    playerRankings[rank] = p;
  }
  return { winKey, mode: '4', playerRankings };
}

const P1 = { id: 1, name: '老王', emoji: '🐶', team: 1 };
const P2 = { id: 2, name: '老李', emoji: '🐱', team: 1 };
const P3 = { id: 3, name: '老张', emoji: '🐭', team: 2 };
const P4 = { id: 4, name: '老赵', emoji: '🐰', team: 2 };

// 3 局：P1 名次 1,1,2 → avg 1.33；P3 名次 3,3,4 → 垫底 1 次
const history = [
  entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 }),
  entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 }),
  entry('t1', { 1: P2, 2: P1, 3: P4, 4: P3 })
];

const state = {
  mode: '4',
  players: [P1, P2, P3, P4],
  history,
  gameStatus: { ended: true, winnerKey: 't1', winnerName: '蓝队', reason: 'A_LEVEL_CLEARED' }
};

describe('victoryStats.aggregateSession', () => {
  it('逐玩家聚合：场次/名次和/平均/头游/垫底/是否胜方', () => {
    const agg = aggregateSession(state);
    assert.equal(agg.gamesInSession, 3);

    const p1 = agg.players.find(p => p.id === 1);
    assert.equal(p1.games, 3);
    assert.equal(p1.avgRanking, (1 + 1 + 2) / 3);
    assert.equal(p1.firstPlaces, 2);
    assert.equal(p1.lastPlaces, 0);
    assert.equal(p1.teamWon, true);

    const p3 = agg.players.find(p => p.id === 3);
    assert.equal(p3.avgRanking, (3 + 3 + 4) / 3);
    assert.equal(p3.lastPlaces, 1);
    assert.equal(p3.teamWon, false);
  });

  it('搭子/对头按队伍切分（id 列表，不含自己）', () => {
    const agg = aggregateSession(state);
    const p1 = agg.players.find(p => p.id === 1);
    assert.deepEqual(p1.partnerIds, [2]);
    assert.deepEqual(p1.opponentIds.sort(), [3, 4]);
  });

  it('空历史：零场次、玩家聚合为空', () => {
    const agg = aggregateSession({ ...state, history: [] });
    assert.equal(agg.gamesInSession, 0);
    assert.deepEqual(agg.players, []);
  });

  it('某局缺 playerRankings 时跳过该局不炸', () => {
    const agg = aggregateSession({ ...state, history: [...history, { winKey: 't1', mode: '4' }] });
    assert.equal(agg.gamesInSession, 4);
    assert.equal(agg.players.find(p => p.id === 1).games, 3);
  });
});

describe('victoryStats.computeSessionMvp', () => {
  it('全场最低平均排名者为 MVP', () => {
    const mvp = computeSessionMvp(state);
    assert.equal(mvp.id, 1);
    assert.equal(mvp.name, '老王');
  });

  it('平均并列时头游多者胜出', () => {
    // P1: 1,2 → avg 1.5, 头游1次；P2: 2,1 → avg 1.5, 头游1次 → 再并列按 id 稳定
    const tied = {
      ...state,
      history: [
        entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 }),
        entry('t1', { 1: P2, 2: P1, 3: P3, 4: P4 })
      ]
    };
    const mvp = computeSessionMvp(tied);
    assert.equal(mvp.id, 1); // 全并列 → id 小者（稳定可预期）
  });

  it('无历史返回 null', () => {
    assert.equal(computeSessionMvp({ ...state, history: [] }), null);
  });
});

describe('victoryStats.computeSessionHonors（vendored honorLogic 接入）', async () => {
  const { computeSessionHonors } = await import('../miniprogram/core/victoryStats.js');
  const { displayHonorTitle } = await import('../miniprogram/core/honorDisplay.js');
  const { it } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;

  it('5+ 局后最低平均排名者获吕布（MIN_HONOR_GAMES=5 门槛）', () => {
    const fiveRounds = Array.from({ length: 5 }, () =>
      entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 })
    );
    const honors = computeSessionHonors({ ...state, history: fiveRounds });
    assert.ok(honors[1], 'P1 应有荣誉');
    assert.ok(honors[1].includes('吕布'), `P1 应获吕布，实际 ${JSON.stringify(honors[1])}`);
  });

  it('不足 5 局：样本不够，无人得荣誉', () => {
    const honors = computeSessionHonors(state); // 3 局
    assert.deepEqual(honors, {});
  });

  it('合规别名：赌徒渲染为莽夫，其余原样', () => {
    assert.equal(displayHonorTitle('赌徒'), '莽夫');
    assert.equal(displayHonorTitle('吕布'), '吕布');
  });
});
