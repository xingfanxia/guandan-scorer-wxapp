// 围观页：实时比分（watch+轮询）、座位认领（微信身份）、结束后投票
import { watchRoom } from '../../core/roomSync.js';
import { buildBoardVM, buildHistoryRows } from '../../core/viewModel.js';
import { computeSessionMvp } from '../../core/victoryStats.js';
import { deriveVoteSessionKey } from '../../shared-logic/voteSessionKey.js';

interface SeatVM {
  id: number;
  name: string;
  emoji: string;
  team: number;
  claim: { nickname: string } | null;
  mine: boolean;
}

Page({
  data: {
    code: '',
    loaded: false,
    loadError: '',
    vm: null as unknown as ReturnType<typeof buildBoardVM> | null,
    rows: [] as unknown[],
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
    myVoted: false
  },

  watcher: null as null | { stop(): void },
  myOpenid: '',
  sessionKey: '',
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
      if (this.lastDoc) this.renderDoc(this.lastDoc, 'watch');
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

  renderDoc(doc: Record<string, unknown>, channel: string) {
    const s = doc.snapshot as Record<string, unknown> | undefined;
    if (!s) return;
    const claims = (doc.claims || {}) as Record<string, { openid: string; nickname: string }>;
    const players = (s.players || []) as Array<{ id: number; name: string; emoji: string; team: number }>;

    const seats: SeatVM[] = players.map(p => {
      const claim = claims[String(p.id)] || null;
      return {
        ...p,
        claim: claim ? { nickname: claim.nickname } : null,
        mine: Boolean(claim && this.myOpenid && claim.openid === this.myOpenid)
      };
    });

    const vm = buildBoardVM(s);
    let mvp = null;
    if (vm.ended) {
      const m = computeSessionMvp(s);
      if (m) mvp = { name: m.name, emoji: m.emoji, avg: m.avgRanking.toFixed(2) };
      const voteEpoch = Number(doc.voteEpoch || 0);
      this.sessionKey = deriveVoteSessionKey({
        roomCode: this.data.code,
        gameStatus: s.gameStatus,
        history: s.history,
        finishedAt: null,
        endGameVotesHistory: new Array(voteEpoch).fill(0)
      }) || '';
      if (this.sessionKey && !this.data.tally.total) this.fetchTally();
    }

    this.setData({
      loaded: true,
      loadError: '',
      vm,
      rows: buildHistoryRows((s.history || []) as Array<Record<string, unknown>>),
      seats,
      mvp,
      channelText: channel === 'watch' ? '实时同步中' : '轮询同步中'
    });
  },

  /* ===== 座位认领 ===== */

  onStartClaim(e: WechatMiniprogram.TouchEvent) {
    this.setData({ claimingSeatId: Number(e.currentTarget.dataset.id) });
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
        }).then(() => this.refreshOnce());
      }
    });
  },

  refreshOnce() {
    wx.cloud.database().collection('rooms').doc(this.data.code).get()
      .then((res: { data: Record<string, unknown> }) => {
        if (res.data) {
          this.lastDoc = res.data;
          this.renderDoc(res.data, 'poll');
        }
      })
      .catch(() => { /* 权限未开时静等 watch/poll 通道 */ });
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
