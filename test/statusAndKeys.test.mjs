// 覆盖 gameStatus.js / voteSessionKey.js / ruleConfig.js（+ roomSnapshotValidation.js 抽查）
// 被测代码为 vendor 自 web 版的纯 ESM 模块，断言基于源码实际行为契约。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  openGameStatus,
  getHistoryEntries,
  isClearingANote,
  deriveGameStatusFromHistory,
  resolveGameStatus
} from '../miniprogram/shared-logic/gameStatus.js';
import {
  deriveVoteSessionKey,
  deriveGameSessionKey,
  deriveVoteProfileHistoryKey
} from '../miniprogram/shared-logic/voteSessionKey.js';
import {
  DEFAULT_RULES,
  sanitizeRulesConfig,
  isValidRuleSettings
} from '../miniprogram/shared-logic/ruleConfig.js';
import {
  isValidRoomSnapshotPayload
} from '../miniprogram/shared-logic/roomSnapshotValidation.js';

const OPEN_STATUS = {
  ended: false,
  winnerKey: null,
  winnerName: null,
  reason: null
};

describe('gameStatus.openGameStatus', () => {
  it('返回未结束状态的标准形状（四个字段，全空值）', () => {
    assert.deepEqual(openGameStatus(), OPEN_STATUS);
  });

  it('每次调用返回新对象，互不共享引用', () => {
    const a = openGameStatus();
    const b = openGameStatus();
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });
});

describe('gameStatus.getHistoryEntries', () => {
  it('直接传数组时原样返回同一引用', () => {
    const history = [{ winKey: 't1' }];
    assert.equal(getHistoryEntries(history), history);
  });

  it('传 { history: [...] } 时返回其 history 数组', () => {
    const history = [{ winKey: 't2' }];
    assert.equal(getHistoryEntries({ history }), history);
  });

  it('传 { hist: [...] } 时返回其 hist 数组（旧字段名兼容）', () => {
    const hist = [{ winKey: 't1' }];
    assert.equal(getHistoryEntries({ hist }), hist);
  });

  it('history 与 hist 同时存在时 history 优先', () => {
    const history = [{ id: 'new' }];
    const hist = [{ id: 'old' }];
    assert.equal(getHistoryEntries({ history, hist }), history);
  });

  it('垃圾输入（null/字符串/数字/空对象/非数组字段）一律返回空数组', () => {
    assert.deepEqual(getHistoryEntries(null), []);
    assert.deepEqual(getHistoryEntries(undefined), []);
    assert.deepEqual(getHistoryEntries('history'), []);
    assert.deepEqual(getHistoryEntries(42), []);
    assert.deepEqual(getHistoryEntries({}), []);
    assert.deepEqual(getHistoryEntries({ history: 'not-an-array', hist: 7 }), []);
  });
});

describe('gameStatus.isClearingANote', () => {
  it('同时包含「A级通关」与「在自己的A级」时判定为通关', () => {
    assert.equal(isClearingANote('本局A级通关！队伍在自己的A级头游获胜'), true);
  });

  it('包含「不通关」时即使有通关字样也判定为否', () => {
    assert.equal(isClearingANote('A级通关判定：在自己的A级，但本局不通关'), false);
  });

  it('包含「未通关」时判定为否', () => {
    assert.equal(isClearingANote('A级通关检查：在自己的A级，结果未通关'), false);
  });

  it('包含「不能通关」时判定为否', () => {
    assert.equal(isClearingANote('A级通关条件：在自己的A级，第三次失败不能通关'), false);
  });

  it('只含「A级通关」缺「在自己的A级」判定为否', () => {
    assert.equal(isClearingANote('A级通关'), false);
  });

  it('非字符串输入（null/数字/对象/undefined）一律为否', () => {
    assert.equal(isClearingANote(null), false);
    assert.equal(isClearingANote(undefined), false);
    assert.equal(isClearingANote(123), false);
    assert.equal(isClearingANote({ aNote: 'A级通关 在自己的A级' }), false);
  });
});

