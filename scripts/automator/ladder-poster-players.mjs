#!/usr/bin/env node
/**
 * E2E：本 session 新增面 —— 玩家天梯页 / 长图海报布局 / 荣誉 caption。
 * 1. store 直驱打满 5 局通关 → 历史页荣誉行带 caption（用户反馈回归）
 * 2. 海报：getApp().buildPosterLayout 在真机上下文跑长图布局 + #posterCanvas 实绘 + 导出临时 PNG
 * 3. 玩家天梯页：pool_list 列表渲染（24 名池玩家）→ 点首名 → profile_get_by_handle 详情
 * 用法：node scripts/automator/ladder-poster-players.mjs
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT_DIR = join(ROOT, 'docs', 'reports', 'wxapp-9-visual');
mkdirSync(SHOT_DIR, { recursive: true });

const fail = (msg) => { throw new Error(`E2E FAIL: ${msg}`); };
const expect = (cond, msg) => { if (!cond) fail(msg); };

/** automator IPC 偶发永挂（tap/screenshot 不返回）—— 每步限时，快速失败优于无声卡死 */
function step(promise, label, ms = 30000) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`E2E STEP TIMEOUT: ${label}（${ms}ms）`)), ms); })
  ]);
}

let miniProgram; // 由 launchOrConnect 赋值；shot 需要提前引用

/** 截图 best-effort：screenshot IPC 在退化会话上会永挂（2026-06-12 实测三连）——
 * 挂了只警告不中断，硬性验证全部走 page.data/evaluate 断言 */
async function shot(name) {
  try {
    await step(miniProgram.screenshot({ path: join(SHOT_DIR, name) }), `screenshot ${name}`, 20000);
    console.log(`📸 ${name}`);
  } catch (err) {
    console.log(`⚠️ 截图跳过（${err.message}）—— 数据断言不受影响`);
  }
}

acquireDevtoolsLock('guandan-scorer-wxapp:ladder-poster-players');
process.on('exit', releaseDevtoolsLock);

miniProgram = await launchOrConnect(ROOT);

