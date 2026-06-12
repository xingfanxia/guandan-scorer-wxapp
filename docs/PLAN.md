# 施工计划 — 掼蛋计分助手（微信小程序）

> 前置阅读：`docs/research/2026-06-11-wechat-miniprogram-port.md`（可行性结论 + 架构映射 + 合规红线）。
> 里程碑命名遵循全局约定 `WXAPP-<N>`。每步带 verify 关卡；完成一个里程碑就更新本文件状态并提交。

## 前置条件（WXAPP-0，需要用户本人操作）

代码可以先行（开发者工具支持无 appid 的测试号模式），但以下三件事只有 AX 本人能做：

- [x] **注册小程序账号**（2026-06-12 完成）：实际注册名「闹掼计分器」，appid `wxb9f2afca5bcf65c4`，类目「工具-计算器」。注意：每个小程序是独立公众平台账号，邮箱 1:1，同一身份证上限 5 个（dahua + 掼蛋共占 2）。
- [x] **开通云开发**（2026-06-12 完成）：环境 ID `cloud1-d2go4yxtv833a2113`（免费开发环境）。
- [ ] **添加体验成员**：mp 后台 → 成员管理，按微信号加牌友（上限 15 体验成员 + 15 项目成员）。不挡开发，WXAPP-6 前完成即可。
- [ ]（仅当决定正式上架时）**ICP 备案**：mp 后台在线提交，身份证 + 人脸核身 + 两个手机号，预留 1-3 周，不可加急。

拿到 appid 前，所有开发用测试号 + 本地 mock 云函数即可推进到 WXAPP-2 末尾。

## 设计概要

### UI 方向（2026-06-12 用户拍板）

- **简洁大方、可读性优先**；**不复刻 web 版主题美学**（Broadcast/Tea-Table 等主题不迁移），小程序自成一套克制的设计语言
- **dark + light 双模式是硬需求**：app.json `"darkmode": true` + theme.json 变量映射跟随系统；WXSS 色值全部走 design token 变量，禁止硬编码颜色
- 功能目标 = **对齐 web 版全功能**（计分/历史/荣誉/成就/投票/海报导出），微信社交闭环是增量而非替代
- WXAPP-2 UI 开工第一步：按上述方向产出 `DESIGN.md`（repo 现无设计系统文档），再动 WXML/WXSS

### 微信身份贯穿（2026-06-12 用户拍板，细化 openid 决策）

- 好友经分享卡片/小程序码进房围观、投票（原规划保持）
- **座位认领**：玩家用自己的微信身份认领房间内座位 —— openid 绑定座位，战绩/荣誉/成就随 openid 累计，本人此后用微信身份直接查自己的档案页（彻底替代 web 版 handle 自报体系）
- 头像昵称：走官方「头像昵称填写能力」（`button open-type="chooseAvatar"` + `input type="nickname"`），用户一次点击即填；**无法静默获取**（getUserProfile 已收紧是平台限制），UI 要把这步做得尽量轻

### 页面结构（原生 WXML/WXSS/TS）

```
pages/
  index/        主计分页（房主）：模式选择(4/6/8)、玩家管理、排名录入、记分牌、升级预览
  room/         围观页：?code=A1B2C3 进入，db.watch 实时跟踪 + 投票入口
  history/      对局历史：逐局升级记录、回滚（房主）
  profile/      玩家档案：openid 维度战绩、荣誉、成就、搭子/对头
  victory/      （或 index 内弹层）胜利结算：MVP 计算、投票确认、战绩海报导出
```

### 云开发数据模型

```
rooms 集合（单文档/房间，状态收敛进一个 doc，CAS 条件更新防并发）
  _id: 房间码(6位)        ownerOpenid, mode, createdAt, finishedAt
  snapshot: {...}        ← 结构 = web 版 KV room JSON，复用 shared-logic/roomSnapshotValidation.js 校验
  version: n             ← where({version}).update(...) CAS
  opengid?: string       ← 群绑定（打开方上报）
  votes: { [sessionKey]: { [openid]: {mvp, burden} } }   ← openid 天然幂等

players 集合
  _id: openid            displayName, avatarFileID, stats{...}, honors{...}, achievements[]
                         ← stats schema 平移 web 版 player:handle 结构
```

