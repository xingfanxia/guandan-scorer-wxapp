// 玩家天梯/查询页：池内全员列表（天梯榜序）→ 点开看任意玩家档案（web players.html 对位）
import { buildProfileVM } from '../../core/profileVM.js';
import { ACHIEVEMENT_COUNT } from '../../shared-logic/achievementLogic.js';
import { applyTheme } from '../../core/theme.js';

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
  provisional: boolean;
  ladderSessions: number;
  calibrationLeft: number;
  wxSessions: number;
  seeded: boolean;
  totalSessions: number;
}

interface DetailVM {
  emoji: string;
  displayName: string;
  handle: string;
  tagline: string;
  bound: boolean;
  webSource: boolean; // 档案战绩来自 web（未绑定玩家）→ 措辞标 web
  seeded: boolean; // 天梯分仍是 web 折算起评分（ladder.sessions===0，未在小程序实结）→ 标「（起评分）」
  webFetchFailed: boolean; // 未绑定且 web 全量战绩拉取失败 → 仅展示池内 3 格概要 + 提示
  webCells: Array<{ label: string; value: string }>;
  summary: { sessionsPlayed: number; winRate: string; ladder: number } | null;
  statCells: Array<{ label: string; value: string }>;
  honorRows: Array<{ title: string; caption: string; count: number }>;
  achievementRows: Array<{ id: string; name: string; badge: string; desc: string }>;
  achievementTotal: number;
}

Page({
  data: {
    loading: true,
    rows: [] as Array<PoolRow & { rankText: string; ladderText: string; calibrated: boolean }>,
    calibratedCount: 0,
    detail: null as DetailVM | null,
    detailLoading: false
  },

  onShow() {
    applyTheme(this);
    this.fetchList();
  },

  fetchList() {
    wx.cloud.callFunction({ name: 'pool_list' }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; players?: PoolRow[] };
      // pool_list 已排好序（已校准在前、待校准沉底）；正式名次只编号已校准玩家
      let rank = 0;
      const rows = (r.players || []).map((p) => {
        const calibrated = !p.provisional;
        if (calibrated) rank += 1;
        return {
          ...p,
          calibrated,
          // 待校准（历史 <3 场）沉底不编号；老牌友凭 web 历史拿正式名次
          rankText: calibrated ? String(rank) : '待校准',
          // * = 起评分（web 历史折算，未在小程序实结）—— 与是否校准无关，挣过分才去掉 *
          ladderText: Number.isFinite(p.ladder) ? `${p.ladder}${p.seeded ? '*' : ''}` : '—'
        };
      });
      this.setData({ loading: false, rows, calibratedCount: rank });
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
        profile?: null | { displayName: string; avatarUrl: string; stats: unknown; source?: string };
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
      // 绑定玩家：小程序档案（已并入 web）；未绑定玩家：云函数实时拉的 web 全量战绩。两者同走 VM。
      const vm = r.profile ? buildProfileVM(r.profile.stats) : null;
      const webSource = !r.pool.bound;
      // 起评分标记取真信号（天梯结算场次 0），不看绑定状态 —— 否则「绑了但没打过小程序局」的玩家
      // 列表显示 1209* 而详情却显示无标记的「天梯 1209」，同一人两处打架（review 2026-06-13 修复）
      const seeded = !!vm && vm.ladder.sessions === 0;
      // 未绑定且富档案拉取失败但池内有 web 概要 → 回退仅展示 3 格概要，不编造富战绩
      const webFetchFailed = webSource && !vm && Number(web.sessionsPlayed) > 0;
      this.setData({
        detailLoading: false,
        detail: {
          emoji: r.pool.emoji,
          displayName: r.pool.displayName,
          handle: r.pool.handle,
          tagline: r.pool.tagline,
          bound: r.pool.bound,
          webSource,
          seeded,
          webFetchFailed,
          webCells,
          summary: vm ? vm.summary : null,
          statCells: vm ? vm.statCells : [],
          honorRows: vm ? vm.honorRows : [],
          achievementRows: vm ? vm.achievementRows : [],
          achievementTotal: ACHIEVEMENT_COUNT
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
