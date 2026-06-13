// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/playerCountMode.js @ ba119979e8c2f37db2eb388d56e955f7c9ef7ccc
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
const VALID_PLAYER_COUNTS = new Set([4, 6, 8]);

export function normalizePlayerCountMode(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return VALID_PLAYER_COUNTS.has(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^(4|6|8)$/.test(trimmed)) {
      return Number(trimmed);
    }
  }

  return null;
}

export function resolvePlayerCountMode(modeValue, fallbackCount = 8) {
  return normalizePlayerCountMode(modeValue) ||
    normalizePlayerCountMode(fallbackCount) ||
    8;
}

export function resolveInitialPlayerCountMode(modeValue, playersOrCount = []) {
  const loadedCount = Array.isArray(playersOrCount)
    ? playersOrCount.length
    : playersOrCount;
  const loadedMode = normalizePlayerCountMode(loadedCount);
  return loadedMode || resolvePlayerCountMode(modeValue);
}
