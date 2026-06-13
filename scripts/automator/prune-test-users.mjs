#!/usr/bin/env node
/**
 * 一次性管理工具：调 pool_prune 删测试玩家（test_ 前缀），再 pool_list 核对已消失。
 * 用法：node scripts/automator/prune-test-users.mjs test_dnonan test_chaozi
 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const handles = process.argv.slice(2);
if (handles.length === 0) { console.error('用法：prune-test-users.mjs <handle...>'); process.exit(1); }

acquireDevtoolsLock('guandan-scorer-wxapp:prune-test-users');
process.on('exit', releaseDevtoolsLock);

const miniProgram = await launchOrConnect(ROOT);
try {
  const page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(500);
  const callFn = (name, data) => miniProgram.evaluate(
    (n, d) => wx.cloud.callFunction({ name: n, data: d }).then(r => r.result),
    name, data
  );

  const prune = await callFn('pool_prune', { handles });
  console.log('pool_prune →', JSON.stringify(prune));

  const list = await callFn('pool_list', {});
  const remaining = (list.players || []).map(p => p.handle);
  const stillThere = handles.filter(h => remaining.includes(h.toLowerCase()));
  console.log(`pool_list → ${remaining.length} 名玩家；test_ 残留：${remaining.filter(h => h.startsWith('test_')).join(', ') || '无'}`);
  if (stillThere.length > 0) throw new Error(`PRUNE FAIL：仍存在 ${stillThere.join(', ')}`);
  console.log('PRUNE PASS:', handles.join(', '), '已从 pool 删除');
} finally {
  await miniProgram.disconnect();
}
