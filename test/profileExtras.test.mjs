import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// canonical 副本（profile_get_by_handle）；profile_get 为同步副本
const ex = require('../cloudfunctions/profile_get_by_handle/profileExtras.js');

describe('profileExtras 合并（绑定玩家 = web 历史 + 小程序新局）', () => {
  it('relationsFromMap：openid/handle → 含 name/emoji 数组，剔除 0 局', () => {
    const arr = ex.relationsFromMap(
      { axax: { games: 6, wins: 5 }, dead: { games: 0, wins: 0 } },
      (k) => ({ name: k === 'axax' ? '帆' : '', emoji: '🐶', handle: k })
    );
    assert.equal(arr.length, 1);
    assert.equal(arr[0].name, '帆');
    assert.ok(Math.abs(arr[0].winRate - 5 / 6) < 1e-9);
  });

  it('mergeRelations：同 handle 累加 games/wins 并重算胜率', () => {
    const web = [{ name: '帆', emoji: '🐶', handle: 'axax', games: 6, wins: 4, winRate: 4 / 6 }];
    const wx = [{ name: '帆', emoji: '🐶', handle: 'axax', games: 2, wins: 2, winRate: 1 }];
    const m = ex.mergeRelations(web, wx);
    assert.equal(m.length, 1);
    assert.equal(m[0].games, 8);
    assert.equal(m[0].wins, 6);
    assert.equal(m[0].winRate, 0.75);
  });

  it('mergeRelations：不同 handle 各自保留；无 handle 按 name 归并', () => {
    const m = ex.mergeRelations(
      [{ name: '帆', handle: 'axax', games: 3, wins: 1 }, { name: '路人', handle: '', games: 1, wins: 0 }],
      [{ name: '豪', handle: 'hao', games: 2, wins: 2 }, { name: '路人', handle: '', games: 1, wins: 1 }]
    );
    const byName = Object.fromEntries(m.map((r) => [r.name, r]));
    assert.equal(byName['帆'].games, 3);
    assert.equal(byName['豪'].games, 2);
    assert.equal(byName['路人'].games, 2); // 同名无 handle → 合并
  });

  it('mergeTrend：web 旧 + wx 新 → 旧→新，封顶 10', () => {
    const web = [5, 4, 3]; // 旧→新
    const wx = [2, 1]; // 更新
    assert.deepEqual(ex.mergeTrend(web, wx), [5, 4, 3, 2, 1]);
    const long = ex.mergeTrend([8, 8, 8, 8, 8, 8], [1, 2, 3, 4, 5, 6]);
    assert.equal(long.length, 10);
    assert.equal(long[long.length - 1], 6); // 最新保留
  });

  it('mergeRecentGames：wx 新局在前、web 旧局在后，封顶 10', () => {
    const web = [{ ranking: 5 }, { ranking: 6 }];
    const wx = [{ ranking: 1 }];
    const m = ex.mergeRecentGames(web, wx);
    assert.equal(m[0].ranking, 1); // wx 最新在前
    assert.equal(m.length, 3);
  });

  it('rankTrendFromWeb：web 新→旧 翻成 旧→新', () => {
    assert.deepEqual(ex.rankTrendFromWeb([1, 2, 3]), [3, 2, 1]);
  });
});
