/**
 * launch-or-connect：IDE 自动化端口（本 repo 固定 9421，见 CLAUDE.md 端口分家）
 * 已被占用时直接 connect 复用现有会话；否则 launch 拉起。
 * 全部步骤带超时 + connect 后探活 —— 半死的自动化会话（IDE 重编译/上一脚本异常退出）
 * 会让无超时的 connect/首个指令永远挂起（2026-06-12 实测 11 分钟无输出）。
 */
import automator from 'miniprogram-automator';

export const AUTO_PORT = 9421;
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
    })
  ]);
}

export async function launchOrConnect(projectPath) {
  let zombie = null;
  try {
    const mp = await withTimeout(
      automator.connect({ wsEndpoint: `ws://localhost:${AUTO_PORT}` }),
      10000,
      'connect'
    );
    zombie = mp;
    await withTimeout(mp.pageStack(), 10000, 'connect 探活');
    return mp;
  } catch (err) {
    if (zombie) await zombie.disconnect().catch(() => {});
    console.log(`[launchOrConnect] connect 不可用（${err.message}），改走 launch`);
    return withTimeout(
      automator.launch({ cliPath: CLI, projectPath, port: AUTO_PORT }),
      180000,
      'launch'
    );
  }
}
