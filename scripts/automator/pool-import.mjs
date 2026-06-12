#!/usr/bin/env node
/** 触发 pool_import（web 玩家池一次性导入）并验证 pool_list。 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

acquireDevtoolsLock('guandan-scorer-wxapp:pool-import');
process.on('exit', releaseDevtoolsLock);

const miniProgram = await launchOrConnect(ROOT);

try {
  await miniProgram.reLaunch('/pages/index/index');
  // 长调用会被 evaluate 自身超时吞掉 —— 发射后把结果挂到 app 全局，轮询取回
  await miniProgram.evaluate(() => {
    getApp().__poolImport = undefined;
    wx.cloud.callFunction({ name: 'pool_import' })
      .then(r => { getApp().__poolImport = r.result; })
      .catch(err => { getApp().__poolImport = { ok: false, error: 'client_call_failed', detail: String((err && err.errMsg) || err) }; });
  });
  let imported;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    imported = await miniProgram.evaluate(() => getApp().__poolImport);
    if (imported !== undefined && imported !== null) break;
  }
  console.log('pool_import →', JSON.stringify(imported));
  if (!imported || !imported.ok) throw new Error('pool_import 失败');

  const list = await miniProgram.evaluate(() =>
    wx.cloud.callFunction({ name: 'pool_list' }).then(r => r.result)
  );
  console.log(`pool_list → ${list.players.length} 名玩家:`,
    list.players.map(p => `@${p.handle}(${p.sessionsPlayed}场)`).join(' '));
  if (!list.players.length) throw new Error('池子是空的');
  console.log('POOL IMPORT PASS');
} finally {
  await miniProgram.disconnect();
}
