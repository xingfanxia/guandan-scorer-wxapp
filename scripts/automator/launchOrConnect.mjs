/**
 * launch-or-connect：IDE 自动化端口（本 repo 固定 9421，见 CLAUDE.md 端口分家）
 * 已被占用时直接 connect 复用现有会话；否则 launch 拉起。
 */
import automator from 'miniprogram-automator';

export const AUTO_PORT = 9421;
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

export async function launchOrConnect(projectPath) {
  try {
    return await automator.connect({ wsEndpoint: `ws://localhost:${AUTO_PORT}` });
  } catch {
    return automator.launch({ cliPath: CLI, projectPath, port: AUTO_PORT });
  }
}