describe('gameStatus.deriveGameStatusFromHistory', () => {
  it('空历史返回 open 状态', () => {
    assert.deepEqual(deriveGameStatusFromHistory([]), OPEN_STATUS);
    assert.deepEqual(deriveGameStatusFromHistory(undefined), OPEN_STATUS);
  });

  it('最后一局带 structured gameStatus(ended) 时返回完成态，且字符串字段被 trim', () => {
    const history = [{
      gameStatus: {
        ended: true,
        winnerKey: 't1',
        winnerName: '  红队  ',
        reason: '  CUSTOM_REASON  '
      }
    }];
    assert.deepEqual(deriveGameStatusFromHistory(history), {
      ended: true,
      winnerKey: 't1',
      winnerName: '红队',
      reason: 'CUSTOM_REASON'
    });
  });

  it('structured gameStatus 缺 reason 时默认补 A_LEVEL_CLEARED', () => {
    const history = [{
      gameStatus: { ended: true, winnerKey: 't2', winnerName: '蓝队' }
    }];
    assert.deepEqual(deriveGameStatusFromHistory(history), {
      ended: true,
      winnerKey: 't2',
      winnerName: '蓝队',
      reason: 'A_LEVEL_CLEARED'
    });
  });

  it('legacy aNote 通关 + 合法 winKey 时返回完成态', () => {
    const history = [{
      aNote: '本局A级通关，在自己的A级取胜',
      winKey: 't2',
      win: '蓝队'
    }];
    assert.deepEqual(deriveGameStatusFromHistory(history), {
      ended: true,
      winnerKey: 't2',
      winnerName: '蓝队',
      reason: 'A_LEVEL_CLEARED'
    });
  });

  it('aNote 通关但 winKey 非法时回退为 open', () => {
    const history = [{
      aNote: '本局A级通关，在自己的A级取胜',
      winKey: 'team-red',
      win: '红队'
    }];
    assert.deepEqual(deriveGameStatusFromHistory(history), OPEN_STATUS);
  });

  it('只看最后一局：前面有完成局但最后一局未完成时返回 open', () => {
    const history = [
      { gameStatus: { ended: true, winnerKey: 't1' }, winKey: 't1' },
      { winKey: 't2' }
    ];
    assert.deepEqual(deriveGameStatusFromHistory(history), OPEN_STATUS);
  });
});

describe('gameStatus.resolveGameStatus', () => {
  it('structured status 完整时直接采用（含自定义 reason）', () => {
    const result = resolveGameStatus(
      { ended: true, winnerKey: 't1', winnerName: '红队', reason: 'FORFEIT' },
      []
    );
    assert.deepEqual(result, {
      ended: true,
      winnerKey: 't1',
      winnerName: '红队',
      reason: 'FORFEIT'
    });
  });

  it('status 与 history 最新局 winner 冲突时以 history 为准', () => {
    const history = [{
      gameStatus: { ended: true, winnerKey: 't2', winnerName: '蓝队' },
      winKey: 't2',
      win: '蓝队'
    }];
    const result = resolveGameStatus({ ended: true, winnerKey: 't1' }, history);
    assert.deepEqual(result, {
      ended: true,
      winnerKey: 't2',
      winnerName: '蓝队',
      reason: 'A_LEVEL_CLEARED'
    });
  });

  it('status 无 winnerKey 时从 history 最新完成局兜底 winnerKey 与 winnerName', () => {
    const history = [{
      aNote: '本局A级通关，在自己的A级头游',
      winKey: 't1',
      win: '红队'
    }];
    const result = resolveGameStatus({ ended: true }, history);
    assert.deepEqual(result, {
      ended: true,
      winnerKey: 't1',
      winnerName: '红队',
      reason: 'A_LEVEL_CLEARED'
    });
  });

  it('status 无 winnerKey 且 history 也无法兜底时返回 open', () => {
    assert.deepEqual(resolveGameStatus({ ended: true }, []), OPEN_STATUS);
  });

  it('status 与 history 均未结束时返回 open', () => {
    assert.deepEqual(resolveGameStatus(undefined, []), OPEN_STATUS);
    assert.deepEqual(resolveGameStatus({ ended: false }, [{ winKey: 't1' }]), OPEN_STATUS);
  });
});

