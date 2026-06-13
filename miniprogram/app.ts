import { getStore } from './core/appStore.js';
import { ENV_ID } from './core/cloudConfig.js';
import { buildPosterLayout } from './core/poster.js';
import { applyTheme } from './core/theme.js';

App({
  // 暴露给 automator E2E（getApp().store 直驱编排层做测试 setup）；页面代码用 core/appStore.js 的 getStore()
  store: getStore(),
  // 同上：E2E 校验长图布局（纯函数，无副作用）
  buildPosterLayout,
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: ENV_ID, traceUser: true });
    }
    // 系统主题变化（仅 auto 偏好时跟随）：刷新当前页的 themeClass + 导航栏。
    // applyTheme 自身按存储的 themePref 解析 —— 用户固定 light/dark 时系统切换不影响。
    wx.onThemeChange?.(() => {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      if (cur) applyTheme(cur as unknown as WechatMiniprogram.Page.Instance<Record<string, unknown>, Record<string, unknown>>);
    });
  }
});
