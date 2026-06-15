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

  // 队友与对手（对位 web player-profile.html renderPartnerRivalStats）：
  // 云函数把 partners/opponents 解析成 display-safe 数组（含 name/emoji，无 openid），VM 派生最佳/最弱。
  describe('relations 队友与对手派生', () => {
    const withRel = {
      ...baseStats,
      relations: {
        partners: [
          { name: '阿轴', emoji: '🐶', handle: 'axax', games: 6, wins: 5, winRate: 5 / 6 },
          { name: '小昊', emoji: '🐱', handle: 'hao', games: 6, wins: 5, winRate: 5 / 6 },
          { name: '徐峰', emoji: '🐭', handle: 'xufeng', games: 9, wins: 5, winRate: 5 / 9 },
          { name: '凡子', emoji: '🐰', handle: 'fzy', games: 4, wins: 1, winRate: 0.25 }
        ],
        opponents: [
          { name: '凡子', emoji: '🐰', handle: 'fzy', games: 9, wins: 8, winRate: 8 / 9 },
          { name: '焦', emoji: '🦊', handle: 'jiaqicao', games: 9, wins: 5, winRate: 5 / 9 },
          { name: '徐峰', emoji: '🐭', handle: 'xufeng', games: 6, wins: 1, winRate: 1 / 6 }
        ]
      }
    };

    it('无 relations 字段 → relations 为 null（不破坏老数据）', () => {
      assert.equal(buildProfileVM(baseStats).relations, null);
    });

    it('最佳队友=胜率最高，最弱队友=胜率最低；带行话 label', () => {
      const { relations: rel } = buildProfileVM(withRel);
      assert.equal(rel.bestPartner.name, '阿轴'); // 5/6 并列时取首个（sort 稳定）
      assert.equal(rel.bestPartner.label, '大佬带我躺赢');
      assert.equal(rel.worstPartner.handle, 'fzy'); // 0.25 最低
      assert.equal(rel.worstPartner.label, '偷着乐吧');
      assert.equal(rel.bestPartner.pct, '83.3');
      assert.equal(rel.worstPartner.pct, '25.0');
    });

    it('最强对手=你的胜率最低（最难赢），最弱对手=你的胜率最高', () => {
      const { relations: rel } = buildProfileVM(withRel);
      assert.equal(rel.hardestOpponent.handle, 'xufeng'); // 1/6 你最难赢
      assert.equal(rel.hardestOpponent.label, '既生瑜何生亮');
      assert.equal(rel.easiestOpponent.handle, 'fzy'); // 8/9 你最常赢
      assert.equal(rel.easiestOpponent.label, '这是送分来的');
    });

    it('全队友/全对手列表带胜率 + bar 宽度 + tone 配色', () => {
      const { relations: rel } = buildProfileVM(withRel);
      assert.equal(rel.partnerCount, 4);
      assert.equal(rel.opponentCount, 3);
      assert.equal(rel.allPartners.length, 4);
      // 列表按胜率降序
      assert.ok(rel.allPartners[0].winRate >= rel.allPartners[3].winRate);
      const fzyP = rel.allPartners.find(r => r.handle === 'fzy');
      assert.equal(fzyP.tone, 'loss'); // 25% < 50%
      const axP = rel.allPartners.find(r => r.handle === 'axax');
      assert.equal(axP.tone, 'win'); // 83% >= 60%
      assert.equal(typeof axP.pctNum, 'number');
    });

    it('只有一个队友 → 不重复显示成最弱（worstPartner=null）', () => {
      const vm = buildProfileVM({
        ...baseStats,
        relations: { partners: [{ name: '独苗', emoji: '🐶', handle: 'solo', games: 3, wins: 2, winRate: 2 / 3 }], opponents: [] }
      });
      assert.equal(vm.relations.bestPartner.handle, 'solo');
      assert.equal(vm.relations.worstPartner, null);
      assert.equal(vm.relations.opponentCount, 0);
    });
  });

  describe('rankTrend 近期排名走势', () => {
    it('无数据 → null', () => {
      assert.equal(buildProfileVM(baseStats).rankTrend, null);
      assert.equal(buildProfileVM({ ...baseStats, rankTrend: [] }).rankTrend, null);
    });
    it('透出 points（旧→新）+ 计算 max 轴上限（≥8）', () => {
      const vm = buildProfileVM({ ...baseStats, rankTrend: [5, 1, 3, 8, 2] });
      assert.deepEqual(vm.rankTrend.points, [5, 1, 3, 8, 2]);
      assert.equal(vm.rankTrend.max, 8);
    });
    it('排名超 8（大局）时 max 扩到数据上限', () => {
      const vm = buildProfileVM({ ...baseStats, rankTrend: [9, 3, 10] });
      assert.equal(vm.rankTrend.max, 10);
    });
  });

  describe('recentGames 最近游戏', () => {
    it('无数据 → 空数组', () => {
      assert.deepEqual(buildProfileVM(baseStats).recentGames, []);
    });
    it('格式化 mode/result/rank，最多 10 条', () => {
      const games = Array.from({ length: 12 }, (_, i) => ({
        date: '2026-06-10T07:30:00.000Z', mode: '8P', ranking: 4.9, teamWon: i % 2 === 0, honors: i === 0 ? ['吕布'] : []
      }));
      const vm = buildProfileVM({ ...baseStats, recentGames: games });
      assert.equal(vm.recentGames.length, 10);
      assert.equal(vm.recentGames[0].modeText, '8人');
      assert.equal(vm.recentGames[0].resultText, '胜');
      assert.equal(vm.recentGames[1].resultText, '负');
      assert.equal(vm.recentGames[0].rankText, '4.9');
      assert.deepEqual(vm.recentGames[0].honors, ['吕布']);
    });
  });
});
