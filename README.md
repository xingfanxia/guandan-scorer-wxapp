# 闹掼计分器 · 微信小程序

[guandan-scorer](../guandan-scorer)（web 版掼蛋计分器）的微信小程序版。核心增量：微信社交闭环 —— 群里发分享卡片（或手输房间码），牌友直达计分房间围观/投票/认领座位，openid 静默登录，战绩记进各自的微信档案。

- 技术栈：原生 WXML/WXSS/TS + 微信云开发（云函数 + 云数据库 db.watch 实时同步）
- 状态：WXAPP-2~5/8 代码侧完成（2026-06-12）——单机计分闭环、云房间围观、投票/座位认领/档案、荣誉海报、玩家池与 web 数据迁移；进度与人工步骤见 [docs/PLAN.md](docs/PLAN.md)
- 调研与合规结论：[docs/research/2026-06-11-wechat-miniprogram-port.md](docs/research/2026-06-11-wechat-miniprogram-port.md)
- 游戏规则逻辑单一事实源：web 版 repo 的 `shared/` + `src/game/`；本 repo 的 `miniprogram/shared-logic/` 为 vendor 快照（`npm run sync:shared` 同步，勿手改）

```bash
npm test              # 规则与编排逻辑测试（node:test，零第三方依赖，250+ 用例）
npm run typecheck     # tsc --noEmit
npm run sync:shared   # 从 web repo 重新 vendor 规则逻辑
npm run sync:check    # 校验 vendor 快照未被手改
node scripts/automator/scoring-flow.mjs   # 模拟器 E2E：计分主链路（需 DevTools）
node scripts/automator/cloud-smoke.mjs    # 云函数冒烟：建房/CAS（需 DevTools+登录）
```
