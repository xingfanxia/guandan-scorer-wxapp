// test/achievements.test.mjs
// 覆盖 miniprogram/shared-logic/achievementLogic.js + honorCatalog.js
// 仅用 node:test + node:assert/strict，零第三方依赖。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_COUNT,
  checkAchievements,
  countDistinctProfileRelations,
  getNewAchievements
} from '../miniprogram/shared-logic/achievementLogic.js';
import {
  CURRENT_HONOR_COUNT,
  CURRENT_HONOR_TITLES,
  HONOR_TITLES_BY_KEY,
  canonicalizeHonorTitle,
  countCurrentHonors,
  createHonorCounter,
  normalizeHonorCounter
} from '../miniprogram/shared-logic/honorCatalog.js';

/** 用现行荣誉表前 n 个标题构造 honors 计数对象（每个 1 次） */
function honorsWithDistinct(n) {
  return Object.fromEntries(CURRENT_HONOR_TITLES.slice(0, n).map(title => [title, 1]));
}

/** 构造 n 个互不相同的关系条目 { p1: {games:1}, ... } */
function relations(prefix, n) {
  const map = {};
  for (let i = 1; i <= n; i++) map[`${prefix}${i}`] = { games: 1 };
  return map;
}

describe('checkAchievements — 里程碑阈值', () => {
  it('0 场什么都不给', () => {
    assert.deepEqual(checkAchievements({ sessionsPlayed: 0 }), []);
  });

  it('1 场只给 newbie', () => {
    assert.deepEqual(checkAchievements({ sessionsPlayed: 1 }), ['newbie']);
  });

  it('9 场仍只有 newbie（started 边界外）', () => {
    assert.deepEqual(checkAchievements({ sessionsPlayed: 9 }), ['newbie']);
  });

  it('10 场给 newbie + started', () => {
    assert.deepEqual(checkAchievements({ sessionsPlayed: 10 }), ['newbie', 'started']);
  });

  it('99 场不给 veteran，100 场给', () => {
    assert.deepEqual(checkAchievements({ sessionsPlayed: 99 }), ['newbie', 'started']);
    assert.deepEqual(checkAchievements({ sessionsPlayed: 100 }), ['newbie', 'started', 'veteran']);
  });

  it('999 场不给 legend，1000 场四个里程碑全给', () => {
    assert.deepEqual(checkAchievements({ sessionsPlayed: 999 }), ['newbie', 'started', 'veteran']);
    assert.deepEqual(
      checkAchievements({ sessionsPlayed: 1000 }),
      ['newbie', 'started', 'veteran', 'legend']
    );
  });

  it('legacy 字段 gamesPlayed 作为 sessionsPlayed 的回退', () => {
    assert.deepEqual(checkAchievements({ gamesPlayed: 10 }), ['newbie', 'started']);
  });

  it('sessionsPlayed 优先于 gamesPlayed（?? 链顺序）', () => {
    assert.deepEqual(
      checkAchievements({ sessionsPlayed: 1, gamesPlayed: 100 }),
      ['newbie']
    );
  });
});

describe('checkAchievements — 首胜与连胜', () => {
  it('sessionsWon >= 1 给 first_win', () => {
    assert.deepEqual(
      checkAchievements({ sessionsPlayed: 1, sessionsWon: 1 }),
      ['newbie', 'first_win']
    );
  });

  it('legacy 字段 wins 作为 sessionsWon 的回退', () => {
    assert.deepEqual(checkAchievements({ wins: 1 }), ['first_win']);
  });

  it('连胜 4 不给，5 给 streak_5，10 给 streak_5 + streak_10', () => {
    assert.deepEqual(checkAchievements({ longestWinStreak: 4 }), []);
    assert.deepEqual(checkAchievements({ longestWinStreak: 5 }), ['streak_5']);
    assert.deepEqual(checkAchievements({ longestWinStreak: 10 }), ['streak_5', 'streak_10']);
  });
});

