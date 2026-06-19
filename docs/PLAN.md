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
  _id: 房间码(6位)        ownerOpenid, mode, createdAt, finishedAt, updatedAt
  snapshot: {...}        ← buildRoomSnapshot 产物（含 players[].handle），room_write 用 _.set 整体替换
  version: n             ← where({version}).update(...) CAS；claims/voteEpoch 变更也 +1（围观端去重通道）
  claims: { [playerId]: {openid, nickname, avatarUrl, claimedAt} }   ← 座位认领（先到先得原子）
  voteEpoch: n           ← vote_reset +1 → 派生新投票 sessionKey

votes 集合（独立集合而非内嵌房间 doc —— TCB 对含 ':' 的嵌套动态 key dot-path 不可靠 + 并发覆盖）
  _id: `${code}:${sessionKey}:${openid}`   ← 天然幂等，重投=覆盖自己那票
  code, sessionKey, openid, mvp, burden, votedAt

players 集合
  _id: openid            displayName, avatarUrl, stats{...含 honors 计数器/webImport}, updatedAt
                         ← stats schema 平移 web 版 player:handle 结构；成就读时派生不落库

pool 集合（WXAPP-8：web 版玩家池）
  _id: handle            displayName, emoji, tagline, webStats{...}, boundOpenid?, boundAt?
