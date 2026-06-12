# 施工计划 — 掼蛋计分助手（微信小程序）

> 前置阅读：`docs/research/2026-06-11-wechat-miniprogram-port.md`（可行性结论 + 架构映射 + 合规红线）。
> 里程碑命名遵循全局约定 `WXAPP-<N>`。每步带 verify 关卡；完成一个里程碑就更新本文件状态并提交。

## 前置条件（WXAPP-0，需要用户本人操作）

代码可以先行（开发者工具支持无 appid 的测试号模式），但以下三件事只有 AX 本人能做：

- [ ] **注册小程序账号**：mp.weixin.qq.com → 个人主体（大陆身份证 + 实名微信扫码）→ 账号类型选**小程序**（绝不能选小游戏，游戏类目单向锁定）→ 名称「掼蛋计分助手」（被拦则「牌局计分助手」）→ 类目「工具-计算器」。免费、当天完成。
- [ ] **开通云开发**：微信开发者工具内一键开通，选免费环境（未发布期间免费，活动至 2026-12-31）。
- [ ] **添加体验成员**：mp 后台 → 成员管理，按微信号加牌友（上限 15 体验成员 + 15 项目成员）。
- [ ]（仅当决定正式上架时）**ICP 备案**：mp 后台在线提交，身份证 + 人脸核身 + 两个手机号，预留 1-3 周，不可加急。

拿到 appid 前，所有开发用测试号 + 本地 mock 云函数即可推进到 WXAPP-2 末尾。

## 设计概要

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

### WXAPP-2：单机计分闭环
index 页完整可用：4/6/8 模式、玩家增删、排名录入、应用结果/撤销/重置、升级预览、A 级规则（strict/lenient）、本地 storage 持久化。不依赖云、不依赖 appid。
→ verify: 真机预览跑通一整局 2→A；对照 web 版同输入同输出（拿 web 版 history 快照做夹具）。

### WXAPP-3：云房间 + 群内邀请闭环（核心增量）
wx.login → openid；room_create/room_write 云函数；分享卡片带房间码（onShareAppMessage + withShareTicket）；room 页 db.watch + 轮询兜底；动态消息"X 人围观中"。
→ verify: 双真机实测——A 建房 → 群里发卡片 → B 点卡片直达房间看到实时比分；watch 断连后兜底轮询接管。

### WXAPP-4：投票 + 玩家档案
胜利结算 MVP 计算（沿用"全场最低平均排名"算法）；围观者投票（openid 幂等）；头像昵称填写能力 + 云存储头像；profile_sync 云函数 + profile 页。
→ verify: 投票重复提交不重计；档案页 stats 与 web 版 schema 对齐。

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

## 红线（每个 PR 自查，违者即合规事故）

1. 永远不做金钱输赢记账/筹码折算；投票零竞猜元素
2. 名称/简介/截图零"赌"联想（无牌面、筹码、¥ 符号）
3. 不注册小游戏账号、不挂游戏类目
4. AppSecret/session_key 永不下发客户端（用云函数 getWXContext 则根本不需要 AppSecret）

## 状态

- 2026-06-11：repo 创建，调研+计划固化。代码未开始。等待 WXAPP-0 用户注册账号（不阻塞 WXAPP-1/2）。
- 2026-06-11（晚）：**WXAPP-1 代码侧完成**。上游抽取（web repo `cd9551f` + 审查修复 `cf03c6f`，均已 push：checkALevelRules 纯化进 shared/aLevelLogic.js、playerCountMode 入 shared/、死分支清理）→ vendor 10 文件（锚 `cf03c6f`）→ node:test 206 用例全绿 → 原生 TS 空壳（4 页面，appid=touristappid）+ `tsc --noEmit` 绿。多 lens review（5 维度 + 对抗复核）：16 条 findings 全部修复（含 `npm run sync:check` 防手改门、import 闭包校验、isolatedModules、A 级测试缺口 6 例）。**剩余半个 verify 关卡**：开发者工具编译空壳 —— 等用户首次扫码登录 DevTools（已 brew 装好）后跑 `cli open --project`。