### 云函数（替代 api/ 的 Vercel routes）

| 云函数 | 对应 web 版 | 要点 |
|---|---|---|
| `room_create` | api/rooms/create.js | 生成 6 位码、防碰撞、初始化 doc |
| `room_write` | api/rooms/[code].js PUT | 仅 ownerOpenid 可写；snapshot 校验 + version CAS |
| `vote_submit` | api/rooms/vote/[code].js | openid 幂等；voteSessionKey 复用 |
| `vote_reset` | api/rooms/reset-vote/[code].js | 仅 owner |
| `profile_sync` | api/players/[handle].js PUT | syncProfileStats 服务端半边；achievementLogic 复用 |
| `group_bind` | （新） | getGroupEnterInfo cloudID 解密 opengid → 房间绑群 |

读路径（围观）不走云函数：客户端直接 `db.watch` rooms 文档（读权限"所有用户可读，仅创建者可写"），省调用量。

### 复用资产（vendor 自 web repo，单一事实源在那边）

`miniprogram/shared-logic/` ← `npm run sync:shared` 从 web repo 复制：顶层 `shared/`（含已抽纯的 `aLevelLogic.js`、`playerCountMode.js`）+ `src/game/calculator.js`。同步脚本自动重写 import 路径并在文件头注记 upstream commit hash；上游脏工作区会被拒绝。`honors.js`/`statistics.js` 的纯算法 WXAPP-5 时再抽（先上游、后同步）。

## 里程碑

### WXAPP-1：骨架与逻辑层
原生 TS scaffold（开发者工具模板 + miniprogram-api-typings）；vendor `shared-logic/`；把 web 版的 A 级规则测试用例搬过来在 Node 下跑通（计分逻辑在小程序环境外可验证）。
→ verify: `npm test` 绿（calculator/rules/achievements 纯逻辑测试）；开发者工具能编译空壳。

### WXAPP-2：单机计分闭环 ✅（2026-06-12 代码侧完成）
index 页完整可用：4/6/8 模式、玩家增删、排名录入、应用结果/撤销/重置、升级预览、A 级规则（strict/lenient）、本地 storage 持久化。不依赖云、不依赖 appid。
→ verify: ~~真机预览跑通一整局 2→A~~ 已完成自动化半边：GameStore 19 用例（含全程 2→A 通关联调、web schema 契约校验）+ automator E2E 主链路（seed→录名次→预览→应用→记分牌→历史）+ 截图视觉审计。**真机一整局留人工清单。**
实现注记：编排层在 `miniprogram/core/gameStore.js`（工厂+注入，语义对齐 web applyGameResult）；UI 三页共用 `core/viewModel.js` 防文案分叉；名次录入交互 = 按完成顺序点玩家 chip。

### WXAPP-3：云房间 + 群内邀请闭环（核心增量）🔶（2026-06-12 代码侧完成，等权限+真机）
wx.login → openid；room_create/room_write 云函数；分享卡片带房间码（onShareAppMessage + withShareTicket）；room 页 db.watch + 轮询兜底。~~动态消息"X 人围观中"~~（裁剪：非核心，体验版可后补）。
→ verify: 云函数已部署并冒烟通过（建房 E8N5E4 / CAS v1→v2 / 旧版本写入正确冲突）。**双真机实测留人工清单**；db.watch 围观需先在控制台把 rooms 集合权限改为「所有用户可读，仅创建者可写」（默认权限已实测拒绝围观直读）。
设计决策（autonomous）：云函数只做结构/权限/CAS 校验，完整游戏语义校验留在客户端 store —— 唯一写入方是房主本人，朋友局威胁模型下足够；若未来房间公开化需把 roomSnapshotValidation vendor 进函数。

