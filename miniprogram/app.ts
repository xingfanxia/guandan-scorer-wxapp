import { getStore } from './core/appStore.js';
import { ENV_ID } from './core/cloudConfig.js';

App({
  // 暴露给 automator E2E（getApp().store 直驱编排层做测试 setup）；页面代码用 core/appStore.js 的 getStore()
  store: getStore(),
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: ENV_ID, traceUser: true });
    }
  }
});