describe('checkAchievements — champion（20 场 + 70% 胜率）', () => {
  it('恰好 20 场且胜率恰好 0.7 才给 champion', () => {
    assert.deepEqual(
      checkAchievements({ sessionsPlayed: 20, sessionsWon: 14, sessionWinRate: 0.7 }),
      ['newbie', 'started', 'first_win', 'champion']
    );
  });

  it('19 场即使全胜也不给（场次差一点）', () => {
    assert.deepEqual(
      checkAchievements({ sessionsPlayed: 19, sessionsWon: 19, sessionWinRate: 1 }),
      ['newbie', 'started', 'first_win']
    );
  });

  it('20 场胜率 0.699 不给（胜率差一点）', () => {
    assert.deepEqual(
      checkAchievements({ sessionsPlayed: 20, sessionsWon: 13, sessionWinRate: 0.699 }),
      ['newbie', 'started', 'first_win']
    );
  });

  it('legacy 字段 winRate 作为 sessionWinRate 的回退', () => {
    const earned = checkAchievements({ gamesPlayed: 20, wins: 14, winRate: 0.7 });
    assert.equal(earned.includes('champion'), true);
  });
});

describe('checkAchievements — 荣誉收藏类', () => {
  it('4 种不同荣誉不给 honor_5', () => {
    assert.deepEqual(checkAchievements({ honors: honorsWithDistinct(4) }), []);
  });

  it('5 种不同荣誉给 honor_5（不给 honor_10）', () => {
    assert.deepEqual(checkAchievements({ honors: honorsWithDistinct(5) }), ['honor_5']);
  });

  it('10 种不同荣誉给 honor_5 + honor_10', () => {
    assert.deepEqual(
      checkAchievements({ honors: honorsWithDistinct(10) }),
      ['honor_5', 'honor_10']
    );
  });

  it('集齐全部 CURRENT_HONOR_COUNT 种荣誉给 honor_all', () => {
    assert.deepEqual(
      checkAchievements({ honors: honorsWithDistinct(CURRENT_HONOR_COUNT) }),
      ['honor_5', 'honor_10', 'honor_all']
    );
  });

  it('差一种不给 honor_all', () => {
    assert.deepEqual(
      checkAchievements({ honors: honorsWithDistinct(CURRENT_HONOR_COUNT - 1) }),
      ['honor_5', 'honor_10']
    );
  });

  it('legacy 荣誉名经 normalize 后也计入不同荣誉数（6 个旧名 → honor_5）', () => {
    const legacyHonors = { 小丑: 1, 连胜王: 1, 佛系玩家: 1, 鲤鱼王: 1, 不粘锅: 1, 闪电侠: 1 };
    assert.deepEqual(checkAchievements({ honors: legacyHonors }), ['honor_5']);
  });

  it('吕布 9 次不给 lubu_10，10 次给', () => {
    const mvp = HONOR_TITLES_BY_KEY.mvp;
    assert.equal(mvp, '吕布');
    assert.deepEqual(checkAchievements({ honors: { [mvp]: 9 } }), []);
    assert.deepEqual(checkAchievements({ honors: { [mvp]: 10 } }), ['lubu_10']);
  });
});

describe('checkAchievements — social_butterfly（20+ 不同关系）', () => {
  it('partners 12 + opponents 8 = 20 个不同关系 → 给', () => {
    const stats = { partners: relations('p', 12), opponents: relations('o', 8) };
    assert.deepEqual(checkAchievements(stats), ['social_butterfly']);
  });

  it('19 个不同关系不给', () => {
    const stats = { partners: relations('p', 12), opponents: relations('o', 7) };
    assert.deepEqual(checkAchievements(stats), []);
  });

  it('partners 与 opponents 中同名（含大小写差异）只算一个人', () => {
    // partners 19 人 + opponents 中 1 个大小写变体 → 仍是 19，不给
    const partners = relations('p', 18);
    partners.Shared = { games: 3 };
    const opponents = { SHARED: { games: 2 } };
    assert.deepEqual(
      checkAchievements({ partners, opponents }),
      []
    );
    // 换成真正的第 20 人 → 给
    const opponents2 = { brandnew: { games: 2 } };
    assert.deepEqual(
      checkAchievements({ partners: { ...partners, another: { games: 1 } }, opponents: opponents2 }),
      ['social_butterfly']
    );
  });
});

