#!/usr/bin/env node
/**
 * 诊断「重置点了没反应」：真实 wx（不 mock）+ wrap 捕获 showActionSheet/showModal 的
 * fail/success + 是否弹出。通关态触发 onReset，逐环看卡在哪。
 *   - actionSheet wrap：itemList>6 立即 fail；≤6 弹出挂起（success/fail 不触发）
 *   - 另外单独直调 showModal 验证 modal 本身能弹（排除 modal 通道问题）
 * 用法：node scripts/automator/diag-reset.mjs（项目需已 open 编译完成）
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
acquireDevtoolsLock('guandan-scorer-wxapp:diag-reset');
process.on('exit', releaseDevtoolsLock);

const mp = await launchOrConnect(ROOT);

try {
  let page = await mp.reLaunch('/pages/index/index');
  await page.waitFor(900);

  // 5 局通关（复现截图态）
  await mp.evaluate(() => {
    const s = getApp().store;
    s.resetGame(false); s.setMode('4');
    [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => s.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
    for (let k = 0; k < 5; k++) {
      const st = s.getState();
      const byT = (t) => st.players.filter(p => p.team === t);
      const rk = {};
      byT(1).concat(byT(2)).forEach((p, i) => { rk[i + 1] = { id: p.id, name: p.name, emoji: p.emoji, team: p.team }; });
      s.applyResult('t1', [1, 2], rk);
    }
  });
  page = await mp.reLaunch('/pages/index/index');
  await page.waitFor(700);

  // wrap 真实 showActionSheet + showModal，触发 onReset
  await mp.evaluate(() => {
    const app = getApp();
    app.__as = null; app.__modal = null;
    const origAS = wx.showActionSheet;
    wx.showActionSheet = function (o) {
      const items = (o.itemList || []).length;
      return origAS.call(wx, Object.assign({}, o, {
        success: (r) => { app.__as = { ok: true, items, tap: r.tapIndex }; if (o.success) o.success(r); },
        fail: (e) => { app.__as = { ok: false, items, err: e.errMsg }; if (o.fail) o.fail(e); }
      }));
    };
    const origM = wx.showModal;
    wx.showModal = function (o) {
      app.__modal = { shown: true, title: o.title };
      return origM.call(wx, o);
    };
    getCurrentPages()[getCurrentPages().length - 1].onReset();
  });
  await page.waitFor(1800);

  const as = await mp.evaluate(() => getApp().__as);
  const modal = await mp.evaluate(() => getApp().__modal);
  if (as === null) console.log('✅ onReset 的 actionSheet 弹出挂起（itemList=2，未 fail）—— actionSheet 这步正常');
  else if (as.ok === false) console.log(`❌ actionSheet FAIL：items=${as.items} err=${as.err}`);
  else console.log(`actionSheet success tap=${as.tap}`);
  console.log('showModal 被调用了吗（actionSheet 未点选时应为 null）:', JSON.stringify(modal));

  // 单独验证 showModal 本身能弹（直调，排除 modal 通道问题）
  await mp.evaluate(() => {
    const app = getApp();
    app.__m2 = null;
    const origM = wx.showModal;
    wx.showModal = function (o) {
      return origM.call(wx, Object.assign({}, o, {
        success: (r) => { app.__m2 = { ok: true, confirm: r.confirm }; if (o.success) o.success(r); },
        fail: (e) => { app.__m2 = { ok: false, err: e.errMsg }; if (o.fail) o.fail(e); }
      }));
    };
    wx.showModal({ title: '直调 modal 测试', content: '能弹出说明 modal 通道正常' });
  });
  await page.waitFor(1500);
  const m2 = await mp.evaluate(() => getApp().__m2);
  if (m2 === null) console.log('✅ 直调 showModal 弹出挂起 —— modal 通道正常');
  else console.log('直调 showModal 结果:', JSON.stringify(m2));
} finally {
  await mp.disconnect();
}
