/**
 * 战绩海报（WXAPP-5）：canvas 2d 纯文字构图 —— 级牌大字 + MVP + 荣誉。
 * 合规：无牌面/筹码/货币图形；荣誉标题经 displayHonorTitle 渲染。
 * 调用方传 canvas 节点（page 里 createSelectorQuery 拿到的 canvas 2d 实例）。
 */
import { buildBoardVM } from './viewModel.js';
import { computeSessionMvp, computeSessionHonors } from './victoryStats.js';
import { displayHonorTitle } from './honorDisplay.js';

export const POSTER_W = 750;
export const POSTER_H = 1100;

/** 与 tokens.wxss light 模式一致的海报配色（canvas 吃不到 CSS 变量，此处是镜像常量） */
const C = {
  bg: '#F4F6F3',
  surface: '#FFFFFF',
  text: '#1B221E',
  secondary: '#5A655E',
  accent: '#15694B',
  t1: '#2A5DB0',
  t2: '#B6403B',
  gold: '#A37412',
  hairline: 'rgba(27,34,30,0.12)'
};

export function drawPoster(ctx, state, roomCode) {
  const vm = buildBoardVM(state);
  const mvp = computeSessionMvp(state);
  const honors = computeSessionHonors(state);
  const playerById = new Map(state.players.map(p => [p.id, p]));

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // 标题区
  ctx.fillStyle = C.accent;
  ctx.font = '500 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('闹掼计分器 · 战绩', POSTER_W / 2, 80);

  ctx.fillStyle = C.secondary;
  ctx.font = '400 24px sans-serif';
  const sub = vm.ended ? `${vm.eyebrow}` : `打到 ${state.roundLevel}`;
  ctx.fillText(sub, POSTER_W / 2, 124);

  // 级牌大字
  ctx.font = '800 180px sans-serif';
  ctx.fillStyle = C.t1;
  ctx.fillText(state.teamLevels.t1, POSTER_W / 2 - 170, 330);
  ctx.fillStyle = C.secondary;
  ctx.font = '700 80px sans-serif';
  ctx.fillText(':', POSTER_W / 2, 310);
  ctx.fillStyle = C.t2;
  ctx.font = '800 180px sans-serif';
  ctx.fillText(state.teamLevels.t2, POSTER_W / 2 + 170, 330);

  ctx.font = '500 28px sans-serif';
  ctx.fillStyle = C.t1;
  ctx.fillText(state.teamNames.t1, POSTER_W / 2 - 170, 390);
  ctx.fillStyle = C.t2;
  ctx.fillText(state.teamNames.t2, POSTER_W / 2 + 170, 390);

  // 战线
  ctx.strokeStyle = C.hairline;
  ctx.beginPath();
  ctx.moveTo(60, 440);
  ctx.lineTo(POSTER_W - 60, 440);
  ctx.stroke();

  let y = 510;

  // MVP
  if (mvp) {
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    ctx.font = '500 26px sans-serif';
    ctx.fillText('本场 MVP', POSTER_W / 2, y);
    ctx.fillStyle = C.text;
    ctx.font = '700 44px sans-serif';
    ctx.fillText(`${mvp.emoji} ${mvp.name} · 平均第 ${mvp.avgRanking.toFixed(2)} 名`, POSTER_W / 2, y + 56);
    y += 140;
  }

  // 荣誉（最多 8 行）
  const honorLines = [];
  for (const [pid, titles] of Object.entries(honors)) {
    const p = playerById.get(Number(pid));
    if (!p) continue;
    for (const t of titles) {
      honorLines.push(`${displayHonorTitle(t)} · ${p.emoji} ${p.name}`);
    }
  }
  if (honorLines.length > 0) {
    ctx.fillStyle = C.accent;
    ctx.font = '500 26px sans-serif';
    ctx.fillText('本场荣誉', POSTER_W / 2, y);
    y += 50;
    ctx.fillStyle = C.text;
    ctx.font = '400 30px sans-serif';
    for (const line of honorLines.slice(0, 8)) {
      ctx.fillText(line, POSTER_W / 2, y);
      y += 46;
    }
    if (honorLines.length > 8) {
      ctx.fillStyle = C.secondary;
      ctx.fillText(`…等 ${honorLines.length} 项`, POSTER_W / 2, y);
      y += 46;
    }
  }

  // 共 N 局
  ctx.fillStyle = C.secondary;
  ctx.font = '400 26px sans-serif';
  ctx.fillText(`共 ${state.history.length} 局`, POSTER_W / 2, y + 30);

  // 底部
  ctx.fillStyle = C.secondary;
  ctx.font = '400 24px sans-serif';
  const footer = roomCode ? `房间 ${roomCode} · 线下牌局计分记录` : '线下牌局计分记录';
  ctx.fillText(footer, POSTER_W / 2, POSTER_H - 60);
}
