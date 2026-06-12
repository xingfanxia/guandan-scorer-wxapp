#!/usr/bin/env node
/**
 * 云函数冒烟：room_create（顺带建 rooms 集合）→ room_write CAS 正常路 → 旧版本号写入必须冲突。
 * 在模拟器上下文经 wx.cloud 调用（走真实云环境）。
 */
import automator from 'miniprogram-automator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (msg) => { throw new Error(`CLOUD SMOKE FAIL: ${msg}`); };

const miniProgram = await automator.launch({
  cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  projectPath: ROOT
});

try {
  await miniProgram.reLaunch('/pages/index/index');

  const snapshot = {
    mode: '4',
    players: [],
    teamNames: { t1: '蓝队', t2: '红队' },
    teamLevels: { t1: '2', t2: '2' },
    aFail: { t1: 0, t2: 0 },
    roundLevel: '2',
    roundOwner: null,
    nextRoundBase: null,
    gameStatus: { ended: false, winnerKey: null, winnerName: null, reason: null },
    history: [],
    prefs: { strictA: true, must1: true, autoNext: true }
  };

  const callFn = (name, data) => miniProgram.evaluate(
    (n, d) => wx.cloud.callFunction({ name: n, data: d }).then(r => r.result),
    name,
    data
  );

  const c = await callFn('room_create', { snapshot }) || {};
  if (!c.ok || !/^[A-Z][0-9A-Z]{5}$/.test(c.code || '')) {
    fail(`room_create 失败: ${JSON.stringify(c)}`);
  }
  console.log(`room_create OK → 房间 ${c.code} v${c.version}`);

  const w = await callFn('room_write', {
    code: c.code, baseVersion: 1, snapshot: { ...snapshot, roundLevel: '5' }
  }) || {};
  if (!w.ok || w.version !== 2) fail(`room_write 正常路失败: ${JSON.stringify(w)}`);
  console.log(`room_write OK → v${w.version}`);

  // 故意旧版本
  const s2 = await callFn('room_write', { code: c.code, baseVersion: 1, snapshot }) || {};
  if (s2.ok || s2.error !== 'version_conflict' || s2.currentVersion !== 2) {
    fail(`CAS 冲突检测失败: ${JSON.stringify(s2)}`);
  }
  console.log(`CAS conflict OK → currentVersion=${s2.currentVersion}`);

  // 客户端直读（围观路径权限预检）：默认权限下预期失败，控制台改「所有用户可读」后这里转 OK
  const readProbe = await miniProgram.evaluate((code) => {
    return wx.cloud.database().collection('rooms').doc(code).get()
      .then(() => 'READ_OK')
      .catch((err) => 'READ_DENIED: ' + (err.errMsg || err));
  }, c.code);
  console.log(`viewer direct read probe → ${readProbe}`);

  console.log('CLOUD SMOKE PASS');
} finally {
  await miniProgram.disconnect();
}