```

### 云函数（替代 api/ 的 Vercel routes）

| 云函数 | 对应 web 版 | 要点 |
|---|---|---|
| `room_create` | api/rooms/create.js | 生成 6 位码、防碰撞、初始化 doc |
| `room_write` | api/rooms/[code].js PUT | 仅 owner；结构校验 + version CAS + `_.set` 整体替换 |
| `room_claim_seat` | （新） | 座位认领/释放：快照内真实座位、原子先到先得、一人一座 |
| `vote_submit` | api/rooms/vote/[code].js | votes 集合 `_id` 天然幂等 |
| `vote_tally` | （新） | 服务端聚合计票（绕开围观端集合读权限） |
| `vote_reset` | api/rooms/reset-vote/[code].js | 仅 owner；清票 + voteEpoch+1 |
| `profile_sync` | api/players/[handle].js PUT | 仅 owner + 已通关；openid 白名单=claims∪pool 绑定（服务端解析）；key 服务端派生；票数服务端自取；gameKey/voteKey 双幂等 |
| `profile_get` | api/players/[handle].js GET | 读自己档案 + openid |
| `pool_import` | api/players/list.js GET | WXAPP-8：从 gd.ax0x.ai 一次性导入玩家池（幂等 upsert，不覆盖绑定） |
| `pool_list` | — | 选人器/绑定页列表 |
| `pool_bind` | — | openid↔handle 双向唯一一次性绑定 + webStats 并入档案 |
| ~~`group_bind`~~ | — | **裁剪**（2026-06-12）：群绑定/动态消息非核心，体验版后按需补 |

读路径（围观）双通道（2026-06-19 加固）：**实时快通道** = 客户端 `db.watch` rooms 文档（需控制台读权限「所有用户可读」，人工清单 #2，省调用量，下发原始 doc）；**保底通道** = 轮询走 `room_get` 云函数（管理端权限直读 + 脱敏不下发 openid，**不依赖**客户端读权限）。权限没设对时 watch 被拒，但 room_get 轮询仍能围观 —— 即「读权限是实时优化，不是围观前提」。三处客户端 rooms 直读（轮询/认领后 refresh/海报 voteEpoch）全部改走 room_get，仅 `db.watch` 保留客户端直读。

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

### WXAPP-4：投票 + 玩家档案 🔶（2026-06-12 代码侧完成，函数待部署成功）
胜利结算 MVP 计算（沿用"全场最低平均排名"算法）；围观者投票（openid 幂等）；**座位认领**（玩家微信身份绑定座位，stats 随 openid 累计）；头像昵称填写能力；profile_sync 云函数 + profile 页。
→ verify: 投票幂等 = votes 集合 `_id=code:sessionKey:openid` 天然去重；profile_sync gameKey/voteKey 双幂等；成就**读时派生**不落库（与 web 同一套 vendored checkAchievements）。真机联调留人工清单。
设计决策（autonomous）：①投票存独立 votes 集合而非房间 doc 内嵌（TCB 对含 `:` 的嵌套动态 key dot-path 不可靠 + 并发覆盖）；②计票走 vote_tally 函数聚合（绕开围观端集合读权限）；③头像用 chooseAvatar 的 tempUrl 直存（云存储头像后续有需要再上）。

### WXAPP-5：荣誉 / 成就 / 导出 ✅（2026-06-12 代码侧完成）
16 荣誉计算（vendor 的纯算法）+ 渲染；成就；canvas 战绩海报 + 保存相册。~~一次性订阅消息~~（裁剪：非核心）。
**合规硬约束（已落实）**：荣誉「赌徒」UI/海报一律经 `core/honorDisplay.js` 渲染为**「莽夫」**（与吕布/阿斗同语系）；存储与计算 key 保持 `'赌徒'` 不动 —— normalizeHonorCounter 以中文标题为计数 key，改 key 即破坏与 web 版 stats schema 的互通。
→ verify: 荣誉算法 = 上游 `00f6ef6` 抽纯的 shared/honorLogic.js（web 同源同算法）；victoryStats 测试含吕布/阿斗判定 + MIN_HONOR_GAMES 门槛；**全部 UI/海报渲染路径经 displayHonorTitle**（海报合规测试断言渲染文本零「赌」字样）；「赌」字面仅存在于 vendored 数据 key 与本段说明。

### WXAPP-6：体验版分发
上传体验版；`getunlimitedqrcode`（env_version:"trial"）永久码；加体验成员；真机 QA 清单（iOS + Android 各一轮）。
→ verify: 非项目成员的体验成员从群卡片完整走通围观+投票。

### WXAPP-8：玩家池 + web 数据迁移 + 微信绑定 ✅（2026-06-12 代码侧完成，用户拍板新增）
pool 集合（pool_import 从 gd.ax0x.ai 拉全部玩家，云函数出站不受域名白名单限制）；房主加人从池子选（actionSheet 分页选人器，手输兜底）；微信用户一次性绑定 pool 玩家（openid↔handle 双向唯一，绑定即并入 web 老战绩）；绑定后座位「这是我」一键认领 + 战绩入库自动归属（claims∪绑定，服务端解析）。
→ verify: profileSession/gameStore handle 测试绿；池空/不可用时手输路径不受影响。**人工**：跑一次 pool_import（人工清单 #5）+ 真机绑定走一遍。

### WXAPP-9：玩家天梯分 ✅（简化 ELO，spec 2026-06-12 定稿，当日代码侧完成）
1. 每人初始 1000 分，按「场」（整场通关）结算，不按局。
2. 队伍分 = 全队成员当前天梯分均值（未绑定/新玩家按 1000 计入均值）。
3. 期望胜率 E = 1/(1+10^((对队均分−己队均分)/400))；胜 S=1，负 S=0。
4. 队伍项 = 24×(S−E) —— 强队赢弱队 E 大、加分少；爆冷多得。两队队伍项互为相反数。
5. 个人表现项 = 28×(中位名次−场均名次)/(人数−1)，区间约 ±14 —— **个人表现权重高于胜负**（2026-06-12 用户调参：输了但个人名次好要被激励）。
6. 个人增量 = round(队伍项+表现项)，**胜方保底 +1，负方加分封顶 +6**（输局打神了可以小加分）；存 players.stats.ladder = {rating, sessions, peak}。
7. 幂等跟 gameKey 同一道闸（applySession 去重时一并应用/跳过）；rating 下限 0。
8. **起评分**（无小程序战绩时从 web 历史折算，同口径名次为主）：1000 + 置信度×(250×(4.5−场均名次)/3.5 + 300×(胜率−0.5))，钳 [700,1300]，置信度 = min(场次,20)/20；只在 sessions=0 时垫底，永不覆盖已挣分。天梯榜 `*` 标记 = 该分仍是起评分（`ladder.sessions===0`，未在小程序实结），**与是否校准独立**。
8b. **校准门（2026-06-13 用户反馈改）**：天梯榜「待校准」沉底门按 **历史总场次（web + 小程序合计）< 3** 判定，**不是**只数小程序天梯局 —— web 迁移来的老牌友凭历史直接进正式榜（旧实现只数 `ladder.sessions` 致 18 场老将也显示「还差 3 场」）。仅 pool_list 一处（纯展示/排序，web 无此概念）。
9. 纯函数算法（Node 可测）；评分读写全在服务端：profile_sync 用 computeLadderDeltas/applyLadderDelta/seedLadderRating，pool_bind/pool_list/profile_get_by_handle 用 seedLadderRating。**去重收口（2026-06-13）**：原 `core/ladder.js` + 4 个手写 CJS 镜像已塌缩为单一事实源 `shared/ladderLogic.js`（web canonical，upstream `b5c6a66`）—— vendor 成 ESM 进 `miniprogram/shared-logic/` + 经 esmToCjs vendor 成 CJS 进 4 个云函数目录，各 `require('./ladderLogic.js')`。改算法只改 web repo + `sync:shared`，改完重部署 4 云函数。
→ verify: 纯函数测试覆盖 强胜弱少加分/爆冷多得/输局高光小加分/胜方保底/个人表现拉开同队差距/起评分折算；档案页 + 查询 view 展示天梯分。

### 下一 session 工作清单（2026-06-12 晚已全部完成）

1. ~~**房间与会话彻底分离**~~ ✅ `ebaffdb`：reset/换人数 → ownerSession.detach()（旧房间留档），下次开打自动建新房。
2. ~~**玩家战绩查询 view**~~ ✅：新页 pages/players（天梯榜序列表 → 点开任意玩家档案）；新函数 profile_get_by_handle（不回传 openid）；pool_list join players 出天梯分。
3. ~~**海报信息密度对齐 web 长图**~~ ✅：poster.js 重构为 buildPosterLayout 纯函数 + paintPoster；六区块（总览/每队提名/16 特殊荣誉/玩家统计表/观众投票/逐局历史）对齐 web exportMobile.js，高度动态；gambler 图标 💥（零赌具图形）。
4. ~~**WXAPP-9 天梯分**~~ ✅（spec 见上）：`shared-logic/ladderLogic.js`（原 core/ladder.js，已 vendor 收口）+ profile_sync 服务端 + 档案页/天梯页展示。
5. 复盘 review 余项：下一轮 review 盯本批云函数新增面（profile_get_by_handle / pool_list join / profile_sync ladder）。
6. （用户 2026-06-12 反馈修复）荣誉行恢复 caption：honorDisplay 16 条 web 同文案，history/room/profile/players 四处渲染。

### WXAPP-7（可选，用户决策后启动）：正式上架
ICP 备案（1-3 周）→ 合规自查（命名/截图/零金额元素/提审备注模板见 research doc）→ 提审 → 发布。云开发转 ¥19.9/月。
→ verify: 非体验成员的任意微信用户点群卡片即开。

## 人工清单（只有 AX 本人能做的，按优先级）

1. **部署云函数** — 共 16 个（13 旧 + `pool_add` + `admin` + `room_get`）。`room_get` **2026-06-19 已部署（GUI 上传，Active）**，待上传新客户端才生效。⚠️ **CLI 部署踩坑（2026-06-19 定论，见状态条）**：`cli cloud functions deploy` 报 `getCloudAPISignedHeader 41002 system error` 时，**不是后端抽风、不要空等**——是 CLI 这条签名通道的问题，账号/环境/网络/登录全好（已逐项排除）。**直接用 IDE GUI 部署**：右键 `cloudfunctions/<fn>` → 「上传并部署：云端安装依赖」（GUI 走 IDE 内部会话签名，CLI 走的 `getCloudAPISignedHeader` 是另一条且坏的）。**2026-06-14 待补部署**（云会话漂到别 env 阻塞）：`pool_add`（genHandle test 前缀 + callerBound）/ `pool_prune`（scanTest）/ `profile_sync`（审核队列）/ `admin`（新）。命令：`cli cloud functions deploy --env cloud1-d2go4yxtv833a2113 --names pool_add pool_prune profile_sync admin --remote-npm-install --project $(pwd)`。部署后：① `pool_prune {scanTest:true}` 清遗留 `test_勿留勿用`（m-handle）② 上传新客户端 ③ `node scripts/automator/profile-extras-verify.mjs` 真机验证。**坑（与 dahua-dice 共用 IDE 云会话）**：`ResourceNotFound.Namespace` = 会话漂移到别的 env，执行面（callFunction）仍正常 —— 重试 / 等对方释放会话 / GUI 部署，**别重启 IDE**。**标准动作**：`sync:shared` 改了 ladderLogic 后必须重部署 4 个天梯云函数（profile_sync / pool_bind / pool_list / profile_get_by_handle）。
   - **首次设管理员**：`admin` 部署后，AX 在档案页「⚙︎ 战绩审核」→ 输入口令（管理员微信号 `AXAXAX0x`）认领，把自己 openid 写入 `admins` 集合。之后非管理员入库进 `pending_sessions` 待审。
2. **控制台改 rooms 集合权限**（2026-06-19 起：**实时优化，非围观前提**）：云开发控制台 → 数据库 → rooms → 权限设置 → 「所有用户可读，仅创建者可写」。**只此一个集合要改**（votes/players/pool/pending_sessions/admins 全走云函数、保持「仅创建者可读写」，改成公开是无谓泄露）。设了 → 围观走 `db.watch` 实时；没设 → `room_get` 轮询保底（~5s，仍能围观）。**历史背景**：2026-06-19 前此步是硬前提，没设则非房主全部进不去房间（用户实测事故）—— 现 room_get 兜底后降级为可选优化。
3. **小程序认证（解锁分享卡片）**：mp 后台 → 设置 → 基本设置 → 小程序认证，30 元/年。未认证时分享按钮被微信拦（「未完成认证，分享功能暂时无法使用」，已实测）—— 已做手输房间码兜底（首页「围观别人」），认证前也能用，但群卡片体验需要认证。
4. **mp 后台把最新版设为体验版**：版本管理 → 开发版本 → 选为体验版。
5. **触发玩家池导入**：函数部署后，在 DevTools 云开发面板对 `pool_import` 点一次「云端测试」（空参数）—— 把 web 版 10 名玩家拉进 pool 集合。
6. **加体验成员**：mp 后台 → 成员管理。
7. **真机 QA**：扫 `tmp/preview-qr.png`（或体验版码）真机跑一整局 2→A（4人模式，含撤销/重置/strict 降级/随机分队/统计页/海报各一次）。
8. **双真机闭环**（1、2 完成后）：A 机开围观 → 发卡片或报房间码 → B 机围观实时比分 → B 绑定玩家池身份 + 认领座位 → 结束后投票 → A 战绩入库 → B 查档案看到 web 老战绩 + 本场新增。

## 红线（每个 PR 自查，违者即合规事故）

1. 永远不做金钱输赢记账/筹码折算；投票零竞猜元素
2. 名称/简介/截图零"赌"联想（无牌面、筹码、¥ 符号）
3. 不注册小游戏账号、不挂游戏类目
4. AppSecret/session_key 永不下发客户端（用云函数 getWXContext 则根本不需要 AppSecret）

## 状态

- 2026-06-11：repo 创建，调研+计划固化。代码未开始。等待 WXAPP-0 用户注册账号（不阻塞 WXAPP-1/2）。
- 2026-06-11（晚）：**WXAPP-1 代码侧完成**。上游抽取（web repo `cd9551f` + 审查修复 `cf03c6f`，均已 push：checkALevelRules 纯化进 shared/aLevelLogic.js、playerCountMode 入 shared/、死分支清理）→ vendor 10 文件（锚 `cf03c6f`）→ node:test 206 用例全绿 → 原生 TS 空壳（4 页面，appid=touristappid）+ `tsc --noEmit` 绿。多 lens review（5 维度 + 对抗复核）：16 条 findings 全部修复（含 `npm run sync:check` 防手改门、import 闭包校验、isolatedModules、A 级测试缺口 6 例）。~~剩余半个 verify 关卡：开发者工具编译空壳~~ → **2026-06-12 已补**：服务端口开启后 `cli preview` 全量编译通过（包体 1.3KB，真机预览码 tmp/preview-qr.png）。**WXAPP-1 verify 全绿，里程碑关闭。**
- 2026-06-12（晚）：**「下一 session 工作清单」4 项全收口 + WXAPP-9 上线**（commits 579dbd1→845a6dc+）。①玩家天梯查询页（pool_list join 天梯分 + profile_get_by_handle，E2E 数据断言 + 截图）②长图海报重做对位 web exportMobile（buildPosterLayout 纯函数六区块 + MVP tagline + 观众投票，E2E 实绘导出 308KB PNG）③WXAPP-9 天梯分（简化 ELO：表现权重 28 > 胜负 24、胜方保底+1、负方封顶+6；起评分从 web 历史折算，名次为主；三处 CJS 镜像）④荣誉 caption 恢复（用户反馈）。review workflow 10 条 confirmed findings 全修（HIGH：公开端点 openid 泄漏白名单化、🎲 徽章合规别名）。282 测试 + tsc 绿；scoring-flow 与 ladder-poster-players 两套 automator E2E PASS；16 个云函数态（11+profile_get_by_handle）全部部署；体验版 **0.3.0** 已上传。坑：automator 会话会退化（screenshot IPC 永挂）—— 修复 = `cli close --project` 后 fresh launch（窗口级操作，不动 IDE），脚本已全步限时 + 截图 best-effort。
- 2026-06-13：**两条用户反馈修复 + 体验版 1.0.1**（commit 06af32a，main 对齐 f5a88fc）。①**天梯校准改按历史总场次**（见 WXAPP-9 §8b）—— 真机实测：塔 #1(18场)、11 已校准 / 13 待校准（旧实现全员待校准）；`*` 重定义为「起评分」语义（seeded，与校准独立）。②**未绑定玩家档案补全**：profile_get_by_handle 对未绑定玩家实时拉 `/api/players/{handle}` 全量战绩归一成档案 stats（含荣誉/连胜/局数/票数），客户端 buildProfileVM 渲染完整战绩格+荣誉(带caption)+成就，对齐 web 版（旧实现只 3 格 web 概要）；profileVM 容忍 web 缺失字段（头游/垫底 null → 略过格不显示 null）。多镜头对抗 review 16 raw→5 confirmed 全修：详情起评分标记取真信号 ladder.sessions===0（不按绑定状态推断，消除列表/详情打架）、getJson 加 4s 超时、web 不可达不再编造「总局数0」假富档案、seedLadderRating drift 注记补齐第 4 镜像。285 测试 + tsc + sync:check 绿；ladder-poster-players E2E PASS（含 web-only 玩家 7 格战绩+7 荣誉断言）。**pool_list 已部署 live**；profile_get_by_handle 加固当时被云会话漂移（ResourceNotFound.Namespace）阻塞，**同日稍后已重部署成功（见下条）**。
- 2026-06-13（续）：①**profile_get_by_handle 加固重部署成功**（另一 app 释放共用云会话后一把过，task #24 关闭）。②**另一 agent 天梯 vendor 重构合入**（`86de826`/`39225f2`，建在我提交之上）：`core/ladder.js` + 4 处手抄 CJS 镜像 → 单一事实源 `shared/ladderLogic.js`（ESM 进 `miniprogram/shared-logic/` + esmToCjs 进 4 云函数，见 §9/CLAUDE.md 天梯特例），从根上解决我 review 抓到的 seedLadderRating 漂移；4 个天梯云函数（profile_sync/pool_bind/pool_list/profile_get_by_handle）重部署（各打包 ladderLogic.js）。③**用户清理 test 玩家**：新增自限管理函数 `pool_prune`（只删 `test_` 前缀，谁调都动不了真实玩家）+ `scripts/automator/prune-test-users.mjs`，删 `test_dnonan`/`test_chaozi`，天梯榜 24→22 名（web 源侧清理交另一 agent）。④**main 全对齐**到分支（`50e57b7`，含补删 main 残留的 `core/ladder.js` —— `git checkout <branch> -- .` 不删分支已移除的文件）；体验版 **1.0.2** 上传；ladder-poster-players E2E 复验绿（塔 #1、22 名、9 已校准/13 待校准、未绑定 7 格+7 荣誉+4 成就）。**云端=repo=体验版三者一致。**
- 2026-06-13（续2）：**外观开关（用户反馈）**。新增 `core/theme.js`（auto/light/dark，storage 持久）：把 `theme--light`/`theme--dark` 类挂到各页 `.page` 根节点覆盖系统 `@media`，`wx.setNavigationBarColor` 同步导航栏；机制写入 DESIGN.md §1（4 处色值同步约束）。UI = 首页「模式与规则」卡底部三段控件（复用 `.seg`）。`tokens.wxss` 加 `.page.theme--*` 两套色值；`app.wxss` `.page` 加 `min-height:100vh+background` 铺满；5 页 root 加 `{{themeClass}}` + `onShow` 调 `applyTheme`；`index.ts` accentColor 改按 `effectiveTheme()`。tsc + 测试绿；theme-shots E2E PASS（深/浅/跟随系统三态截图 + themeClass 翻转 + 持久）。体验版 **1.0.3**。
- 2026-06-13（续3）：**外观开关反色修复 + 1.0.4**（commit `e072e37`，main `3ceeef2`）。`app.wxss` `.page` 补 `color:var(--text-primary)` —— 否则普通 `<text>` 继承 `page{}` 元素按系统 @media 算好的 color，手动覆盖时与背景反色看不清；DESIGN.md §1 约束②补「.page 须带 color」。
- 2026-06-14：**档案对齐 web 三段 + 三个用户问题修复**（gap 审计 workflow → commits `da9b814` / `4f101a3` / `32cd84d`）。
  - **档案扩展（队友与对手 / 近期排名走势 / 最近游戏）**：web `player-profile.html` 三段对位。新增 `templates/profileExtras.wxml`（profile/players 两页共用）、`core/profileVM.js` 派生（buildRelations/buildRankTrend/buildRecentGames + 当前连胜格）、`core/rankChart.js` canvas 折线图（几何/绘制分层，token 镜像 DESIGN §10 例外③）。云端 `profileExtras.js`（vendored 双份）把 partners/opponents 解析成 display-safe 数组（name/emoji，**不下发 openid**）+ rankTrend/recentGames（剥房间码）；`profile_get`/`profile_get_by_handle` 三路（own / 绑定 / 未绑定 web）都接。21 新测试（profileVM relations/trend/games + rankChart 几何）。
  - **bug：手动输入新建玩家没进 DB**（用户报告）→ 新增 `pool_add` 云函数落 pool 集合（生成 latin handle，中文名进 displayName）；`index` 手动输入接入，离线降级仅本地。`pool_prune` 加 `scanTest` 模式（按 handle/displayName 测试标记自清）。
  - **一个微信只绑一个玩家、未绑过则首次创建即绑+一次确认**（用户决策）→ `pool_add` 回传 callerBound；`index` 建玩家后若未绑过弹「这是你本人吗」→ 复用 `pool_bind`。
  - **战绩入库管理员审核队列**（用户决策；防房主伪造自家战绩）→ `profile_sync` 外科加分支（apply 核心不动）：非管理员入库进 `pending_sessions`，管理员凭 approveId 重跑 apply（gameKey 幂等）；新增 `admin` 云函数（claim 口令认领/whoami/list/reject）+ `pages/admin` 审核页 + 档案页「⚙︎ 战绩审核」入口。管理员身份 = `admins` 集合，口令 = 管理员微信号（server-only bootstrap token，云函数只能拿 openid 故需自助认领）。
  - 状态：299 测试 + tsc + sync:check 绿。
- 2026-06-14（续）：**全部部署 + 绑定档案合并修复 + 体验版 1.0.5**（commits `5cba356` 修复 + `83a5d39`，main 对齐 `c8ba911`）。
  - **部署阻塞复盘**：先 `ResourceNotFound.Namespace`（云会话漂到别 env）→ 重启 IDE 后转 `getCloudAPISignedHeader 41002 system error`。**⚠️ 当时归因「微信签名后端抽风、自愈」是错的（2026-06-19 纠正，见下方状态条）**：41002 是 **CLI 这条 `cloud functions deploy` 签名通道坏了**，不是后端宕、不会「自愈」——上次「重启+等」碰巧好，其实换 GUI 部署立刻就能成。**正确教训**：CLI 报 41002 → 直接改用 IDE GUI「上传并部署」（GUI 签名走另一条好的通道），别空等几小时。
  - **新 bug：绑定玩家档案不完整**（用户报告，塔完整/豪不完整）。审计（`scripts/automator/player-data-audit.mjs`）确认：未绑定玩家 live-fetch web → 队友/对手/走势/最近完整；绑定玩家只取 wx 侧 → 这几段几乎全空（绑定只并了 web 聚合+荣誉，关系/走势/最近没并）。修复：`profile_get` / `profile_get_by_handle` 绑定路径实时拉 web（pool handle = web handle）+ `profileExtras` 新增 mergeRelations/mergeTrend/mergeRecentGames 合并 web 历史 ∪ 小程序新局。真机复验：帆 队友9/对手11/走势10/最近10、豪 队友9/对手9/走势10/最近10（修前全 0/1/1/1）。
  - 15 云函数全部 live（+pool_add +admin）；遗留 test 玩家已 `pool_prune {scanTest:true}` 清；305 测试绿；**体验版 1.0.5** 上传，云端=repo=体验版三者一致。
  - **首次用须设管理员**：档案页「⚙︎ 战绩审核」→ 输入口令 `AXAXAX0x` 认领（写入 admins 集合），之后非管理员入库进 pending_sessions 待审。
- 2026-06-19：**分享后非房主进不去房间 —— 根因 + 加固**（用户报告「巨大问题：share 到群里别人打开/手输房间码都进不去」）。
  - **根因**：围观读路径是**客户端直读** `rooms` 集合（`db.watch` + 轮询 `.doc().get()`），受集合安全规则约束。房间 doc 由云函数写入（绕过规则），但非房主用 **另一个 openid** 客户端读时被「仅创建者可读写」默认规则拒 → `连不上房间`。房主无感（房主看的是本地 store，从不客户端读）。两条入口（分享卡片 → room 页 / 首页「围观别人」手输码）都汇进 `watchRoom` → 同一处被拒，故双双失败。这正是人工清单 #2（控制台设 rooms 公开读）**从未执行**的后果，代码注释（`room_create:46`）与 PLAN #2 早已标注「不改则全拒（已实测）」。
  - **即时解**（仅 AX 能做）：控制台把 rooms 设「所有用户可读，仅创建者可写」→ 立即生效，watch 直读放行。
  - **代码加固**（消除对人工步骤的依赖，TDD）：新增 `room_get` 云函数（管理端权限直读 + `roomView.sanitizeRoomForViewer` 脱敏：剥 openid → `isOwner` / `claim.mine` 布尔，**不下发 openid**）。三处客户端 rooms 直读改走 room_get：`roomSync.pollOnce`（轮询保底）/ `room.refreshOnce`（认领后刷新）/ `index.collectPosterVotes`（海报 voteEpoch）；`db.watch` 保留为实时快通道。`room.renderDoc` 改双通道（watch 原始 doc 用 `claim.openid`/`ownerOpenid` 客户端判，room_get 脱敏 doc 用预判好的 `claim.mine`/`isOwner`）。这样**权限没设对也能围观**（room_get 轮询），设了则 watch 实时 —— 读权限从硬前提降级为实时优化。
  - **非房主自动进围观**：room 页 onLoad 即 `watchRoom`，本就是「打开即旁观」，无需额外动作 —— 加固让这个自动旁观在任意权限态下都成立。
  - code-reviewer 通过（无 CRITICAL/HIGH）；M1（认领后 watch 帧覆盖 mine 闪烁）→ `watchRoom.syncVersion` 同步去重游标修复；L1（version 自增不变量）补注；L2（db_error errMsg 不下发客户端）。311 测试（+6 roomView）+ tsc 绿。代码 commit `e1f697e`，main 对齐 `f02be97`。
  - **部署阻塞 → 定论（CLI 41002 是 CLI 通道 bug，不是后端宕）**：`cli cloud functions deploy room_get` 一路 `getCloudAPISignedHeader 41002 system error`。逐项排除：① 网络/代理——默认路由直出 `en0`（Clash 直连+系统代理关、Tailscale 无 exit node），非网络 ② appid——`project.config.json` 有 `wxb9f2afca5bcf65c4`（`--appid` 显式传也一样 41002），非配置 ③ 多实例——单实例 ④ 登录——重新扫码登录后仍 41002，非会话 ⑤ room_get 专属——重部署**已存在的** `room_create` 也同样 41002 → **账号/环境级、所有 deploy 都签名失败，但 read（list/info）正常**。**决定性证据**：改用 **IDE GUI「上传并部署」→ 越过签名步**，报 `ResourceInUse.FunctionName 已存在`（说明 GUI 那条签名通道好、且函数已建成）。`cli cloud functions info` 确认 `room_get` = **Active / Nodejs16.13**。**∴ root cause = CLI 的 `getCloudAPISignedHeader` 通道对本机坏了（GUI 走 IDE 内部会话签名是好的）；`room_get` 已 GUI 部署上线。** （`cli ... download` 也被同一签名 quirk 挡，无法 byte 级核对，但 Active + ResourceInUse + 该函数只存在过我的代码 → 即我的代码。）
  - **CWD 漂移自纠**：调试中一度 `cd cloudfunctions/room_get` 后 `--project "$PWD"` 指错目录 → 误报「project.config.json 缺失 / appid missing」，其实 config 一直在仓库根（`b952ff1` 起就 tracked）。教训：deploy/检查脚本固定 `cd` 仓库根。
  - **room_get 端到端验证通过（2026-06-19）**：云端测试传 `{"code":"A1B2C3"}` → `{"ok":false,"error":"room_not_found"}`，215ms、无 module 报错（证实代码+`wx-server-sdk` 依赖都在云端就绪）。`room_get` = Deployed（创建 19:29，更新 19:31）。
  - **唯一待 AX**：上传新客户端（体验版）让 room_get 真正被调用生效。控制台 rooms 读权限已设（用户 2026-06-19 当场改为「所有用户可读」）。分享当前已可用（权限+watch），room_get 是加固。
