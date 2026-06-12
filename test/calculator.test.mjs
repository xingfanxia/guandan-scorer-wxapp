import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRanks,
  sum,
  scoreSum,
  tier,
  nextLevel,
  calculateUpgrade
} from '../miniprogram/shared-logic/calculator.js';
import { DEFAULT_RULES } from '../miniprogram/shared-logic/ruleConfig.js';

// calculateUpgrade 在错误路径会 console.error，测试时静音避免污染输出
let originalConsoleError;
beforeEach(() => {
  originalConsoleError = console.error;
  console.error = () => {};
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe('parseRanks', () => {
  describe('连续数字输入', () => {
    it('4人模式输入 "13" 解析为 [1, 3]', () => {
      assert.deepEqual(parseRanks('13', 2), { ok: true, ranks: [1, 3] });
    });

    it('6人模式输入 "136" 解析为 [1, 3, 6]', () => {
      assert.deepEqual(parseRanks('136', 3), { ok: true, ranks: [1, 3, 6] });
    });

    it('8人模式输入 "1278" 解析为 [1, 2, 7, 8]', () => {
      assert.deepEqual(parseRanks('1278', 4), { ok: true, ranks: [1, 2, 7, 8] });
    });

    it('乱序输入 "31" 排序后返回 [1, 3]', () => {
      assert.deepEqual(parseRanks('31', 2), { ok: true, ranks: [1, 3] });
    });
  });

  describe('分隔符输入', () => {
    it('空格分隔 "1 2" 解析为 [1, 2]', () => {
      assert.deepEqual(parseRanks('1 2', 2), { ok: true, ranks: [1, 2] });
    });

    it('逗号分隔 "1,3" 解析为 [1, 3]', () => {
      assert.deepEqual(parseRanks('1,3', 2), { ok: true, ranks: [1, 3] });
    });

    it('乱序空格输入 "4 1" 排序后返回 [1, 4]', () => {
      assert.deepEqual(parseRanks('4 1', 2), { ok: true, ranks: [1, 4] });
    });
  });

  describe('重复名次拒绝', () => {
    it('连续数字 "11" 返回 名次不能重复', () => {
      assert.deepEqual(parseRanks('11', 2), { ok: false, msg: '名次不能重复' });
    });

    it('逗号分隔 "2,2" 返回 名次不能重复', () => {
      assert.deepEqual(parseRanks('2,2', 2), { ok: false, msg: '名次不能重复' });
    });
  });

  describe('超出范围拒绝', () => {
    it('4人模式 max 4：连续数字 "15" 返回 名次超出范围', () => {
      assert.deepEqual(parseRanks('15', 2), { ok: false, msg: '名次超出范围' });
    });

    it('4人模式 max 4：分隔输入 "1 5" 返回 名次必须在 1~4', () => {
      assert.deepEqual(parseRanks('1 5', 2), { ok: false, msg: '名次必须在 1~4' });
    });

    it('4人模式：名次 0 低于下限返回 名次超出范围', () => {
      assert.deepEqual(parseRanks('10', 2), { ok: false, msg: '名次超出范围' });
    });

    it('6人模式 max 6：连续数字 "167" 返回 名次超出范围', () => {
      assert.deepEqual(parseRanks('167', 3), { ok: false, msg: '名次超出范围' });
    });

    it('6人模式 max 6：分隔输入 "1 6 7" 返回 名次必须在 1~6', () => {
      assert.deepEqual(parseRanks('1 6 7', 3), { ok: false, msg: '名次必须在 1~6' });
    });

    it('8人模式 max 8：连续数字 "1239" 返回 名次超出范围', () => {
      assert.deepEqual(parseRanks('1239', 4), { ok: false, msg: '名次超出范围' });
    });

    it('8人模式 max 8：分隔输入 "1 2 3 9" 返回 名次必须在 1~8', () => {
      assert.deepEqual(parseRanks('1 2 3 9', 4), { ok: false, msg: '名次必须在 1~8' });
    });
  });

  describe('个数不符', () => {
    it('需要 2 个却给 3 个 "1 2 3" 返回 需要 2 个名次', () => {
      assert.deepEqual(parseRanks('1 2 3', 2), { ok: false, msg: '需要 2 个名次' });
    });

    it('需要 3 个却给 2 位数字 "12" 返回 需要 3 个名次', () => {
      assert.deepEqual(parseRanks('12', 3), { ok: false, msg: '需要 3 个名次' });
    });
  });

  describe('空输入', () => {
    it('空字符串返回 请输入名次', () => {
      assert.deepEqual(parseRanks('', 2), { ok: false, msg: '请输入名次' });
    });

    it('null 返回 请输入名次', () => {
      assert.deepEqual(parseRanks(null, 2), { ok: false, msg: '请输入名次' });
    });
  });
});

describe('nextLevel', () => {
  it("'2' 升 1 级到 '3'", () => {
    assert.equal(nextLevel('2', 1), '3');
  });

  it("'K' 升 2 级封顶在 'A'", () => {
    assert.equal(nextLevel('K', 2), 'A');
  });

  it("'A' 升 1 级仍是 'A'（封顶）", () => {
    assert.equal(nextLevel('A', 1), 'A');
  });

  it("'10' 升 1 级到 'J'", () => {
    assert.equal(nextLevel('10', 1), 'J');
  });

  it("未知等级 'X' 按 index 0（'2'）处理：升 1 级到 '3'", () => {
    assert.equal(nextLevel('X', 1), '3');
  });

  it("未知等级 'X' 升 0 级返回 '2'", () => {
    assert.equal(nextLevel('X', 0), '2');
  });
});

describe('calculateUpgrade — 4人模式（DEFAULT_RULES.c4 全表）', () => {
  it('[1,2] 升 3 级', () => {
    const result = calculateUpgrade('4', [1, 2], DEFAULT_RULES);
    assert.equal(result.upgrade, 3);
    assert.equal(result.details.mode, '4-player');
    assert.equal(result.details.combination, '1,2');
  });

  it('[1,3] 升 2 级', () => {
    assert.equal(calculateUpgrade('4', [1, 3], DEFAULT_RULES).upgrade, 2);
  });

  it('[1,4] 升 1 级', () => {
    assert.equal(calculateUpgrade('4', [1, 4], DEFAULT_RULES).upgrade, 1);
  });

  it('无匹配组合 [2,3] 升 0 级', () => {
    const result = calculateUpgrade('4', [2, 3], DEFAULT_RULES);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.combination, '2,3');
  });

  it('mode 传数字 4 与字符串 "4" 行为一致', () => {
    assert.equal(calculateUpgrade(4, [1, 2], DEFAULT_RULES).upgrade, 3);
  });
});

describe('calculateUpgrade — 6人模式（p6 总分 16，diff = 2*ourScore - 16）', () => {
  it('[1,2,3] ourScore=12 diff=8 ≥ g3(7) 升 3 级', () => {
    const result = calculateUpgrade('6', [1, 2, 3], DEFAULT_RULES);
    assert.equal(result.upgrade, 3);
    assert.equal(result.details.ourScore, 12);
    assert.equal(result.details.oppScore, 4);
    assert.equal(result.details.difference, 8);
    assert.equal(result.details.hasFirstPlace, true);
  });

  it('[1,3,4] ourScore=11 diff=6 落在 g2(4) 档升 2 级', () => {
    assert.equal(calculateUpgrade('6', [1, 3, 4], DEFAULT_RULES).upgrade, 2);
  });

  it('[1,2,5] ourScore=10 diff=4 恰好命中 g2(4) 边界升 2 级', () => {
    const result = calculateUpgrade('6', [1, 2, 5], DEFAULT_RULES);
    assert.equal(result.upgrade, 2);
    assert.equal(result.details.difference, 4);
  });

  it('[1,3,5] ourScore=9 diff=2 落在 g1(1) 档升 1 级', () => {
    assert.equal(calculateUpgrade('6', [1, 3, 5], DEFAULT_RULES).upgrade, 1);
  });

  it('[1,4,6] ourScore=8 diff=0 低于 g1(1) 升 0 级', () => {
    const result = calculateUpgrade('6', [1, 4, 6], DEFAULT_RULES);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.difference, 0);
  });

  it('must1=true 且无第 1 名：[2,3,4] diff=4 本可升 2 级但强制为 0', () => {
    const result = calculateUpgrade('6', [2, 3, 4], DEFAULT_RULES, true);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.difference, 4);
    assert.equal(result.details.hasFirstPlace, false);
  });

  it('must1=false 时 [2,3,4] 按差值升 2 级', () => {
    assert.equal(calculateUpgrade('6', [2, 3, 4], DEFAULT_RULES, false).upgrade, 2);
  });
});