describe('checkAchievements — lastSession 类成就', () => {
  it('不传 lastSession 时不评定任何单场成就', () => {
    assert.deepEqual(checkAchievements({}), []);
    assert.deepEqual(checkAchievements({}, null), []);
  });

  it('marathon：50 轮不给，51 轮给', () => {
    assert.deepEqual(checkAchievements({}, { gamesInSession: 50, ranking: 3 }), []);
    assert.deepEqual(checkAchievements({}, { gamesInSession: 51, ranking: 3 }), ['marathon']);
  });

  it('quick_finish：14 轮且获胜给；15 轮获胜不给；14 轮未胜不给', () => {
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 14, teamWon: true, ranking: 3 }),
      ['quick_finish']
    );
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 15, teamWon: true, ranking: 3 }),
      []
    );
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 14, teamWon: false, ranking: 3 }),
      []
    );
  });

  it('perfect：场均排名 1.5 给，1.51 不给', () => {
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 20, ranking: 1.5 }),
      ['perfect']
    );
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 20, ranking: 1.51 }),
      []
    );
  });

  it('perfect：lastSession 缺 ranking 时按 999 处理，不给', () => {
    assert.deepEqual(checkAchievements({}, { gamesInSession: 20 }), []);
  });

  it('unlucky：5 次垫底且获胜给；4 次不给；5 次未胜不给', () => {
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 30, ranking: 3, lastPlaces: 5, teamWon: true }),
      ['unlucky']
    );
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 30, ranking: 3, lastPlaces: 4, teamWon: true }),
      []
    );
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 30, ranking: 3, lastPlaces: 5, teamWon: false }),
      []
    );
  });

  it('单场多成就可同时给（14 轮获胜 + 场均 1.2 + 5 次垫底）', () => {
    assert.deepEqual(
      checkAchievements({}, { gamesInSession: 14, teamWon: true, ranking: 1.2, lastPlaces: 5 }),
      ['quick_finish', 'perfect', 'unlucky']
    );
  });
});

describe('countDistinctProfileRelations — 安全键与清洗', () => {
  it('__proto__ / constructor / prototype 键被拒绝', () => {
    const partners = {
      ['__proto__']: { games: 5 },
      constructor: { games: 5 },
      prototype: { games: 5 },
      alice: { games: 2 }
    };
    assert.equal(countDistinctProfileRelations({ partners }), 1);
  });

  it('大小写/前后空白变体的危险键同样被拒绝', () => {
    const partners = {
      ' __PROTO__ ': { games: 5 },
      CONSTRUCTOR: { games: 5 },
      ' Prototype': { games: 5 }
    };
    assert.equal(countDistinctProfileRelations({ partners }), 0);
  });

  it('空白键被拒绝', () => {
    assert.equal(countDistinctProfileRelations({ partners: { '   ': { games: 3 } } }), 0);
  });

  it('games <= 0 / NaN / 缺失 / 非对象值不计入；数字字符串 games 计入', () => {
    const partners = {
      zero: { games: 0 },
      negative: { games: -3 },
      nan: { games: NaN },
      junk: { games: 'abc' },
      missing: {},
      nul: null,
      str: 'not-an-object',
      numericString: { games: '3' },
      valid: { games: 2 }
    };
    assert.equal(countDistinctProfileRelations({ partners }), 2);
  });

  it('大小写归一去重：Alice / ALICE / alice 算一个人', () => {
    const stats = {
      partners: { Alice: { games: 1 }, ALICE: { games: 1 } },
      opponents: { alice: { games: 4 } }
    };
    assert.equal(countDistinctProfileRelations(stats), 1);
  });

  it('partners 与 opponents 合并去重', () => {
    const stats = {
      partners: { a: { games: 1 }, b: { games: 1 } },
      opponents: { b: { games: 1 }, c: { games: 1 } }
    };
    assert.equal(countDistinctProfileRelations(stats), 3);
  });

  it('无参 / 缺关系表 / 关系表非对象时返回 0', () => {
    assert.equal(countDistinctProfileRelations(), 0);
    assert.equal(countDistinctProfileRelations({}), 0);
    assert.equal(countDistinctProfileRelations({ partners: 'oops', opponents: 42 }), 0);
  });
});

