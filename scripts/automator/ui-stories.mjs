#!/usr/bin/env node
/**
 * 完整 UI user-story 回归（DevTool）—— 覆盖所有用户动作的弹窗交互链路。
 *
 * 之前的 E2E 只直驱 store，绕过了 actionSheet/showModal（automator 驱动不了原生弹窗），
 * 导致「加人按钮吞窗」这类 UI-only bug 漏网。本脚本在页面上下文里一次性 mock 掉弹窗 API
 *（记录调用到 app.__log + 从 app.__queue 注入用户选择），真实触发页面事件处理器，
 * 断言状态机 —— 把「点了之后逻辑对不对、弹窗有没有弹、选择有没有路由到 store」补上。
 *
 * 真实弹窗「是否被吞」由 ui-popup-shots.mjs 截图人工确认（互补，本脚本不依赖原生弹窗显示）。
 * 用法：node scripts/automator/ui-stories.mjs
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let passed = 0;
const fail = (m) => { throw new Error(`STORY FAIL: ${m}`); };
const ok = (cond, m) => { if (!cond) fail(m); passed += 1; console.log(`  ✓ ${m}`); };

acquireDevtoolsLock('guandan-scorer-wxapp:ui-stories');
process.on('exit', releaseDevtoolsLock);

const mp = await launchOrConnect(ROOT);

/** 一次性安装弹窗 mock：记录调用到 app.__log，从 app.__queue 取应答（reLaunch 后需重装） */
async function installMocks() {
  await mp.evaluate(() => {
    const app = getApp();
    app.__log = [];
    app.__queue = [];
    const next = () => app.__queue.shift();
    wx.showActionSheet = (o) => {
      app.__log.push('AS:[' + (o.itemList || []).join('|') + ']');
      const a = next();
      if (a && a.tap != null && o.success) o.success({ tapIndex: a.tap });
      else if (o.fail) o.fail({ errMsg: 'cancel' });
    };
    wx.showModal = (o) => {
      app.__log.push('M:' + o.title + (o.editable ? '(editable)' : ''));
      const a = next();
      if (o.success) o.success((a && a.modal) ? a.modal : { confirm: false });
    };
    wx.showToast = (o) => app.__log.push('T:' + (o && o.title));
    wx.showLoading = () => app.__log.push('L');
    wx.hideLoading = () => app.__log.push('HL');
    wx.navigateTo = (o) => app.__log.push('NAV:' + o.url);
    wx.showShareMenu = () => {};
  });
}

/** async 触发（加人：云调用 + setTimeout 弹窗）后 poll 取回 store 玩家与调用日志 */
async function pollAfter(triggerFn, arg, settleMs = 450) {
  await mp.evaluate(triggerFn, arg);
  let r;
  for (let k = 0; k < 15; k++) {
    await new Promise(res => setTimeout(res, 500));
    r = await mp.evaluate(() => {
      const app = getApp();
      return app.__done ? { log: app.__log.slice(), players: app.store.getState().players } : null;
    });
    if (r) break;
  }
  if (!r) fail('async story 超时');
  return r;
}