describe('calculateUpgrade — 8人模式（p8 总分 28，diff = 2*ourScore - 28）', () => {
  it('sweep [1,2,3,4] 直接升 4 级并标记 sweepBonus', () => {
    const result = calculateUpgrade('8', [1, 2, 3, 4], DEFAULT_RULES);
    assert.equal(result.upgrade, 4);
    assert.deepEqual(result.details, { mode: '8-player', sweepBonus: true });
  });

  it('非 sweep [1,2,3,5] ourScore=21 diff=14 ≥ g3(11) 升 3 级', () => {
    const result = calculateUpgrade('8', [1, 2, 3, 5], DEFAULT_RULES);
    assert.equal(result.upgrade, 3);
    assert.equal(result.details.ourScore, 21);
    assert.equal(result.details.difference, 14);
    assert.equal(result.details.sweepBonus, undefined);
  });

  it('[1,2,3,8] ourScore=18 diff=8 落在 g2(5) 档升 2 级', () => {
    assert.equal(calculateUpgrade('8', [1, 2, 3, 8], DEFAULT_RULES).upgrade, 2);
  });

  it('[1,2,7,8] ourScore=14 diff=0 恰好命中 g1(0) 边界升 1 级', () => {
    const result = calculateUpgrade('8', [1, 2, 7, 8], DEFAULT_RULES);
    assert.equal(result.upgrade, 1);
    assert.equal(result.details.difference, 0);
  });

  it('[1,6,7,8] ourScore=10 diff=-8 低于 g1(0) 升 0 级', () => {
    const result = calculateUpgrade('8', [1, 6, 7, 8], DEFAULT_RULES);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.difference, -8);
  });

  it('must1=true 且无第 1 名：[2,3,4,5] diff=8 本可升 2 级但强制为 0', () => {
    const result = calculateUpgrade('8', [2, 3, 4, 5], DEFAULT_RULES, true);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.hasFirstPlace, false);
  });

  it('must1=false 时 [2,3,4,5] 按差值升 2 级', () => {
    assert.equal(calculateUpgrade('8', [2, 3, 4, 5], DEFAULT_RULES, false).upgrade, 2);
  });
});

