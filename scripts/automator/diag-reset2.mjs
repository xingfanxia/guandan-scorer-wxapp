#!/usr/bin/env node
/**
 * 诊断「模拟器点重置没反应」第二轮：真实 DOM tap 按钮（不再 evaluate 直调 onReset），
 * 复现用户的真实操作路径。wrap showActionSheet/showModal 记录是否被调用 + 参数。
 *   - tap 后 __as 有记录 → onReset 被触发、actionSheet 调起（问题在原生渲染/感知）
 *   - tap 后 __as 仍 null → 按钮 tap 没命中 / onReset 没触发（问题在按钮本身）
 * 用法：node scripts/automator/diag-reset2.mjs（项目需已 open 编译完成）
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
acquireDevtoolsLock('guandan-scorer-wxapp:diag-reset2');
process.on('exit', releaseDevtoolsLock);

const mp = await launchOrConnect(ROOT);

try {
  let page = await mp.reLaunch('/pages/index/index');
  await page.waitFor(900);

  // 通关态（截图同款）
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
  await page.waitFor(800);

  // 装 wrap（记录 showActionSheet/showModal 调用）
  await mp.evaluate(() => {
    const app = getApp();
    app.__as = null; app.__modal = null; app.__resetEntered = false;
    const origAS = wx.showActionSheet;
    wx.showActionSheet = function (o) {
      app.__as = { items: (o.itemList || []).length, list: o.itemList };
      return origAS.call(wx, o);
    };
    const origM = wx.showModal;
    wx.showModal = function (o) { app.__modal = { title: o.title }; return origM.call(wx, o); };
    // 包一层 onReset 入口探针
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const origReset = pg.onReset.bind(pg);
    pg.onReset = function () { getApp().__resetEntered = true; return origReset(); };
  });

  // 找到「重置」按钮并真实 tap
  const danger = await page.$('.btn--danger');
  console.log('找到 .btn--danger 按钮:', Boolean(danger));
  if (danger) {
    const txt = await danger.text().catch(() => '?');
    console.log('按钮文字:', txt);
    await danger.tap();
    console.log('已 tap .btn--danger');
  } else {
    // 兜底：枚举 actionbar 按钮
    const btns = await page.$$('.actionbar .btn');
    console.log('actionbar 按钮数:', btns.length);
    for (const b of btns) console.log('  -', await b.text().catch(() => '?'));
  }
  await page.waitFor(1500);

  const r = await mp.evaluate(() => {
    const app = getApp();
    return { resetEntered: app.__resetEntered, as: app.__as, modal: app.__modal };
  });
  console.log('onReset 被触发了吗:', r.resetEntered);
  console.log('showActionSheet 调用:', JSON.stringify(r.as));
  console.log('showModal 调用:', JSON.stringify(r.modal));

  if (!r.resetEntered) console.log('❌ tap 按钮没触发 onReset —— 问题在按钮点击层（fixed/遮挡/绑定）');
  else if (r.as) console.log('✅ onReset 触发、actionSheet 已调起（itemList=' + r.as.items + '）—— 链路通');
  else console.log('⚠️ onReset 触发但 actionSheet 未调起');
} finally {
  await mp.disconnect();
}
