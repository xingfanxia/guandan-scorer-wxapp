/**
 * 荣誉显示层（合规约束，见 docs/PLAN.md WXAPP-5）：
 * 存储与计算 key 永远用 honorCatalog 的原始标题（与 web stats schema 互通），
 * UI/海报/截图一律经 displayHonorTitle 渲染 —— 「赌徒」显示为「莽夫」（零"赌"联想）。
 */
const DISPLAY_ALIAS = { '赌徒': '莽夫' };

export function displayHonorTitle(title) {
  return DISPLAY_ALIAS[title] || title;
}

/** 荣誉 caption（取 web index.html honor__desc 的中文半边，去英文尾注）；key = 存储标题（非别名） */
const HONOR_CAPTIONS = {
  '吕布': '头游率 + 上半区压制',
  '阿斗': '末游率 + 下半区停留',
  '石佛': '低方差 + 高位输出',
  '波动王': '全场名次震荡',
  '奋斗王': '前段到后段明显变强',
  '翻车王': '上位区坠入底部',
  '赌徒': '头游和末游都多',
  '大满贯': '全场名次图鉴',
  '连段王': '连续压在上半区',
  '团队中轴': '持续强于队友均值',
  '逆转核心': '从低位带起后程',
  '保底核心': '不垫底且托住队友',
  '节奏核心': '推动队伍持续领先',
  '燃尽王': '前段尚可后段坠落',
  '棋差一着': '二游很多但没有头游',
  '抗压王': '低位承压后反弹最多'
};

export function displayHonorCaption(title) {
  return HONOR_CAPTIONS[title] || '';
}

/** 成就徽章合规别名：vendored achievementLogic 的「天选之子」badge 是 🎲（赌具图形）—— UI 出口替换 */
const BADGE_ALIAS = { '🎲': '🌟' };

export function displayAchievementBadge(badge) {
  return BADGE_ALIAS[badge] || badge;
}