describe('calculateUpgrade — 错误路径', () => {
  it("invalid mode '5' 返回 upgrade 0 + details.error 'invalid_mode'", () => {
    const result = calculateUpgrade('5', [1, 2], DEFAULT_RULES);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.error, 'invalid_mode');
    assert.equal(result.details.received, '5');
  });

  it("非数字 mode 'abc' 返回 invalid_mode", () => {
    const result = calculateUpgrade('abc', [1, 2], DEFAULT_RULES);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.error, 'invalid_mode');
  });

  it("4人模式 ranks 只有 1 个返回 invalid_ranks_length（expected 2, received 1）", () => {
    const result = calculateUpgrade('4', [1], DEFAULT_RULES);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.error, 'invalid_ranks_length');
    assert.equal(result.details.expected, 2);
    assert.equal(result.details.received, 1);
  });

  it("6人模式 ranks 给 2 个返回 invalid_ranks_length（expected 3, received 2）", () => {
    const result = calculateUpgrade('6', [1, 2], DEFAULT_RULES);
    assert.equal(result.details.error, 'invalid_ranks_length');
    assert.equal(result.details.expected, 3);
    assert.equal(result.details.received, 2);
  });

  it('ranks 为 null 返回 invalid_ranks_length 且 received 为 undefined', () => {
    const result = calculateUpgrade('8', null, DEFAULT_RULES);
    assert.equal(result.upgrade, 0);
    assert.equal(result.details.error, 'invalid_ranks_length');
    assert.equal(result.details.expected, 4);
    assert.equal(result.details.received, undefined);
  });
});

describe('sum', () => {
  it('sum([1,2,3]) 返回 6', () => {
    assert.equal(sum([1, 2, 3]), 6);
  });

  it('空数组返回 0', () => {
    assert.equal(sum([]), 0);
  });
});

describe('scoreSum', () => {
  it('scoreSum([1,3], DEFAULT_RULES.p6) 返回 5+3=8', () => {
    assert.equal(scoreSum([1, 3], DEFAULT_RULES.p6), 8);
  });

  it('pointMap 中不存在的名次按 0 计：scoreSum([7], p6) 返回 0', () => {
    assert.equal(scoreSum([7], DEFAULT_RULES.p6), 0);
  });
});

describe('tier — t6/t8 阈值精确边界', () => {
  it('t6：diff=7 恰好命中 g3 返回 3', () => {
    assert.equal(tier(7, DEFAULT_RULES.t6), 3);
  });

  it('t6：diff=6 低于 g3 落入 g2 返回 2', () => {
    assert.equal(tier(6, DEFAULT_RULES.t6), 2);
  });

  it('t6：diff=4 恰好命中 g2 返回 2', () => {
    assert.equal(tier(4, DEFAULT_RULES.t6), 2);
  });

  it('t6：diff=1 恰好命中 g1 返回 1', () => {
    assert.equal(tier(1, DEFAULT_RULES.t6), 1);
  });

  it('t6：diff=0 低于 g1 返回 0', () => {
    assert.equal(tier(0, DEFAULT_RULES.t6), 0);
  });

  it('t8：diff=11 恰好命中 g3 返回 3', () => {
    assert.equal(tier(11, DEFAULT_RULES.t8), 3);
  });

  it('t8：diff=5 恰好命中 g2 返回 2', () => {
    assert.equal(tier(5, DEFAULT_RULES.t8), 2);
  });

  it('t8：diff=0 恰好命中 g1 返回 1', () => {
    assert.equal(tier(0, DEFAULT_RULES.t8), 1);
  });

  it('t8：diff=-1 低于 g1 返回 0', () => {
    assert.equal(tier(-1, DEFAULT_RULES.t8), 0);
  });
});
