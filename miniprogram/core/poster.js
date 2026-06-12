/**
 * 战绩长图海报 —— 对齐 web 版 src/export/exportMobile.js「手机版 PNG」的信息密度：
 * 总览头部（通关/冠军队伍/MVP/时长/级牌）→ 荣誉提名（每队 最C/最闹）→ 16 项特殊荣誉
 * → 每玩家排名统计表 → 观众投票 → 完整逐局历史（每局含全员名次行）→ 落款。
 *
 * 架构：buildPosterLayout 纯函数（Node 可测：高度按内容动态算、文案合规可断言），
 * paintPoster 只执行 ops。canvas 吃不到 CSS 变量 —— 配色为 tokens.wxss light 镜像常量。
 * 合规：无牌面/筹码/货币/骰子图形（gambler 荣誉图标用 💥 不用 web 的 🎲）；
 * 荣誉标题一律经 displayHonorTitle（「赌徒」→「莽夫」）。
 */
import { aggregateSession, computeSessionMvp } from './victoryStats.js';
import { calculateHonorsFromData } from '../shared-logic/honorLogic.js';
import { HONOR_TITLES_BY_KEY } from '../shared-logic/honorCatalog.js';
import { displayHonorTitle } from './honorDisplay.js';

export const POSTER_W = 600;

const C = {
  bg: '#F4F6F3',
  text: '#1B221E',
  secondary: '#5A655E',
  hint: '#8A948D',
  accent: '#15694B',
  t1: '#2A5DB0',
  t2: '#B6403B',
  gold: '#A37412',
  t1Tint: 'rgba(42,93,176,0.08)',
  t2Tint: 'rgba(182,64,59,0.08)'
};

/** 16 荣誉的展示元数据（镜像 web src/stats/honors.js HONOR_META；顺序一致） */
const HONOR_META = [
  { key: 'mvp', glyph: '🥇', color: '#A37412', fmt: (h, st) => `${st.firstPlaceCount}/${st.games} 头游` },
  { key: 'burden', glyph: '😅', color: '#8B4513', fmt: (h, st) => `${st.lastPlaceCount}/${st.games} 垫底` },
  { key: 'stable', glyph: '🗿', color: '#708090', fmt: (h, st) => `σ ${h.score} · n=${st.games}` },
  { key: 'rollercoaster', glyph: '🌊', color: '#FF4500', fmt: (h, st) => (st.rankings.length > 0 ? `Σ ${h.score} · ${Math.min(...st.rankings)}–${Math.max(...st.rankings)}` : `Σ ${h.score}`) },
  { key: 'comeback', glyph: '📈', color: '#32CD32', fmt: (h) => `${h.score} 位提升` },
  { key: 'fanche', glyph: '🎪', color: '#DC143C', fmt: (h) => `${h.score} 崩盘次` },
  { key: 'gambler', glyph: '💥', color: '#8B5CF6', fmt: (h) => `${h.score} 高风险` },
  { key: 'complete', glyph: '👑', color: '#B8860B', fmt: (h) => `${h.score} 体验过` },
  { key: 'streak', glyph: '🔥', color: '#FF6347', fmt: (h) => `${h.score} 上半区连段` },
  { key: 'median', glyph: '🧭', color: '#9370DB', fmt: (h) => `${h.score} 强于队友均值` },
  { key: 'carp', glyph: '📈', color: '#F97316', fmt: (h) => `${h.score} 后程提升` },
  { key: 'nonstick', glyph: '🛡️', color: '#10B981', fmt: (h) => `${h.score} 强于队友均值` },
  { key: 'frequent', glyph: '⚡', color: '#FFA500', fmt: (h) => `${h.score} 队伍领先局` },
  { key: 'burnout', glyph: '🔥', color: '#B91C1C', fmt: (h) => `${h.score} 后程下滑` },
  { key: 'almost', glyph: '🎯', color: '#3B82F6', fmt: (h) => `${h.score} 差一名` },
  { key: 'resilient', glyph: '🧱', color: '#0F766E', fmt: (h) => `${h.score} 反弹/承压` }
];

