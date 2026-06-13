import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeLadderDeltas, applyLadderDelta, seedLadderRating, LADDER_BASE, LADDER_TEAM_K } from '../miniprogram/shared-logic/ladderLogic.js';

const P = (id, team, rating, avgRanking) => ({ id, team, rating, avgRanking });

describe('ladder.computeLadderDeltas（简化 ELO，spec=PLAN.md WXAPP-9）', () => {
  it('同分队伍对局：胜队约 +12、负队约 −12（E=0.5）；两队零和', () => {
    const deltas = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, 1000, 2.5), P(2, 1, 1000, 2.5), P(3, 2, 1000, 2.5), P(4, 2, 1000, 2.5)]
    });
    // avgRanking=2.5=中位 → 个人表现 0；队伍项 = 24×(1−0.5) = 12
    assert.equal(deltas.get('1'), 12);
    assert.equal(deltas.get('2'), 12);
    assert.equal(deltas.get('3'), -12);
    assert.equal(deltas.get('4'), -12);
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
    assert.ok(strongWin.get('1') < 12, `强胜弱应少于均势的12，got ${strongWin.get('1')}`);
    assert.ok(strongWin.get('1') >= 1);
    assert.ok(upset.get('3') > 12, `爆冷应多于均势的12，got ${upset.get('3')}`);
    assert.ok(upset.get('3') <= LADDER_TEAM_K + 14);
  });

  it('输了但个人名次好 → 小加分（≤+6 封顶）；输了打差才大扣（2026-06-12 用户调参）', () => {
    // 均势局：负队头游手 perf=+0.5 → −12+14 = +2 小加分
    const even = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, 1000, 2.0), P(2, 1, 1000, 3.0), P(3, 2, 1000, 1.0), P(4, 2, 1000, 4.0)]
    });
    assert.ok(even.get('3') > 0, `输局头游手应小加分，got ${even.get('3')}`);
    assert.ok(even.get('3') <= 6, `负方加分封顶 +6，got ${even.get('3')}`);
    assert.ok(even.get('4') < -12, `输局垫底手该大扣，got ${even.get('4')}`);
    // 弱队输给强队（本就该输）：高光手触发 +6 封顶
    const underdogLoss = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, 1400, 2.5), P(2, 1, 1400, 2.5), P(3, 2, 1000, 1.0), P(4, 2, 1000, 4.0)]
    });
    assert.equal(underdogLoss.get('3'), 6, `弱队高光手封顶 +6，got ${underdogLoss.get('3')}`);
  });

  it('胜方保底 +1：躺赢混子不倒扣', () => {
    const deltas = computeLadderDeltas({
      mode: 4,
      winnerTeam: 1,
      players: [P(1, 1, 1000, 1.0), P(2, 1, 1000, 4.0), P(3, 2, 1000, 2.0), P(4, 2, 1000, 3.0)]
    });
    // P2 躺赢垫底：12−14=−2 → 保底 +1
    assert.equal(deltas.get('2'), 1);
    assert.ok(deltas.get('1') > deltas.get('2'));
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
    assert.equal(deltas.get('1'), 12);
  });

  it('8 人局表现归一：场均第 1 → +0.5×28=+14；垫底 → −14', () => {
    const players = [];
    for (let i = 1; i <= 4; i++) players.push(P(i, 1, 1000, i === 1 ? 1 : 4.5));
    for (let i = 5; i <= 8; i++) players.push(P(i, 2, 1000, i === 8 ? 8 : 4.5));
    const deltas = computeLadderDeltas({ mode: 8, winnerTeam: 1, players });
    assert.equal(deltas.get('1'), 12 + 14);
    assert.equal(deltas.get('8'), -12 - 14);
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

describe('ladder.seedLadderRating（web 历史折算起评分）', () => {
  it('零场/缺数据 → 1000；不会产出 NaN', () => {
    assert.equal(seedLadderRating(undefined), LADDER_BASE);
    assert.equal(seedLadderRating({}), LADDER_BASE);
    assert.equal(seedLadderRating({ sessionsPlayed: 0, sessionsWon: 0 }), LADDER_BASE);
    assert.equal(seedLadderRating({ sessionsPlayed: 5 }), Math.round(1000 + (5 / 20) * 300 * -0.5));
  });

  it('强历史（高胜率+靠前名次）> 1000；弱历史 < 1000；强弱有区分度', () => {
    const strong = seedLadderRating({ sessionsPlayed: 18, sessionsWon: 13, avgRankingPerSession: 3.2 });
    const weak = seedLadderRating({ sessionsPlayed: 18, sessionsWon: 5, avgRankingPerSession: 5.8 });
    assert.ok(strong > 1050, `强历史应明显高于 1000，got ${strong}`);
    assert.ok(weak < 950, `弱历史应明显低于 1000，got ${weak}`);
    assert.ok(strong - weak > 150, `强弱差距应有区分度，got ${strong - weak}`);
  });

  it('场次少 → 贴 1000（置信度折扣）；极端值钳在 [700,1300]', () => {
    const few = seedLadderRating({ sessionsPlayed: 2, sessionsWon: 2, avgRankingPerSession: 1.5 });
    const many = seedLadderRating({ sessionsPlayed: 20, sessionsWon: 20, avgRankingPerSession: 1.5 });
    assert.ok(Math.abs(few - 1000) < Math.abs(many - 1000), '少场次应比多场次更贴 1000');
    assert.ok(many <= 1300 && many >= 700);
    assert.equal(seedLadderRating({ sessionsPlayed: 100, sessionsWon: 100, avgRankingPerSession: 1 }), 1300);
    assert.equal(seedLadderRating({ sessionsPlayed: 100, sessionsWon: 0, avgRankingPerSession: 8 }), 700);
  });
});
