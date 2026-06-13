// Vendored from guandan-scorer (web) — DO NOT EDIT HERE.
// Upstream: shared/honorCatalog.js @ b5c6a6699cd1e743804a1a283cb33bf481e263cf
// 改规则先改 web repo，再跑 npm run sync:shared 重新同步（见 CLAUDE.md）。
export const HONOR_TITLES_BY_KEY = Object.freeze({
  mvp: '吕布',
  burden: '阿斗',
  stable: '石佛',
  rollercoaster: '波动王',
  comeback: '奋斗王',
  fanche: '翻车王',
  gambler: '赌徒',
  complete: '大满贯',
  streak: '连段王',
  median: '团队中轴',
  carp: '逆转核心',
  nonstick: '保底核心',
  frequent: '节奏核心',
  burnout: '燃尽王',
  almost: '棋差一着',
  resilient: '抗压王'
});

const LEGACY_HONOR_TITLE_ALIASES = Object.freeze({
  小丑: '抗压王',
  连胜王: '连段王',
  佛系玩家: '团队中轴',
  鲤鱼王: '逆转核心',
  不粘锅: '保底核心',
  闪电侠: '节奏核心'
});

export const CURRENT_HONOR_TITLES = Object.freeze(Object.values(HONOR_TITLES_BY_KEY));
export const CURRENT_HONOR_COUNT = CURRENT_HONOR_TITLES.length;

export function createHonorCounter() {
  return Object.fromEntries(CURRENT_HONOR_TITLES.map(title => [title, 0]));
}

export function normalizeHonorCounter(honors = {}) {
  const normalized = createHonorCounter();

  CURRENT_HONOR_TITLES.forEach(title => {
    const legacyTitles = Object.entries(LEGACY_HONOR_TITLE_ALIASES)
      .filter(([, nextTitle]) => nextTitle === title)
      .map(([legacyTitle]) => legacyTitle);
    const count = Number(honors?.[title]);
    const legacyCount = legacyTitles.reduce((total, legacyTitle) => {
      const value = Number(honors?.[legacyTitle]);
      return total + (Number.isFinite(value) ? Math.max(0, value) : 0);
    }, 0);
    normalized[title] = (Number.isFinite(count) ? Math.max(0, count) : 0) + legacyCount;
  });

  return normalized;
}

export function canonicalizeHonorTitle(title) {
  if (typeof title !== 'string') return null;
  if (CURRENT_HONOR_TITLES.includes(title)) return title;
  return Object.prototype.hasOwnProperty.call(LEGACY_HONOR_TITLE_ALIASES, title)
    ? LEGACY_HONOR_TITLE_ALIASES[title]
    : null;
}

export function countCurrentHonors(honors = {}) {
  return CURRENT_HONOR_TITLES
    .filter(title => Number(honors[title]) > 0)
    .length;
}
