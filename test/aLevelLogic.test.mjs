import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkALevelRules, DEFAULT_TEAM_NAMES } from '../miniprogram/shared-logic/aLevelLogic.js';

/** 基础输入模板：6人模式，t1 在 A 级、t2 在 K 级，本局是 t1 自己的 A 级回合，strict A。 */
function baseInput(overrides = {}) {
  return {
    winnerKey: 't1',
    ranks: [1, 2, 3],
    mode: '6',
    teamLevels: { t1: 'A', t2: 'K' },
    roundOwner: 't1',
    roundLevel: 'A',
    strictA: true,
    aFailCounts: { t1: 0, t2: 0 },
    teamNames: { t1: '蓝队', t2: '红队' },
    ...overrides
  };
}

describe('checkALevelRules — A级通关 / 失败核心规则', () => {
  it('场景1：自己的A级回合、胜方无末游 → finalWin:true，aNote 含「A级通关」', () => {
    const res = checkALevelRules(baseInput({ ranks: [1, 2, 3] }));
    assert.equal(res.finalWin, true);
    assert.equal(res.aNote, '蓝队 A级通关（胜方无末游，在自己的A级）');
    assert.match(res.aNote, /A级通关/);
    assert.equal(res.aTeam, 't1');
    assert.equal(res.winnerNewLevel, null);
    assert.equal(res.loserNewLevel, null);
    assert.deepEqual(res.aFailUpdates, {});
  });

  it('场景2：自己的A级回合、胜方含末游（strict）→ 不通关，计1次失败，停留在A', () => {
    const res = checkALevelRules(baseInput({ ranks: [1, 2, 6] }));
    assert.equal(res.finalWin, false);
    assert.equal(res.winnerNewLevel, 'A');
    assert.deepEqual(res.aFailUpdates, { t1: 1 });
    assert.equal(res.aNote, '蓝队 A级失败（在自己的A级胜方含末游）→ A1');
    assert.match(res.aNote, /A级失败/);
    assert.equal(res.aTeam, 't1');
  });

  it('场景3：对方回合（roundLevel:K, roundOwner:t2）含末游获胜 → 不计失败，aNote 含「不计」', () => {
    const res = checkALevelRules(baseInput({
      ranks: [1, 2, 6],
      roundOwner: 't2',
      roundLevel: 'K'
    }));
    assert.equal(res.finalWin, false);
    assert.deepEqual(res.aFailUpdates, {});
    assert.equal(res.aNote, '蓝队 在对方回合（红队的级）胜但含末游，不通关，但A失败不计');
    assert.match(res.aNote, /不计/);
    assert.equal(res.winnerNewLevel, 'A');
  });

  it('场景4：strict 下已累计2次失败再失败 → 第3次触发降级，winnerNewLevel:2，计数器重置为0', () => {
    const res = checkALevelRules(baseInput({
      ranks: [1, 2, 6],
      aFailCounts: { t1: 2, t2: 0 }
    }));
    assert.equal(res.finalWin, false);
    assert.equal(res.winnerNewLevel, '2');
    // deepEqual 锁死「仅该队重置」：t2 的计数器不得被波及
    assert.deepEqual(res.aFailUpdates, { t1: 0 });
    assert.equal(res.aNote, '蓝队 A级失败（在自己的A级胜方含末游）→ A3｜累计3次失败，仅该队重置到2');
    assert.match(res.aNote, /重置到2/);
  });

  it('场景4b：strict 下已累计1次失败再失败 → 计到2不降级（双侧钉死 >=3 阈值）', () => {
    const res = checkALevelRules(baseInput({
      ranks: [1, 2, 6],
      aFailCounts: { t1: 1, t2: 0 }
    }));
    assert.equal(res.finalWin, false);
    assert.equal(res.winnerNewLevel, 'A');
    assert.deepEqual(res.aFailUpdates, { t1: 2 });
    assert.equal(res.aNote, '蓝队 A级失败（在自己的A级胜方含末游）→ A2');
    assert.doesNotMatch(res.aNote, /重置到2/);
  });

  it('场景5：lenient（strictA:false）自己A回合含末游 → 不计数，aNote 含「继续打到通关」', () => {
    const res = checkALevelRules(baseInput({
      ranks: [1, 2, 6],
      strictA: false
    }));
    assert.equal(res.finalWin, false);
    assert.deepEqual(res.aFailUpdates, {});
    assert.equal(res.aNote, '蓝队 在自己的A级胜方含末游，不通关，继续打到通关');
    assert.match(res.aNote, /继续打到通关/);
    assert.equal(res.winnerNewLevel, 'A');
  });

  it('场景6a：A级队在自己的A回合败北（roundOwner 是输家）→ 输家计失败，loserNewLevel 保持 null', () => {
    // t2 获胜，t1（A级）是本回合 owner 且输了 → t1 计失败
    const res = checkALevelRules(baseInput({
      winnerKey: 't2',
      ranks: [1, 2, 3],
      teamLevels: { t1: 'A', t2: 'K' },
      roundOwner: 't1',
      roundLevel: 'A'
    }));
    assert.equal(res.finalWin, false);
    assert.equal(res.aTeam, 't1');
    assert.deepEqual(res.aFailUpdates, { t1: 1 });
    assert.equal(res.aNote, '蓝队 A级失败（在自己的A级未取胜）→ A1');
    // 未到3次：不降级，loserNewLevel 不设置
    assert.equal(res.loserNewLevel, null);
    assert.equal(res.winnerNewLevel, null);
  });

  it('场景6b：输家在自己的A回合第3次失败 → loserNewLevel:2，计数器重置为0', () => {
    const res = checkALevelRules(baseInput({
      winnerKey: 't2',
      ranks: [1, 2, 3],
      teamLevels: { t1: 'A', t2: 'K' },
      roundOwner: 't1',
      roundLevel: 'A',
      aFailCounts: { t1: 2, t2: 0 }
    }));
    assert.equal(res.finalWin, false);
    assert.equal(res.loserNewLevel, '2');
    assert.equal(res.aFailUpdates.t1, 0);
    assert.equal(res.aNote, '蓝队 A级失败（在自己的A级未取胜）→ A3｜累计3次失败，仅该队重置到2');
  });

  it('场景7：双方都在A级、roundOwner 是唯一权威 — t1 回合 t2 无末游获胜 → t2 不通关，t1 计失败', () => {
    const res = checkALevelRules(baseInput({
      winnerKey: 't2',
      ranks: [1, 2, 3],
      teamLevels: { t1: 'A', t2: 'A' },
      roundOwner: 't1',
      roundLevel: 'A'
    }));
    assert.equal(res.finalWin, false);
    assert.equal(res.winnerNewLevel, 'A'); // t2 停留在 A
    assert.equal(res.aTeam, 't1'); // 计失败的是回合主 t1
    assert.deepEqual(res.aFailUpdates, { t1: 1 });
    assert.equal(
      res.aNote,
      '红队 A级胜利（但在蓝队的回合，需在自己的A级获胜才能通关）｜蓝队 A级失败（在自己的A级未取胜）→ A1'
    );
  });

  it('场景8：双方都不在A级 → 返回形状只有 {aNote:"", finalWin:false} 两个字段', () => {
    const res = checkALevelRules(baseInput({
      teamLevels: { t1: '5', t2: 'K' }
    }));
    assert.deepEqual(res, { aNote: '', finalWin: false });
    assert.deepEqual(Object.keys(res).sort(), ['aNote', 'finalWin']);
  });

  it('场景9：mode 非法 → {aNote:"模式无效", finalWin:false, error:"invalid_mode"}', () => {
    const res = checkALevelRules(baseInput({ mode: '5' }));
    assert.deepEqual(res, {
      aNote: '模式无效',
      finalWin: false,
      aFailUpdates: {},
      error: 'invalid_mode'
    });
  });

  it('场景10：roundOwner:null（新开局首局）A级队含末游获胜、roundLevel 非 A → 不计失败，aNote 用「未定」指代回合归属', () => {
    const res = checkALevelRules(baseInput({
      ranks: [1, 2, 6],
      roundOwner: null,
      roundLevel: 'K'
    }));
    assert.equal(res.finalWin, false);
    assert.deepEqual(res.aFailUpdates, {});
    assert.equal(res.aNote, '蓝队 在对方回合（未定的级）胜但含末游，不通关，但A失败不计');
    assert.match(res.aNote, /未定/);
  });

  it('场景11：teamNames 缺省 → 使用默认 蓝队/红队', () => {
    const input = baseInput({ ranks: [1, 2, 3] });
    delete input.teamNames;
    const res = checkALevelRules(input);
    assert.equal(res.aNote, '蓝队 A级通关（胜方无末游，在自己的A级）');
    assert.deepEqual(DEFAULT_TEAM_NAMES, { t1: '蓝队', t2: '红队' });
  });

  it('场景12：roundLevel 非 A 但 winner 在 A 级且无末游获胜 → aNote 含「本局级牌为」，finalWin:false', () => {
    const res = checkALevelRules(baseInput({
      ranks: [1, 2, 3],
      roundOwner: 't2',
      roundLevel: 'K'
    }));
    assert.equal(res.finalWin, false);
    assert.equal(res.winnerNewLevel, 'A');
    assert.equal(res.aNote, '蓝队 A级胜利（但本局级牌为K，需在自己的A级获胜才能通关）');
    assert.match(res.aNote, /本局级牌为/);
  });

  describe('场景13：4人/8人模式末游名次判定（lastRank = 模式人数）', () => {
    it('4人模式：名次含4视为末游 → 自己A回合不通关并计失败', () => {
      const res = checkALevelRules(baseInput({ mode: '4', ranks: [1, 4] }));
      assert.equal(res.finalWin, false);
      assert.deepEqual(res.aFailUpdates, { t1: 1 });
      assert.match(res.aNote, /A级失败/);
    });

    it('4人模式：名次 [1,2] 无末游 → 自己A回合通关', () => {
      const res = checkALevelRules(baseInput({ mode: '4', ranks: [1, 2] }));
      assert.equal(res.finalWin, true);
      assert.match(res.aNote, /A级通关/);
    });

    it('8人模式：名次含8视为末游 → 自己A回合不通关并计失败', () => {
      const res = checkALevelRules(baseInput({ mode: '8', ranks: [1, 2, 3, 8] }));
      assert.equal(res.finalWin, false);
      assert.deepEqual(res.aFailUpdates, { t1: 1 });
      assert.match(res.aNote, /A级失败/);
    });

    it('8人模式：名次含6（6不是8人局末游）→ 自己A回合照常通关', () => {
      const res = checkALevelRules(baseInput({ mode: 8, ranks: [1, 2, 3, 6] }));
      assert.equal(res.finalWin, true);
      assert.match(res.aNote, /A级通关/);
    });
  });

  describe('审查补强：「仅自己回合计失败」输家侧 / 双A矩阵 / lenient 输家路径', () => {
    it('场景14：A级输家在对方回合败北（strict）→ 不计失败，aNote 含「A失败不计」', () => {
      // t1（K级）在自己的 K 回合获胜，t2 在 A 级但这不是 t2 的回合 → t2 不得计失败
      const res = checkALevelRules(baseInput({
        winnerKey: 't1',
        ranks: [1, 2, 3],
        teamLevels: { t1: 'K', t2: 'A' },
        roundOwner: 't1',
        roundLevel: 'K'
      }));
      assert.equal(res.finalWin, false);
      assert.deepEqual(res.aFailUpdates, {});
      assert.equal(res.loserNewLevel, null);
      assert.equal(res.aNote, '红队 在对方回合（蓝队的级）未胜，A失败不计');
    });

    it('场景14b：同局 lenient 变体 → 尾缀为空（tail 三元 false 分支）', () => {
      const res = checkALevelRules(baseInput({
        winnerKey: 't1',
        ranks: [1, 2, 3],
        teamLevels: { t1: 'K', t2: 'A' },
        roundOwner: 't1',
        roundLevel: 'K',
        strictA: false
      }));
      assert.deepEqual(res.aFailUpdates, {});
      assert.equal(res.aNote, '红队 在对方回合（蓝队的级）未胜');
    });

    it('场景15：双A、回合主自己干净通关 → finalWin:true 且对面不产生任何失败/注记污染', () => {
      const res = checkALevelRules(baseInput({
        winnerKey: 't1',
        ranks: [1, 2, 3],
        teamLevels: { t1: 'A', t2: 'A' },
        roundOwner: 't1',
        roundLevel: 'A'
      }));
      assert.equal(res.finalWin, true);
      assert.deepEqual(res.aFailUpdates, {});
      // aNote 只有通关一条 —— !finalWin 守卫必须短路输家侧注记
      assert.equal(res.aNote, '蓝队 A级通关（胜方无末游，在自己的A级）');
      assert.equal(res.aNote.includes('｜'), false);
    });

    it('场景16：双A、非回合主含末游获胜 → 赢家「胜但含末游」+ 回合主计失败 双注记拼接', () => {
      const res = checkALevelRules(baseInput({
        winnerKey: 't2',
        ranks: [1, 2, 6],
        teamLevels: { t1: 'A', t2: 'A' },
        roundOwner: 't1',
        roundLevel: 'A'
      }));
      assert.equal(res.finalWin, false);
      assert.deepEqual(res.aFailUpdates, { t1: 1 });
      assert.equal(
        res.aNote,
        '红队 在对方回合（蓝队的级）胜但含末游，不通关，但A失败不计｜蓝队 A级失败（在自己的A级未取胜）→ A1'
      );
      assert.equal(res.aTeam, 't1');
    });

    it('场景17：lenient 下 A级队在自己的A回合败北 → 不计数不降级，aNote 含「继续打到通关」', () => {
      const res = checkALevelRules(baseInput({
        winnerKey: 't2',
        ranks: [1, 2, 3],
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't1',
        roundLevel: 'A',
        strictA: false
      }));
      assert.equal(res.finalWin, false);
      assert.deepEqual(res.aFailUpdates, {});
      assert.equal(res.loserNewLevel, null);
      assert.equal(res.aNote, '蓝队 在自己的A级未取胜，不通关，继续打到通关');
    });
  });
});
