#!/usr/bin/env node
/**
 * 玩家数据完整性审计：pool_list 看绑定状态 + 每个玩家 profile_get_by_handle 看 source(wx/web)
 * 与战绩完整度。诊断「绑定玩家档案不完整、未绑定反而完整」的猜想。只读，不写。
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
acquireDevtoolsLock('guandan-scorer-wxapp:player-data-audit');
process.on('exit', releaseDevtoolsLock);

const mp = await launchOrConnect(ROOT);
const callFn = (name, data) => mp.evaluate(
  (n, d) => wx.cloud.callFunction({ name: n, data: d }).then(r => r.result).catch(e => ({ ok: false, error: String(e) })),
  name, data
);

try {
  await mp.reLaunch('/pages/players/players');
  const list = await callFn('pool_list');
  const players = (list && list.players) || [];
  console.log(`pool 玩家数: ${players.length}`);
  console.log('handle / name / bound / totalSessions / ladder');
  for (const p of players) {
    console.log(`  ${p.handle} / ${p.displayName} / bound=${p.bound} / ${p.totalSessions}场 / 天梯${p.ladder}`);
  }
  console.log('\n=== 逐玩家档案完整度（profile_get_by_handle）===');
  for (const p of players) {
    const r = await callFn('profile_get_by_handle', { handle: p.handle });
    const prof = r && r.profile;
    const st = (prof && prof.stats) || null;
    if (!st) {
      console.log(`  ${p.handle}(${p.displayName}): profile=null  bound=${p.bound}  ${p.bound ? '【绑定但无 wx 档案?】' : '【web 拉取失败/无战绩】'}`);
      continue;
    }
    const rel = st.relations || {};
    const pn = (rel.partners || []).length, op = (rel.opponents || []).length;
    const rt = (st.rankTrend || []).length, rg = (st.recentGames || []).length;
    const honors = Object.keys(st.honors || {}).length;
    console.log(`  ${p.handle}(${p.displayName}): source=${prof.source} 局数=${st.totalGames} 头游=${st.firstPlaceCount} 垫底=${st.lastPlaceCount} 荣誉=${honors} 队友=${pn} 对手=${op} 走势=${rt} 最近=${rg}`);
  }
} finally {
  await mp.disconnect();
}