describe('getNewAchievements — 差集行为', () => {
  it('返回 new 中不在 old 里的项，保持 new 的顺序', () => {
    assert.deepEqual(
      getNewAchievements(['newbie', 'first_win'], ['newbie', 'streak_5', 'first_win', 'champion']),
      ['streak_5', 'champion']
    );
  });

  it('old 为空时返回完整 new', () => {
    assert.deepEqual(getNewAchievements([], ['newbie']), ['newbie']);
  });

  it('完全相同时返回空数组', () => {
    assert.deepEqual(getNewAchievements(['a', 'b'], ['a', 'b']), []);
  });

  it('old 非数组（null / 字符串）按空集处理', () => {
    assert.deepEqual(getNewAchievements(null, ['x']), ['x']);
    assert.deepEqual(getNewAchievements('garbage', ['x', 'y']), ['x', 'y']);
  });

  it('new 非数组按空数组处理', () => {
    assert.deepEqual(getNewAchievements(['x'], null), []);
    assert.deepEqual(getNewAchievements(['x'], 'garbage'), []);
  });

  it('双默认参数返回空数组', () => {
    assert.deepEqual(getNewAchievements(), []);
  });
});

describe('normalizeHonorCounter — legacy 迁移与清洗', () => {
  it('无参调用等价于全零计数器', () => {
    assert.deepEqual(normalizeHonorCounter(), createHonorCounter());
  });

  it('六个 legacy 别名各自迁移到现行名', () => {
    const result = normalizeHonorCounter({
      小丑: 1, 连胜王: 2, 佛系玩家: 3, 鲤鱼王: 4, 不粘锅: 5, 闪电侠: 6
    });
    assert.equal(result['抗压王'], 1);
    assert.equal(result['连段王'], 2);
    assert.equal(result['团队中轴'], 3);
    assert.equal(result['逆转核心'], 4);
    assert.equal(result['保底核心'], 5);
    assert.equal(result['节奏核心'], 6);
  });

  it('新旧名并存时相加（抗压王 2 + 小丑 3 = 5）', () => {
    const result = normalizeHonorCounter({ 抗压王: 2, 小丑: 3 });
    assert.equal(result['抗压王'], 5);
  });

  it('负数 / NaN / Infinity 清洗为 0', () => {
    const result = normalizeHonorCounter({ 吕布: -4, 阿斗: NaN, 石佛: Infinity, 波动王: 'abc' });
    assert.equal(result['吕布'], 0);
    assert.equal(result['阿斗'], 0);
    assert.equal(result['石佛'], 0);
    assert.equal(result['波动王'], 0);
  });

  it('legacy 负数被钳到 0，不会抵扣现行计数', () => {
    const result = normalizeHonorCounter({ 抗压王: 2, 小丑: -5 });
    assert.equal(result['抗压王'], 2);
  });

  it('数字字符串按数值解析', () => {
    const result = normalizeHonorCounter({ 吕布: '3' });
    assert.equal(result['吕布'], 3);
  });

  it('未知键被丢弃，输出键集恰为 16 个现行荣誉名', () => {
    const result = normalizeHonorCounter({ 不存在的荣誉: 9, 吕布: 1 });
    assert.deepEqual(Object.keys(result).sort(), [...CURRENT_HONOR_TITLES].sort());
    assert.equal(Object.keys(result).length, CURRENT_HONOR_COUNT);
    assert.equal(result['吕布'], 1);
    assert.equal('不存在的荣誉' in result, false);
  });
});

