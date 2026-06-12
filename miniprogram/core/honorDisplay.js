/**
 * 荣誉显示层（合规约束，见 docs/PLAN.md WXAPP-5）：
 * 存储与计算 key 永远用 honorCatalog 的原始标题（与 web stats schema 互通），
 * UI/海报/截图一律经 displayHonorTitle 渲染 —— 「赌徒」显示为「莽夫」（零"赌"联想）。
 */
const DISPLAY_ALIAS = { '赌徒': '莽夫' };

export function displayHonorTitle(title) {
  return DISPLAY_ALIAS[title] || title;
}
