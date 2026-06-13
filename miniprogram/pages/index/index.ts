// 主计分页：模式/规则、玩家管理、名次顺序录入、升级预览、应用/撤销/重置、围观分享
import { getStore } from '../../core/appStore.js';
import { getOwnerSession } from '../../core/ownerRoom.js';
import { buildBoardVM } from '../../core/viewModel.js';
import { computeSessionMvp } from '../../core/victoryStats.js';
import { buildProfileSessions } from '../../core/profileSession.js';
import { buildPosterLayout, paintPoster } from '../../core/poster.js';
import { deriveVoteSessionKey } from '../../shared-logic/voteSessionKey.js';

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
    addingTeam: 0 as 0 | 1 | 2, // 加人云调用进行中的队（页面内 loading 态，替代原生 wx.showLoading）
    rankHint: '',
    preview: null as null | { upgradeText: string; detail: string },
    accentColor: ACCENT_BY_THEME.light,
    roomCode: '',
    mvpText: '',
    resetSheet: false, // 重置底部弹层显隐（页面内自定义，替代原生 actionSheet+modal）
    // 加人底部弹层：一屏可滚动全员 + 多选一次加入（替代原生 actionSheet 分页翻页）
    poolSheet: {
      show: false,
      target: 0 as 0 | 1 | 2, // 去向：0=随机分队、1=蓝队、2=红队
      rows: [] as Array<{ handle: string; displayName: string; emoji: string; sub: string; selected: boolean }>,
      selectedCount: 0
    }
  },

  /** 名次录入：玩家 id 按完成顺序排列（头游在前） */
  order: [] as number[],

  onLoad() {
    // getSystemInfoSync 已废弃；getAppBaseInfo 基础库 2.20+，老库回退
    const base = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    const theme = (base.theme || 'light') as string;
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

  /** 房主结算入库：服务端做白名单/key 派生/票数聚合，客户端只送本场聚合（双幂等，可重复点） */
  async onSyncProfiles() {
    const code = getOwnerSession().getCode();
    const s = getStore().getState();
    if (!code || !s.gameStatus.ended) return;

    wx.showLoading({ title: '入库中…' });
    const sessions = buildProfileSessions(s); // openid 归属（认领 ∪ 玩家池绑定）由服务端解析
    try {
      const syncRes = await wx.cloud.callFunction({
        name: 'profile_sync',
        data: { code, sessions }
      });
      wx.hideLoading();
      const r = (syncRes.result || {}) as { ok: boolean; applied?: number; message?: string };
      if (r.ok) {
        wx.showToast({
          title: r.applied ? `已入库 ${sessions.length} 人战绩` : '本场已入过库（幂等跳过）',
          icon: 'none'
        });
      } else {
        wx.showToast({ title: r.message || '入库失败，稍后再试', icon: 'none' });
      }
    } catch {
      wx.hideLoading();
      wx.showToast({ title: '入库失败，检查网络', icon: 'none' });
    }
  },

  /** 随机分队（开打后 store 层会拒绝） */
  onShuffleTeams() {
    const res = getStore().shuffleTeams();
    if (!res.ok) {
      wx.showToast({ title: res.msg || '分不了队', icon: 'none' });
      return;
    }
    this.order = [];
    this.refresh();
    wx.showToast({ title: '已随机分队', icon: 'none' });
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
    const store = getStore();
    const s = store.getState();
    if (s.mode === mode) return;

    // 换人数 = 重新组局，名单一律清空（杜绝旧局玩家残留成「placeholder」）
    const started = s.history.length > 0;
    if (started || s.players.length > 0) {
      wx.showModal({
        title: started ? `开新一局（${mode}人）？` : `换成 ${mode} 人局？`,
        content: started
          ? '本场比分、历史、玩家名单清零，按新人数重新加人；围观房间换新（旧房间留档）。'
          : '当前玩家名单会清空，按新人数重新加人。',
        confirmText: started ? '开新一局' : '换并清空',
        success: (m) => {
          if (!m.confirm) return;
          store.resetGame(false); // 清空玩家 —— 开新一局总是干净名单
          store.setMode(mode);
          if (started) {
            getOwnerSession().detach(); // 新一局 = 新房间，统计跟房间走
            this.setData({ roomCode: '' });
          }
          this.order = [];
          this.refresh();
        }
      });
      return;
    }

    // 空名单未开打：直接切
    const res = store.setMode(mode);
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

  addingPlayer: false,

  /**
   * 加人：打开页面内自定义弹层（一屏可滚动全员 + 多选一次加入），**不用原生 actionSheet**。
   * 原生 actionSheet itemList 上限 6 项 → 24 人池要反复翻「更多」，体验差且吞窗（用户反馈）。
   * 自定义弹层一屏滚动看全部、勾多个一次加、池空/不可用也能手输。
   */
  async onAddPlayer(e: WechatMiniprogram.TouchEvent) {
    if (this.addingPlayer) return;
    const team = Number(e.currentTarget.dataset.team) as 1 | 2;
    const openSheet = (pool: Array<{ handle: string; displayName: string; emoji: string; sessionsPlayed: number; totalSessions?: number }>) => {
      const taken = new Set(
        getStore().getState().players.map((p: { handle?: string }) => p.handle).filter(Boolean)
      );
      // 活跃度 = 总出场次数（绑定后含小程序场，否则 web 场次）
      const activeOf = (p: { totalSessions?: number; sessionsPlayed?: number }) =>
        Number(p.totalSessions ?? p.sessionsPlayed) || 0;
      const rows = pool
        .filter(p => !taken.has(p.handle))
        .slice()
        .sort((a, b) => activeOf(b) - activeOf(a)) // 默认按最活跃玩家倒序
        .map(p => {
          const n = activeOf(p);
          return {
            handle: p.handle,
            displayName: p.displayName,
            emoji: p.emoji,
            sub: n ? `${n} 场` : '新',
            selected: false
          };
        });
      // 默认「随机分队」模式（选完一次随机平衡分两队）；想手动指定队再切蓝/红
      void team; // team 仅用于手输兜底时的落队（onPoolManual），加人去向以 target 为准
      this.setData({ poolSheet: { show: true, target: 0, rows, selectedCount: 0 } });
    };

    // 缓存命中（60s）：直接开弹层
    if (this.poolCache && Date.now() - this.poolCache.at < 60000) {
      openSheet(this.poolCache.players);
      return;
    }
    // 首次/失效：页面内 loading 态（按钮「读取中…」），不碰原生 wx.showLoading
    this.addingPlayer = true;
    this.setData({ addingTeam: team });
    let pool: Array<{ handle: string; displayName: string; emoji: string; sessionsPlayed: number; totalSessions?: number }> = [];
    try {
      pool = await this.getPoolPlayers();
    } finally {
      this.addingPlayer = false;
      this.setData({ addingTeam: 0 });
    }
    openSheet(pool);
  },

  /** 弹层内勾选/取消一个池玩家 */
  onPoolToggle(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.idx);
    const rows = this.data.poolSheet.rows.slice();
    if (!rows[idx]) return;
    rows[idx] = { ...rows[idx], selected: !rows[idx].selected };
    this.setData({
      'poolSheet.rows': rows,
      'poolSheet.selectedCount': rows.filter(r => r.selected).length
    });
  },

  /** 弹层去向切换：随机分队 / 蓝队 / 红队 */
  onPoolTarget(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'poolSheet.target': Number(e.currentTarget.dataset.target) as 0 | 1 | 2 });
  },

  /** 一次加入所有勾选的池玩家；target=0 随机平衡分到两队 */
  onPoolConfirm() {
    const { target, rows } = this.data.poolSheet;
    const store = getStore();
    let selected = rows.filter(r => r.selected);
    if (target === 0) {
      // 随机分队：打散后依次填入当前人少的队（平衡），开打前还能再点「随机分队」重洗
      const arr = selected.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      selected = arr;
    }
    let added = 0;
    let failMsg = '';
    for (const r of selected) {
      let team: 1 | 2;
      if (target === 0) {
        const s = store.getState();
        const t1n = s.players.filter((p: { team: number }) => p.team === 1).length;
        const t2n = s.players.filter((p: { team: number }) => p.team === 2).length;
        team = t1n <= t2n ? 1 : 2;
      } else {
        team = target;
      }
      const res = store.addPlayer({ name: r.displayName, emoji: r.emoji, team, handle: r.handle });
      if (res.ok) added += 1; else failMsg = res.msg || '加不下了';
    }
    this.setData({ poolSheet: { show: false, target, rows: [], selectedCount: 0 } });
    this.refresh();
    if (failMsg) wx.showToast({ title: failMsg, icon: 'none' });
    else if (added) wx.showToast({ title: `加了 ${added} 人`, icon: 'none' });
  },

  onPoolClose() {
    this.setData({ 'poolSheet.show': false });
  },

  noop() { /* 吸收弹层内部点击，阻止冒泡到 mask（catchtap 占位） */ },

  /** 弹层「手动输入」：关弹层后隔宏任务弹单个 editable modal（避免 setData→modal 衔接吞窗） */
  onPoolManual() {
    const { target } = this.data.poolSheet;
    let team: 1 | 2;
    if (target === 0) {
      const s = getStore().getState();
      const t1n = s.players.filter((p: { team: number }) => p.team === 1).length;
      const t2n = s.players.filter((p: { team: number }) => p.team === 2).length;
      team = t1n <= t2n ? 1 : 2;
    } else {
      team = target;
    }
    this.setData({ 'poolSheet.show': false });
    setTimeout(() => this.promptManualAdd(team), 60);
  },

  poolCache: null as null | { at: number; players: Array<{ handle: string; displayName: string; emoji: string; sessionsPlayed: number; totalSessions?: number }> },

  async getPoolPlayers() {
    if (this.poolCache && Date.now() - this.poolCache.at < 60000) return this.poolCache.players;
    try {
      // 云函数 hang 不能拖死加人按钮 —— 3.5s 超时降级（命中旧缓存或空池走手输）
      const res = await Promise.race([
        wx.cloud.callFunction({ name: 'pool_list' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('pool_list timeout')), 3500))
      ]);
      const r = ((res as { result?: unknown }).result || {}) as { ok: boolean; players?: Array<{ handle: string; displayName: string; emoji: string; sessionsPlayed: number; totalSessions?: number }> };
      const players = (r.ok && r.players) || [];
      this.poolCache = { at: Date.now(), players };
      return players;
    } catch {
      return this.poolCache ? this.poolCache.players : []; // 池子不可用/超时 → 旧缓存或手输兜底
    }
  },

  /**
   * 选人 actionSheet。微信 itemList **硬上限 6 项** —— 之前一页 5 池+更多+手输=7 项
   * 超限直接 fail，actionSheet 根本不弹（用户实测「没反应」的真因）。每页 4 池玩家：
   * hasMore 时 4+更多+手输=6；末页 ≤4+手输≤5，恒 ≤6。
   */
  showPoolSheet(team: 1 | 2, candidates: Array<{ handle: string; displayName: string; emoji: string }>, page: number) {
    const PAGE = 4;
    const slice = candidates.slice(page * PAGE, page * PAGE + PAGE);
    const hasMore = candidates.length > (page + 1) * PAGE;
    const items = [
      ...slice.map(p => `${p.emoji} ${p.displayName}（@${p.handle}）`),
      ...(hasMore ? ['更多牌友…'] : []),
      '手动输入'
    ];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex < slice.length) {
          const p = slice[res.tapIndex];
          const add = getStore().addPlayer({ name: p.displayName, emoji: p.emoji, team, handle: p.handle });
          if (!add.ok) wx.showToast({ title: add.msg || '加不进去', icon: 'none' });
          this.refresh();
        } else if (hasMore && res.tapIndex === slice.length) {
          this.showPoolSheet(team, candidates, page + 1);
        } else {
          this.promptManualAdd(team);
        }
      },
      fail: (err) => {
        // 用户取消(cancel)静默；其余失败（如 itemList 超限）降级手输，绝不静默「没反应」
        if (!String(err.errMsg || '').includes('cancel')) this.promptManualAdd(team);
      }
    });
  },

  promptManualAdd(team: 1 | 2) {
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
          const r = store.updatePlayer(id, { team: player.team === 1 ? 2 : 1 });
          if (!r.ok) wx.showToast({ title: r.msg || '换不了队', icon: 'none' });
          this.order = [];
          this.refresh();
        } else if (res.tapIndex === 2) {
          const r = store.removePlayer(id);
          if (!r.ok) wx.showToast({ title: r.msg || '删不了', icon: 'none' });
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

    // 开打即建房（默认有房间，分享/围观随时可用）；失败静默——房间是增强不是前提
    if (!getOwnerSession().getCode() && wx.cloud) {
      getOwnerSession().create().then((r: { ok: boolean; code?: string }) => {
        if (r.ok) this.setData({ roomCode: r.code });
      }).catch(() => { /* 静默：无网/未部署时单机照常 */ });
    }
  },

  /** 观众投票数据（海报用）：房主读自己房间的 voteEpoch → 派生 voteKey → vote_tally */
  async collectPosterVotes(s: ReturnType<ReturnType<typeof getStore>['getState']>) {
    const code = getOwnerSession().getCode();
    if (!code || !s.gameStatus?.ended || !wx.cloud) return null;
    const doc = await wx.cloud.database().collection('rooms').doc(code).get();
    const voteEpoch = Number((doc.data as { voteEpoch?: number }).voteEpoch || 0);
    const key = deriveVoteSessionKey({
      roomCode: code,
      gameStatus: s.gameStatus,
      history: s.history,
      finishedAt: null,
      endGameVotesHistory: new Array(voteEpoch).fill(0)
    });
    if (!key) return null;
    const res = await wx.cloud.callFunction({ name: 'vote_tally', data: { code, sessionKey: key } });
    const r = (res.result || {}) as { ok: boolean; counts?: { mvp: Record<string, number>; burden: Record<string, number> } };
    if (!r.ok || !r.counts) return null;
    const byId = new Map<string, { emoji: string; name: string }>();
    for (const p of s.players) byId.set(String(p.id), p);
    const rows = (m: Record<string, number>) => Object.entries(m || {})
      .map(([pid, count]) => {
        const p = byId.get(String(pid));
        return p ? { emoji: p.emoji, name: p.name, count } : null;
      })
      .filter((v): v is { emoji: string; name: string; count: number } => Boolean(v))
      .sort((a, b) => b.count - a.count);
    const votes = { mvp: rows(r.counts.mvp), burden: rows(r.counts.burden) };
    return votes.mvp.length || votes.burden.length ? votes : null;
  },

  /** MVP 宣言（海报引言，web 版对位）：MVP 座位带池 handle 时取其 tagline */
  async collectMvpTagline(s: { gameStatus: { ended?: boolean } | null; players: Array<{ id: number; handle?: string | null }> }) {
    if (!s.gameStatus?.ended || !wx.cloud) return '';
    const mvp = computeSessionMvp(s);
    const handle = mvp && s.players.find((p) => p.id === mvp.id)?.handle;
    if (!handle) return '';
    const res = await wx.cloud.callFunction({ name: 'profile_get_by_handle', data: { handle } });
    const r = (res.result || {}) as { ok: boolean; pool?: { tagline?: string } };
    return (r.ok && r.pool && r.pool.tagline) || '';
  },

  // 在途守卫标记（实例字段，不进 data —— 不需要驱动渲染）
  posterBusy: false,

  /** 生成战绩长图（对齐 web 手机版导出的信息密度）并存相册 */
  async onSavePoster() {
    // 在途守卫：生成期间重复点会并发两条 canvas/云调用链
    if (this.posterBusy) return;
    this.posterBusy = true;
    const done = () => {
      this.posterBusy = false;
      wx.hideLoading();
    };
    const s = getStore().getState();
    wx.showLoading({ title: '生成长图…', mask: true });
    const [votes, mvpTagline] = await Promise.all([
      this.collectPosterVotes(s).catch(() => null),
      this.collectMvpTagline(s).catch(() => '')
    ]);
    const layout = buildPosterLayout(s, {
      roomCode: getOwnerSession().getCode(),
      votes,
      mvpTagline,
      timestamp: new Date().toLocaleString('zh-CN', { hour12: false })
    });
    wx.createSelectorQuery()
      .select('#posterCanvas')
      .fields({ node: true })
      .exec((res) => {
        try {
          const canvas = res?.[0]?.node;
          if (!canvas) {
            done();
            wx.showToast({ title: '画布初始化失败', icon: 'none' });
            return;
          }
          // 长图高度 × dpr 可能撞老设备 canvas 尺寸上限（≈8192）—— 超限降为 1x 导出
          const dpr = Math.min((wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2, 2);
          const scale = layout.height * dpr > 8000 ? 1 : dpr;
          canvas.width = layout.width * scale;
          canvas.height = layout.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.scale(scale, scale);
          paintPoster(ctx, layout);

          wx.canvasToTempFilePath({
            canvas,
            destWidth: layout.width * scale,
            destHeight: layout.height * scale,
            success: (file) => {
              wx.saveImageToPhotosAlbum({
                filePath: file.tempFilePath,
                success: () => {
                  done();
                  wx.showToast({ title: '长图已存相册', icon: 'none' });
                },
                fail: (err) => {
                  done();
                  const denied = String(err.errMsg || '').includes('auth');
                  wx.showToast({ title: denied ? '需要相册权限 —— 在设置里打开' : '保存失败', icon: 'none' });
                }
              });
            },
            fail: () => {
              done();
              wx.showToast({ title: '长图生成失败', icon: 'none' });
            }
          });
        } catch (err) {
          // 回调内同步异常（canvas API 不可用等）不能让 loading 永挂
          done();
          console.error('[poster] 生成异常:', err);
          wx.showToast({ title: '长图生成失败', icon: 'none' });
        }
      });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  goPlayers() {
    wx.navigateTo({ url: '/pages/players/players' });
  },

  goRoom() {
    const code = getOwnerSession().getCode();
    if (code) wx.navigateTo({ url: `/pages/room/room?code=${code}` });
  },

  /** 手输房间码围观 —— 分享卡片不可用时（如未认证）的兜底入口 */
  onEnterRoomCode() {
    wx.showModal({
      title: '围观房间',
      editable: true,
      placeholderText: '输入 6 位房间码，如 A2B3C4',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const code = res.content.trim().toUpperCase();
        if (!/^[A-Z][0-9A-Z]{5}$/.test(code)) {
          wx.showToast({ title: '房间码是 6 位字母数字', icon: 'none' });
          return;
        }
        wx.navigateTo({ url: `/pages/room/room?code=${code}` });
      }
    });
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

  /**
   * 重置：页面内自定义底部弹层（WXML 渲染），**不用原生 actionSheet/modal**。
   * 原生连续弹窗（actionSheet→modal）在模拟器/真机反复吞窗、不可靠（用户三次「没反应」），
   * 自定义弹层选择+确认合一、一定可见、automator 可 tap 可截图。
   */
  onReset() {
    this.setData({ resetSheet: true });
  },

  onResetPick(e: WechatMiniprogram.TouchEvent) {
    const mode = String(e.currentTarget.dataset.mode || 'cancel');
    this.setData({ resetSheet: false });
    if (mode === 'cancel') return;
    const preserve = mode === 'keep';
    // 重置 = 同一桌继续打，**保留房间**（围观者不掉线）；换桌请用「换人数」开新房间
    getStore().resetGame(preserve);
    this.order = [];
    this.refresh();
    wx.showToast({ title: preserve ? '已重新开局（保留玩家）' : '已清空，重新加人', icon: 'none' });
  }
});
