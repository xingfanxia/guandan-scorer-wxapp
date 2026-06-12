/**
 * 荣誉显示层（合规约束，见 docs/PLAN.md WXAPP-5）：
 * 存储与计算 key 永远用 honorCatalog 的原始标题（与 web stats schema 互通），
 * UI/海报/截图一律经 displayHonorTitle 渲染 —— 「赌徒」显示为「莽夫」（零"赌"联想）。
 */
const DISPLAY_ALIAS = { '赌徒': '莽夫' };

export function displayHonorTitle(title) {
  return DISPLAY_ALIAS[title] || title;
}

/** 荣誉 caption（web index.html honor__desc 同文案）；key = 存储标题（非别名） */
const HONOR_CAPTIONS = {
  '吕布': '头游率 + 上半区压制 · Dominance',
  '阿斗': '末游率 + 下半区停留 · Burden Arc',
  '石佛': '低方差 + 高位输出 · Stone Buddha',
  '波动王': '全场名次震荡 · Volatility',
  '奋斗王': '前段到后段明显变强 · Climber',
  '翻车王': '上位区坠入底部 · Crash Arc',
  '赌徒': '头游和末游都多 · High Stakes',
  '大满贯': '全场名次图鉴 · Grand Slam',
  '连段王': '连续压在上半区 · Top-Half Streak',
  '团队中轴': '持续强于队友均值 · Team Anchor',
  '逆转核心': '从低位带起后程 · Comeback Core',
  '保底核心': '不垫底且托住队友 · Safety Net',
  '节奏核心': '推动队伍持续领先 · Tempo Core',
  '燃尽王': '前段尚可后段坠落 · Burnout Arc',
  '棋差一着': '二游很多但没有头游 · So Close',
  '抗压王': '低位承压后反弹最多 · Pressure Rebound'
};

export function displayHonorCaption(title) {
  return HONOR_CAPTIONS[title] || '';
}
