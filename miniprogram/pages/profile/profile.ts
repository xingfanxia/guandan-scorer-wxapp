// 玩家档案：openid 维度战绩 + 荣誉（合规别名渲染）+ 成就（读时派生，不落库）
import { checkAchievements, ACHIEVEMENTS, ACHIEVEMENT_COUNT } from '../../shared-logic/achievementLogic.js';
import { displayHonorTitle, displayHonorCaption } from '../../core/honorDisplay.js';

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
  webImport?: { handle: string; importedAt: string };
  [key: string]: unknown;
}

Page({
  data: {
    loading: true,
    hasProfile: false,
    displayName: '',
    avatarUrl: '',
    summary: { sessionsPlayed: 0, winRate: '—' },
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
      if (!r.ok || !r.profile || !r.profile.stats || !r.profile.stats.sessionsPlayed) {
        this.setData({ loading: false, hasProfile: false });
        return;
      }
      const stats = r.profile.stats;
      const winRate = stats.sessionsPlayed > 0 ? stats.sessionsWon / stats.sessionsPlayed : 0;
      const avgRank = stats.rankingGames > 0 ? stats.rankingSum / stats.rankingGames : 0;

      const statCells = [
        { label: '总局数', value: String(stats.totalGames) },
        { label: '最长连胜', value: String(stats.longestWinStreak) },
        { label: '平均名次', value: avgRank ? avgRank.toFixed(2) : '—' },
        { label: '头游', value: String(stats.firstPlaceCount) },
        { label: '垫底', value: String(stats.lastPlaceCount) },
        { label: '最C/最闹票', value: `${stats.mvpVotes}/${stats.burdenVotes}` }
      ];

      const honorRows = Object.entries(stats.honors || {})
        .filter(([, count]) => Number(count) > 0)
        .map(([title, count]) => ({
          title: displayHonorTitle(title),
          caption: displayHonorCaption(title),
          count: Number(count)
        }))
        .sort((a, b) => b.count - a.count);

      // 成就：读时派生（与 web 同一套 vendored 逻辑），lastSession 取最近一场
      const sessionKeys = Object.keys(stats.sessionHistory || {});
      const last = sessionKeys.length > 0 ? stats.sessionHistory[sessionKeys[sessionKeys.length - 1]] : null;
      const earned = checkAchievements(
        { ...stats, sessionWinRate: winRate },
        last || undefined
      ) as string[];
      const achievementRows = earned
        .filter((id) => (ACHIEVEMENTS as Record<string, { name: string; badge: string; desc: string }>)[id])
        .map((id) => {
          const meta = (ACHIEVEMENTS as Record<string, { name: string; badge: string; desc: string }>)[id];
          return { id, name: meta.name, badge: meta.badge, desc: meta.desc };
        });

      this.setData({
        loading: false,
        hasProfile: true,
        boundHandle: (stats.webImport && stats.webImport.handle) || '',
        displayName: r.profile.displayName,
        avatarUrl: r.profile.avatarUrl,
        summary: {
          sessionsPlayed: stats.sessionsPlayed,
          winRate: `${Math.round(winRate * 100)}%`
        },
        statCells,
        honorRows,
        achievementRows
      });
    }).catch(() => {
      this.setData({ loading: false, hasProfile: false });
      wx.showToast({ title: '档案读取失败', icon: 'none' });
    });
  }
});
