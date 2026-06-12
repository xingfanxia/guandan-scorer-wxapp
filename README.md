# 掼蛋计分助手 · 微信小程序

[guandan-scorer](../guandan-scorer)（web 版掼蛋计分器）的微信小程序版。核心增量：微信社交闭环 —— 群里发分享卡片，朋友点卡片直达计分房间围观/投票，openid 静默登录，无需链接和房间码输入。

- 技术栈：原生 WXML/WXSS/TS + 微信云开发（云函数 + 云数据库 db.watch 实时同步）
- 状态：WXAPP-1 骨架与逻辑层完成（2026-06-11），见 [docs/PLAN.md](docs/PLAN.md)
- 调研与合规结论：[docs/research/2026-06-11-wechat-miniprogram-port.md](docs/research/2026-06-11-wechat-miniprogram-port.md)
- 游戏规则逻辑单一事实源：web 版 repo 的 `shared/` + `src/game/`；本 repo 的 `miniprogram/shared-logic/` 为 vendor 快照（`npm run sync:shared` 同步，勿手改）

```bash
npm test              # 规则逻辑测试（node:test，零第三方依赖，200 用例）
npm run typecheck     # tsc --noEmit
npm run sync:shared   # 从 web repo 重新 vendor 规则逻辑
```
