import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileVM } from '../miniprogram/core/profileVM.js';

const baseStats = {
  sessionsPlayed: 4,
  sessionsWon: 3,
  currentWinStreak: 1,
  longestWinStreak: 2,
  totalGames: 20,
  firstPlaceCount: 6,
  lastPlaceCount: 1,
  rankingSum: 40,
  rankingGames: 20,
  mvpVotes: 5,
  burdenVotes: 1,
  honors: { '吕布': 2, '赌徒': 1, '石佛': 0 },
  sessionHistory: { k1: { gamesInSession: 5, ranking: 2, teamWon: true, lastPlaces: 0 } },
  votingHistory: {}
};

describe('profileVM.buildProfileVM（档案页/玩家查询页共用）', () => {
  it('空/零场 stats → null', () => {
    assert.equal(buildProfileVM(null), null);
    assert.equal(buildProfileVM({ ...baseStats, sessionsPlayed: 0 }), null);
  });

  it('stat cells 含天梯三项；无 ladder 字段时按 1000 起步显示', () => {
    const vm = buildProfileVM(baseStats);
    const byLabel = Object.fromEntries(vm.statCells.map(c => [c.label, c.value]));
    assert.equal(byLabel['天梯分'], '1000');
    assert.equal(byLabel['天梯峰值'], '1000');
    assert.equal(byLabel['天梯场次'], '0');
    assert.equal(byLabel['平均名次'], '2.00');
    assert.equal(vm.summary.winRate, '75%');
    assert.equal(vm.summary.ladder, 1000);
  });

  it('有 ladder 字段时透出真实评分；summary.ladder 同步', () => {
    const vm = buildProfileVM({ ...baseStats, ladder: { rating: 1042, sessions: 3, peak: 1058 } });
    const byLabel = Object.fromEntries(vm.statCells.map(c => [c.label, c.value]));
    assert.equal(byLabel['天梯分'], '1042');
    assert.equal(byLabel['天梯峰值'], '1058');
    assert.equal(byLabel['天梯场次'], '3');
    assert.equal(vm.summary.ladder, 1042);
  });

  it('荣誉行经合规别名 + caption；零计数不显示', () => {
    const vm = buildProfileVM(baseStats);
    const titles = vm.honorRows.map(r => r.title);
    assert.ok(titles.includes('吕布'));
    assert.ok(titles.includes('莽夫'), '「赌徒」应渲染为「莽夫」');
    assert.ok(!titles.includes('赌徒'));
    assert.ok(!titles.includes('石佛'), '零计数荣誉不显示');
    for (const r of vm.honorRows) {
      assert.ok(r.caption.length > 0, `荣誉「${r.title}」缺 caption`);
    }
  });
});