### WXAPP-4：投票 + 玩家档案
胜利结算 MVP 计算（沿用"全场最低平均排名"算法）；围观者投票（openid 幂等）；**座位认领**（玩家微信身份绑定座位，stats 随 openid 累计）；头像昵称填写能力 + 云存储头像；profile_sync 云函数 + profile 页。
→ verify: 投票重复提交不重计；档案页 stats 与 web 版 schema 对齐；认领座位后本人微信身份可直查自己档案。

### WXAPP-5：荣誉 / 成就 / 导出
16 荣誉计算（vendor 的纯算法）+ 渲染；20 成就；canvas 战绩海报 + 保存相册；（可选）一次性订阅消息"本局结束"。
**合规硬约束**：荣誉 `gambler: '赌徒'`（honorCatalog.js）在小程序 UI/海报/截图一律渲染合规别名（显示层映射，别名届时定）；存储与计算 key 保持 `'赌徒'` 不动 —— normalizeHonorCounter 以中文标题为计数 key，改 key 即破坏与 web 版 stats schema 的互通。
→ verify: 同一局数据在 web 版与小程序版算出相同荣誉得主；全 UI grep 无「赌」字样。

### WXAPP-6：体验版分发
上传体验版；`getunlimitedqrcode`（env_version:"trial"）永久码；加体验成员；真机 QA 清单（iOS + Android 各一轮）。
→ verify: 非项目成员的体验成员从群卡片完整走通围观+投票。

### WXAPP-7（可选，用户决策后启动）：正式上架
ICP 备案（1-3 周）→ 合规自查（命名/截图/零金额元素/提审备注模板见 research doc）→ 提审 → 发布。云开发转 ¥19.9/月。
→ verify: 非体验成员的任意微信用户点群卡片即开。

## 人工清单（只有 AX 本人能做的，按优先级）

1. **控制台改 rooms 集合权限**：云开发控制台 → 数据库 → rooms → 权限设置 → 「所有用户可读，仅创建者可写」。不改则围观页 db.watch/轮询全部被拒（已实测）。
2. **真机 QA**：扫 `tmp/preview-qr.png` 真机跑一整局 2→A（4人模式，含撤销/重置/strict 降级各一次）。
3. **双真机围观实测**（权限改完后）：A 机开围观 → 群里发卡片 → B 机点卡片直达房间看实时比分。
4. **加体验成员**：mp 后台 → 成员管理（WXAPP-6 分发前）。

## 红线（每个 PR 自查，违者即合规事故）

1. 永远不做金钱输赢记账/筹码折算；投票零竞猜元素
2. 名称/简介/截图零"赌"联想（无牌面、筹码、¥ 符号）
3. 不注册小游戏账号、不挂游戏类目
4. AppSecret/session_key 永不下发客户端（用云函数 getWXContext 则根本不需要 AppSecret）

## 状态

- 2026-06-11：repo 创建，调研+计划固化。代码未开始。等待 WXAPP-0 用户注册账号（不阻塞 WXAPP-1/2）。
- 2026-06-11（晚）：**WXAPP-1 代码侧完成**。上游抽取（web repo `cd9551f` + 审查修复 `cf03c6f`，均已 push：checkALevelRules 纯化进 shared/aLevelLogic.js、playerCountMode 入 shared/、死分支清理）→ vendor 10 文件（锚 `cf03c6f`）→ node:test 206 用例全绿 → 原生 TS 空壳（4 页面，appid=touristappid）+ `tsc --noEmit` 绿。多 lens review（5 维度 + 对抗复核）：16 条 findings 全部修复（含 `npm run sync:check` 防手改门、import 闭包校验、isolatedModules、A 级测试缺口 6 例）。~~剩余半个 verify 关卡：开发者工具编译空壳~~ → **2026-06-12 已补**：服务端口开启后 `cli preview` 全量编译通过（包体 1.3KB，真机预览码 tmp/preview-qr.png）。**WXAPP-1 verify 全绿，里程碑关闭。**
