import { getStore } from './core/appStore.js';
import { ENV_ID } from './core/cloudConfig.js';
import { buildPosterLayout } from './core/poster.js';

App({
  // 暴露给 automator E2E（getApp().store 直驱编排层做测试 setup）；页面代码用 core/appStore.js 的 getStore()
  store: getStore(),
  // 同上：E2E 校验长图布局（纯函数，无副作用）
  buildPosterLayout,
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: ENV_ID, traceUser: true });
    }
  }
});
