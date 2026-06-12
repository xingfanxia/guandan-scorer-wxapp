// 主计分页：模式/规则、玩家管理、名次顺序录入、升级预览、应用/撤销/重置、围观分享
import { getStore } from '../../core/appStore.js';
import { getOwnerSession } from '../../core/ownerRoom.js';
import { buildBoardVM } from '../../core/viewModel.js';
import { aggregateSession, computeSessionMvp, computeSessionHonors } from '../../core/victoryStats.js';
import { deriveGameSessionKey, deriveVoteSessionKey } from '../../shared-logic/voteSessionKey.js';
import { drawPoster, POSTER_W, POSTER_H } from '../../core/poster.js';

const EMOJI_POOL = ['🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐯'];

// switch 组件的 color 是 WXML 属性，吃不到 CSS 变量 —— 唯一允许在 WXSS 体系外出现的色值，
// 取值必须与 tokens.wxss 的 --accent 两套保持一致
const ACCENT_BY_THEME: Record<string, string> = { light: '#15694B', dark: '#46B98D' };

interface ChipVM {
  id: number;
  name: string;
  emoji: string;
  team: 1 | 2;
  badge: string;
}

Page({
  data: {
    mode: '4',
    modeNum: 4,
    modeOptions: ['4', '6', '8'],
    teamNames: { t1: '蓝队', t2: '红队' },
    teamLevels: { t1: '2', t2: '2' },
    aFail: { t1: 0, t2: 0 },
    roundOwner: null as string | null,
    nextRoundBase: null as string | null,
    ended: false,
    eyebrow: '',
    prefs: { strictA: true, must1: true, autoNext: true },
    teamRows: [] as Array<{ key: string; team: number; players: ChipVM[] }>,
    playersCount: 0,
    rankHint: '',
    preview: null as null | { upgradeText: string; detail: string },
    accentColor: ACCENT_BY_THEME.light,
    roomCode: '',
    mvpText: ''
  },

  /** 名次录入：玩家 id 按完成顺序排列（头游在前） */
  order: [] as number[],

  onLoad() {
    const theme = (wx.getSystemInfoSync().theme || 'light') as string;
    this.setData({ accentColor: ACCENT_BY_THEME[theme] || ACCENT_BY_THEME.light });
    wx.onThemeChange?.((res) => {
      this.setData({ accentColor: ACCENT_BY_THEME[res.theme] || ACCENT_BY_THEME.light });
    });
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true });
    this.setData({ roomCode: getOwnerSession().getCode() || '' });
    this.refresh();
  },

  onOpenRoom() {
    wx.showLoading({ title: '开房间…' });
    getOwnerSession().create().then((res: { ok: boolean; code?: string; msg?: string }) => {
      wx.hideLoading();
      if (res.ok) {
        this.setData({ roomCode: res.code });
        wx.showToast({ title: `房间 ${res.code} 已开`, icon: 'none' });
      } else {
        wx.showToast({ title: res.msg || '建房失败', icon: 'none' });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '建房失败，检查网络', icon: 'none' });
    });
  },

  onShareAppMessage() {
    const code = getOwnerSession().getCode();
    if (code) {
      return {
        title: `闹掼计分 · 房间 ${code}，来围观比分`,
        path: `/pages/room/room?code=${code}`
      };
    }
    return {
      title: '闹掼计分器 · 线下牌局记分',
      path: '/pages/index/index'
    };
  },

  refresh() {
    const s = getStore().getState();
    const modeNum = Number(s.mode);

    // 玩家不齐时清掉残留的录入顺序
    this.order = this.order.filter((id: number) => s.players.some((p: ChipVM) => p.id === id));

    const toChip = (p: { id: number; name: string; emoji: string; team: number }): ChipVM => {
      const idx = this.order.indexOf(p.id);
      return { ...p, team: p.team as 1 | 2, badge: idx >= 0 ? String(idx + 1) : '' };
    };

    const teamRows = [
      { key: 't1', team: 1, players: s.players.filter((p: ChipVM) => p.team === 1).map(toChip) },
      { key: 't2', team: 2, players: s.players.filter((p: ChipVM) => p.team === 2).map(toChip) }
    ];

    const board = buildBoardVM(s);
    const ended = board.ended;
    const eyebrow = ended ? `${board.eyebrow} · 撤销或重置后可继续` : board.eyebrow;
    let mvpText = '';
    if (ended) {
      const mvp = computeSessionMvp(s);
      if (mvp) mvpText = `本场MVP：${mvp.emoji} ${mvp.name}（平均第 ${mvp.avgRanking.toFixed(2)} 名）`;
    }

    let rankHint: string;
    if (s.players.length < modeNum) {
      rankHint = '';
    } else if (this.order.length === 0) {
      rankHint = '按名次点玩家：头游先点';
    } else if (this.order.length < modeNum) {
      rankHint = `已录 ${this.order.length}/${modeNum}，继续点`;
    } else {
      rankHint = '名次已录满，可应用结果';
    }

    this.setData({
      mode: s.mode,
      modeNum,
      teamNames: s.teamNames,
      teamLevels: s.teamLevels,
      aFail: s.aFail,
      roundOwner: s.roundOwner,
      nextRoundBase: s.nextRoundBase,
      ended,
      eyebrow,
      prefs: s.prefs,
      teamRows,
      playersCount: s.players.length,
      rankHint,
      preview: this.buildPreview(s, modeNum),
      mvpText
    });
  },

  /** 房主结算入库：把认领过座位玩家的本场战绩+票数写进 players 集合（双幂等，可重复点） */
  onSyncProfiles() {
    const code = getOwnerSession().getCode();
    const s = getStore().getState();
    if (!code || !s.gameStatus.ended) return;

    wx.showLoading({ title: '入库中…' });
    const db = wx.cloud.database();
    db.collection('rooms').doc(code).get().then(async (res: { data: Record<string, unknown> }) => {
      const doc = res.data || {};
      const claims = (doc.claims || {}) as Record<string, { openid: string; nickname: string; avatarUrl: string }>;
      if (Object.keys(claims).length === 0) {
        wx.hideLoading();
        wx.showToast({ title: '还没人认领座位 —— 让牌友在房间页认领', icon: 'none' });
        return;
      }

      const agg = aggregateSession(s);
      const honors = computeSessionHonors(s);
      const sessions = agg.players
        .filter(p => claims[String(p.id)])
        .map(p => ({
          openid: claims[String(p.id)].openid,
          displayName: claims[String(p.id)].nickname,
          avatarUrl: claims[String(p.id)].avatarUrl || '',
          mode: s.mode,
          teamWon: p.teamWon,
          gamesInSession: p.games,
          avgRanking: p.avgRanking,
          firstPlaces: p.firstPlaces,
          lastPlaces: p.lastPlaces,
          partnerOpenids: p.partnerIds.map((id: number) => claims[String(id)]?.openid).filter(Boolean),
          opponentOpenids: p.opponentIds.map((id: number) => claims[String(id)]?.openid).filter(Boolean),
          honorsEarned: (honors as Record<string, string[]>)[String(p.id)] || []
        }));

      const gameKey = deriveGameSessionKey({
        roomCode: code,
        gameStatus: s.gameStatus,
        history: s.history,
        finishedAt: null
      });

      // 票数（有就一起入库）
      const voteEpoch = Number(doc.voteEpoch || 0);
      const sessionKey = deriveVoteSessionKey({
        roomCode: code,
        gameStatus: s.gameStatus,
        history: s.history,
        finishedAt: null,
        endGameVotesHistory: new Array(voteEpoch).fill(0)
      });
      let voteKey: string | null = null;
      let voteTallies: Array<{ openid: string; mvp: number; burden: number }> = [];
      if (sessionKey) {
        const tallyRes = await wx.cloud.callFunction({
          name: 'vote_tally',
          data: { code, sessionKey }
        }).catch(() => null);
        const tally = (tallyRes?.result || {}) as {
          ok?: boolean;
          total?: number;
          counts?: { mvp: Record<string, number>; burden: Record<string, number> };
        };
        if (tally.ok && tally.total && tally.counts) {
          voteKey = sessionKey;
          voteTallies = Object.entries(claims).map(([pid, c]) => ({
            openid: c.openid,
            mvp: tally.counts!.mvp[pid] || 0,
            burden: tally.counts!.burden[pid] || 0
          })).filter(t => t.mvp > 0 || t.burden > 0);
        }
      }

      const syncRes = await wx.cloud.callFunction({
        name: 'profile_sync',
        data: { code, gameKey, sessions, voteKey, voteTallies }
      });
      wx.hideLoading();
      const r = (syncRes.result || {}) as { ok: boolean; applied?: number; skipped?: number };
      if (r.ok) {
        wx.showToast({
          title: r.applied ? `已入库 ${sessions.length} 人战绩` : '本场已入过库（幂等跳过）',
          icon: 'none'
        });
      } else {
        wx.showToast({ title: '入库失败，稍后再试', icon: 'none' });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '读取房间失败', icon: 'none' });
    });
  },

  buildPreview(s: ReturnType<ReturnType<typeof getStore>['getState']>, modeNum: number) {
    if (this.order.length !== modeNum || modeNum === 0) return null;
    const winnerInfo = this.deriveWinner(s);
    if (!winnerInfo) return null;
    const p = getStore().previewResult(winnerInfo.winnerKey, winnerInfo.ranks.join(' '));
    if (!p.ok) return null;
    const winnerName = s.teamNames[winnerInfo.winnerKey as 't1' | 't2'];
    if (p.finalWin) {
      return { upgradeText: '通关', detail: `${winnerName}在自己的A级取胜，无末游` };
    }
    const comboName = winnerInfo.ranks[0] === 1 && winnerInfo.ranks[1] === 2 ? '双上 · ' : '';
    return {
      upgradeText: `升 ${p.upgrade} 级`,
      detail: `${comboName}${winnerName} ${p.ranks.join(',')} → 打${p.newLevel}${p.aNote ? ' · ' + p.aNote : ''}`
    };
  },

  /** 从完成顺序导出胜方与胜方名次（胜方 = 头游所在队） */
  deriveWinner(s: { players: Array<{ id: number; team: number }> }) {
    if (this.order.length === 0) return null;
    const byId = new Map(s.players.map(p => [p.id, p]));
    const first = byId.get(this.order[0]);
    if (!first) return null;
    const winnerTeam = first.team;
    const ranks: number[] = [];
    this.order.forEach((id: number, idx: number) => {
      if (byId.get(id)?.team === winnerTeam) ranks.push(idx + 1);
    });
    return { winnerKey: winnerTeam === 1 ? 't1' : 't2', ranks };
  },

  buildPlayerRankings(s: { players: Array<{ id: number; name: string; emoji: string; team: number }> }) {
    const byId = new Map(s.players.map(p => [p.id, p]));
    const rankings: Record<string, unknown> = {};
    this.order.forEach((id: number, idx: number) => {
      const p = byId.get(id);
      if (p) rankings[String(idx + 1)] = { id: p.id, name: p.name, emoji: p.emoji, team: p.team };
    });
    return rankings;
  },

  onMode(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as string;
    const res = getStore().setMode(mode);
    if (!res.ok) {
      wx.showToast({ title: res.msg || '切换失败', icon: 'none' });
      return;
    }
    this.order = [];
    this.refresh();
  },

  onPref(e: WechatMiniprogram.SwitchChange) {
    const key = e.currentTarget.dataset.key as string;
    getStore().setPreference(key, e.detail.value);
    this.refresh();
  },

  onAddPlayer(e: WechatMiniprogram.TouchEvent) {
    const team = Number(e.currentTarget.dataset.team) as 1 | 2;
    wx.showModal({
      title: '加玩家',
      editable: true,
      placeholderText: '名字（≤4字更清楚）',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const store = getStore();
        const used = store.getState().players.length;
        const add = store.addPlayer({
          name: res.content,
          emoji: EMOJI_POOL[used % EMOJI_POOL.length],
          team
        });
        if (!add.ok) wx.showToast({ title: add.msg || '加不进去', icon: 'none' });
        this.refresh();
      }
    });
  },

  onEditPlayer(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id);
    const store = getStore();
    const player = store.getState().players.find((p: { id: number }) => p.id === id);
    if (!player) return;
    wx.showActionSheet({
      itemList: ['改名', player.team === 1 ? '换到红队' : '换到蓝队', '移除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '改名',
            editable: true,
            placeholderText: player.name,
            success: (m) => {
              if (m.confirm && m.content) {
                store.updatePlayer(id, { name: m.content });
                this.refresh();
              }
            }
          });
        } else if (res.tapIndex === 1) {
          store.updatePlayer(id, { team: player.team === 1 ? 2 : 1 });
          this.order = [];
          this.refresh();
        } else if (res.tapIndex === 2) {
          store.removePlayer(id);
          this.order = this.order.filter((x: number) => x !== id);
          this.refresh();
        }
      }
    });
  },

  onTapPlayer(e: WechatMiniprogram.TouchEvent) {
    const s = getStore().getState();
    if (s.players.length < Number(s.mode)) return; // 人没齐先不录名次
    const id = Number(e.currentTarget.dataset.id);
    const idx = this.order.indexOf(id);
    if (idx >= 0) {
      this.order.splice(idx, 1); // 再点取消，其后名次自动前移
    } else if (this.order.length < Number(s.mode)) {
      this.order.push(id);
    }
    this.refresh();
  },

  onApply() {
    const store = getStore();
    const s = store.getState();
    const winnerInfo = this.deriveWinner(s);
    if (!winnerInfo || this.order.length !== Number(s.mode)) return;

    const res = store.applyResult(
      winnerInfo.winnerKey,
      winnerInfo.ranks,
      this.buildPlayerRankings(s)
    );
    if (!res.applied) {
      wx.showToast({ title: res.message || '应用失败，检查名次', icon: 'none' });
      return;
    }
    this.order = [];
    if (res.finalWin) {
      wx.showModal({
        title: '通关',
        content: res.message || '',
        showCancel: false,
        confirmText: '好'
      });
    } else {
      wx.showToast({ title: res.message || '已记一局', icon: 'none' });
    }
    this.refresh();
  },

  /** 生成战绩海报并存相册（canvas 2d 纯文字构图，合规安全） */
  onSavePoster() {
    const s = getStore().getState();
    wx.showLoading({ title: '生成海报…' });
    wx.createSelectorQuery()
      .select('#posterCanvas')
      .fields({ node: true })
      .exec((res) => {
        const canvas = res?.[0]?.node;
        if (!canvas) {
          wx.hideLoading();
          wx.showToast({ title: '画布初始化失败', icon: 'none' });
          return;
        }
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        canvas.width = POSTER_W * dpr;
        canvas.height = POSTER_H * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        drawPoster(ctx, s, getOwnerSession().getCode());

        wx.canvasToTempFilePath({
          canvas,
          success: (file) => {
            wx.saveImageToPhotosAlbum({
              filePath: file.tempFilePath,
              success: () => {
                wx.hideLoading();
                wx.showToast({ title: '海报已存相册', icon: 'none' });
              },
              fail: (err) => {
                wx.hideLoading();
                const denied = String(err.errMsg || '').includes('auth');
                wx.showToast({ title: denied ? '需要相册权限 —— 在设置里打开' : '保存失败', icon: 'none' });
              }
            });
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '海报生成失败', icon: 'none' });
          }
        });
      });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  goRoom() {
    const code = getOwnerSession().getCode();
    if (code) wx.navigateTo({ url: `/pages/room/room?code=${code}` });
  },

  onAdvance() {
    const res = getStore().advanceToNextRound();
    wx.showToast({ title: res.message || '', icon: 'none' });
    this.refresh();
  },

  onUndo() {
    const store = getStore();
    if (store.getState().history.length === 0) {
      wx.showToast({ title: '没有可撤销的记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '撤销最近一局？',
      content: '将删除最近一局记录并还原比分。',
      success: (res) => {
        if (!res.confirm) return;
        const r = store.undoLast();
        wx.showToast({ title: r.success ? '已撤销' : '撤销失败', icon: 'none' });
        this.order = [];
        this.refresh();
      }
    });
  },

  onReset() {
    wx.showActionSheet({
      itemList: ['重置比分（保留玩家）', '连玩家一起清空'],
      success: (sheet) => {
        const preserve = sheet.tapIndex === 0;
        wx.showModal({
          title: preserve ? '重置整场比赛？' : '清空全部？',
          content: preserve ? '比分与历史清零，玩家保留。' : '比分、历史、玩家全部清空。',
          success: (res) => {
            if (!res.confirm) return;
            getStore().resetGame(preserve);
            this.order = [];
            this.refresh();
          }
        });
      }
    });
  }
});
