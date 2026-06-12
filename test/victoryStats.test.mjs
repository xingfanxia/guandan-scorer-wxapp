import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSession, computeSessionMvp, computeSessionHonors } from '../miniprogram/core/victoryStats.js';
import { displayHonorTitle } from '../miniprogram/core/honorDisplay.js';

/** 构造一条带 playerRankings 的 history entry */
function entry(winKey, rankToPlayer, mode = '4') {
  const playerRankings = {};
  for (const [rank, p] of Object.entries(rankToPlayer)) {
    playerRankings[rank] = p;
  }
  return { winKey, mode, playerRankings };
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

  it('名册漂移：玩家在历史里但已被移出 players → 仍计股票数据，搭子/对头按现有名册', () => {
    const drifted = { ...state, players: [P1, P2, P3] }; // P4 已删
    const agg = aggregateSession(drifted);
    const p4 = agg.players.find(p => p.id === 4);
    assert.ok(p4, '历史里的 P4 仍应有聚合行');
    assert.equal(p4.games, 3);
    assert.deepEqual(p4.partnerIds, [3]); // 现名册里同队只剩 P3
  });

  it('8人局：lastRank=8 判定垫底', () => {
    const P = (id, team) => ({ id, name: `P${id}`, emoji: '🙂', team });
    const eight = [1, 2, 3, 4].map(i => P(i, 1)).concat([5, 6, 7, 8].map(i => P(i, 2)));
    const ranks = {};
    eight.forEach((p, i) => { ranks[i + 1] = p; });
    const s8 = {
      mode: '8',
      players: eight,
      history: [entry('t1', ranks, '8')],
      gameStatus: { ended: true, winnerKey: 't1', winnerName: '蓝队', reason: 'A_LEVEL_CLEARED' }
    };
    const agg = aggregateSession(s8);
    assert.equal(agg.players.find(p => p.id === 8).lastPlaces, 1);
    assert.equal(agg.players.find(p => p.id === 7).lastPlaces, 0);
    assert.equal(agg.players.find(p => p.id === 1).teamWon, true);
    assert.equal(agg.players.find(p => p.id === 5).teamWon, false);
  });
});

describe('victoryStats.computeSessionMvp', () => {
  it('全场最低平均排名者为 MVP', () => {
    const mvp = computeSessionMvp(state);
    assert.equal(mvp.id, 1);
    assert.equal(mvp.name, '老王');
  });

  it('平均并列时头游多者胜出（真实决胜夹具：P1 与 P2 平均同为 1.5，P1 头游 2 次 vs P2 0 次）', () => {
    // 局1: P1=1, P2=2；局2: P1=2... 构造 avg 相同但头游不同：
    // P1: 1,1,2,2 → avg 1.5，头游 2；P2: 2,2,1,1 → avg 1.5，头游 2 —— 不行。
    // 用 P1: 1,2 (avg 1.5, 头游1)；P2: 2,1 (avg 1.5, 头游1) 也并列。
    // 三人局名次池不行（4人局名次 1-4）：P1: 1,1,2,2 avg=1.5 头游2；P2: 2,2,1,1 avg=1.5 头游2。
    // 真正可分的夹具：P1: 1,1,3,3 avg=2 头游2；P2: 2,2,2,2 avg=2 头游0 → P1 胜出。
    const tied = {
      ...state,
      history: [
        entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 }),
        entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 }),
        entry('t1', { 1: P3, 2: P2, 3: P1, 4: P4 }),
        entry('t1', { 1: P4, 2: P2, 3: P1, 4: P3 })
      ]
    };
    // P1: 1,1,3,3 → avg 2, 头游 2；P2: 2,2,2,2 → avg 2, 头游 0
    const mvp = computeSessionMvp(tied);
    assert.equal(mvp.id, 1);
    assert.equal(mvp.firstPlaces, 2);
  });

  it('无历史返回 null', () => {
    assert.equal(computeSessionMvp({ ...state, history: [] }), null);
  });
});

describe('victoryStats.computeSessionHonors（vendored honorLogic 接入）', () => {
  it('5+ 局后按 web 同算法颁发多项荣誉（吕布给最低平均、阿斗给垫底王）', () => {
    // 5 局固定名次：P1 全头游、P4 全末游
    const fiveRounds = Array.from({ length: 5 }, () =>
      entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 })
    );
    const honors = computeSessionHonors({ ...state, history: fiveRounds });
    assert.ok(honors[1] && honors[1].includes('吕布'), `P1 应获吕布，实际 ${JSON.stringify(honors[1])}`);
    assert.ok(honors[4] && honors[4].includes('阿斗'), `P4 应获阿斗，实际 ${JSON.stringify(honors[4])}`);
    // 颁出的荣誉全部来自现行 catalog（key 缺失会被静默丢弃 —— 钉死该行为）
    const all = Object.values(honors).flat();
    assert.ok(all.length >= 2);
    for (const t of all) {
      assert.equal(typeof t, 'string');
      assert.ok(t.length > 0);
    }
  });

  it('6人局也能算（lastRank=6）', () => {
    const P = (id, team) => ({ id, name: `P${id}`, emoji: '🙂', team });
    const six = [1, 2, 3].map(i => P(i, 1)).concat([4, 5, 6].map(i => P(i, 2)));
    const ranks = {};
    six.forEach((p, i) => { ranks[i + 1] = p; });
    const rounds = Array.from({ length: 5 }, () => entry('t1', ranks, '6'));
    const honors = computeSessionHonors({
      mode: '6',
      players: six,
      history: rounds,
      gameStatus: { ended: true, winnerKey: 't1', winnerName: '蓝队', reason: 'A_LEVEL_CLEARED' }
    });
    assert.ok(honors[1] && honors[1].includes('吕布'));
    assert.ok(honors[6] && honors[6].includes('阿斗'));
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
