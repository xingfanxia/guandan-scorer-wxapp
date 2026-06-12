/**
 * DevTools 互斥锁 —— 实现跨项目 canonical 约定：
 * ~/.claude/references/wechat-devtools-lock.md（与 dahua-dice-wxapp 共同遵守）。
 * 锁 = `~/.claude/state/wechat-devtools.lock/`（mkdir 原子），owner.json 记
 * project/pid/since，45 分钟僵尸自动可抢。automator/生命周期操作前 acquire，
 * 做完 release；永不 quit/pkill IDE。
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOCK_DIR = join(homedir(), '.claude', 'state', 'wechat-devtools.lock');
const OWNER = join(LOCK_DIR, 'owner.json');
const STALE_MS = 45 * 60 * 1000;
const WAIT_MS = 10000;
const MAX_ATTEMPTS = 60; // 最多等 10 分钟

const sleepSync = (ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* 脚本场景同步等待无碍 */ }
};

export function acquireDevtoolsLock(project) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      mkdirSync(LOCK_DIR, { recursive: false });
      writeFileSync(OWNER, JSON.stringify({
        project,
        pid: process.pid,
        since: new Date().toISOString()
      }, null, 2));
      return;
    } catch (err) {
      let holder = '(unknown)';
      try {
        const age = Date.now() - statSync(OWNER).mtimeMs;
        if (age > STALE_MS) {
          rmSync(LOCK_DIR, { recursive: true, force: true });
          continue;
        }
        holder = JSON.parse(readFileSync(OWNER, 'utf8')).project || holder;
      } catch {
        // owner.json 缺失的半成品锁：直接清
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      console.error(`DevTools 被「${holder}」占用，等 10s 重试 ${attempt + 1}/${MAX_ATTEMPTS}…`);
      sleepSync(WAIT_MS);
    }
  }
  throw new Error('DevTools 互斥锁等待超时（10 分钟）—— 用 devtools-lock.sh status 查占用者，不要 pkill IDE');
}

export function releaseDevtoolsLock() {
  try {
    const holder = JSON.parse(readFileSync(OWNER, 'utf8'));
    if (holder.pid !== process.pid) return; // 不是自己的锁不碰
  } catch { /* 读不到就按自己的清 */ }
  rmSync(LOCK_DIR, { recursive: true, force: true });
}
