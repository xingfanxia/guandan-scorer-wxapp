// 玩家档案：openid 维度战绩 + 荣誉（合规别名渲染）+ 成就（读时派生，不落库）
import { ACHIEVEMENT_COUNT } from '../../shared-logic/achievementLogic.js';
import { buildProfileVM } from '../../core/profileVM.js';

interface ProfileStats {
  sessionsPlayed: number;
  sessionsWon: number;
  longestWinStreak: number;
  totalGames: number;
  firstPlaceCount: number;
  lastPlaceCount: number;
  rankingSum: number;
  rankingGames: number;
  mvpVotes: number;
  burdenVotes: number;
  honors: Record<string, number>;
  sessionHistory: Record<string, { gamesInSession: number; ranking: number; teamWon: boolean; lastPlaces: number }>;
  ladder?: { rating: number; sessions: number; peak: number };
  webImport?: { handle: string; importedAt: string };
  [key: string]: unknown;
}

Page({
  data: {
    loading: true,
    hasProfile: false,
    displayName: '',
    avatarUrl: '',
    summary: { sessionsPlayed: 0, winRate: '—', ladder: 1000 },
    statCells: [] as Array<{ label: string; value: string }>,
    honorRows: [] as Array<{ title: string; count: number }>,
    achievementRows: [] as Array<{ id: string; name: string; badge: string; desc: string }>,
    achievementTotal: ACHIEVEMENT_COUNT,
    boundHandle: ''
  },

  onShow() {
    this.fetchProfile();
  },

  /** 绑定 web 版玩家身份（一次性）：选未被绑定的池玩家 → pool_bind → 老战绩并入 */
  async onBindWeb() {
    let players: Array<{ handle: string; displayName: string; emoji: string; bound: boolean }> = [];
    try {
      const res = await wx.cloud.callFunction({ name: 'pool_list' });
      const r = (res.result || {}) as { ok: boolean; players?: typeof players };
      players = (r.players || []).filter(p => !p.bound);
    } catch { /* fallthrough */ }
    if (players.length === 0) {
      wx.showToast({ title: '玩家池为空或都已被绑定', icon: 'none' });
      return;
    }
    this.showBindSheet(players, 0);
  },

  showBindSheet(players: Array<{ handle: string; displayName: string; emoji: string }>, page: number) {
    const PAGE = 5;
    const slice = players.slice(page * PAGE, page * PAGE + PAGE);
    const hasMore = players.length > (page + 1) * PAGE;
    wx.showActionSheet({
      itemList: [...slice.map(p => `${p.emoji} ${p.displayName}（@${p.handle}）`), ...(hasMore ? ['更多…'] : [])],
      success: (res) => {
        if (hasMore && res.tapIndex === slice.length) {
          this.showBindSheet(players, page + 1);
          return;
        }
        const p = slice[res.tapIndex];
        if (!p) return;
        wx.showModal({
          title: `绑定 @${p.handle}？`,
          content: `每人只能绑定一次，绑定后「${p.displayName}」的 web 版战绩将并入你的档案。`,
          success: (m) => {
            if (!m.confirm) return;
            wx.cloud.callFunction({ name: 'pool_bind', data: { handle: p.handle } }).then((bindRes) => {
              const r = (bindRes.result || {}) as { ok: boolean; message?: string };
              wx.showToast({ title: r.ok ? '绑定成功，战绩已并入' : (r.message || '绑定失败'), icon: 'none' });
              if (r.ok) this.fetchProfile();
            }).catch(() => wx.showToast({ title: '绑定失败，检查网络', icon: 'none' }));
          }
        });
      }
    });
  },

  fetchProfile() {
    wx.cloud.callFunction({ name: 'profile_get' }).then((res) => {
      const r = (res.result || {}) as {
        ok: boolean;
        profile: null | { displayName: string; avatarUrl: string; stats: ProfileStats };
      };
      const vm = r.ok && r.profile ? buildProfileVM(r.profile.stats) : null;
      if (!vm) {
        this.setData({ loading: false, hasProfile: false });
        return;
      }
      const stats = r.profile!.stats;
      this.setData({
        loading: false,
        hasProfile: true,
        boundHandle: (stats.webImport && stats.webImport.handle) || '',
        displayName: r.profile!.displayName,
        avatarUrl: r.profile!.avatarUrl,
        summary: vm.summary,
        statCells: vm.statCells,
        honorRows: vm.honorRows,
        achievementRows: vm.achievementRows
      });
    }).catch(() => {
      this.setData({ loading: false, hasProfile: false });
      wx.showToast({ title: '档案读取失败', icon: 'none' });
    });
  }
});