describe('canonicalizeHonorTitle', () => {
  it('现行名直通返回自身', () => {
    assert.equal(canonicalizeHonorTitle('吕布'), '吕布');
    assert.equal(canonicalizeHonorTitle('抗压王'), '抗压王');
  });

  it('legacy 名映射到现行名', () => {
    assert.equal(canonicalizeHonorTitle('小丑'), '抗压王');
    assert.equal(canonicalizeHonorTitle('连胜王'), '连段王');
    assert.equal(canonicalizeHonorTitle('佛系玩家'), '团队中轴');
    assert.equal(canonicalizeHonorTitle('鲤鱼王'), '逆转核心');
    assert.equal(canonicalizeHonorTitle('不粘锅'), '保底核心');
    assert.equal(canonicalizeHonorTitle('闪电侠'), '节奏核心');
  });

  it('未知名 / 非字符串 / 原型链键返回 null', () => {
    assert.equal(canonicalizeHonorTitle('不存在的'), null);
    assert.equal(canonicalizeHonorTitle(42), null);
    assert.equal(canonicalizeHonorTitle(null), null);
    assert.equal(canonicalizeHonorTitle('toString'), null);
    assert.equal(canonicalizeHonorTitle('__proto__'), null);
  });
});

describe('createHonorCounter / countCurrentHonors / CURRENT_HONOR_COUNT 一致性', () => {
  it('CURRENT_HONOR_COUNT 为 16 且与标题表长度一致、无重复', () => {
    assert.equal(CURRENT_HONOR_COUNT, 16);
    assert.equal(CURRENT_HONOR_TITLES.length, CURRENT_HONOR_COUNT);
    assert.equal(new Set(CURRENT_HONOR_TITLES).size, CURRENT_HONOR_COUNT);
  });

  it('createHonorCounter 键集 = 现行荣誉名，值全为 0', () => {
    const counter = createHonorCounter();
    assert.deepEqual(Object.keys(counter), [...CURRENT_HONOR_TITLES]);
    assert.equal(Object.values(counter).every(v => v === 0), true);
  });

  it('countCurrentHonors(createHonorCounter()) === 0', () => {
    assert.equal(countCurrentHonors(createHonorCounter()), 0);
  });

  it('countCurrentHonors 只数 > 0 的现行名，忽略 0 / 负数 / 未知键，数字字符串计入', () => {
    assert.equal(
      countCurrentHonors({ 吕布: 2, 阿斗: 0, 石佛: -1, 波动王: '3', 随便: 9 }),
      2
    );
  });

  it('countCurrentHonors 不识别 legacy 原始键（须先 normalize）', () => {
    const legacy = { 小丑: 5, 连胜王: 1 };
    assert.equal(countCurrentHonors(legacy), 0);
    assert.equal(countCurrentHonors(normalizeHonorCounter(legacy)), 2);
  });

  it('honor_all 的描述与 CURRENT_HONOR_COUNT 同步', () => {
    assert.equal(ACHIEVEMENTS.honor_all.desc, `获得全部${CURRENT_HONOR_COUNT}种荣誉`);
  });

  it('ACHIEVEMENT_COUNT 与定义表键数一致（17 个成就）', () => {
    assert.equal(ACHIEVEMENT_COUNT, 17);
    assert.equal(Object.keys(ACHIEVEMENTS).length, ACHIEVEMENT_COUNT);
  });
});
