# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

掼蛋计分助手 — 微信小程序版的掼蛋（Guandan）计分器。是 `~/projects/side-projects/guandan-scorer`（web 版，Vercel + KV）的 sibling repo，**不是 fork**：infra 与 web 版零重叠（原生小程序 + 微信云开发），只共享纯游戏逻辑。

**当前状态（2026-06-11）：规划阶段，代码未开始。** 等待用户完成 WXAPP-0（mp.weixin.qq.com 注册个人主体小程序）；WXAPP-1/2 可用测试号先行。

## 必读文档（按序）

1. `docs/research/2026-06-11-wechat-miniprogram-port.md` — 可行性结论、两条路线（体验版 vs 上架）、合规红线、架构映射。**所有产品/合规问题先查这里。**
2. `docs/PLAN.md` — 设计概要（页面/数据模型/云函数）+ WXAPP-N 里程碑 + 每步 verify 关卡 + 当前状态。
3. `~/.claude/references/wechat-miniprogram-friends-only.md` — 跨项目通用 playbook（备案/认证/版号机制、成员上限、社交 API 清单、云开发定价、来源 URL）。政策时效敏感，重大决策前 spot-check 官方页面。
4. `.claude/skills/cloudbase/` — vendor 的云开发参考文档（SKILL.md + references），写云函数/db.watch/CAS 前先读。

## 关键决策（已定，勿反复）

- **原生 WXML/WXSS/TS**，不用 Taro/uni-app —— web 版是 vanilla DOM，没有 React 可复用；单端引入跨端框架是负收益。类型用 miniprogram-api-typings。
- **后端 = 微信云开发**（云函数 + 云数据库 + 云存储）。Vercel 后端对小程序是物理死路：`.ai` 域名不可备案、境外托管无法维持备案、正式版强制已备案合法域名。云开发免域名免备案。
- **实时同步 = db.watch + 轮询兜底双通道**（watch 官方无自动重连承诺）。房间状态收敛进单文档，version 字段 CAS 条件更新防并发。
- **两条路线都保持可用**：先体验版（≤31 人朋友局），但代码/命名/截图从第一天就按可提审标准写，未来上架不返工。上架走「工具-计算器」类目（纯计分工具不构成类目逃避，不涉版号）。
- **身份 = openid**（wx.login → 云函数 getWXContext，免 AppSecret），替代 web 版 handle + ownershipToken 体系。

## 游戏逻辑：单一事实源在 web repo

规则引擎的权威实现在 `~/projects/side-projects/guandan-scorer`：

- 顶层 `shared/`（994 行，零宿主依赖）：achievementLogic / gameStatus / honorCatalog / roomSnapshotValidation / ruleConfig / voteSessionKey
- `src/game/calculator.js`（231 行纯函数）：parseRanks / calculateUpgrade / nextLevel
- `src/game/rules.js` 的 A 级逻辑（与 state 单例耦合，只抽算法）；`src/stats/honors.js` 的 16 荣誉算法（与 DOM 渲染混合，只抽计算半边）

本 repo 的 `shared-logic/` 是 vendor 快照，每次同步注记 upstream commit hash。**改游戏规则：先改 web repo，再同步过来 —— 永远不要让两边规则分叉。** A 级规则细节（roundOwner 判定、strict 3 次失败降级、双 A 局归属）见 web repo CLAUDE.md。

## 合规红线（每个 PR 自查，违者即合规事故）

1. 永远不做金钱输赢记账/筹码折算功能；投票（MVP/最闹）零竞猜下注元素
2. 名称/简介/审核截图零"赌"联想：无扑克牌面、筹码、人民币符号；简介自称"线下牌局计分记录工具，不含对局玩法"
3. 不注册小游戏账号、不挂游戏类目（游戏类目单向锁定，且牌类对个人主体关闭）
4. AppSecret / session_key 永不出现在客户端代码或 repo
5. 真钱/兑换/红包元素是腾讯对未上架内容唯一主动执法类别 —— 体验版也零容忍

## 开发命令

代码未开始 —— scaffold 落地后在此补：开发者工具 CLI 预览/上传、云函数本地调试、`npm test`（shared-logic 纯逻辑测试，Node 下可跑）。

## 命名约定

里程碑用 `WXAPP-<N>`（见 docs/PLAN.md），不用 Stage/Phase 字母轴。

## Sibling Projects

- `~/projects/side-projects/guandan-scorer` — web 版，游戏逻辑单一事实源
- `~/projects/side-projects/guandan-online` — 多人对战版（另一个产品，勿混淆）
- `~/projects/side-projects/dahua-dice-wxapp` — 同模式 sibling（大话骰小程序版，Taro 路线因为它有 React 可复用；架构问题可参考但框架选型不同）
