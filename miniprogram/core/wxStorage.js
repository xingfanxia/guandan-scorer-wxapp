/** wx storage 适配器 —— gameStore 的注入面（{get,set}）。失败必须出声，不静默。 */
export const wxStorage = {
  get(key) {
    try {
      const value = wx.getStorageSync(key);
      return value === '' ? null : value;
    } catch (err) {
      console.error('[storage] 读取失败', key, err);
      return null;
    }
  },
  set(key, value) {
    try {
      wx.setStorageSync(key, value);
    } catch (err) {
      console.error('[storage] 写入失败', key, err);
      wx.showToast({ title: '本地保存失败', icon: 'none' });
    }
  }
};
