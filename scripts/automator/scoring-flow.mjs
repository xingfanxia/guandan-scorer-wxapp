#!/usr/bin/env node
/**
 * E2E：核心计分流（WXAPP-2 verify 的自动化半边）。
 * 流程：seed 4 玩家 → 按名次点 chip → 校验升级预览 → 应用结果 → 校验记分牌/eyebrow → 历史页校验。
 * 原生弹窗（showModal/ActionSheet）automator 驱动不了 —— 那些路径由 store 单测覆盖，此处只走无弹窗主链路。
 * 用法：node scripts/automator/scoring-flow.mjs（需 DevTools 已安装且服务端口开启）
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT_DIR = join(ROOT, 'docs', 'reports', 'wxapp-2-visual');
mkdirSync(SHOT_DIR, { recursive: true });

const fail = (msg) => { throw new Error(`E2E FAIL: ${msg}`); };
const expect = (cond, msg) => { if (!cond) fail(msg); };

acquireDevtoolsLock('guandan-scorer-wxapp:scoring-flow');
process.on('exit', releaseDevtoolsLock);

const miniProgram = await launchOrConnect(ROOT);

/** automator screenshot IPC 在退化会话上会永挂（2026-06-12 实测）—— best-effort，硬验证走 DOM/数据断言 */
function stepTimeout(promise, label, ms = 20000) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`STEP TIMEOUT: ${label}`)), ms); })
  ]);
}
async function shot(name) {
  try {
    await stepTimeout(miniProgram.screenshot({ path: join(SHOT_DIR, name) }), name);
    console.log(`📸 ${name}`);
  } catch (err) {
    console.log(`⚠️ 截图跳过（${err.message}）`);
  }
}


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
  await shot('01-players-ready.png');

  // 名次录入：t1 双上（老王头游、老李二游），老张三、老赵末游
  for (const i of [0, 1, 2, 3]) {
    await chips[i].tap();
    await page.waitFor(200);
  }

  const previewNum = await page.$('.preview__num');
  expect(previewNum, '录满名次后应出现升级预览条');
  const previewText = await previewNum.text();
  expect(previewText.includes('升 3 级'), `预览应为「升 3 级」，实际「${previewText}」`);
  await shot('02-ranks-filled-preview.png');

  await (await page.$('.actionbar__apply')).tap();
  await page.waitFor(600);

  const t1Level = await (await page.$('.board__level--t1')).text();
  expect(t1Level.trim() === '5', `应用后蓝队级牌应为 5，实际「${t1Level}」`);
  const t2Level = await (await page.$('.board__level--t2')).text();
  expect(t2Level.trim() === '2', `红队级牌应保持 2，实际「${t2Level}」`);
  const eyebrow = await (await page.$('.board__eyebrow')).text();
  expect(eyebrow.includes('打5'), `eyebrow 应含「打5」，实际「${eyebrow}」`);
  expect(eyebrow.includes('蓝队'), `eyebrow 应标注蓝队的级，实际「${eyebrow}」`);
  await shot('03-applied-board.png');

  // 历史页（第 1 局 + 逐局排名行）
  page = await miniProgram.navigateTo('/pages/history/history');
  await page.waitFor(500);
  const rowTitle = await page.$('.row__title');
  expect(rowTitle, '历史页应有记录行');
  const rowText = await rowTitle.text();
  expect(rowText.includes('第 1 局') && rowText.includes('蓝队') && rowText.includes('打5'),
    `历史行应为「第 1 局 · 蓝队 … → 打5」，实际「${rowText}」`);
  const ranksLine = await page.$('.row__ranks');
  expect(ranksLine, '历史行应有逐局排名行');
  const ranksText = await ranksLine.text();
  expect(ranksText.includes('1.') && ranksText.includes('老王') && ranksText.includes('4.'),
    `排名行应含全员名次，实际「${ranksText}」`);

  // 会话锁定：开打后换人数必须被拒
  const lockProbe = await miniProgram.evaluate(() => getApp().store.setMode('8'));
  expect(lockProbe && lockProbe.ok === false, `开打后 setMode 应被拒，实际 ${JSON.stringify(lockProbe)}`);

  // store 直驱补满 5 局（绕开通关原生弹窗）：2→5 已打，再 4 局到 A 通关
  await miniProgram.evaluate(() => {
    const store = getApp().store;
    for (let i = 0; i < 4; i++) {
      const s = store.getState();
      const byTeam = (t) => s.players.filter(p => p.team === t).map(p => p.id);
      const rankings = {};
      [...byTeam(1), ...byTeam(2)].forEach((id, idx) => {
        const p = s.players.find(x => x.id === id);
        rankings[idx + 1] = { id: p.id, name: p.name, emoji: p.emoji, team: p.team };
      });
      store.applyResult('t1', [1, 2], rankings);
    }
  });

  page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(500);
  const endedEyebrow = await (await page.$('.board__eyebrow')).text();
  expect(endedEyebrow.includes('通关'), `5 局后应通关，eyebrow=「${endedEyebrow}」`);
  const mvpEl = await page.$('.board__mvp');
  expect(mvpEl, '通关后应显示本场 MVP');
  const mvpText = await mvpEl.text();
  expect(mvpText.includes('老王'), `MVP 应为全头游的老王，实际「${mvpText}」`);
  await shot('05-victory.png');

  // 历史页：本场统计 + 荣誉（≥5 局解锁，吕布=老王）
  page = await miniProgram.navigateTo('/pages/history/history');
  await page.waitFor(500);
  const statRows = await page.$$('.stats__row');
  expect(statRows.length === 4, `统计面板应有 4 行，实际 ${statRows.length}`);
  const honorTitles = await page.$$('.honor-line__title');
  expect(honorTitles.length > 0, '5 局后应有荣誉得主');
  const honorTexts = [];
  for (const h of honorTitles) honorTexts.push(await h.text());
  expect(honorTexts.some(t => t.includes('吕布')), `应颁出吕布，实际 ${JSON.stringify(honorTexts)}`);
  expect(honorTexts.every(t => !t.includes('赌')), `荣誉渲染必须走合规别名，实际 ${JSON.stringify(honorTexts)}`);
  await shot('06-history-stats-honors.png');

  console.log('E2E PASS: 主链路 + 5局通关 + MVP + 统计/荣誉面板 + 排名行 + 会话锁定 全部通过');
  console.log(`screenshots → ${SHOT_DIR}`);
} finally {
  await miniProgram.disconnect();
}
