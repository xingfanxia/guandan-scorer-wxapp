// 对局历史：逐局升级记录 + 最新一局撤销（DESIGN.md：回滚入口只在最新一行）
import { getStore } from '../../core/appStore.js';
import { buildHistoryRows } from '../../core/viewModel.js';

Page({
  data: {
    rows: [] as unknown[]
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const s = getStore().getState();
    this.setData({ rows: buildHistoryRows(s.history) });
  },

  onUndoLatest() {
    const store = getStore();
    wx.showModal({
      title: '撤销最近一局？',
      content: '将删除最近一局记录并还原比分。',
      success: (res) => {
        if (!res.confirm) return;
        const r = store.undoLast();
        wx.showToast({ title: r.success ? '已撤销' : '撤销失败', icon: 'none' });
        this.refresh();
      }
    });
  }
});
