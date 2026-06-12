#!/usr/bin/env node
/**
 * Vendor 同步脚本：从 web repo (guandan-scorer) 复制纯游戏逻辑到 miniprogram/shared-logic/。
 *
 * 单一事实源在 web repo —— 改规则永远先改那边，再跑本脚本同步（见 CLAUDE.md）。
 * 用法：
 *   npm run sync:shared            同步（上游工作区必须干净）
 *   npm run sync:check             校验现有快照未被手改（按各文件头注记的 commit 重新生成比对）
 *   UPSTREAM=/path/to/guandan-scorer node scripts/sync-shared-logic.mjs   自定义上游路径
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = resolve(process.env.UPSTREAM || join(repoRoot, '..', 'guandan-scorer'));
const destDir = join(repoRoot, 'miniprogram', 'shared-logic');
const checkMode = process.argv.includes('--check');

// upstream 相对路径 → vendor 文件名；transform 在头注之前应用于文件内容。
// transform 必须在未命中时抛错 —— 静默 no-op 会让上游改动悄悄绕过重写。
const MANIFEST = [
  { src: 'shared/aLevelLogic.js', dest: 'aLevelLogic.js' },
  { src: 'shared/achievementLogic.js', dest: 'achievementLogic.js' },
  { src: 'shared/gameStatus.js', dest: 'gameStatus.js' },
  { src: 'shared/honorCatalog.js', dest: 'honorCatalog.js' },
  { src: 'shared/honorLogic.js', dest: 'honorLogic.js' },
  { src: 'shared/playerCountMode.js', dest: 'playerCountMode.js' },
  { src: 'shared/roomSnapshotValidation.js', dest: 'roomSnapshotValidation.js' },
  { src: 'shared/ruleConfig.js', dest: 'ruleConfig.js' },
  { src: 'shared/version.js', dest: 'version.js' },
  { src: 'shared/voteSessionKey.js', dest: 'voteSessionKey.js' },
  {
    src: 'src/game/calculator.js',
    dest: 'calculator.js',
    // 上游在 src/game/ 下引用 ../core/；vendor 后全部文件平铺同目录
    transform: (code) => {
      const needle = "from '../core/playerCountMode.js'";
      if (!code.includes(needle)) {
        throw new Error("calculator.js import 重写目标串未命中 —— 上游改了 import 写法，请更新 MANIFEST 的 transform");
      }
      return code.replace(needle, "from './playerCountMode.js'");
    }
  }
];

function git(args, { allowFail = false, raw = false } = {}) {
  try {
    const out = execFileSync('git', ['-C', upstream, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    // raw 用于读文件内容（git show）：trim 会破坏字节保真
    return raw ? out : out.trim();
  } catch (err) {
    if (allowFail) return null;
    const firstLine = String(err.stderr || err.message).trim().split('\n')[0];
    console.error(`✗ 上游 git 调用失败（${upstream}）：${firstLine}`);
    console.error('  上游 repo 不存在或不是 git 仓库？用 UPSTREAM=/path/to/guandan-scorer 指定路径。');
    process.exit(1);
  }
}

function buildVendorContent(src, transform, commit) {
  let code = git(['show', `${commit}:${src}`], { raw: true, allowFail: checkMode });
  if (code === null) return null;
  if (transform) code = transform(code);
  const header = [
    `// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.`,
    `// Upstream: ${src} @ ${commit}`,
    `// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。`,
    ''
  ].join('\n');
  return header + code;
}

// import 闭包校验：每个 vendor 文件的 import 必须指向快照内的兄弟文件，
// 否则说明上游新增了快照外依赖（漏 vendor 的传递依赖）。
function validateImportClosure(contents) {
  const names = new Set(contents.keys());
  const problems = [];
  for (const [dest, content] of contents) {
    for (const m of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('./')) {
        problems.push(`${dest}: 非快照内 import '${spec}'`);
      } else if (!names.has(spec.slice(2))) {
        problems.push(`${dest}: import '${spec}' 不在快照内（上游新增依赖需加进 MANIFEST）`);
      }
    }
  }
  return problems;
}

if (checkMode) {
  // 防手改校验：按各文件头注记的 commit 重新生成期望内容，与磁盘逐字节比对
  let drift = 0;
  for (const { src, dest, transform } of MANIFEST) {
    const destPath = join(destDir, dest);
    if (!existsSync(destPath)) {
      console.error(`✗ ${dest}: 快照文件缺失`);
      drift++;
      continue;
    }
    const actual = readFileSync(destPath, 'utf8');
    const recorded = actual.match(/^\/\/ Upstream: .+ @ ([0-9a-f]{40})$/m)?.[1];
    if (!recorded) {
      console.error(`✗ ${dest}: 头注缺失或格式不对（找不到 upstream commit 注记）`);
      drift++;
      continue;
    }
    const expected = buildVendorContent(src, transform, recorded);
    if (expected === null) {
      console.error(`✗ ${dest}: 注记的 commit ${recorded.slice(0, 7)} 在上游不可达（被 rebase/gc？）`);
      drift++;
    } else if (expected !== actual) {
      console.error(`✗ ${dest}: 与上游 ${recorded.slice(0, 7)} 重新生成的内容不一致 —— 疑似被手改`);
      drift++;
    } else {
      console.log(`✓ ${dest} @ ${recorded.slice(0, 7)}`);
    }
  }
  if (drift) {
    console.error(`\n${drift} 个文件偏离快照。手改请回滚；规则变更走 web repo + npm run sync:shared。`);
    process.exit(1);
  }
  console.log('\n快照完好：无手改痕迹。');
  process.exit(0);
}

const upstreamDirty = git(['status', '--porcelain']);
if (upstreamDirty) {
  console.error(`⚠️  上游工作区有未提交改动 (${upstream})——vendor 快照必须对应一个干净的 commit。先在 web repo 提交，再重跑。`);
  process.exit(1);
}

const upstreamCommit = git(['rev-parse', 'HEAD']);
const onRemote = git(['branch', '-r', '--contains', upstreamCommit], { allowFail: true });
if (!onRemote) {
  console.warn('⚠️  上游 HEAD 尚未推送到任何 remote 分支 —— vendor 注记将指向仅本机存在的 commit。建议先 push web repo 再同步（本次继续执行）。');
}

const contents = new Map();
for (const { src, dest, transform } of MANIFEST) {
  // 经由 git show HEAD 读取而非读工作区文件：保证内容与注记的 commit 严格一致
  contents.set(dest, buildVendorContent(src, transform, upstreamCommit));
}

const problems = validateImportClosure(contents);
if (problems.length) {
  console.error('✗ import 闭包校验失败：');
  problems.forEach(p => console.error(`  - ${p}`));
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
for (const [dest, content] of contents) {
  writeFileSync(join(destDir, dest), content);
  console.log(`✓ → miniprogram/shared-logic/${dest}`);
}

console.log(`\nSynced ${MANIFEST.length} files @ upstream ${upstreamCommit.slice(0, 7)}`);
