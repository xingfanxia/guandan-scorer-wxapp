# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

掼蛋计分助手 — 微信小程序版的掼蛋（Guandan）计分器。是 `~/projects/side-projects/guandan-scorer`（web 版，Vercel + KV）的 sibling repo，**不是 fork**：infra 与 web 版零重叠（原生小程序 + 微信云开发），只共享纯游戏逻辑。

**当前状态（2026-06-14）：核心闭环 + 档案对齐 web 三段 + 四个用户问题修复（全部署上线）**（分支 wxapp-2-scoring-loop，main 对齐 `c8ba911`）——单机计分闭环、云房间围观（watch+轮询）、投票/座位认领/档案、长图海报（web 手机版对位）、玩家池与 web 数据迁移、天梯分（简化 ELO + 起评分；**校准门按历史总场次 web+小程序合计 <3 才待校准沉底**；单一 vendor 源 `shared/ladderLogic.js`）、玩家天梯查询页、**外观开关**（首页三段控件覆盖系统主题，机制见 DESIGN.md §1）。

**2026-06-14 新增（gap 审计 + 用户报告，见 docs/PLAN.md 2026-06-14 条 + DESIGN.md §11）**：
- **档案对齐 web 三段**：队友与对手（最佳/最弱队友、最强/最弱对手 + 全列表胜率条）、近期排名走势（canvas 折线）、最近游戏。两页共用 `templates/profileExtras.wxml`；派生纯函数在 `core/profileVM.js`，折线图 `core/rankChart.js`；云端 `profileExtras.js`（vendored 双份）解析 partners/opponents 成 display-safe 数组（**不下发 openid**）。
- **bug 修复**：手动输入新建玩家没进 DB → 新增 `pool_add` 云函数落 pool。`pool_prune` 加 `scanTest` 自清模式。
- **一个微信只绑一个玩家**：未绑过则首次创建即绑 + 一次确认（pool_add 回 callerBound，复用 pool_bind）。
- **战绩入库管理员审核队列**（防房主伪造）：非管理员入库进 `pending_sessions`，管理员（`admins` 集合，口令认领）在 `pages/admin` 审批；`profile_sync` 外科加 approveId 分支（apply 核心不动）；新增 `admin` 云函数。
- **绑定玩家档案合并修复**：绑定玩家原只取 wx 侧 → 队友/对手/走势/最近几乎全空（绑定只并了 web 聚合）。`profile_get`/`profile_get_by_handle` 绑定路径改为实时拉 web + `profileExtras` mergeRelations/mergeTrend/mergeRecentGames 合并 web 历史 ∪ 小程序新局。

**15 云函数 live**（+`pool_add` +`admin`），**体验版 1.0.5**，云端=repo=体验版一致。部署曾被微信签名后端 `41002` + 多 DevTools 实例阻塞数小时，杀全部实例单开 + 等后端自愈后一把过（复盘见 docs/PLAN.md 2026-06-14 续）。**首次须设管理员**：档案页「⚙︎ 战绩审核」输入口令 `AXAXAX0x` 认领。

**2026-06-19 加固（分享后非房主进不去房间）**：根因 = 围观读路径是客户端直读 `rooms` 集合，受集合安全规则约束，非房主（另一 openid）被默认「仅创建者可读写」拒（房主无感）。两条入口（分享卡片 / 手输房间码）都汇进 `watchRoom` 故双双失败。新增第 16 个云函数 **`room_get`**（管理端权限直读 + 脱敏不下发 openid）作围观**保底读通道**：`roomSync.pollOnce` / `room.refreshOnce` / `index.collectPosterVotes` 三处客户端 rooms 直读改走它，`db.watch` 保留为实时快通道 → **读权限从硬前提降级为实时优化**（没设也能轮询围观）。311 测试绿。代码 commit `e1f697e`、main `f02be97`；**`room_get` 已 GUI 部署（Active）**，rooms 读权限用户已设。**待 AX：上传新客户端让 room_get 生效**（上传前 GUI「云端测试」room_get 传 `{"code":"A1B2C3"}` 应回 `room_not_found`）。详见 docs/PLAN.md 2026-06-19。

