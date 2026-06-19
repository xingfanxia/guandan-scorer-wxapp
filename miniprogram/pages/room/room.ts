// 围观页：实时比分（watch+轮询）、红蓝队组成、本场统计/荣誉、逐局记录、结束后投票
import { watchRoom } from '../../core/roomSync.js';
import { buildBoardVM, buildHistoryRows, buildSessionStatsVM } from '../../core/viewModel.js';
import { computeSessionMvp } from '../../core/victoryStats.js';
import { deriveVoteSessionKey } from '../../shared-logic/voteSessionKey.js';
import { applyTheme } from '../../core/theme.js';

// 投票/统计用的座位（认领功能已下线，围观端只读）
interface SeatVM {
  id: number;
  name: string;
  emoji: string;
  team: number;
}

Page({
  data: {
    code: '',
    loaded: false,
    loadError: '',
    vm: null as unknown as ReturnType<typeof buildBoardVM> | null,
    rows: [] as unknown[],
    stats: null as unknown,
    seats: [] as SeatVM[],
    // 红蓝队队员组成（围观端展示，按队分组）
    teamRoster: { t1: [] as Array<{ emoji: string; name: string }>, t2: [] as Array<{ emoji: string; name: string }> },
    channelText: '',
    // 结算与投票
    mvp: null as null | { name: string; emoji: string; avg: string },
    voteMvp: 0,
    voteBurden: 0,
    tally: { mvp: {} as Record<string, number>, burden: {} as Record<string, number>, total: 0 },
    myVoted: false,
    isOwner: false
  },

  watcher: null as null | { stop(): void; refresh(): void; syncVersion(v: number): void },
  myOpenid: '', // 用于判定房主（watch 通道 ownerOpenid 比对；room_get 通道直接给 isOwner）
  sessionKey: '',
  lastChannel: 'poll',
  lastDoc: null as null | Record<string, unknown>,

  onLoad(options: Record<string, string | undefined>) {
    const code = String(options.code || '').trim().toUpperCase();
    if (!code) {
      this.setData({ loadError: '没有房间码 —— 从分享卡片进入，或让房主重新分享' });
      return;
    }
    this.setData({ code });

    // 自己的 openid（判定是否房主 → 显示「重新开票」）
    wx.cloud.callFunction({ name: 'profile_get' }).then((res) => {
      const r = (res.result || {}) as { openid?: string };
      this.myOpenid = r.openid || '';
      if (this.lastDoc) this.renderDoc(this.lastDoc, this.lastChannel);
    }).catch(() => { /* 不阻塞围观 */ });

    this.watcher = watchRoom(code, {
      onSnapshot: (doc: Record<string, unknown>, channel: string) => {
        this.lastDoc = doc;
        this.renderDoc(doc, channel);
      },
      onStatus: (status: { channel: string; error: boolean }) => {
        if (status.error && !this.data.loaded) {
          this.setData({ loadError: `连不上房间 ${code} —— 确认房间码，或让房主重新分享` });
        }
        if (status.error && status.channel === 'watch' && this.data.loaded) {
          this.setData({ channelText: '轮询同步中' });
        }
      }
    });
  },

  onShow() {
    applyTheme(this);
    // 后台切回/页面栈返回时主动重同步（watch 可能在后台静默死亡）
    if (this.watcher) this.watcher.refresh();
  },

  renderDoc(doc: Record<string, unknown>, channel: string) {
    this.lastChannel = channel;
    const s = doc.snapshot as Record<string, unknown> | undefined;
    if (!s) return;
    const players = (s.players || []) as Array<{ id: number; name: string; emoji: string; team: number }>;

    // 投票用座位（id/名字/emoji）
    const seats: SeatVM[] = players.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, team: p.team }));
    // 红蓝队队员组成（围观端展示，按队分组）
    const teamRoster = {
      t1: players.filter(p => p.team === 1).map(p => ({ emoji: p.emoji, name: p.name })),
      t2: players.filter(p => p.team === 2).map(p => ({ emoji: p.emoji, name: p.name }))
    };

    const vm = buildBoardVM(s);
    let mvp = null;
    if (vm.ended) {
      const m = computeSessionMvp(s);
      if (m) mvp = { name: m.name, emoji: m.emoji, avg: m.avgRanking.toFixed(2) };
      const voteEpoch = Number(doc.voteEpoch || 0);
      const newKey = deriveVoteSessionKey({
        roomCode: this.data.code,
        gameStatus: s.gameStatus,
        history: s.history,
        finishedAt: null,
        endGameVotesHistory: new Array(voteEpoch).fill(0)
      }) || '';
      if (newKey !== this.sessionKey) {
        // 新一轮投票窗口（重新开票/撤销后再通关）：旧计票与已投状态全部作废
        this.sessionKey = newKey;
        this.setData({
          tally: { mvp: {}, burden: {}, total: 0 },
          myVoted: false,
          voteMvp: 0,
          voteBurden: 0
        });
        if (newKey) this.fetchTally();
      }
    } else if (this.sessionKey) {
      this.sessionKey = '';
      this.setData({ tally: { mvp: {}, burden: {}, total: 0 }, myVoted: false, voteMvp: 0, voteBurden: 0 });
    }

    this.setData({
      loaded: true,
      loadError: '',
      vm,
      rows: buildHistoryRows((s.history || []) as Array<Record<string, unknown>>),
      stats: buildSessionStatsVM(s),
      seats,
      teamRoster,
      mvp,
      isOwner: Boolean(doc.isOwner === true || (this.myOpenid && doc.ownerOpenid === this.myOpenid)),
      channelText: channel === 'watch' ? '实时同步中' : '轮询同步中'
    });
  },

  /** 房主：清空本轮投票重新开票（voteEpoch+1 → 新 sessionKey） */
  onResetVotes() {
    if (!this.sessionKey) return;
    wx.showModal({
      title: '重新开票？',
      content: '本轮已收的票会清空，所有人可重新投。',
      success: (m) => {
        if (!m.confirm) return;
        wx.cloud.callFunction({
          name: 'vote_reset',
          data: { code: this.data.code, sessionKey: this.sessionKey }
        }).then((res) => {
          const r = (res.result || {}) as { ok: boolean; message?: string };
          wx.showToast({ title: r.ok ? '已重新开票' : (r.message || '操作失败'), icon: 'none' });
          if (this.watcher) this.watcher.refresh();
        }).catch(() => wx.showToast({ title: '操作失败，检查网络', icon: 'none' }));
      }
    });
  },

  /* ===== 投票 ===== */

  onPickVote(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id);
    const kind = String(e.currentTarget.dataset.kind);
    if (kind === 'mvp') this.setData({ voteMvp: this.data.voteMvp === id ? 0 : id });
    else this.setData({ voteBurden: this.data.voteBurden === id ? 0 : id });
  },

  onSubmitVote() {
    const { voteMvp, voteBurden } = this.data;
    if (!voteMvp || !voteBurden || !this.sessionKey) return;
    if (voteMvp === voteBurden) {
      wx.showToast({ title: '最C和最闹不能投同一个人', icon: 'none' });
      return;
    }
    wx.cloud.callFunction({
      name: 'vote_submit',
      data: { code: this.data.code, sessionKey: this.sessionKey, vote: { mvp: voteMvp, burden: voteBurden } }
    }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; message?: string };
      if (r.ok) {
        wx.showToast({ title: '已投票', icon: 'none' });
        this.setData({ myVoted: true });
        this.fetchTally();
      } else {
        wx.showToast({ title: r.message || '投票失败', icon: 'none' });
      }
    }).catch(() => wx.showToast({ title: '投票失败，检查网络', icon: 'none' }));
  },

  fetchTally() {
    if (!this.sessionKey) return;
    wx.cloud.callFunction({
      name: 'vote_tally',
      data: { code: this.data.code, sessionKey: this.sessionKey }
    }).then((res) => {
      const r = (res.result || {}) as {
        ok: boolean;
        counts?: { mvp: Record<string, number>; burden: Record<string, number> };
        total?: number;
        myVote?: { mvp: number; burden: number } | null;
      };
      if (!r.ok || !r.counts) return;
      this.setData({
        tally: { mvp: r.counts.mvp, burden: r.counts.burden, total: r.total || 0 },
        myVoted: Boolean(r.myVote),
        voteMvp: r.myVote ? r.myVote.mvp : this.data.voteMvp,
        voteBurden: r.myVote ? r.myVote.burden : this.data.voteBurden
      });
    }).catch(() => { /* 计票失败不打断围观 */ });
  },

  onUnload() {
    if (this.watcher) this.watcher.stop();
  },

  onShareAppMessage() {
    return {
      title: `闹掼计分 · 房间 ${this.data.code}，来围观比分`,
      path: `/pages/room/room?code=${this.data.code}`
    };
  }
});