/** 估宽（纯函数没有 measureText）：CJK/emoji ≈ 字号，ASCII ≈ 0.55 字号 */
function estWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) {
    w += ch.codePointAt(0) > 0x2e7f ? size : size * 0.55;
  }
  return w;
}

/** 该局全员名次 → 按宽度折行（最多 maxLines 行，溢出加 …） */
function wrapRankingTokens(playerRankings, fontSize, maxWidth, maxLines) {
  const rankings = playerRankings && typeof playerRankings === 'object' ? playerRankings : {};
  const tokens = Object.keys(rankings)
    .map(Number)
    .filter(Number.isSafeInteger)
    .sort((a, b) => a - b)
    .map(r => `${r}.${rankings[r].emoji || ''}${rankings[r].name || ''}`);
  const lines = [];
  let line = '';
  for (const tok of tokens) {
    const test = line ? `${line} ${tok}` : tok;
    if (line && estWidth(test, fontSize) > maxWidth) {
      lines.push(line);
      line = tok;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) lines[maxLines - 1] += ' …';
  return lines;
}

/**
 * 纯布局：state（gameStore 快照）→ { width, height, ops }。
 * @param {Object} [opts]
 * @param {string|null} [opts.roomCode]
 * @param {{mvp: Array<{emoji,name,count}>, burden: Array<{emoji,name,count}>}|null} [opts.votes] - 观众投票（调用方从 vote_tally 取）
 * @param {string} [opts.timestamp] - 已格式化的当前时间（保持纯函数，时钟由调用方注入）
 */
export function buildPosterLayout(state, opts = {}) {
  const { roomCode = null, votes = null, timestamp = '' } = opts;
  const W = POSTER_W;
  const ops = [];
  const text = (t, x, y, font, color, align) =>
    ops.push({ type: 'text', text: String(t), x, y, font, color, align: align || 'left' });
  const rect = (x, y, w, h, color) => ops.push({ type: 'rect', x, y, w, h, color });

  const history = Array.isArray(state.history) ? state.history : [];
  const agg = aggregateSession(state);
  const playersWithGames = agg.players.filter(p => p.games > 0);
  const ended = Boolean(state.gameStatus && state.gameStatus.ended);
  let y = 70;

  // === 总览头部 ===
  text('掼蛋战绩总览', 40, y, 'bold 44px sans-serif', C.text);
  y += 50;

  if (ended) {
    const wk = state.gameStatus.winnerKey === 't2' ? 't2' : 't1';
    const wName = state.gameStatus.winnerName || state.teamNames[wk] || '';
    text(`🏆 ${wName} A级通关！`, 40, y, 'bold 30px sans-serif', wk === 't2' ? C.t2 : C.t1);
    y += 42;
    const winnerTeam = wk === 't2' ? 2 : 1;
    const roster = (state.players || [])
      .filter(p => p.team === winnerTeam)
      .map(p => `${p.emoji}${p.name}`)
      .join(' ');
    text(`冠军队伍：${roster}`, 40, y, '20px sans-serif', C.secondary);
    y += 34;
    const mvp = computeSessionMvp(state);
    if (mvp) {
      text(`MVP：${mvp.emoji}${mvp.name}（平均 ${mvp.avgRanking.toFixed(2)} 名）`, 40, y, 'bold 22px sans-serif', C.gold);
      y += 36;
    }
    const last = history[history.length - 1];
    const durMs = last ? Number(last.sessionDuration) : 0;
    if (Number.isFinite(durMs) && durMs > 0) {
      const mins = Math.floor(durMs / 60000);
      const timeStr = mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分` : `${mins}分钟`;
      text(`游戏时长：${timeStr}`, 40, y, '18px sans-serif', C.secondary);
      y += 30;
    }
  }

  text(`级牌：${state.roundLevel} | 下局：${state.nextRoundBase || '—'}`, 40, y, '18px sans-serif', C.secondary);
  y += 26;
  text(`A级：${state.prefs && state.prefs.strictA ? '严格模式' : '宽松模式'}`, 40, y, '18px sans-serif', C.secondary);
  y += 26;
  text(`${state.teamNames.t1} ${state.teamLevels.t1} | ${state.teamNames.t2} ${state.teamLevels.t2}`, 40, y, '18px sans-serif', C.secondary);
  y += 24;
  if (timestamp) {
    text(`时间：${timestamp}`, 40, y, '16px sans-serif', C.secondary);
    y += 24;
  }
  y += 30;

  // === 荣誉提名（每队 最C/最闹，按场均名次） ===
  if (playersWithGames.length > 0) {
    text('🏆 荣誉提名', 40, y, 'bold 30px sans-serif', C.text);
    y += 44;
    for (const tk of ['t1', 't2']) {
      const teamNo = tk === 't2' ? 2 : 1;
      const members = playersWithGames.filter(p => p.team === teamNo);
      if (members.length === 0) continue;
      const byAvg = [...members].sort((a, b) => a.avgRanking - b.avgRanking || b.firstPlaces - a.firstPlaces || a.id - b.id);
      const mvp = byAvg[0];
      const burden = byAvg[byAvg.length - 1];
      text(state.teamNames[tk], 40, y, 'bold 22px sans-serif', tk === 't2' ? C.t2 : C.t1);
      y += 32;
      text(`最C：${mvp.emoji}${mvp.name}（场均 ${mvp.avgRanking.toFixed(2)}）`, 60, y, '19px sans-serif', C.secondary);
      y += 28;
      text(`最闹：${burden.emoji}${burden.name}（场均 ${burden.avgRanking.toFixed(2)}）`, 60, y, '19px sans-serif', C.secondary);
      y += 38;
    }
    y += 10;
  }

  // === 16 项特殊荣誉（与 web 同算法；无得主显示 进行中） ===
  if (playersWithGames.length > 0) {
    text('🎖️ 特殊荣誉', 40, y, 'bold 26px sans-serif', C.text);
    y += 40;
    const allStats = {};
    for (const p of agg.players) {
      allStats[p.id] = { games: p.games, rankings: p.rankings, firstPlaceCount: p.firstPlaces, lastPlaceCount: p.lastPlaces };
    }
    const honorPlayers = (state.players || []).map(p => ({ id: p.id, name: p.name, emoji: p.emoji, team: p.team }));
    const honorData = calculateHonorsFromData(honorPlayers, allStats, Number(state.mode) || honorPlayers.length) || {};
    for (const meta of HONOR_META) {
      const h = honorData[meta.key];
      const title = displayHonorTitle(HONOR_TITLES_BY_KEY[meta.key]);
      text(`${meta.glyph}${title}`, 60, y, 'bold 20px sans-serif', meta.color);
      if (h && h.player) {
        const st = h.stats || allStats[h.player.id] || { games: 0, rankings: [], firstPlaceCount: 0, lastPlaceCount: 0 };
        text(`${h.player.emoji || ''}${h.player.name || ''}`, 220, y, 'bold 20px sans-serif', C.text);
        text(meta.fmt(h, st), 370, y, '15px sans-serif', C.hint);
      } else {
        text('进行中', 220, y, '18px sans-serif', C.hint);
      }
      y += 36;
    }
    y += 34;
  }

  // === 玩家排名统计表 ===
  if (playersWithGames.length > 0) {
    text('📊 玩家排名统计', 40, y, 'bold 26px sans-serif', C.text);
    y += 38;
    text('玩家', 50, y, 'bold 17px sans-serif', C.secondary);
    text('场次', 230, y, 'bold 17px sans-serif', C.secondary);
    text('平均', 305, y, 'bold 17px sans-serif', C.secondary);
    text('头游', 390, y, 'bold 17px sans-serif', C.secondary);
    text('垫底', 470, y, 'bold 17px sans-serif', C.secondary);
    y += 32;
    const sorted = [...playersWithGames].sort((a, b) => a.team - b.team || a.avgRanking - b.avgRanking);
    for (const p of sorted) {
      rect(30, y - 22, W - 60, 32, p.team === 1 ? C.t1Tint : C.t2Tint);
      text(`${p.emoji}${p.name}`, 50, y, '17px sans-serif', p.team === 1 ? C.t1 : C.t2);
      text(p.games, 235, y, '17px sans-serif', C.text);
      text(p.avgRanking.toFixed(2), 305, y, '17px sans-serif', C.text);
      text(p.firstPlaces, 395, y, '17px sans-serif', C.text);
      text(p.lastPlaces, 475, y, '17px sans-serif', C.text);
      y += 36;
    }
    y += 34;
  }

  // === 观众投票（围观端投出的 最C/最闹） ===
  const hasVotes = votes && ((votes.mvp && votes.mvp.length > 0) || (votes.burden && votes.burden.length > 0));
  if (hasVotes) {
    text('🗳️ 观众投票', 40, y, 'bold 26px sans-serif', C.text);
    y += 38;
    const voteBlock = (label, rows, color) => {
      if (!rows || rows.length === 0) return;
      text(label, 40, y, 'bold 20px sans-serif', color);
      y += 30;
      for (const v of rows) {
        text(`${v.emoji} ${v.name}：${v.count}票`, 60, y, '16px sans-serif', C.secondary);
        y += 26;
      }
      y += 12;
    };
    voteBlock('最C', votes.mvp, C.accent);
    voteBlock('最闹', votes.burden, C.t2);
    y += 20;
  }

  // === 完整逐局历史（每局含全员名次行） ===
  if (history.length > 0) {
    text('📜 比赛历史', 40, y, 'bold 26px sans-serif', C.text);
    y += 38;
    text('#', 50, y, 'bold 18px sans-serif', C.accent);
    text('组合', 95, y, 'bold 18px sans-serif', C.accent);
    text('升级', 230, y, 'bold 18px sans-serif', C.accent);
    text('胜队', 360, y, 'bold 18px sans-serif', C.accent);
    text('级牌', 480, y, 'bold 18px sans-serif', C.accent);
    y += 34;
    history.forEach((h, i) => {
      const wk = h.winKey === 't2' ? 't2' : 't1';
      const entryEnded = Boolean(h.gameStatus && h.gameStatus.ended);
      const rankingLines = wrapRankingTokens(h.playerRankings, 15, W - 100, 3);
      const aNote = h.aNote ? String(h.aNote) : '';
      const blockH = 28 + (aNote ? 24 : 0) + rankingLines.length * 22 + 12;
      rect(30, y - 24, W - 60, blockH, wk === 't1' ? C.t1Tint : C.t2Tint);

      text(i + 1, 50, y, 'bold 18px sans-serif', C.accent);
      text(h.combo || '', 95, y, '17px sans-serif', C.text);
      text(h.up ? `${h.win}升${h.up}级` : (entryEnded ? `${h.win}获胜` : '不升级'), 230, y, '17px sans-serif', C.text);
      text(h.win || '', 360, y, 'bold 17px sans-serif', wk === 't1' ? C.t1 : C.t2);
      text(`${h.t1}|${h.t2}`, 480, y, '16px sans-serif', C.secondary);
      y += 28;
      if (aNote) {
        text(aNote, 95, y, '15px sans-serif', C.secondary);
        y += 24;
      }
      for (const line of rankingLines) {
        text(line, 50, y, '15px sans-serif', C.secondary);
        y += 22;
      }
      y += 26;
    });
  }

  // === 落款 ===
  y += 14;
  text(`闹掼计分器 · 线下牌局计分记录${roomCode ? ` · 房间 ${roomCode}` : ''}`, W / 2, y, '14px sans-serif', C.hint, 'center');
  y += 22;
  text('Made with ❤️ by 闹麻家族', W / 2, y, '12px sans-serif', C.hint, 'center');

  return { width: W, height: Math.max(y + 50, 700), ops };
}

/** 执行布局 ops（调用方负责 canvas 尺寸与 dpr scale） */
export function paintPoster(ctx, layout) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const op of layout.ops) {
    if (op.type === 'rect') {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.type === 'text') {
      ctx.fillStyle = op.color;
      ctx.font = op.font;
      ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
    }
  }
  ctx.textAlign = 'left';
}
