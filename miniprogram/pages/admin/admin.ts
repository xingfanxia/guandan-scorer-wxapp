// 战绩审核后台：管理员认领（口令）→ 待审列表 → 通过(profile_sync approveId) / 拒绝(admin reject)
import { applyTheme } from '../../core/theme.js';

interface PendingItem { id: string; code: string; mode: string; summary: string; createdAt?: unknown; timeText?: string }

Page({
  data: {
    loading: true,
    isAdmin: false,
    secret: '',
    items: [] as PendingItem[],
    busy: false
  },

  onShow() {
    applyTheme(this);
    this.refresh();
  },

  refresh() {
    wx.cloud.callFunction({ name: 'admin', data: { action: 'whoami' } }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; isAdmin?: boolean };
      const isAdmin = !!(r.ok && r.isAdmin);
      this.setData({ isAdmin });
      if (isAdmin) this.loadPending();
      else this.setData({ loading: false });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '读取失败', icon: 'none' });
    });
  },

  loadPending() {
    wx.cloud.callFunction({ name: 'admin', data: { action: 'list' } }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; items?: PendingItem[] };
      const items = (r.items || []).map((it) => ({
        ...it,
        timeText: it.createdAt ? new Date(it.createdAt as string).toLocaleString('zh-CN', { hour12: false }) : ''
      }));
      this.setData({ loading: false, items });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '待审列表读取失败', icon: 'none' });
    });
  },

  onSecretInput(e: WechatMiniprogram.Input) {
    this.setData({ secret: e.detail.value });
  },

  onClaim() {
    const secret = this.data.secret.trim();
    if (!secret) { wx.showToast({ title: '先输入口令', icon: 'none' }); return; }
    wx.cloud.callFunction({ name: 'admin', data: { action: 'claim', secret } }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; isAdmin?: boolean };
      if (r.ok && r.isAdmin) {
        wx.showToast({ title: '已认领管理员', icon: 'none' });
        this.setData({ secret: '', loading: true });
        this.refresh();
      } else {
        wx.showToast({ title: '口令不对', icon: 'none' });
      }
    }).catch(() => wx.showToast({ title: '认领失败，检查网络', icon: 'none' }));
  },

  onApprove(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    this.setData({ busy: true });
    wx.cloud.callFunction({ name: 'profile_sync', data: { approveId: id } }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; applied?: number; error?: string };
      this.setData({ busy: false });
      wx.showToast({ title: r.ok ? `已入库（${r.applied || 0} 项）` : (r.error || '审批失败'), icon: 'none' });
      if (r.ok) this.loadPending();
    }).catch(() => {
      this.setData({ busy: false });
      wx.showToast({ title: '审批失败，检查网络', icon: 'none' });
    });
  },

  onReject(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.showModal({
      title: '拒绝这条战绩？',
      content: '拒绝后该提交被丢弃，不入库。',
      success: (m) => {
        if (!m.confirm) return;
        this.setData({ busy: true });
        wx.cloud.callFunction({ name: 'admin', data: { action: 'reject', id } }).then((res) => {
          const r = (res.result || {}) as { ok: boolean };
          this.setData({ busy: false });
          wx.showToast({ title: r.ok ? '已拒绝' : '操作失败', icon: 'none' });
          if (r.ok) this.loadPending();
        }).catch(() => {
          this.setData({ busy: false });
          wx.showToast({ title: '操作失败，检查网络', icon: 'none' });
        });
      }
    });
  }
});
