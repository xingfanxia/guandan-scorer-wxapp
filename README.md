# 掼蛋计分助手 · 微信小程序

[guandan-scorer](../guandan-scorer)（web 版掼蛋计分器）的微信小程序版。核心增量：微信社交闭环 —— 群里发分享卡片，朋友点卡片直达计分房间围观/投票，openid 静默登录，无需链接和房间码输入。

- 技术栈：原生 WXML/WXSS/TS + 微信云开发（云函数 + 云数据库 db.watch 实时同步）
- 状态：规划阶段（2026-06-11），见 [docs/PLAN.md](docs/PLAN.md)
- 调研与合规结论：[docs/research/2026-06-11-wechat-miniprogram-port.md](docs/research/2026-06-11-wechat-miniprogram-port.md)
- 游戏规则逻辑单一事实源：web 版 repo 的 `shared/` + `src/game/`
