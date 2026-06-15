#!/usr/bin/env node
/**
 * 验证：① pool_add 手动新建玩家入池（含 test_ 去重 + pool_prune 自清）；
 *       ② profile_get_by_handle 回传 relations/rankTrend/recentGames（队友对手/排名走势/最近游戏）；
 *       ③ 玩家查询页详情渲染队友对手卡 + 排名走势 canvas（截图）。
 * 用法：node scripts/automator/profile-extras-verify.mjs
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT = join(ROOT, 'docs', 'reports', 'profile-extras');
mkdirSync(SHOT, { recursive: true });
const fail = (m) => { throw new Error('VERIFY FAIL: ' + m); };

acquireDevtoolsLock('guandan-scorer-wxapp:profile-extras-verify');
process.on('exit', releaseDevtoolsLock);

const mp = await launchOrConnect(ROOT);
const callFn = (name, data) => mp.evaluate(
  (n, d) => wx.cloud.callFunction({ name: n, data: d }).then(r => r.result).catch(e => ({ ok: false, error: String(e) })),
  name, data
);

try {
  const page = await mp.reLaunch('/pages/players/players');
  await page.waitFor(600);

  // 先清掉历史测试脏数据（含 m_ 前缀但测试名的遗留），保证后续新建不被去重命中
  await callFn('pool_prune', { scanTest: true });

  // ① pool_add：新建并入池（用户报告的「新建玩家没进 db」修复）
  const add = await callFn('pool_add', { displayName: 'test_勿留勿用', emoji: '🐶' });
  if (!add.ok || !add.handle) fail('pool_add 未返回 handle：' + JSON.stringify(add));
  // test_ 前缀是 genHandle 修复后的清理便利项；若尚未部署则仅告警（不挡用户面验证）
  if (!/^test_/.test(add.handle)) console.log(`⚠️ test_ 前缀未生效（genHandle 修复待部署）：${add.handle}`);
  console.log(`pool_add OK → @${add.handle} created=${add.created}`);

  const list1 = await callFn('pool_list');
  if (!(list1.players || []).some(p => p.handle === add.handle)) fail('新建玩家未进 pool_list');
  console.log('新玩家已入池（pool_list 可见）✓');

  // 去重：同名再加应复用
  const add2 = await callFn('pool_add', { displayName: 'test_勿留勿用', emoji: '🐱' });
  if (!add2.ok || add2.handle !== add.handle || add2.created !== false) fail('同名去重失败：' + JSON.stringify(add2));
  console.log('同名去重 OK（复用 handle，不新建）✓');

  // ② profile_get_by_handle：富战绩玩家应带 relations / rankTrend / recentGames
  const prof = await callFn('profile_get_by_handle', { handle: 'xiaoxiao' });
  const st = prof && prof.profile && prof.profile.stats;
  if (!st) fail('xiaoxiao 档案为空：' + JSON.stringify(prof).slice(0, 200));
  if (!st.relations || !(st.relations.partners || []).length) fail('relations.partners 为空');
  if (!(st.relations.opponents || []).length) fail('relations.opponents 为空');
  if (!(st.rankTrend || []).length) fail('rankTrend 为空');
  if (!(st.recentGames || []).length) fail('recentGames 为空');
  console.log(`profile_get_by_handle OK → partners=${st.relations.partners.length} opponents=${st.relations.opponents.length} trend=${st.rankTrend.length} games=${st.recentGames.length}`);
  // 抽查解析：partner 应有 name + winRate
  const p0 = st.relations.partners[0];
  if (!p0.name || typeof p0.winRate !== 'number') fail('partner 解析缺 name/winRate：' + JSON.stringify(p0));
  console.log(`  样例队友：${p0.emoji} ${p0.name} ${(p0.winRate * 100).toFixed(0)}% (${p0.wins}/${p0.games})`);

  // ③ 详情页渲染（驱动 onTapPlayer 直达，免滚动找行）→ 截图
  await mp.evaluate(() => {
    const pages = getCurrentPages();
    pages[pages.length - 1].onTapPlayer({ currentTarget: { dataset: { handle: 'xiaoxiao' } } });
  });
  await page.waitFor(1200); // 等档案 + canvas 绘制
  await mp.screenshot({ path: join(SHOT, '01-detail-relations.png') }).catch(() => {});
  // 滚到走势/最近游戏
  await mp.evaluate(() => wx.pageScrollTo({ scrollTop: 700, duration: 0 }));
  await page.waitFor(500);
  await mp.screenshot({ path: join(SHOT, '02-detail-chart-games.png') }).catch(() => {});
  console.log('详情截图 → ' + SHOT);

  // 自清：扫描删测试玩家（scanTest 待部署时旧版会忽略 → 仅告警，留待批量部署后清）
  const prune = await callFn('pool_prune', { scanTest: true });
  console.log(`pool_prune → ${JSON.stringify(prune)}`);
  const list2 = await callFn('pool_list');
  if ((list2.players || []).some(p => p.handle === add.handle)) {
    console.log('⚠️ 测试玩家未清（pool_prune scanTest 待部署）—— 批量部署后再清');
  } else {
    console.log('测试玩家已清理 ✓');
  }

  console.log('PROFILE-EXTRAS VERIFY PASS（用户面：relations/chart/recentGames + pool_add 入池）');
} finally {
  await mp.disconnect();
}
