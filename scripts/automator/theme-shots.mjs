#!/usr/bin/env node
/**
 * 外观开关 E2E：首页驱动 onThemePick 切 深色/浅色/跟随系统，断言 themeClass 翻转 +
 * 选中态持久，并截图三态。用法：node scripts/automator/theme-shots.mjs
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT_DIR = join(ROOT, 'docs', 'reports', 'theme-toggle');
mkdirSync(SHOT_DIR, { recursive: true });
const fail = (m) => { throw new Error('THEME FAIL: ' + m); };

function step(p, label, ms = 30000) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, r) => { t = setTimeout(() => r(new Error('TIMEOUT ' + label)), ms); })
  ]);
}

acquireDevtoolsLock('guandan-scorer-wxapp:theme-shots');
process.on('exit', releaseDevtoolsLock);

let mp;
async function shot(name) {
  try { await step(mp.screenshot({ path: join(SHOT_DIR, name) }), 'shot ' + name, 20000); console.log('📸 ' + name); }
  catch (e) { console.log('⚠️ 截图跳过：' + e.message); }
}

mp = await launchOrConnect(ROOT);
try {
  const page = await mp.reLaunch('/pages/index/index');
  await page.waitFor(700);
  // 摆几个玩家让记分牌有内容（截图更直观）
  await mp.evaluate(() => {
    const s = getApp().store;
    s.resetGame(false); s.setMode('4');
    [['老王', '🐶', 1], ['老李', '🐱', 1], ['老张', '🐭', 2], ['老赵', '🐰', 2]]
      .forEach(([name, emoji, team]) => s.addPlayer({ name, emoji, team }));
  });
  await page.waitFor(400);

  const pick = async (pref) => {
    await step(mp.evaluate((p) => {
      const pages = getCurrentPages();
      pages[pages.length - 1].onThemePick({ currentTarget: { dataset: { pref: p } } });
    }, pref), 'pick ' + pref);
    await page.waitFor(500);
    return step(page.data('themeClass'), 'read themeClass');
  };

  const dark = await pick('dark');
  if (dark !== 'theme--dark') fail('深色未生效，themeClass=' + dark);
  console.log('深色 → themeClass=' + dark);
  await shot('01-dark.png');

  const light = await pick('light');
  if (light !== 'theme--light') fail('浅色未生效，themeClass=' + light);
  console.log('浅色 → themeClass=' + light);
  await shot('02-light.png');

  const auto = await pick('auto');
  if (auto !== 'theme--light' && auto !== 'theme--dark') fail('跟随系统未解析，themeClass=' + auto);
  console.log('跟随系统 → themeClass=' + auto + '（解析到系统主题）');
  await shot('03-auto.png');

  const pref = await step(page.data('themePref'), 'read themePref');
  if (pref !== 'auto') fail('themePref 未记住选中态，=' + pref);

  console.log('THEME PASS: 深/浅/跟随系统 三态切换 + themeClass 正确翻转 + 选中态持久');
  console.log('screenshots → ' + SHOT_DIR);
} finally {
  await mp.disconnect();
}
