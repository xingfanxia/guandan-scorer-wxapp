#!/usr/bin/env node
/**
 * E2E：核心计分流（WXAPP-2 verify 的自动化半边）。
 * 流程：seed 4 玩家 → 按名次点 chip → 校验升级预览 → 应用结果 → 校验记分牌/eyebrow → 历史页校验。
 * 原生弹窗（showModal/ActionSheet）automator 驱动不了 —— 那些路径由 store 单测覆盖，此处只走无弹窗主链路。
 * 用法：node scripts/automator/scoring-flow.mjs（需 DevTools 已安装且服务端口开启）
 */
import automator from 'miniprogram-automator';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT_DIR = join(ROOT, 'docs', 'reports', 'wxapp-2-visual');
mkdirSync(SHOT_DIR, { recursive: true });

const fail = (msg) => { throw new Error(`E2E FAIL: ${msg}`); };
const expect = (cond, msg) => { if (!cond) fail(msg); };

const miniProgram = await automator.launch({
  cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  projectPath: ROOT
});

try {
  let page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(500);

  // setup：清空并直驱 store 加满 4 人（绕开原生弹窗）
  await miniProgram.evaluate(() => {
    const store = getApp().store;
    store.resetGame(false);
    store.setMode('4');
    store.addPlayer({ name: '老王', emoji: '🐶', team: 1 });
    store.addPlayer({ name: '老李', emoji: '🐱', team: 1 });
    store.addPlayer({ name: '老张', emoji: '🐭', team: 2 });
    store.addPlayer({ name: '老赵', emoji: '🐰', team: 2 });
  });
  page = await miniProgram.reLaunch('/pages/index/index'); // onShow 重新拉取
  await page.waitFor(500);

  const chips = await page.$$('.chip');
  expect(chips.length === 4, `应有 4 个玩家 chip，实际 ${chips.length}`);
  await miniProgram.screenshot({ path: join(SHOT_DIR, '01-players-ready.png') });

  // 名次录入：t1 双上（老王头游、老李二游），老张三、老赵末游
  for (const i of [0, 1, 2, 3]) {
    await chips[i].tap();
    await page.waitFor(200);
  }

  const previewNum = await page.$('.preview__num');
  expect(previewNum, '录满名次后应出现升级预览条');
  const previewText = await previewNum.text();
  expect(previewText.includes('升 3 级'), `预览应为「升 3 级」，实际「${previewText}」`);
  await miniProgram.screenshot({ path: join(SHOT_DIR, '02-ranks-filled-preview.png') });

  await (await page.$('.actionbar__apply')).tap();
  await page.waitFor(600);

  const t1Level = await (await page.$('.board__level--t1')).text();
  expect(t1Level.trim() === '5', `应用后蓝队级牌应为 5，实际「${t1Level}」`);
  const t2Level = await (await page.$('.board__level--t2')).text();
  expect(t2Level.trim() === '2', `红队级牌应保持 2，实际「${t2Level}」`);
  const eyebrow = await (await page.$('.board__eyebrow')).text();
  expect(eyebrow.includes('打5'), `eyebrow 应含「打5」，实际「${eyebrow}」`);
  expect(eyebrow.includes('蓝队'), `eyebrow 应标注蓝队的级，实际「${eyebrow}」`);
  await miniProgram.screenshot({ path: join(SHOT_DIR, '03-applied-board.png') });

  // 历史页
  page = await miniProgram.navigateTo('/pages/history/history');
  await page.waitFor(500);
  const rowTitle = await page.$('.row__title');
  expect(rowTitle, '历史页应有记录行');
  const rowText = await rowTitle.text();
  expect(rowText.includes('第 1 局') && rowText.includes('蓝队') && rowText.includes('打5'),
    `历史行应为「第 1 局 · 蓝队 … → 打5」，实际「${rowText}」`);
  await miniProgram.screenshot({ path: join(SHOT_DIR, '04-history.png') });

  console.log('E2E PASS: 计分主链路（seed → 名次录入 → 预览 → 应用 → 记分牌 → 历史）全部通过');
  console.log(`screenshots → ${SHOT_DIR}`);
} finally {
  await miniProgram.disconnect();
}
