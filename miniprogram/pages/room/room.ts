// 围观页：实时比分（watch+轮询）、座位认领（微信身份）、结束后投票
import { watchRoom } from '../../core/roomSync.js';
import { buildBoardVM, buildHistoryRows, buildSessionStatsVM } from '../../core/viewModel.js';
import { computeSessionMvp } from '../../core/victoryStats.js';
import { deriveVoteSessionKey } from '../../shared-logic/voteSessionKey.js';
import { applyTheme } from '../../core/theme.js';

interface SeatVM {
  id: number;
  name: string;
  emoji: string;
  team: number;
  handle: string;
  claim: { nickname: string } | null;
  mine: boolean;
  suggestClaim: boolean; // 这个座位的 handle 绑定的是我 → 一键认领
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
    channelText: '',
    // 认领表单
    claimingSeatId: 0,
    claimNickname: '',
    claimAvatar: '',
    // 结算与投票
    mvp: null as null | { name: string; emoji: string; avg: string },
    voteMvp: 0,
    voteBurden: 0,
    tally: { mvp: {} as Record<string, number>, burden: {} as Record<string, number>, total: 0 },
    myVoted: false,
    isOwner: false
  },

  watcher: null as null | { stop(): void; refresh(): void; syncVersion(v: number): void },
  myOpenid: '',
  myBoundHandle: '',
  myBoundName: '',
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

    // 自己的 openid（座位归属判定）
    wx.cloud.callFunction({ name: 'profile_get' }).then((res) => {
      const r = (res.result || {}) as { openid?: string };
      this.myOpenid = r.openid || '';
      if (this.lastDoc) this.renderDoc(this.lastDoc, this.lastChannel);
    }).catch(() => { /* 不阻塞围观 */ });

    // 我的玩家池绑定（座位「一键认领」提示用）
    wx.cloud.callFunction({ name: 'pool_list' }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; players?: Array<{ handle: string; displayName: string; boundToMe: boolean }> };
      const mine = (r.players || []).find(p => p.boundToMe);
      if (mine) {
        this.myBoundHandle = mine.handle;
        this.myBoundName = mine.displayName;
        if (this.lastDoc) this.renderDoc(this.lastDoc, this.lastChannel);
      }
    }).catch(() => { /* 池子不可用不影响围观 */ });

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
    // 双通道：watch 给原始 doc（claim.openid，客户端比对）；room_get 给脱敏 doc（claim.mine 已判好）
    const claims = (doc.claims || {}) as Record<string, { openid?: string; nickname: string; mine?: boolean }>;
    const players = (s.players || []) as Array<{ id: number; name: string; emoji: string; team: number }>;

    const seats: SeatVM[] = (players as Array<{ id: number; name: string; emoji: string; team: number; handle?: string }>).map(p => {
      const claim = claims[String(p.id)] || null;
      const handle = p.handle || '';
      return {
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        team: p.team,
        handle,
        claim: claim ? { nickname: claim.nickname } : null,
        mine: Boolean(claim && (claim.mine === true || (this.myOpenid && claim.openid === this.myOpenid))),
        suggestClaim: Boolean(!claim && handle && this.myBoundHandle && handle === this.myBoundHandle)
      };
    });

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

  /* ===== 座位认领 ===== */

  onStartClaim(e: WechatMiniprogram.TouchEvent) {
    const seatId = Number(e.currentTarget.dataset.id);
    const seat = (this.data.seats as SeatVM[]).find(s => s.id === seatId);
    // 绑定过玩家池身份 → 昵称预填，一键确认
    this.setData({
      claimingSeatId: seatId,
      claimNickname: seat && seat.suggestClaim ? this.myBoundName : this.data.claimNickname
    });
  },

  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({ claimAvatar: e.detail.avatarUrl });
  },

  onNickInput(e: WechatMiniprogram.Input) {
    this.setData({ claimNickname: e.detail.value });
  },

  onConfirmClaim() {
    const seatId = this.data.claimingSeatId;
    if (!seatId) return;
    const nickname = this.data.claimNickname.trim();
    if (!nickname) {
      wx.showToast({ title: '填个昵称再认领', icon: 'none' });
      return;
    }
    wx.cloud.callFunction({
      name: 'room_claim_seat',
      data: {
        code: this.data.code,
        playerId: seatId,
        action: 'claim',
        profile: { nickname, avatarUrl: this.data.claimAvatar }
      }
    }).then((res) => {
      const r = (res.result || {}) as { ok: boolean; message?: string };
      if (r.ok) {
        wx.showToast({ title: '认领成功', icon: 'none' });
        this.setData({ claimingSeatId: 0, claimNickname: '', claimAvatar: '' });
        // claims 不经 room_write 推送，主动刷一次
        if (this.lastDoc) this.refreshOnce();
      } else {
        wx.showToast({ title: r.message || '认领失败', icon: 'none' });
      }
    }).catch(() => wx.showToast({ title: '认领失败，检查网络', icon: 'none' }));
  },

  onRelease(e: WechatMiniprogram.TouchEvent) {
    const seatId = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '释放座位？',
      content: '释放后别人可以认领这个座位。',
      success: (m) => {
        if (!m.confirm) return;
        wx.cloud.callFunction({
          name: 'room_claim_seat',
          data: { code: this.data.code, playerId: seatId, action: 'release' }
        }).then((res) => {
          const r = (res.result || {}) as { ok: boolean; message?: string };
          if (!r.ok) {
            wx.showToast({ title: r.message || '释放失败', icon: 'none' });
            return;
          }
          this.refreshOnce();
        }).catch(() => wx.showToast({ title: '释放失败，检查网络', icon: 'none' }));
      }
    });
  },

  refreshOnce() {
    // 认领/释放后立即反映 —— 走 room_get（脱敏 + 不依赖客户端读权限），绕开 watch 的版本去重
    wx.cloud.callFunction({ name: 'room_get', data: { code: this.data.code } })
      .then((res) => {
        const r = (res.result || {}) as { ok: boolean; room?: Record<string, unknown> };
        if (r.ok && r.room) {
          this.lastDoc = r.room;
          this.renderDoc(r.room, 'poll');
          // 已直接渲染该版本 → 同步 watcher 去重游标，免得随后的同版本 watch 帧把 mine 闪回 false
          if (this.watcher) this.watcher.syncVersion(Number(r.room.version));
        }
      })
      .catch(() => { /* 失败静等 watch/poll 通道 */ });
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