try {
  // === setup：4 人 5 局通关（直驱 store，绕原生弹窗） ===
  let page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(500);
  await miniProgram.evaluate(() => {
    const store = getApp().store;
    store.resetGame(false);
    store.setMode('4');
    store.addPlayer({ name: '老王', emoji: '🐶', team: 1 });
    store.addPlayer({ name: '老李', emoji: '🐱', team: 1 });
    store.addPlayer({ name: '老张', emoji: '🐭', team: 2 });
    store.addPlayer({ name: '老赵', emoji: '🐰', team: 2 });
    for (let i = 0; i < 5; i++) {
      const s = store.getState();
      const byTeam = (t) => s.players.filter(p => p.team === t);
      const rankings = {};
      [...byTeam(1), ...byTeam(2)].forEach((p, idx) => {
        rankings[idx + 1] = { id: p.id, name: p.name, emoji: p.emoji, team: p.team };
      });
      store.applyResult('t1', [1, 2], rankings);
    }
  });

  // === 1. 荣誉 caption 回归（历史页） ===
  page = await miniProgram.reLaunch('/pages/history/history');
  await page.waitFor(600);
  const captions = await page.$$('.honor-line__caption');
  expect(captions.length > 0, '历史页荣誉行应带 caption');
  const capTexts = [];
  for (const c of captions) capTexts.push(await c.text());
  expect(capTexts.some(t => t.includes('Dominance') || t.includes('头游率')),
    `caption 应为 web 同文案，实际 ${JSON.stringify(capTexts.slice(0, 3))}`);
  expect(capTexts.every(t => !t.includes('赌')), 'caption 零「赌」');
  await shot('01-honor-captions.png');

  // === 2. 长图海报：布局断言 + 真画布实绘导出 ===
  const posterProbe = await miniProgram.evaluate(() => {
    const app = getApp();
    const layout = app.buildPosterLayout(app.store.getState(), {
      roomCode: 'E2E001',
      votes: { mvp: [{ emoji: '🐶', name: '老王', count: 3 }], burden: [{ emoji: '🐰', name: '老赵', count: 2 }] },
      timestamp: '2026/6/12 21:00:00'
    });
    const texts = layout.ops.filter(o => o.type === 'text').map(o => o.text);
    return {
      width: layout.width,
      height: layout.height,
      sections: ['掼蛋战绩总览', '🏆 荣誉提名', '🎖️ 特殊荣誉', '📊 玩家排名统计', '🗳️ 观众投票', '📜 比赛历史']
        .filter(s => texts.includes(s)),
      hasGamble: texts.some(t => t.includes('赌')),
      textCount: texts.length
    };
  });
  expect(posterProbe && posterProbe.sections.length === 6,
    `长图应含全部 6 个区块，实际 ${JSON.stringify(posterProbe && posterProbe.sections)}`);
  expect(posterProbe.height > 1800, `长图高度应随内容拉长，实际 ${posterProbe.height}`);
  expect(!posterProbe.hasGamble, '海报文案零「赌」');
  console.log(`poster layout → ${posterProbe.width}x${posterProbe.height}, ${posterProbe.textCount} 条文案`);

  // 实绘：index 页 #posterCanvas 画出来并导出临时 PNG（不动相册权限）
  page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(600);
  await miniProgram.evaluate(() => {
    getApp().__posterFile = undefined;
    const app = getApp();
    const layout = app.buildPosterLayout(app.store.getState(), { roomCode: 'E2E001', timestamp: '2026/6/12 21:00:00' });
    wx.createSelectorQuery().select('#posterCanvas').fields({ node: true }).exec((res) => {
      const canvas = res && res[0] && res[0].node;
      if (!canvas) { app.__posterFile = { ok: false, error: 'no_canvas' }; return; }
      canvas.width = layout.width;
      canvas.height = layout.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#F4F6F3';
      ctx.fillRect(0, 0, layout.width, layout.height);
      for (const op of layout.ops) {
        if (op.type === 'rect') { ctx.fillStyle = op.color; ctx.fillRect(op.x, op.y, op.w, op.h); }
        else { ctx.fillStyle = op.color; ctx.font = op.font; ctx.textAlign = op.align; ctx.fillText(op.text, op.x, op.y); }
      }
      wx.canvasToTempFilePath({
        canvas,
        destWidth: layout.width,
        destHeight: layout.height,
        success: (f) => {
          try {
            const b64 = wx.getFileSystemManager().readFileSync(f.tempFilePath, 'base64');
            app.__posterFile = { ok: true, b64 };
          } catch (err) {
            app.__posterFile = { ok: true, b64: null, note: String(err) };
          }
        },
        fail: (err) => { app.__posterFile = { ok: false, error: String(err && err.errMsg) }; }
      });
    });
  });
  let posterFile;
  for (let i = 0; i < 15; i++) {
    await page.waitFor(1000);
    posterFile = await miniProgram.evaluate(() => getApp().__posterFile);
    if (posterFile !== undefined && posterFile !== null) break;
  }
  expect(posterFile && posterFile.ok, `canvas 实绘导出失败：${JSON.stringify(posterFile)}`);
  if (posterFile.b64) {
    const out = join(SHOT_DIR, '02-poster-long.png');
    writeFileSync(out, Buffer.from(posterFile.b64, 'base64'));
    console.log(`poster PNG → ${out}（${Math.round(posterFile.b64.length * 0.75 / 1024)}KB）`);
  } else {
    console.log(`poster 实绘成功但回传跳过：${posterFile.note || ''}`);
  }

  // === 3. 玩家天梯页：列表 + 详情（page.data 断言 + 直驱页面方法 —— DOM tap 在 automator 下偶发永挂） ===
  page = await step(miniProgram.reLaunch('/pages/players/players'), 'reLaunch players');
  await page.waitFor(2500); // pool_list 真云调用
  let listRows = [];
  for (let i = 0; i < 10; i++) {
    listRows = (await step(page.data('rows'), 'read rows')) || [];
    if (listRows.length > 0) break;
    await page.waitFor(1000);
  }
  expect(listRows.length >= 10, `天梯榜应列出池玩家（24 人池），实际 ${listRows.length} 行`);
  expect(listRows.every(r => /^\d+\*?$/.test(r.ladderText)), `每行都应有天梯分（含 * 起评分），样例 ${JSON.stringify(listRows.slice(0, 3).map(r => r.ladderText))}`);
  const seeded = listRows.filter(r => r.ladderText.endsWith('*')).length;
  console.log(`天梯榜第 1 名：${listRows[0].emoji} ${listRows[0].displayName}（${listRows[0].ladderText} 分）· 共 ${listRows.length} 行 · ${seeded} 人为起评分`);
  await shot('03-ladder-list.png');

  // 直驱 onTapPlayer（等价于点首行），再轮询 detail 数据
  const firstHandle = listRows[0].handle;
  await step(miniProgram.evaluate((h) => {
    const pages = getCurrentPages();
    pages[pages.length - 1].onTapPlayer({ currentTarget: { dataset: { handle: h } } });
  }, firstHandle), 'invoke onTapPlayer');
  let detail = null;
  for (let i = 0; i < 12; i++) {
    await page.waitFor(1000);
    detail = await step(page.data('detail'), 'read detail');
    if (detail) break;
  }
  expect(detail, 'profile_get_by_handle 应返回并展示详情');
  expect(detail.handle === firstHandle, `详情 handle 应为 ${firstHandle}，实际 ${detail && detail.handle}`);
  expect(Array.isArray(detail.webCells) && detail.webCells.length === 3, 'web 老战绩区应有 3 个 cell');
  console.log(`玩家详情：${detail.emoji} ${detail.displayName} @${detail.handle} · bound=${detail.bound} · 小程序statCells=${detail.statCells.length} · 荣誉=${detail.honorRows.length}`);
  await shot('04-player-detail.png');

  console.log('E2E PASS: 荣誉caption + 长图海报(布局/实绘) + 玩家天梯列表/详情 全部通过');
  console.log(`screenshots → ${SHOT_DIR}`);
} finally {
  await miniProgram.disconnect();
}
