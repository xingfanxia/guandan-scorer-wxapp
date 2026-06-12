// 玩家档案：openid 维度战绩 + 荣誉（合规别名渲染）+ 成就（读时派生，不落库）
import { checkAchievements, ACHIEVEMENTS, ACHIEVEMENT_COUNT } from '../../shared-logic/achievementLogic.js';
import { displayHonorTitle } from '../../core/honorDisplay.js';

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
    achievementTotal: ACHIEVEMENT_COUNT
  },

  onShow() {
    this.fetchProfile();
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
        .map(([title, count]) => ({ title: displayHonorTitle(title), count: Number(count) }))
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