try {
  let page = await mp.reLaunch('/pages/index/index');
  await page.waitFor(800);
  await installMocks();

  // 预热玩家池缓存（首次云调用，后续 story 命中缓存）
  await mp.evaluate(() => { const p = getCurrentPages()[getCurrentPages().length - 1]; return p.getPoolPlayers && p.getPoolPlayers(); });
  await page.waitFor(1500);

  console.log('\n■ Story 1：加人 — 自定义弹层多选一次加入（一屏滚动，无翻页）');
  {
    // 缓存命中 → onAddPlayer 同步开弹层；勾两个 + 确认
    const out = await mp.evaluate(() => {
      const app = getApp();
      const store = app.store; store.resetGame(false); store.setMode('6');
      const page = getCurrentPages()[getCurrentPages().length - 1];
      page.onAddPlayer({ currentTarget: { dataset: { team: 1 } } });
      const sheet = page.data.poolSheet;
      const rowCount = sheet.rows.length;
      const shown = sheet.show;
      const subs = sheet.rows.slice(0, 4).map(r => Number((r.sub || '0').replace(/[^0-9]/g, '')) || 0);
      page.onPoolToggle({ currentTarget: { dataset: { idx: 0 } } });
      page.onPoolToggle({ currentTarget: { dataset: { idx: 1 } } });
      const selBefore = page.data.poolSheet.selectedCount;
      page.onPoolConfirm();
      const s = store.getState();
      return { shown, rowCount, subs, selBefore, closed: page.data.poolSheet.show, players: s.players.length, teams: s.players.map(p => p.team) };
    });
    ok(out.shown && out.rowCount >= 10, `弹层一屏列出全员（${out.rowCount} 行，无翻页）`);
    ok(out.subs.every((n, i) => i === 0 || out.subs[i - 1] >= n), `默认按最活跃倒序（前几位场次 ${JSON.stringify(out.subs)}）`);
    ok(out.selBefore === 2, `多选计数正确（选了 ${out.selBefore} 人）`);
    ok(out.players === 2 && out.teams.every(t => t === 1), '一次加入 2 人到 t1');
    ok(out.closed === false, '加入后弹层关闭');
  }

  console.log('\n■ Story 2：加人 — 弹层「手动输入」入口（关弹层→隔宏任务 modal）');
  {
    const r = await pollAfter(() => {
      const app = getApp(); app.__done = false; app.__queue = [{ modal: { confirm: true, content: '临时工老陈' } }]; app.__log = [];
      const store = app.store; store.resetGame(false); store.setMode('6');
      const page = getCurrentPages()[getCurrentPages().length - 1];
      page.onAddPlayer({ currentTarget: { dataset: { team: 2 } } });
      page.onPoolManual(); // 关弹层 + setTimeout(60) 弹手输 modal
      setTimeout(() => { app.__done = true; }, 500);
    });
    ok(r.log.some(l => l.startsWith('M:加玩家')), '走到手输 modal');
    ok(r.players.some(p => p.name === '临时工老陈' && p.team === 2), '手输玩家入队 t2');
  }

  console.log('\n■ Story 3：长按玩家 — 改名（actionSheet→modal）');
  {
    const out = await mp.evaluate(() => {
      const app = getApp(); app.__queue = [{ tap: 0 }, { modal: { confirm: true, content: '阿强' } }]; app.__log = [];
      const store = app.store; store.resetGame(false); store.setMode('4');
      store.addPlayer({ name: '老王', emoji: '🐶', team: 1 });
      const id = store.getState().players[0].id;
      getCurrentPages()[getCurrentPages().length - 1].onEditPlayer({ currentTarget: { dataset: { id } } });
      return store.getState().players[0].name;
    });
    ok(out === '阿强', `改名生效（老王→${out}）`);
  }

  console.log('\n■ Story 4：长按玩家 — 换队');
  {
    const out = await mp.evaluate(() => {
      const app = getApp(); app.__queue = [{ tap: 1 }]; app.__log = [];
      const store = app.store; store.resetGame(false); store.setMode('4');
      store.addPlayer({ name: '老王', emoji: '🐶', team: 1 });
      const id = store.getState().players[0].id;
      getCurrentPages()[getCurrentPages().length - 1].onEditPlayer({ currentTarget: { dataset: { id } } });
      return store.getState().players[0].team;
    });
    ok(out === 2, `t1→t2 换队（team=${out}）`);
  }

  console.log('\n■ Story 5：长按玩家 — 移除');
  {
    const out = await mp.evaluate(() => {
      const app = getApp(); app.__queue = [{ tap: 2 }]; app.__log = [];
      const store = app.store; store.resetGame(false); store.setMode('4');
      store.addPlayer({ name: '老王', emoji: '🐶', team: 1 });
      store.addPlayer({ name: '老李', emoji: '🐱', team: 1 });
      const id = store.getState().players[0].id;
      getCurrentPages()[getCurrentPages().length - 1].onEditPlayer({ currentTarget: { dataset: { id } } });
      return store.getState().players.length;
    });
    ok(out === 1, `移除后剩 1 人（${out}）`);
  }

  console.log('\n■ Story 6：随机分队');
  {
    const out = await mp.evaluate(() => {
      const store = getApp().store; store.resetGame(false); store.setMode('4');
      ['甲', '乙', '丙', '丁'].forEach((n, i) => store.addPlayer({ name: n, emoji: '🙂', team: i < 2 ? 1 : 2 }));
      getCurrentPages()[getCurrentPages().length - 1].onShuffleTeams();
      const ps = store.getState().players;
      return { t1: ps.filter(p => p.team === 1).length, t2: ps.filter(p => p.team === 2).length };
    });
    ok(out.t1 === 2 && out.t2 === 2, `两队各 2 人（t1=${out.t1} t2=${out.t2}）`);
  }

  console.log('\n■ Story 7：名次录入 → 升级预览 → 应用结果');
  {
    const out = await mp.evaluate(() => {
      const store = getApp().store; store.resetGame(false); store.setMode('4');
      [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => store.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
      const page = getCurrentPages()[getCurrentPages().length - 1];
      page.refresh();
      const ids = store.getState().players.map(p => p.id);
      page.order = [ids[0], ids[1], ids[2], ids[3]];
      page.refresh();
      const preview = page.data.preview;
      page.onApply();
      const s = store.getState();
      return { preview: preview && preview.upgradeText, t1: s.teamLevels.t1, history: s.history.length };
    });
    ok(out.preview === '升 3 级', `双上预览「升 3 级」（${out.preview}）`);
    ok(out.t1 === '5' && out.history === 1, `应用后 t1 打5、历史+1（t1=${out.t1} h=${out.history}）`);
  }

  console.log('\n■ Story 8：撤销最近一局（modal 确认）');
  {
    const out = await mp.evaluate(() => {
      const app = getApp(); app.__queue = [{ modal: { confirm: true } }]; app.__log = [];
      const store = app.store; store.resetGame(false); store.setMode('4');
      [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => store.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
      store.applyResult('t1', [1, 2]);
      const before = store.getState().history.length;
      getCurrentPages()[getCurrentPages().length - 1].onUndo();
      return { before, after: store.getState().history.length };
    });
    ok(out.before === 1 && out.after === 0, `撤销后历史归零（${out.before}→${out.after}）`);
  }

  console.log('\n■ Story 9：重置 — 自定义弹层「重新开一局」保留玩家（无原生弹窗）');
  {
    const out = await mp.evaluate(() => {
      const store = getApp().store; store.resetGame(false); store.setMode('4');
      [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => store.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
      store.applyResult('t1', [1, 2]);
      const page = getCurrentPages()[getCurrentPages().length - 1];
      page.onReset();
      const opened = page.data.resetSheet;
      page.onResetPick({ currentTarget: { dataset: { mode: 'keep' } } });
      const s = store.getState();
      return { opened, closed: page.data.resetSheet, players: s.players.length, history: s.history.length };
    });
    ok(out.opened === true, '点重置 → 弹层打开（resetSheet=true）');
    ok(out.players === 4 && out.history === 0, `保留玩家比分清零（players=${out.players} h=${out.history}）`);
    ok(out.closed === false, '选完弹层关闭');
  }

  console.log('\n■ Story 10：重置 — 自定义弹层「清空玩家重来」');
  {
    const out = await mp.evaluate(() => {
      const store = getApp().store; store.resetGame(false); store.setMode('4');
      [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => store.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
      store.applyResult('t1', [1, 2]);
      const page = getCurrentPages()[getCurrentPages().length - 1];
      page.onReset();
      page.onResetPick({ currentTarget: { dataset: { mode: 'clear' } } });
      return store.getState().players.length;
    });
    ok(out === 0, `玩家与比分全清（players=${out}）`);
  }

  console.log('\n■ Story 11：开打后换人数 = 开新一局（清空名单，杜绝 placeholder）');
  {
    const out = await mp.evaluate(() => {
      const app = getApp(); app.__queue = [{ modal: { confirm: true } }]; app.__log = [];
      const store = app.store; store.resetGame(false); store.setMode('4');
      [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => store.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
      store.applyResult('t1', [1, 2]);
      getCurrentPages()[getCurrentPages().length - 1].onMode({ currentTarget: { dataset: { mode: '8' } } });
      const s = store.getState();
      return { mode: s.mode, players: s.players.length, history: s.history.length };
    });
    ok(out.mode === '8' && out.players === 0 && out.history === 0, `换 8 人局名单清空（mode=${out.mode} players=${out.players} h=${out.history}）`);
  }

  console.log('\n■ Story 12：规则开关（严格 A 级）');
  {
    const out = await mp.evaluate(() => {
      const store = getApp().store; store.resetGame(false);
      const was = store.getState().prefs.strictA;
      getCurrentPages()[getCurrentPages().length - 1].onPref({ currentTarget: { dataset: { key: 'strictA' } }, detail: { value: !was } });
      return { was, now: store.getState().prefs.strictA };
    });
    ok(out.was !== out.now, `strictA 切换（${out.was}→${out.now}）`);
  }

  console.log('\n■ Story 13：导航跳转四页（mock navigateTo）');
  {
    const log = await mp.evaluate(() => {
      const app = getApp(); app.__log = [];
      const page = getCurrentPages()[getCurrentPages().length - 1];
      page.goHistory(); page.goProfile(); page.goPlayers();
      return app.__log.slice();
    });
    ok(log.includes('NAV:/pages/history/history'), '→ 对局历史');
    ok(log.includes('NAV:/pages/profile/profile'), '→ 我的档案');
    ok(log.includes('NAV:/pages/players/players'), '→ 玩家天梯');
  }

  console.log('\n■ Story 14：围观别人 — 手输房间码（modal→跳转 room，大写归一）');
  {
    const log = await mp.evaluate(() => {
      const app = getApp(); app.__queue = [{ modal: { confirm: true, content: 'a2b3c4' } }]; app.__log = [];
      getCurrentPages()[getCurrentPages().length - 1].onEnterRoomCode();
      return app.__log.slice();
    });
    ok(log.some(l => l.startsWith('M:')), '弹房间码输入 modal');
    ok(log.some(l => l.startsWith('NAV:/pages/room/room?code=A2B3C4')), '跳转房间（小写归一为大写）');
  }

  console.log('\n■ Story 15：5 局通关 → MVP 文案 + 入库/海报按钮态');
  {
    const out = await mp.evaluate(() => {
      const store = getApp().store; store.resetGame(false); store.setMode('4');
      [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => store.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
      for (let k = 0; k < 5; k++) {
        const s = store.getState();
        const byT = (t) => s.players.filter(p => p.team === t);
        const rk = {};
        byT(1).concat(byT(2)).forEach((p, idx) => { rk[idx + 1] = { id: p.id, name: p.name, emoji: p.emoji, team: p.team }; });
        store.applyResult('t1', [1, 2], rk);
      }
      const page = getCurrentPages()[getCurrentPages().length - 1];
      page.refresh();
      return { ended: page.data.ended, mvp: page.data.mvpText };
    });
    ok(out.ended === true, '通关态 ended=true');
    ok(/MVP/.test(out.mvp || ''), `MVP 文案出现（${out.mvp}）`);
  }

  console.log('\n■ Story 16：玩家天梯页 — 列表 + 待校准沉底 + 详情');
  {
    page = await mp.reLaunch('/pages/players/players');
    await page.waitFor(2500);
    let rows = [];
    for (let k = 0; k < 8; k++) { rows = (await page.data('rows')) || []; if (rows.length) break; await page.waitFor(800); }
    ok(rows.length >= 10, `天梯榜列出池玩家（${rows.length} 行）`);
    ok(rows.every(r => r.calibrated || r.rankText === '待校准'), '未校准行 rank 列显示「待校准」');
    const firstProv = rows.findIndex(r => !r.calibrated);
    const lastCalib = rows.map(r => r.calibrated).lastIndexOf(true);
    ok(firstProv === -1 || lastCalib === -1 || lastCalib < firstProv, '已校准排在待校准之前');
    await mp.evaluate((h) => { getCurrentPages()[getCurrentPages().length - 1].onTapPlayer({ currentTarget: { dataset: { handle: h } } }); }, rows[0].handle);
    let detail = null;
    for (let k = 0; k < 10; k++) { await page.waitFor(700); detail = await page.data('detail'); if (detail) break; }
    ok(detail && detail.handle === rows[0].handle, `点开详情正确（@${detail && detail.handle}）`);
    ok(detail && Array.isArray(detail.webCells) && detail.webCells.length === 3, 'web 老战绩区 3 格');
  }

  console.log('\n■ Story 17：历史页 + 档案页渲染（reLaunch 不崩）');
  {
    page = await mp.reLaunch('/pages/history/history');
    await page.waitFor(600);
    const hist = await page.data('rows');
    ok(Array.isArray(hist), `历史页渲染（rows=${(hist || []).length}）`);
    page = await mp.reLaunch('/pages/profile/profile');
    await page.waitFor(1500);
    const prof = await page.data('loading');
    ok(prof === false, '档案页加载完成');
  }

  console.log(`\n✅ UI STORIES PASS — ${passed} 项断言全过`);
} finally {
  await mp.disconnect();
}
