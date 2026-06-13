#!/usr/bin/env node
/** 诊断「加人按钮没反应」：mock 掉原生弹窗记录调用序列，真实触发 onAddPlayer，看链路走到哪。 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
acquireDevtoolsLock('guandan-scorer-wxapp:diag-addplayer');
process.on('exit', releaseDevtoolsLock);

const miniProgram = await launchOrConnect(ROOT);

try {
  const page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(800);

  // 清空到 0 人 6 人局（复现用户截图）
  await miniProgram.evaluate(() => {
    const s = getApp().store;
    s.resetGame(false);
    s.setMode('6');
  });
  await page.waitFor(300);

  // mock 弹窗 + 触发 onAddPlayer（同一 evaluate 确保 wx 覆盖生效）
  await miniProgram.evaluate(() => {
    const app = getApp();
    app.__diag = { calls: [], err: null, cloud: typeof wx.cloud, t0: 0, t1: 0 };
    const d = app.__diag;
    wx.showLoading = (o) => d.calls.push('showLoading:' + (o && o.title));
    wx.hideLoading = () => d.calls.push('hideLoading');
    wx.showActionSheet = (o) => { d.calls.push('actionSheet:[' + (o.itemList || []).join('|') + ']'); };
    wx.showModal = (o) => { d.calls.push('modal:' + o.title); };
    wx.showToast = (o) => d.calls.push('toast:' + (o && o.title));
    const p = getCurrentPages()[getCurrentPages().length - 1];
    d.calls.push('addingPlayer.before=' + p.addingPlayer);
    try {
      p.onAddPlayer({ currentTarget: { dataset: { team: 1 } } });
      d.calls.push('onAddPlayer.returned');
    } catch (e) {
      d.err = String((e && e.stack) || e);
    }
  });

  // 轮询调用序列（异步链 + 云调用）
  let diag;
  for (let i = 0; i < 12; i++) {
    await page.waitFor(800);
    diag = await miniProgram.evaluate(() => {
      const d = getApp().__diag;
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return { ...d, addingNow: p.addingPlayer };
    });
    if (diag.calls.some(c => c.startsWith('actionSheet') || c.startsWith('modal'))) break;
  }

  console.log('wx.cloud 类型:', diag.cloud);
  console.log('addingPlayer 当前:', diag.addingNow);
  console.log('错误:', diag.err || '(无)');
  console.log('调用序列:');
  diag.calls.forEach(c => console.log('  -', c));

  // 单独测 pool_list 云调用本身
  await miniProgram.evaluate(() => {
    const app = getApp();
    app.__pool = undefined;
    const t = Date.now();
    if (!wx.cloud) { app.__pool = { err: 'no wx.cloud' }; return; }
    wx.cloud.callFunction({ name: 'pool_list' })
      .then(r => { app.__pool = { ms: Date.now() - t, ok: r.result && r.result.ok, n: r.result && r.result.players && r.result.players.length }; })
      .catch(e => { app.__pool = { ms: Date.now() - t, err: String((e && e.errMsg) || e) }; });
  });
  let pool;
  for (let i = 0; i < 10; i++) {
    await page.waitFor(800);
    pool = await miniProgram.evaluate(() => getApp().__pool);
    if (pool) break;
  }
  console.log('pool_list 直测:', JSON.stringify(pool));

  const consoleMsgs = await miniProgram.evaluate(() => (getApp().__consoleErrs || []));
  if (consoleMsgs.length) console.log('console:', JSON.stringify(consoleMsgs));
} finally {
  await miniProgram.disconnect();
}
