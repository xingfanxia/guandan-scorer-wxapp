#!/usr/bin/env node
/** 截图看自定义弹层真实渲染（WXML 弹层 automator 可截，区别于原生 actionSheet）。 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT = join(ROOT, 'docs', 'reports', 'ui-sheets');
mkdirSync(SHOT, { recursive: true });
acquireDevtoolsLock('guandan-scorer-wxapp:sheet-shots');
process.on('exit', releaseDevtoolsLock);

function step(p, label, ms = 18000) {
  let t;
  return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, r) => { t = setTimeout(() => r(new Error('TIMEOUT:' + label)), ms); })]);
}
async function shot(name) {
  try { await step(mp.screenshot({ path: join(SHOT, name) }), name); console.log('📸 ' + name); }
  catch (e) { console.log('⚠️ ' + name + ' 跳过: ' + e.message); }
}

const mp = await launchOrConnect(ROOT);
try {
  let page = await step(mp.reLaunch('/pages/index/index'), 'reLaunch');
  await page.waitFor(900);
  await mp.evaluate(() => { const s = getApp().store; s.resetGame(false); s.setMode('8'); });
  page = await step(mp.reLaunch('/pages/index/index'), 'reLaunch2');
  await page.waitFor(800);

  // 加人弹层（onAddPlayer 首次走云调用 → 轮询 show 变 true 再截）
  await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    p.poolCache = null;
    p.onAddPlayer({ currentTarget: { dataset: { team: 1 } } });
  });
  let n = null;
  for (let i = 0; i < 12; i++) {
    await page.waitFor(600);
    n = await page.data('poolSheet');
    if (n && n.show && n.rows.length > 0) break;
  }
  console.log('加人弹层 show=' + (n && n.show) + ' rows=' + (n && n.rows.length));
  await page.waitFor(300);
  await shot('01-pool-sheet.png');

  // 勾两个看选中态
  await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    p.onPoolToggle({ currentTarget: { dataset: { idx: 0 } } });
    p.onPoolToggle({ currentTarget: { dataset: { idx: 2 } } });
  });
  await page.waitFor(500);
  await shot('02-pool-selected.png');

  // 关弹层，开重置弹层（先通关让重置有意义）
  await mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    p.onPoolClose();
    const s = getApp().store;
    s.resetGame(false); s.setMode('4');
    [['王', 1], ['李', 1], ['张', 2], ['赵', 2]].forEach(x => s.addPlayer({ name: x[0], emoji: '🙂', team: x[1] }));
    s.applyResult('t1', [1, 2]);
  });
  page = await step(mp.reLaunch('/pages/index/index'), 'reLaunch3');
  await page.waitFor(700);
  await mp.evaluate(() => { getCurrentPages()[getCurrentPages().length - 1].onReset(); });
  await page.waitFor(800);
  const rs = await page.data('resetSheet');
  console.log('重置弹层 resetSheet=' + rs);
  await shot('03-reset-sheet.png');

  console.log('截图目录: ' + SHOT);
} finally {
  await mp.disconnect();
}
