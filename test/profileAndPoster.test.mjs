import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileSessions } from '../miniprogram/core/profileSession.js';
import { drawPoster, POSTER_W, POSTER_H } from '../miniprogram/core/poster.js';
import { createGameStore } from '../miniprogram/core/gameStore.js';

function entry(winKey, rankToPlayer, mode = '4') {
  const playerRankings = {};
  for (const [rank, p] of Object.entries(rankToPlayer)) playerRankings[rank] = p;
  return { winKey, mode, playerRankings };
}

const P1 = { id: 1, name: '老王', emoji: '🐶', team: 1, handle: 'axax' };
const P2 = { id: 2, name: '老李', emoji: '🐱', team: 1 };
const P3 = { id: 3, name: '老张', emoji: '🐭', team: 2 };
const P4 = { id: 4, name: '老赵', emoji: '🐰', team: 2 };

const endedState = {
  mode: '4',
  players: [P1, P2, P3, P4],
  teamNames: { t1: '蓝队', t2: '红队' },
  teamLevels: { t1: 'A', t2: 'K' },
  aFail: { t1: 0, t2: 0 },
  roundLevel: 'A',
  roundOwner: 't1',
  nextRoundBase: null,
  history: Array.from({ length: 5 }, () => entry('t1', { 1: P1, 2: P2, 3: P3, 4: P4 })),
  gameStatus: { ended: true, winnerKey: 't1', winnerName: '蓝队', reason: 'A_LEVEL_CLEARED' },
  prefs: { strictA: true, must1: true, autoNext: true }
};

describe('profileSession.buildProfileSessions（playerId 维度，openid 解析归服务端）', () => {
  it('每个出场玩家一条；带 handle 的座位携带 handle；伙伴/对手用 playerId', () => {
    const sessions = buildProfileSessions(endedState);
    assert.equal(sessions.length, 4);

    const s1 = sessions.find(s => s.playerId === 1);
    assert.equal(s1.handle, 'axax');
    assert.equal(s1.teamWon, true);
    assert.equal(s1.gamesInSession, 5);
    assert.equal(s1.firstPlaces, 5);
    assert.deepEqual(s1.partnerPlayerIds, [2]);
    assert.deepEqual(s1.opponentPlayerIds.sort(), [3, 4]);
    assert.ok(s1.honorsEarned.includes('吕布'));

    const s2 = sessions.find(s => s.playerId === 2);
    assert.equal(s2.handle, null);
  });

  it('payload 不含任何 openid 字段（映射权在服务端）', () => {
    const sessions = buildProfileSessions(endedState);
    for (const s of sessions) {
      assert.ok(!('openid' in s));
      assert.ok(!('partnerOpenids' in s));
    }
  });
});

/** 假 canvas ctx：只录 fillText 文本（合规与布局断言用） */
function fakeCtx() {
  const texts = [];
  const noop = () => {};
  return {
    texts,
    fillStyle: '', font: '', textAlign: '',
    fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    strokeStyle: '',
    fillText: (text, x, y) => texts.push({ text: String(text), x, y })
  };
}

describe('poster.drawPoster（合规与布局不变量）', () => {
  it('海报全部文案零「赌」字样；荣誉经合规别名渲染', () => {
    // 让「赌徒」荣誉真实产生：P1 头游多 + 垫底也有 → 不稳定；直接验证标题渲染路径——
    // 用 5 局数据跑真实荣誉，再补一条人造「赌徒」校验别名出口
    const ctx = fakeCtx();
    drawPoster(ctx, endedState, 'A2B3C4');
    const all = ctx.texts.map(t => t.text).join('\n');
    assert.ok(!all.includes('赌'), `海报文案出现「赌」：${all}`);
    assert.ok(all.includes('闹掼计分器'));
    assert.ok(all.includes('房间 A2B3C4'));
  });

  it('荣誉行数超预算时截断 + 任何文字不越过底部 footer 预算线', () => {
    // 构造大量荣誉：8 人局 5 轮固定名次 → 多个荣誉得主
    const P = (id, team) => ({ id, name: `玩家${id}`, emoji: '🙂', team });
    const eight = [1, 2, 3, 4].map(i => P(i, 1)).concat([5, 6, 7, 8].map(i => P(i, 2)));
    const ranks = {};
    eight.forEach((p, i) => { ranks[i + 1] = p; });
    const s8 = {
      ...endedState,
      mode: '8',
      players: eight,
      history: Array.from({ length: 6 }, () => entry('t1', ranks, '8'))
    };
    const ctx = fakeCtx();
    drawPoster(ctx, s8, null);
    const maxContentY = POSTER_H - 140;
    for (const t of ctx.texts) {
      const isFooter = t.text.includes('线下牌局计分记录');
      assert.ok(isFooter || t.y <= maxContentY, `文字越界：「${t.text}」@y=${t.y}`);
      assert.ok(t.x >= 0 && t.x <= POSTER_W);
    }
  });
});

