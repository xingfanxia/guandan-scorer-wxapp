// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/ruleConfig.js @ b5c6a6699cd1e743804a1a283cb33bf481e263cf
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
export const DEFAULT_RULES = {
  c4: {
    '1,2': 3,
    '1,3': 2,
    '1,4': 1
  },
  t6: {
    g3: 7,
    g2: 4,
    g1: 1
  },
  p6: {
    1: 5,
    2: 4,
    3: 3,
    4: 3,
    5: 1,
    6: 0
  },
  t8: {
    g3: 11,
    g2: 5,
    g1: 0
  },
  p8: {
    1: 7,
    2: 6,
    3: 5,
    4: 4,
    5: 3,
    6: 2,
    7: 1,
    8: 0
  }
};

const RULE_KEYS = {
  c4: ['1,2', '1,3', '1,4'],
  t6: ['g3', 'g2', 'g1'],
  p6: ['1', '2', '3', '4', '5', '6'],
  t8: ['g3', 'g2', 'g1'],
  p8: ['1', '2', '3', '4', '5', '6', '7', '8']
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRuleInteger(value, fallback) {
  const parsed = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;

  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function isRuleInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function sanitizeRulesConfig(input = {}) {
  const source = isObject(input) ? input : {};
  const sanitized = {};

  Object.entries(RULE_KEYS).forEach(([sectionName, keys]) => {
    const sectionSource = isObject(source[sectionName]) ? source[sectionName] : {};
    sanitized[sectionName] = {};

    keys.forEach(key => {
      sanitized[sectionName][key] = normalizeRuleInteger(
        sectionSource[key],
        DEFAULT_RULES[sectionName][key]
      );
    });
  });

  return sanitized;
}

export function isValidRuleSettings(settings) {
  if (settings === undefined) return true;
  if (!isObject(settings)) return false;

  return Object.entries(RULE_KEYS).every(([sectionName, keys]) => {
    if (settings[sectionName] === undefined) return true;
    if (!isObject(settings[sectionName])) return false;

    return Object.entries(settings[sectionName]).every(([key, value]) =>
      keys.includes(String(key)) && isRuleInteger(value)
    );
  });
}
