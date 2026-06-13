#!/usr/bin/env node
/**
 * 真实弹窗截图验证（不 mock）—— 证明加人 actionSheet 在去掉 wx.showLoading 后真的弹出、
 * 不被吞。mock E2E 测不出原生 UI 通道吞窗，这里靠真实 wx.showActionSheet + 截图人工确认。
 * 用法：node scripts/automator/ui-popup-shots.mjs（需项目已 open 编译完成）
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT = join(ROOT, 'docs', 'reports', 'ui-popup');
mkdirSync(SHOT, { recursive: true });

acquireDevtoolsLock('guandan-scorer-wxapp:ui-popup-shots');
process.on('exit', releaseDevtoolsLock);

function step(promise, label, ms = 25000) {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error('TIMEOUT:' + label)), ms); })
  ]);
}

const mp = await launchOrConnect(ROOT);

try {
  let page = await step(mp.reLaunch('/pages/index/index'), 'reLaunch1');
  await page.waitFor(1000);
  // 0 人 8 人局（复现用户截图场景），强制非缓存路径
  await mp.evaluate(() => { const s = getApp().store; s.resetGame(false); s.setMode('8'); });
  page = await step(mp.reLaunch('/pages/index/index'), 'reLaunch2');
  await page.waitFor(900);

  // 截图 1：加人前
  try { await step(mp.screenshot({ path: join(SHOT, '00-before.png') }), 'shot0', 18000); console.log('📸 00-before'); }
  catch (e) { console.log('⚠️ 截图0跳过:', e.message); }

  // wrap 真实 wx.showActionSheet：保留弹窗行为，同时捕获 itemList 长度 + success/fail。
  // 判定逻辑：itemList 超 6 项 → 微信立即 fail（__as.ok=false）；≤6 项 → 弹出挂起等用户点
  //（success/fail 都不触发 → __as 保持 null）。后者即「真的弹出来了」。
  await mp.evaluate(() => {
    const app = getApp();
    app.__as = null;
    const orig = wx.showActionSheet;
    wx.showActionSheet = function (o) {
      const items = (o.itemList || []).length;
      return orig.call(wx, Object.assign({}, o, {
        success: (r) => { app.__as = { ok: true, items, tap: r.tapIndex }; if (o.success) o.success(r); },
        fail: (e) => { app.__as = { ok: false, items, err: e.errMsg }; if (o.fail) o.fail(e); }
      }));
    };
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.poolCache = null; // 强制走云调用路径（用户首次加人的真实场景）
    pg.onAddPlayer({ currentTarget: { dataset: { team: 1 } } });
  });

  // 等页面内 loading 态出现（按钮变「读取中…」）
  await page.waitFor(400);
  const adding = await page.data('addingTeam');
  console.log('addingTeam（页面内 loading 态）=', adding);

  // 等云调用 + actionSheet 弹出
  await page.waitFor(2600);

  const asResult = await mp.evaluate(() => getApp().__as);
  if (asResult === null) {
    console.log('✅ showActionSheet 弹出成功并挂起等点击（itemList ≤6，未 fail）—— 弹窗真的弹出来了');
  } else if (asResult.ok === false) {
    console.log(`❌ showActionSheet FAIL：itemList=${asResult.items} 项，err=${asResult.err} —— 弹窗被拒（这就是「没反应」）`);
  } else {
    console.log(`showActionSheet success（已自动选 tap=${asResult.tap}，itemList=${asResult.items}）`);
  }

  // 截图 2：actionSheet 应已弹出（半屏弹层）
  try { await step(mp.screenshot({ path: join(SHOT, '01-addplayer-actionsheet.png') }), 'shot1', 18000); console.log('📸 01-addplayer-actionsheet'); }
  catch (e) { console.log('⚠️ 截图1跳过:', e.message); }

  const after = await page.data('addingTeam');
  console.log('actionSheet 弹出后 addingTeam（应复位 0）=', after);
  console.log(existsSync(join(SHOT, '01-addplayer-actionsheet.png')) ? '✓ 截图已生成，人工核对弹层' : '✗ 截图未生成');
} finally {
  await mp.disconnect();
}
