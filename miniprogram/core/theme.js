/**
 * 外观（主题）管理：auto / light / dark 三态，可覆盖系统主题。
 *
 * 机制：把 `theme--light` / `theme--dark` 类挂到页面 `.page` 根节点 —— token 在 `.page`
 * 作用域重定义（见 styles/tokens.wxss），级联给所有子节点，盖过 `@media (prefers-color-scheme)`。
 * 同时用 wx.setNavigationBarColor 同步原生导航栏色（导航栏吃不到 WXSS）。
 * auto 跟随系统当前主题。偏好持久化在本地 storage —— 纯客户端外观偏好，与评分/云数据无关。
 *
 * 用法：页面 onShow 调 applyTheme(this)；切换调 setThemePref(pref) 后再 applyTheme(this)。
 * app.ts 注册 wx.onThemeChange → 系统主题变化时刷新当前页（auto 模式实时跟随）。
 */
const THEME_KEY = 'themePref';
const VALID = ['auto', 'light', 'dark'];

// 导航栏色与 theme.json / tokens.wxss 的 --bg 一致（chrome 不走 WXSS，只能 JS 设）
const NAV = {
  light: { frontColor: '#000000', backgroundColor: '#F4F6F3' },
  dark: { frontColor: '#ffffff', backgroundColor: '#111613' }
};

export function getThemePref() {
  let v;
  try { v = wx.getStorageSync(THEME_KEY); } catch (e) { v = ''; }
  return VALID.includes(v) ? v : 'auto';
}

export function setThemePref(pref) {
  const p = VALID.includes(pref) ? pref : 'auto';
  try { wx.setStorageSync(THEME_KEY, p); } catch (e) { /* 存储满/隐私模式 —— 偏好本次会话仍生效 */ }
  return p;
}

/** 系统当前主题：getAppBaseInfo 是新 API，旧基础库回退 getSystemInfoSync。 */
export function systemTheme() {
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      const t = wx.getAppBaseInfo().theme;
      if (t === 'light' || t === 'dark') return t;
    }
  } catch (e) { /* fall through */ }
  try {
    const t = wx.getSystemInfoSync().theme;
    if (t === 'light' || t === 'dark') return t;
  } catch (e) { /* fall through */ }
  return 'light';
}

/** 偏好 → 实际生效主题（auto 解析为系统当前主题）。 */
export function effectiveTheme(pref) {
  const p = pref || getThemePref();
  return p === 'auto' ? systemTheme() : p;
}

/** 在页面 onShow 调用：把 themeClass + themePref 写进 page.data，并同步原生导航栏。 */
export function applyTheme(page) {
  if (!page || typeof page.setData !== 'function') return;
  const pref = getThemePref();
  const eff = effectiveTheme(pref);
  page.setData({ themeClass: eff === 'dark' ? 'theme--dark' : 'theme--light', themePref: pref });
  try { wx.setNavigationBarColor(NAV[eff] || NAV.light); } catch (e) { /* 导航栏 API 偶发失败，不阻塞 */ }
}