describe('voteSessionKey.deriveVoteSessionKey', () => {
  it('对局未结束时返回 null', () => {
    assert.equal(deriveVoteSessionKey({
      roomCode: 'ABCD',
      gameStatus: { ended: false },
      history: []
    }), null);
  });

  it('roomCode 为空/空白时返回 null', () => {
    const ended = { ended: true, winnerKey: 't1' };
    assert.equal(deriveVoteSessionKey({ roomCode: '', gameStatus: ended, history: [] }), null);
    assert.equal(deriveVoteSessionKey({ roomCode: '   ', gameStatus: ended, history: [] }), null);
    assert.equal(deriveVoteSessionKey({ gameStatus: ended, history: [] }), null);
    assert.equal(deriveVoteSessionKey(), null);
  });

  it('key 格式为 roomCode:vote:历史长度:winnerKey:endedAt:voteEpoch，各段 encodeURIComponent', () => {
    const key = deriveVoteSessionKey({
      roomCode: 'AB12',
      gameStatus: { ended: true, winnerKey: 't1' },
      history: [{ winKey: 't1', gameEndedAt: '2026-06-11T10:00:00Z' }],
      finishedAt: '2026-06-10T09:00:00Z',
      endGameVotesHistory: [{}, {}]
    });
    // gameEndedAt 优先于 finishedAt；冒号被编码为 %3A
    assert.equal(key, 'AB12:vote:1:t1:2026-06-11T10%3A00%3A00Z:2');
  });

  it('roomCode 大小写归一并 trim（小写带空白 → 大写）', () => {
    const key = deriveVoteSessionKey({
      roomCode: '  ab12 ',
      gameStatus: { ended: true, winnerKey: 't2' },
      history: []
    });
    assert.equal(key, 'AB12:vote:0:t2:ended:0');
  });

  it('无 gameEndedAt/finishedAt/ts 时 endedAt 段回退为字面量 ended，voteEpoch 非数组按 0 计', () => {
    const key = deriveVoteSessionKey({
      roomCode: 'R1',
      gameStatus: { ended: true, winnerKey: 't1' },
      history: [],
      endGameVotesHistory: 'not-an-array'
    });
    assert.equal(key, 'R1:vote:0:t1:ended:0');
  });
});

describe('voteSessionKey.deriveGameSessionKey', () => {
  it('对局未结束时返回 null', () => {
    assert.equal(deriveGameSessionKey({
      roomCode: 'ABCD',
      gameStatus: { ended: false },
      history: []
    }), null);
  });

  it('roomCode 为空时返回 null', () => {
    assert.equal(deriveGameSessionKey({
      roomCode: '  ',
      gameStatus: { ended: true, winnerKey: 't1' },
      history: []
    }), null);
  });

  it('key 格式为 roomCode:game:历史长度:winnerKey:endedAt，五段且无 voteEpoch', () => {
    const key = deriveGameSessionKey({
      roomCode: 'ab12',
      gameStatus: { ended: true, winnerKey: 't1' },
      history: [{ winKey: 't1', gameEndedAt: '2026-06-11T10:00:00Z' }],
      finishedAt: '2026-06-10T09:00:00Z'
    });
    assert.equal(key, 'AB12:game:1:t1:2026-06-11T10%3A00%3A00Z');
    // endedAt 内的冒号已编码为 %3A，整 key 按字面冒号切分恰好 5 段
    assert.equal(key.split(':').length, 5);
  });

  it('history 缺 gameEndedAt 时 endedAt 回退到 finishedAt', () => {
    const key = deriveGameSessionKey({
      roomCode: 'R2',
      gameStatus: { ended: true, winnerKey: 't2' },
      history: [{ winKey: 't2' }],
      finishedAt: '20260611'
    });
    assert.equal(key, 'R2:game:1:t2:20260611');
  });
});