**⚠️ 云函数部署踩坑（2026-06-19 定论，覆盖 2026-06-14 误判）**：`cli cloud functions deploy` 报 `getCloudAPISignedHeader 41002 system error` **不是「微信签名后端抽风、等自愈」**——是 **CLI 这条签名通道对本机坏了**（账号/环境/网络/登录/appid 全好，已逐项排除；连重部署已存在的函数也同样 41002，但 list/info 等 read 正常）。**正确处理：直接用 IDE GUI 部署** —— 右键 `cloudfunctions/<fn>` →「上传并部署：云端安装依赖」（GUI 走 IDE 内部会话签名，是好的通道）。别再按旧 doc 空等几小时。`cli ... download` 也被同一 quirk 挡。

## 账号与环境（2026-06-12 注册完成）

- **注册名**：「闹掼计分器」（个人主体，类目 工具-计算器；「掼蛋计分助手」为当初首选名，实际注册用此名）
- **appid**：`wxb9f2afca5bcf65c4`（公开标识，非密钥；已写入 project.config.json）
- **云开发环境**：`cloud1-d2go4yxtv833a2113`（免费开发环境，未发布期免费；WXAPP-3 云函数/数据库用）
- 体验成员：待添加（mp 后台 → 成员管理，不挡开发）

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
- **身份 = openid**（wx.login → 云函数 getWXContext，免 AppSecret），替代 web 版 handle + ownershipToken 体系。微信身份贯穿到底：玩家**认领座位**绑 openid，战绩随 openid 累计，本人用微信身份直查档案；头像昵称走 chooseAvatar/nickname 填写能力（平台已禁静默获取）。
- **UI 自成体系**（2026-06-12 用户拍板）：简洁大方、可读性优先，**不复刻 web 版主题美学**；**dark/light 双模式硬需求**（`darkmode: true` + theme.json，WXSS 色值全走 token 变量）。功能上对齐 web 版全功能。WXAPP-2 动 UI 前先产出 DESIGN.md。

## 游戏逻辑：单一事实源在 web repo

规则引擎的权威实现在 `~/projects/side-projects/guandan-scorer`：

- 顶层 `shared/`（11 个零宿主依赖模块）：achievementLogic / aLevelLogic / gameStatus / honorCatalog / honorLogic / ladderLogic / playerCountMode / roomSnapshotValidation / ruleConfig / version / voteSessionKey —— `checkALevelRules` 已抽纯（upstream `cd9551f`+`cf03c6f`）、16 荣誉算法已抽纯进 `shared/honorLogic.js`（upstream `00f6ef6`）、天梯算法抽纯进 `shared/ladderLogic.js`（upstream `b5c6a66`），web 侧只剩薄包装/渲染半边。**天梯特例**：`ladderLogic.js` 既 vendor 成 ESM（`miniprogram/shared-logic/`，原 `core/ladder.js` 已删、测试改引 vendor 版），又经 `esmToCjs` transform vendor 成 CJS 进 4 个云函数目录（`cloudfunctions/{profile_sync,pool_bind,pool_list,profile_get_by_handle}/ladderLogic.js`，各 `require('./ladderLogic.js')`）—— 改算法只改 web repo + `sync:shared`，**改完要重新部署这 4 个云函数**。**注意范围**：rules.js 的 `applyGameResult`/`advanceToNextRound` 编排层仍耦合 web 的 state 单例，没有也不会 vendor —— 小程序侧由 `miniprogram/core/gameStore.js` 重实现（语义对齐，契约测试见 test/gameStore.test.mjs）
- `src/game/calculator.js`（231 行纯函数）：parseRanks / calculateUpgrade / nextLevel

