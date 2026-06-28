import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileSessions } from '../miniprogram/core/profileSession.js';
import { buildPosterLayout, paintPoster, POSTER_W, computePosterScale, MAX_CANVAS_DIM } from '../miniprogram/core/poster.js';
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

describe('poster.buildPosterLayout（长图布局：web 手机版信息密度对位 + 合规）', () => {
  const textsOf = (layout) => layout.ops.filter(o => o.type === 'text').map(o => o.text);

  it('全部文案零「赌」零骰子图形；16 荣誉标题全列出（含合规别名「莽夫」）', () => {
    const layout = buildPosterLayout(endedState, { roomCode: 'A2B3C4', timestamp: '2026/6/12 20:00:00' });
    const all = textsOf(layout).join('\n');
    assert.ok(!all.includes('赌'), `海报文案出现「赌」：${all}`);
    assert.ok(!all.includes('🎲'), '海报出现骰子图形');
    assert.ok(all.includes('莽夫'), '特殊荣誉应列全 16 项（含合规别名）');
    assert.ok(all.includes('吕布') && all.includes('阿斗') && all.includes('石佛'));
    assert.ok(all.includes('闹掼计分器'));
    assert.ok(all.includes('房间 A2B3C4'));
    assert.ok(all.includes('线下牌局计分记录'));
  });

  it('信息密度对齐 web 手机版：总览/提名/特殊荣誉/统计表/逐局历史各区齐备', () => {
    const layout = buildPosterLayout(endedState, { timestamp: '2026/6/12 20:00:00' });
    const all = textsOf(layout).join('\n');
    for (const section of ['掼蛋战绩总览', '🏆 荣誉提名', '🎖️ 特殊荣誉', '📊 玩家排名统计', '📜 比赛历史']) {
      assert.ok(all.includes(section), `缺区块：${section}`);
    }
    assert.ok(all.includes('A级通关'));
    assert.ok(all.includes('冠军队伍'));
    assert.ok(all.includes('MVP：🐶老王'));
    assert.ok(all.includes('最C') && all.includes('最闹'));
    // 统计表：每个出场玩家一行
    assert.ok(all.includes('🐶老王') && all.includes('🐱老李') && all.includes('🐭老张') && all.includes('🐰老赵'));
    // 逐局历史：每局一条全员名次行（fixture 无 combo 字段，以名次行计数）
    assert.equal(textsOf(layout).filter(t => /^1\.🐶老王/.test(t)).length, endedState.history.length);
  });

  it('观众投票区：传入 votes 渲染票数行；不传则无该区', () => {
    const votes = { mvp: [{ emoji: '🐶', name: '老王', count: 3 }], burden: [{ emoji: '🐰', name: '老赵', count: 2 }] };
    const withVotes = textsOf(buildPosterLayout(endedState, { votes })).join('\n');
    assert.ok(withVotes.includes('🗳️ 观众投票'));
    assert.ok(withVotes.includes('🐶 老王：3票'));
    assert.ok(withVotes.includes('🐰 老赵：2票'));
    const without = textsOf(buildPosterLayout(endedState, {})).join('\n');
    assert.ok(!without.includes('观众投票'));
  });

  it('长图高度随局数增长；所有 op 落在画布内', () => {
    const P = (id, team) => ({ id, name: `玩家${id}`, emoji: '🙂', team });
    const eight = [1, 2, 3, 4].map(i => P(i, 1)).concat([5, 6, 7, 8].map(i => P(i, 2)));
    const ranks = {};
    eight.forEach((p, i) => { ranks[i + 1] = p; });
    const mk = (n) => buildPosterLayout({
      ...endedState,
      mode: '8',
      players: eight,
      history: Array.from({ length: n }, () => entry('t1', ranks, '8'))
    }, {});
    const small = mk(5);
    const big = mk(15);
    assert.ok(big.height > small.height, '高度应随局数增长');
    for (const layout of [small, big]) {
      assert.equal(layout.width, POSTER_W);
      for (const op of layout.ops) {
        assert.ok(op.y <= layout.height - 20, `op 越过画布底：「${op.text || op.type}」@y=${op.y} h=${layout.height}`);
        assert.ok(op.x >= 0 && op.x <= POSTER_W, `op 越过画布横向：@x=${op.x}`);
      }
    }
    // 8 人名次行按宽度折行：每局至少 2 行名次
    const rankingLines = big.ops.filter(o => o.type === 'text' && /^1\.🙂玩家1/.test(o.text));
    assert.equal(rankingLines.length, 15);
  });

  it('paintPoster 把 ops 原样喂给 ctx（含背景铺底与 align 复位）', () => {
    const calls = [];
    const ctx = {
      fillStyle: '', font: '', textAlign: '',
      fillRect: (...a) => calls.push(['rect', ...a]),
      fillText: (...a) => calls.push(['text', ...a])
    };
    const layout = buildPosterLayout(endedState, {});
    paintPoster(ctx, layout);
    assert.deepEqual(calls[0], ['rect', 0, 0, layout.width, layout.height]);
    assert.equal(calls.filter(c => c[0] === 'text').length, layout.ops.filter(o => o.type === 'text').length);
    assert.equal(ctx.textAlign, 'left');
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

describe('computePosterScale — canvas 背板尺寸不超设备纹理上限（真机导不出根因）', () => {
  // 钉死真机口径：背板用 Math.round(dim*scale)（与 index.ts 调用点一致），两边都不得超 maxDim
  const within = (w, h, scale, maxDim) =>
    Math.round(w * scale) <= maxDim && Math.round(h * scale) <= maxDim;

  it('短海报：scale 跟随 dpr（不超 maxDim 时不缩）', () => {
    // 600×2360 @ dpr2 → 最长边 2360×2=4720 > 4096 → 必须缩到正好贴边，而非沿用 dpr=2
    const scale = computePosterScale(600, 2360, 2);
    assert.ok(scale <= 2, 'scale 不应超过 dpr');
    assert.ok(within(600, 2360, scale, MAX_CANVAS_DIM), '背板任一边不得超 maxDim');
  });

  it('小海报：完全放得下时 scale === dpr（不无谓降清晰度）', () => {
    // 600×1500 @ dpr2 → 最长边 3000 < 4096 → 保留 dpr=2
    assert.equal(computePosterScale(600, 1500, 2), 2);
  });

  it('超长历史海报：允许 scale < 1 以贴合上限（清晰度降级好过导不出）', () => {
    const scale = computePosterScale(600, 10000, 2);
    assert.ok(scale < 1, '超长海报应缩到 <1');
    assert.ok(within(600, 10000, scale, MAX_CANVAS_DIM), '背板高不得超 maxDim');
  });

  it('任意 height 下背板两边都 <= maxDim（不变式）', () => {
    for (const h of [700, 3000, 4096, 5000, 8192, 20000]) {
      for (const dpr of [1, 2, 3]) {
        const scale = computePosterScale(POSTER_W, h, dpr);
        assert.ok(within(POSTER_W, h, scale, MAX_CANVAS_DIM), `h=${h} dpr=${dpr} 越界`);
        assert.ok(scale <= dpr + 1e-9, `h=${h} dpr=${dpr} scale 超 dpr`);
        assert.ok(scale > 0, `h=${h} dpr=${dpr} scale 非正`);
      }
    }
  });

  it('dpr 缺失/非法时回退为 1，结果仍有界', () => {
    for (const bad of [undefined, null, 0, -2, NaN]) {
      const scale = computePosterScale(600, 3000, bad);
      assert.ok(scale > 0 && within(600, 3000, scale, MAX_CANVAS_DIM), `dpr=${bad} 异常`);
    }
  });
});

describe('poster — MVP tagline 引言（web 手机版对位）', () => {
  it('传 mvpTagline 渲染引号引言；不传不渲染；超长截断', () => {
    const textsOf = (layout) => layout.ops.filter(o => o.type === 'text').map(o => o.text);
    const withTag = textsOf(buildPosterLayout(endedState, { mvpTagline: '脱牌好差劲' })).join('\n');
    assert.ok(withTag.includes('“脱牌好差劲”'));
    const without = textsOf(buildPosterLayout(endedState, {})).join('\n');
    assert.ok(!without.includes('“'));
    const long = textsOf(buildPosterLayout(endedState, { mvpTagline: '九'.repeat(50) })).join('\n');
    assert.ok(long.includes('“' + '九'.repeat(30) + '”'));
  });
});