describe('voteSessionKey.deriveVoteProfileHistoryKey — epoch-0 向后兼容', () => {
  const room = {
    state: {
      gameStatus: { ended: true, winnerKey: 't1' },
      history: []
    },
    finishedAt: 'F1'
  };
  const expectedSessionKey = 'ABCD:vote:0:t1:F1:0';

  it('epoch 0 且 votingHistory 仅有裸 roomCode 键时返回裸 roomCode', () => {
    const result = deriveVoteProfileHistoryKey('abcd', room, { ABCD: { count: 1 } });
    assert.equal(result, 'ABCD');
  });

  it('votingHistory 为空时返回完整 sessionKey', () => {
    const result = deriveVoteProfileHistoryKey('abcd', room, {});
    assert.equal(result, expectedSessionKey);
  });

  it('votingHistory 同时含裸 roomCode 与 sessionKey 时返回 sessionKey（不再走兼容分支）', () => {
    const votingHistory = { ABCD: 1, [expectedSessionKey]: 1 };
    assert.equal(deriveVoteProfileHistoryKey('abcd', room, votingHistory), expectedSessionKey);
  });

  it('voteEpoch > 0 时即使有裸 roomCode 键也返回新 sessionKey', () => {
    const roomEpoch1 = { ...room, endGameVotesHistory: [{}] };
    const result = deriveVoteProfileHistoryKey('abcd', roomEpoch1, { ABCD: 1 });
    assert.equal(result, 'ABCD:vote:0:t1:F1:1');
  });

  it('room 无法导出 sessionKey 时回退 fallbackSessionKey，再回退归一化 roomCode', () => {
    assert.equal(deriveVoteProfileHistoryKey('abcd', null, {}, 'FALLBACK-KEY'), 'FALLBACK-KEY');
    assert.equal(deriveVoteProfileHistoryKey('abcd', null, {}), 'ABCD');
  });
});

describe('ruleConfig.sanitizeRulesConfig', () => {
  it('空入参（undefined/{}）返回与 DEFAULT_RULES 等值的新配置', () => {
    assert.deepEqual(sanitizeRulesConfig(), DEFAULT_RULES);
    assert.deepEqual(sanitizeRulesConfig({}), DEFAULT_RULES);
    assert.notEqual(sanitizeRulesConfig(), DEFAULT_RULES); // 不是同一引用
  });

  it('非对象入参（null/字符串/数组）也返回默认配置', () => {
    assert.deepEqual(sanitizeRulesConfig(null), DEFAULT_RULES);
    assert.deepEqual(sanitizeRulesConfig('garbage'), DEFAULT_RULES);
    assert.deepEqual(sanitizeRulesConfig([1, 2]), DEFAULT_RULES);
  });

  it('字符串数字归一为整数', () => {
    const result = sanitizeRulesConfig({ c4: { '1,2': '5' }, t6: { g3: '0' } });
    assert.equal(result.c4['1,2'], 5);
    assert.equal(result.t6.g3, 0);
    // 未提供的键保持默认
    assert.equal(result.c4['1,3'], 2);
  });

  it('负数/非整数/非数字字符串回退为对应默认值', () => {
    const result = sanitizeRulesConfig({
      t6: { g3: -1, g2: 3.5, g1: 'abc' },
      p6: { 1: '  ' }
    });
    assert.equal(result.t6.g3, DEFAULT_RULES.t6.g3); // 7
    assert.equal(result.t6.g2, DEFAULT_RULES.t6.g2); // 4
    assert.equal(result.t6.g1, DEFAULT_RULES.t6.g1); // 1
    assert.equal(result.p6['1'], DEFAULT_RULES.p6['1']); // 5
  });

  it('多余 section 与 section 内多余 key 全部丢弃', () => {
    const result = sanitizeRulesConfig({
      c4: { '1,2': 9, bogus: 99 },
      extraSection: { x: 1 }
    });
    assert.deepEqual(Object.keys(result).sort(), ['c4', 'p6', 'p8', 't6', 't8']);
    assert.deepEqual(Object.keys(result.c4).sort(), ['1,2', '1,3', '1,4']);
    assert.equal(result.c4['1,2'], 9);
    assert.equal('extraSection' in result, false);
  });
});

