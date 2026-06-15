#!/usr/bin/env node
/** 部署后 live 校验：admin(whoami/claim 口令闸) + pool_add(test_ 前缀 + callerBound) + pool_prune 自清。只读为主，建的 test 玩家随手清。 */
import { launchOrConnect } from './launchOrConnect.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDevtoolsLock, releaseDevtoolsLock } from './devtoolsLock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (m) => { throw new Error('POST-DEPLOY FAIL: ' + m); };
acquireDevtoolsLock('guandan-scorer-wxapp:post-deploy-check');
process.on('exit', releaseDevtoolsLock);

const mp = await launchOrConnect(ROOT);
const callFn = (name, data) => mp.evaluate(
  (n, d) => wx.cloud.callFunction({ name: n, data: d }).then(r => r.result).catch(e => ({ ok: false, error: String(e) })),
  name, data
);

try {
  await mp.reLaunch('/pages/index/index');

  // admin 函数 live：whoami（未认领 → isAdmin:false）+ 错口令拒
  const who = await callFn('admin', { action: 'whoami' });
  if (!who || who.ok !== true) fail('admin whoami 未部署/失败: ' + JSON.stringify(who));
  console.log(`admin.whoami OK → isAdmin=${who.isAdmin}`);
  const badClaim = await callFn('admin', { action: 'claim', secret: 'wrong' });
  if (badClaim.ok !== false || badClaim.error !== 'bad_secret') fail('错口令应拒: ' + JSON.stringify(badClaim));
  console.log('admin.claim 错口令正确拒绝 ✓');

  // pool_add live：test_ 前缀 handle + callerBound 字段
  const add = await callFn('pool_add', { displayName: 'test_部署校验', emoji: '🐶' });
  if (!add.ok || !add.handle) fail('pool_add 失败: ' + JSON.stringify(add));
  if (!/^test_/.test(add.handle)) fail('test_ 前缀未生效: ' + add.handle);
  if (typeof add.callerBound !== 'boolean') fail('callerBound 缺失: ' + JSON.stringify(add));
  console.log(`pool_add OK → @${add.handle} created=${add.created} callerBound=${add.callerBound}`);

  // pool_prune scanTest live：清掉刚建的
  const prune = await callFn('pool_prune', { scanTest: true });
  if (!prune.ok || !(prune.removed || []).includes(add.handle)) fail('pool_prune 未清: ' + JSON.stringify(prune));
  console.log(`pool_prune scanTest OK → removed ${JSON.stringify(prune.removed)}`);

  console.log('POST-DEPLOY CHECK PASS: admin / pool_add / pool_prune 均 live 且行为正确');
} finally {
  await mp.disconnect();
}