本 repo 的 `miniprogram/shared-logic/` 是 vendor 快照，由 `npm run sync:shared`（scripts/sync-shared-logic.mjs）生成，文件头注记 upstream commit hash，上游必须是干净 commit 才允许同步。**改游戏规则：先改 web repo，再 `npm run sync:shared` 同步过来 —— 永远不要让两边规则分叉、不要手改 vendor 文件。** A 级规则细节（roundOwner 判定、strict 3 次失败降级、双 A 局归属）见 web repo CLAUDE.md。

## 合规红线（每个 PR 自查，违者即合规事故）

1. 永远不做金钱输赢记账/筹码折算功能；投票（MVP/最闹）零竞猜下注元素
2. 名称/简介/审核截图零"赌"联想：无扑克牌面、筹码、人民币符号；简介自称"线下牌局计分记录工具，不含对局玩法"
3. 不注册小游戏账号、不挂游戏类目（游戏类目单向锁定，且牌类对个人主体关闭）
4. AppSecret / session_key 永不出现在客户端代码或 repo
5. 真钱/兑换/红包元素是腾讯对未上架内容唯一主动执法类别 —— 体验版也零容忍

## 微信开发者工具 = 单实例共享资源（2026-06-12 与 dahua-dice-wxapp 实测撞车后立规）

**Canonical 约定在 `~/.claude/references/wechat-devtools-lock.md`**（与 dahua-dice-wxapp 共同遵守），要点：

1. **永不 `cli quit`/`pkill` IDE**（生命周期操作杀掉所有项目的会话）。冒烟挂起 = 报告占用并等待/询问。
2. **automator/生命周期操作前拿锁**：`~/.claude/state/wechat-devtools.lock/`（45 分钟僵尸可抢）。本 repo 实现：`scripts/automator/devtoolsLock.mjs`（automator 脚本已内置）；shell 侧可用 `~/projects/side-projects/dahua-dice-wxapp/scripts/ops/devtools-lock.sh acquire/release/status`。
3. **窗口级操作**（`cli open --project`、自己项目的 preview/build）不需要锁，先 status 看一眼即可；多项目窗口可共存。
4. 完全不碰 DevTools 的工作（写码/npm test/tsc/git）随便并行。
5. **automator 端口分家**：本 repo `port: 9421`（dahua 9422），不要用默认 9420。
6. **云函数 deploy 经 IDE 全局云会话**，跨项目云操作必须串行（同一把锁）。已知症状：会话不对时报 `ResourceNotFound.Namespace` / `getCloudAPISignedHeader 41002` —— 此时执行面（callFunction）通常仍正常，别误判成函数挂了；处理 = 拿锁后重试或留给 GUI 部署，不要重启 IDE。

## 开发命令

- `npm test` — 规则 + 编排逻辑测试（node:test，零第三方依赖，250+ 用例）
- `npm run typecheck` — `tsc --noEmit` 检查 `miniprogram/**/*.ts`
- `npm run sync:shared` / `npm run sync:check` — vendor 同步 / 防手改校验
- `node scripts/automator/scoring-flow.mjs` — 模拟器 E2E（计分主链路，截图到 docs/reports/）
- `node scripts/automator/cloud-smoke.mjs` — 云函数冒烟（真云环境：建房/CAS/冲突）
- 开发者工具 CLI（需扫码登录 + 服务端口；多 agent 共享规则见上节）：`cli open/preview/upload --project $(pwd)`；云函数部署 `cli cloud functions deploy --env cloud1-d2go4yxtv833a2113 --names <fn...> --remote-npm-install --project $(pwd)`

## 命名约定

里程碑用 `WXAPP-<N>`（见 docs/PLAN.md），不用 Stage/Phase 字母轴。

## Sibling Projects

- `~/projects/side-projects/guandan-scorer` — web 版，游戏逻辑单一事实源
- `~/projects/side-projects/guandan-online` — 多人对战版（另一个产品，勿混淆）
- `~/projects/side-projects/dahua-dice-wxapp` — 同模式 sibling（大话骰小程序版，Taro 路线因为它有 React 可复用；架构问题可参考但框架选型不同）
