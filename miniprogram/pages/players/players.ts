// 玩家天梯/查询页：池内全员列表（天梯榜序）→ 点开看任意玩家档案（web players.html 对位）
import { buildProfileVM } from '../../core/profileVM.js';

interface PoolRow {
  handle: string;
  displayName: string;
  emoji: string;
  tagline: string;
  sessionsPlayed: number;
  bound: boolean;
  boundToMe: boolean;
  ladder: number;
  ladderProvisional: boolean;
  wxSessions: number;
  totalSessions: number;
}

interface DetailVM {
  emoji: string;
  displayName: string;
  handle: string;
  tagline: string;
  bound: boolean;
  webCells: Array<{ label: string; value: string }>;
  summary: { sessionsPlayed: number; winRate: string; ladder: number } | null;
  statCells: Array<{ label: string; value: string }>;
  honorRows: Array<{ title: string; caption: string; count: number }>;
}

Page({
  data: {
    loading: true,
    rows: [] as Array<PoolRow & { rank: number; ladderText: string }>,
    detail: null as DetailVM | null,
    detailLoading: false
  },

  onShow() {
    this.fetchList();
  },

  fetchList() {
    wx.cloud.callFunction({ name: 'pool_list' }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; players?: PoolRow[] };
      const rows = (r.players || []).map((p, i) => ({
        ...p,
        rank: i + 1,
        // * = 起评分（web 历史折算，还没打过小程序场）
        ladderText: Number.isFinite(p.ladder) ? `${p.ladder}${p.ladderProvisional ? '*' : ''}` : '—'
      }));
      this.setData({ loading: false, rows });
    }).catch(() => {
      // 失败保留已有列表（onShow 每次都会重拉，瞬时故障不该把好数据闪成空池态）
      this.setData({ loading: false });
      wx.showToast({ title: '玩家池读取失败', icon: 'none' });
    });
  },

  onTapPlayer(e: WechatMiniprogram.TouchEvent) {
    const handle = String(e.currentTarget.dataset.handle || '');
    // 在途守卫：慢网下连点两个玩家会并发两个请求，后返回的覆盖先返回的（乱序展示错人）
    if (!handle || this.data.detailLoading) return;
    this.setData({ detailLoading: true });
    wx.cloud.callFunction({ name: 'profile_get_by_handle', data: { handle } }).then((res) => {
      const r = (res.result || {}) as {
        ok: boolean;
        pool?: { handle: string; displayName: string; emoji: string; tagline: string; bound: boolean; webStats: Record<string, number> };
        profile?: null | { displayName: string; avatarUrl: string; stats: unknown };
      };
      if (!r.ok || !r.pool) {
        this.setData({ detailLoading: false });
        wx.showToast({ title: '没找到这名玩家', icon: 'none' });
        return;
      }
      const web = r.pool.webStats || {};
      const webCells = [
        { label: 'web 场次', value: String(web.sessionsPlayed || 0) },
        { label: 'web 胜场', value: String(web.sessionsWon || 0) },
        { label: 'web 场均名次', value: web.avgRankingPerSession ? Number(web.avgRankingPerSession).toFixed(2) : '—' }
      ];
      const vm = r.profile ? buildProfileVM(r.profile.stats) : null;
      this.setData({
        detailLoading: false,
        detail: {
          emoji: r.pool.emoji,
          displayName: r.pool.displayName,
          handle: r.pool.handle,
          tagline: r.pool.tagline,
          bound: r.pool.bound,
          webCells,
          summary: vm ? vm.summary : null,
          statCells: vm ? vm.statCells : [],
          honorRows: vm ? vm.honorRows : []
        }
      });
    }).catch(() => {
      this.setData({ detailLoading: false });
      wx.showToast({ title: '档案读取失败', icon: 'none' });
    });
  },

  onCloseDetail() {
    this.setData({ detail: null });
  }
});