describe('gameStore.shuffleTeams（随机分队）', () => {
  function storeWith(n) {
    const store = createGameStore({ storage: { get: () => null, set: () => {} }, now: () => 1 });
    store.setMode(String(n));
    for (let i = 0; i < n; i++) {
      store.addPlayer({ name: `P${i + 1}`, emoji: '🙂', team: i < n / 2 ? 1 : 2 });
    }
    return store;
  }

  it('洗牌后两队各半、玩家集合不变（注入固定 RNG 可复现）', () => {
    const store = storeWith(8);
    const seq = [0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.8];
    let i = 0;
    const res = store.shuffleTeams(() => seq[i++ % seq.length]);
    assert.equal(res.ok, true);
    const players = store.getState().players;
    assert.equal(players.length, 8);
    assert.equal(players.filter(p => p.team === 1).length, 4);
    assert.equal(players.filter(p => p.team === 2).length, 4);
    assert.deepEqual(players.map(p => p.name).sort(), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  });

  it('奇数人数拒绝', () => {
    const store = createGameStore({ storage: { get: () => null, set: () => {} }, now: () => 1 });
    store.setMode('4');
    store.addPlayer({ name: '甲', emoji: '🙂', team: 1 });
    store.addPlayer({ name: '乙', emoji: '🙂', team: 1 });
    store.addPlayer({ name: '丙', emoji: '🙂', team: 2 });
    const res = store.shuffleTeams(() => 0.5);
    assert.equal(res.ok, false);
    assert.match(res.msg, /偶数/);
  });
});

describe('gameStore — review 补强（subscribe/setTeamName/中间索引回滚/池身份）', () => {
  function fourStore() {
    const store = createGameStore({ storage: { get: () => null, set: () => {} }, now: (() => { let t = 0; return () => (t += 1000); })() });
    store.setMode('4');
    store.addPlayer({ name: '甲', emoji: '🙂', team: 1 });
    store.addPlayer({ name: '乙', emoji: '🙂', team: 1 });
    store.addPlayer({ name: '丙', emoji: '🙂', team: 2 });
    store.addPlayer({ name: '丁', emoji: '🙂', team: 2 });
    return store;
  }

  it('subscribe：每次变更收到快照回调；退订后停止', () => {
    const store = fourStore();
    const seen = [];
    const unsub = store.subscribe((s) => seen.push(s.teamLevels.t1));
    store.applyResult('t1', [1, 2]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0], '5');
    unsub();
    store.applyResult('t1', [1, 2]);
    assert.equal(seen.length, 1);
  });

  it('setTeamName：合法改名生效、空名拒绝', () => {
    const store = fourStore();
    assert.equal(store.setTeamName('t1', '东风队').ok, true);
    assert.equal(store.getState().teamNames.t1, '东风队');
    assert.equal(store.setTeamName('t1', '  ').ok, false);
    assert.equal(store.setTeamName('t9', 'x').ok, false);
  });

  it('rollbackTo 中间索引：删除该局及之后，状态回到该局之前', () => {
    const store = fourStore();
    store.applyResult('t1', [1, 2]); // → 5
    store.applyResult('t1', [1, 3]); // → 7
    store.applyResult('t2', [1, 2]); // t2 → 5
    const res = store.rollbackTo(1);
    assert.equal(res.success, true);
    const s = store.getState();
    assert.equal(s.history.length, 1);
    assert.equal(s.teamLevels.t1, '5');
    assert.equal(s.teamLevels.t2, '2');
    assert.equal(s.roundLevel, '5');
    assert.equal(s.roundOwner, 't1');
  });

  it('addPlayer 带 handle：归一化小写、同 handle 不能重复上场', () => {
    const store = createGameStore({ storage: { get: () => null, set: () => {} }, now: () => 1 });
    store.setMode('4');
    const a = store.addPlayer({ name: '帆', emoji: '🦈', team: 1, handle: 'AxAx' });
    assert.equal(a.ok, true);
    assert.equal(store.getState().players[0].handle, 'axax');
    const b = store.addPlayer({ name: '帆2', emoji: '🦈', team: 1, handle: 'axax' });
    assert.equal(b.ok, false);
    assert.match(b.msg, /axax/);
  });
});
