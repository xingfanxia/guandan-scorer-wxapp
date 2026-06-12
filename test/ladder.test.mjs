import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeLadderDeltas, applyLadderDelta, LADDER_BASE, LADDER_TEAM_K } from '../miniprogram/core/ladder.js';

const P = (id, team, rating, avgRanking) => ({ id, team, rating, avgRanking });

describe('ladder.computeLadderDeltas（简化 ELO，spec=PLAN.md WXAPP-9）', () => {
  it('同分队伍对局：胜队约 +16、负队约 −16（E=0.5）；两队零和', () => {
    const deltas = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, 1000, 2.5), P(2, 1, 1000, 2.5), P(3, 2, 1000, 2.5), P(4, 2, 1000, 2.5)]
    });
    // avgRanking=2.5=中位 → 个人表现 0；队伍增量 = 32×(1−0.5) = 16
    assert.equal(deltas.get('1'), 16);
    assert.equal(deltas.get('2'), 16);
    assert.equal(deltas.get('3'), -16);
    assert.equal(deltas.get('4'), -16);
    const sum = [...deltas.values()].reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, '同表现下两队增量应零和');
  });

  it('强队赢弱队加分少；弱队爆冷多得（核心需求）', () => {
    const strongWin = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, 1400, 2.5), P(2, 1, 1400, 2.5), P(3, 2, 1000, 2.5), P(4, 2, 1000, 2.5)]
    });
    const upset = computeLadderDeltas({
      mode: 4,
      winnerTeam: 2,
      players: [P(1, 1, 1400, 2.5), P(2, 1, 1400, 2.5), P(3, 2, 1000, 2.5), P(4, 2, 1000, 2.5)]
    });
    assert.ok(strongWin.get('1') < 16, `强胜弱应少于均势的16，got ${strongWin.get('1')}`);
    assert.ok(strongWin.get('1') >= 1);
    assert.ok(upset.get('3') > 16, `爆冷应多于均势的16，got ${upset.get('3')}`);
    assert.ok(upset.get('3') <= LADDER_TEAM_K + 8);
  });

  it('个人表现拉开同队差距：头游手 > 队内垫底手；表现项不破坏胜负方向', () => {
    const deltas = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, 1000, 1.0), P(2, 1, 1000, 3.6), P(3, 2, 1000, 2.0), P(4, 2, 1000, 3.4)]
    });
    assert.ok(deltas.get('1') > deltas.get('2'), '同队内场均更好的人增量应更大');
    assert.ok(deltas.get('1') > 0 && deltas.get('2') > 0, '胜队都为正');
    assert.ok(deltas.get('3') > deltas.get('4'), '负队内表现好的人扣更少');
    assert.ok(deltas.get('3') < 0 && deltas.get('4') < 0, '负队都为负');
  });

  it('未评分玩家按 1000 计入队伍均分；无 avgRanking 表现项为 0', () => {
    const deltas = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, undefined, undefined), P(2, 1, 1000, 2.5), P(3, 2, 1000, 2.5), P(4, 2, 1000, 2.5)]
    });
    assert.equal(deltas.get('1'), 16);
  });

  it('8 人局表现归一：场均第 1 → +0.5×16=+8；垫底 → −8', () => {
    const players = [];
    for (let i = 1; i <= 4; i++) players.push(P(i, 1, 1000, i === 1 ? 1 : 4.5));
    for (let i = 5; i <= 8; i++) players.push(P(i, 2, 1000, i === 8 ? 8 : 4.5));
    const deltas = computeLadderDeltas({ mode: 8, winnerTeam: 1, players });
    assert.equal(deltas.get('1'), 16 + 8);
    assert.equal(deltas.get('8'), -16 - 8);
  });

  it('退化输入全 0：单边空队 / winnerTeam 非法', () => {
    const oneSide = computeLadderDeltas({ mode: 4, winnerTeam: 1, players: [P(1, 1, 1000, 1)] });
    assert.equal(oneSide.get('1'), 0);
    const badWinner = computeLadderDeltas({ mode: 4, winnerTeam: 0, players: [P(1, 1), P(2, 2)] });
    assert.equal(badWinner.get('1'), 0);
  });
});

describe('ladder.applyLadderDelta（累计 {rating, sessions, peak}）', () => {
  it('从空档案起步：base 1000 + delta；peak 跟涨不跟跌；rating 不为负', () => {
    const first = applyLadderDelta(undefined, 20);
    assert.deepEqual(first, { rating: 1020, sessions: 1, peak: 1020 });
    const second = applyLadderDelta(first, -45);
    assert.deepEqual(second, { rating: 975, sessions: 2, peak: 1020 });
    const floor = applyLadderDelta({ rating: 10, sessions: 5, peak: 1100 }, -50);
    assert.deepEqual(floor, { rating: 0, sessions: 6, peak: 1100 });
  });
});
