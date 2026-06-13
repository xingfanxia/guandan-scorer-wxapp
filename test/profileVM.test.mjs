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

  // web-only（未绑定）玩家：profile_get_by_handle 归一 web 战绩后喂同一个 VM。
  // web 端不跟踪头游/垫底（API 回 null）—— 这两格必须略过，不能显示「null」。
  describe('web-only 玩家（头游/垫底缺失）', () => {
    const webShaped = {
      sessionsPlayed: 18,
      sessionsWon: 13,
      currentWinStreak: 4,
      longestWinStreak: 4,
      totalGames: 291,
      firstPlaceCount: null,
      lastPlaceCount: null,
      rankingSum: 3.56 * 291,
      rankingGames: 291,
      mvpVotes: 0,
      burdenVotes: 2,
      honors: { '吕布': 5, '石佛': 8, '连段王': 7 },
      ladder: { rating: 1120, sessions: 0, peak: 1120 }
    };

    it('头游/垫底字段为 null → 略过该格，不渲染「null」', () => {
      const vm = buildProfileVM(webShaped);
      const labels = vm.statCells.map(c => c.label);
      assert.ok(!labels.includes('头游'), '头游缺失应略过该格');
      assert.ok(!labels.includes('垫底'), '垫底缺失应略过该格');
      for (const c of vm.statCells) {
        assert.notEqual(c.value, 'null');
        assert.notEqual(c.value, 'undefined');
      }
    });

    it('可派生字段照常显示：总局数 / 平均名次 / 最C最闹 / 天梯', () => {
      const vm = buildProfileVM(webShaped);
      const byLabel = Object.fromEntries(vm.statCells.map(c => [c.label, c.value]));
      assert.equal(byLabel['总局数'], '291');
      assert.equal(byLabel['平均名次'], '3.56');
      assert.equal(byLabel['最C/最闹票'], '0/2');
      assert.equal(byLabel['天梯分'], '1120');
      assert.equal(byLabel['天梯场次'], '0');
    });

    it('web 荣誉照常渲染（带 caption），是档案补全的核心', () => {
      const vm = buildProfileVM(webShaped);
      const titles = vm.honorRows.map(r => r.title);
      assert.ok(titles.includes('吕布'));
      assert.ok(titles.includes('石佛'));
      assert.equal(vm.honorRows.length, 3);
      for (const r of vm.honorRows) assert.ok(r.caption.length > 0);
    });
  });
});