describe('ruleConfig.isValidRuleSettings', () => {
  it('undefined 视为合法（无规则覆盖）', () => {
    assert.equal(isValidRuleSettings(undefined), true);
  });

  it('非对象（null/字符串/数字/数组）一律非法', () => {
    assert.equal(isValidRuleSettings(null), false);
    assert.equal(isValidRuleSettings('c4'), false);
    assert.equal(isValidRuleSettings(42), false);
    assert.equal(isValidRuleSettings([]), false);
  });

  it('已知 section 内出现未知 key 时非法', () => {
    assert.equal(isValidRuleSettings({ c4: { '1,2': 3, bogus: 1 } }), false);
    assert.equal(isValidRuleSettings({ t6: { g4: 1 } }), false);
  });

  it('section 值不是普通对象时非法', () => {
    assert.equal(isValidRuleSettings({ c4: 'x' }), false);
    assert.equal(isValidRuleSettings({ p8: [0, 1] }), false);
  });

  it('合法部分配置（只覆盖部分 section/key）为 true', () => {
    assert.equal(isValidRuleSettings({ c4: { '1,2': 5 } }), true);
    assert.equal(isValidRuleSettings({ p8: { 1: 0, 8: 0 }, t8: { g3: 12 } }), true);
    assert.equal(isValidRuleSettings({}), true);
  });

  it('已知 section 外的顶层 key 被忽略（settings 对象与团队/偏好设置共存的设计）', () => {
    assert.equal(isValidRuleSettings({ must1: true, t1: { name: '红队' } }), true);
  });

  it('值为负数/小数/字符串数字时非法（不做归一，严格整数校验）', () => {
    assert.equal(isValidRuleSettings({ c4: { '1,2': -1 } }), false);
    assert.equal(isValidRuleSettings({ c4: { '1,2': 3.5 } }), false);
    assert.equal(isValidRuleSettings({ c4: { '1,2': '5' } }), false);
  });
});

describe('roomSnapshotValidation.isValidRoomSnapshotPayload（抽查）', () => {
  const minimalSnapshot = {
    settings: {},
    state: {
      teams: {
        t1: { lvl: '2', aFail: 0 },
        t2: { lvl: '2', aFail: 0 }
      },
      roundLevel: '2',
      history: []
    },
    players: [
      { id: 1, name: '甲', team: 1 },
      { id: 2, name: '乙', team: 2 }
    ]
  };

  it('最小合法 snapshot（teams 等级 + 玩家列表）通过校验', () => {
    assert.equal(isValidRoomSnapshotPayload(minimalSnapshot), true);
  });

  it('空对象也是合法 snapshot（所有字段均可选）', () => {
    assert.equal(isValidRoomSnapshotPayload({}), true);
  });

  it('非对象输入非法', () => {
    assert.equal(isValidRoomSnapshotPayload(null), false);
    assert.equal(isValidRoomSnapshotPayload([]), false);
    assert.equal(isValidRoomSnapshotPayload('snapshot'), false);
  });

  it('非法队伍等级（lvl 不在 2..A）非法', () => {
    const bad = {
      ...minimalSnapshot,
      state: {
        ...minimalSnapshot.state,
        teams: { t1: { lvl: '1' }, t2: { lvl: '2' } }
      }
    };
    assert.equal(isValidRoomSnapshotPayload(bad), false);
  });

  it('玩家 id 重复非法', () => {
    const bad = {
      ...minimalSnapshot,
      players: [{ id: 1 }, { id: 1 }]
    };
    assert.equal(isValidRoomSnapshotPayload(bad), false);
  });

  it('gameStatus 声称结束但无法解析出合法 winnerKey 时非法', () => {
    const bad = {
      ...minimalSnapshot,
      state: { ...minimalSnapshot.state, gameStatus: { ended: true } }
    };
    assert.equal(isValidRoomSnapshotPayload(bad), false);
  });

  it('settings.t1.color 非法 hex 时非法', () => {
    const bad = {
      ...minimalSnapshot,
      settings: { t1: { color: 'red' } }
    };
    assert.equal(isValidRoomSnapshotPayload(bad), false);
  });

  it('playerStats 有玩家条目但缺 players 列表时非法', () => {
    const bad = {
      playerStats: { 1: { games: 1, totalRank: 1 } }
    };
    assert.equal(isValidRoomSnapshotPayload(bad), false);
  });
});
