# 掼蛋计分器 · 微信小程序版调研与决策（2026-06-11）

> Provenance：8-agent 调研 workflow（4 维度 finder：注册/备案、类目/版号、个人主体社交能力、技术栈/后端 —— 每个维度单独对抗复核，~1.39M tokens），41 条结论中 39 条对官方现行文档核验 confirmed、2 条 corrected（已按纠正后口径记录）。同日 dahua-dice 项目的 15-agent 调研（体验版路线）交叉比对一致。通用政策细节（成员上限、备案机制、社交 API 清单、云开发定价、来源列表）以跨项目 playbook 为准：`~/.claude/references/wechat-miniprogram-friends-only.md` —— 本文只记 guandan-scorer 专属的结论、决策与架构映射。

## 核心结论：计分器与 dahua-dice 的关键差异

dahua-dice 是**游戏**（有对局玩法）→ 个人主体公开上架 ≈ 不可行（牌类小游戏对个人关闭），只能永远体验版。

**掼蛋计分器是纯工具**（不发牌、不出牌、无对局玩法）→ 按功能而非题材归类，走「工具」类目是正路、不构成"类目逃避"。**两条路线都真实可用**：

| | 体验版路线 | 正式上架路线 |
|---|---|---|
| 申请 | 注册即用（免费、当天） | + ICP 备案（免费、1-3 周、人脸核身）+ 提审 |
| 谁能用 | 15 体验成员 + 15 项目成员 ≈ 31 人，逐个手动加 | **任何人**，群里点卡片即开 |
| 群内邀请体验 | 卡片只有成员能打开，非成员提示无权限 | 即点即看（核心诉求达成）|
| 版号 | 不涉及 | **不涉及**（工具类目，有"麻将计分/打牌记账"类个人小程序 2024-2026 持续存活先例）|
| 成本 | ¥0（云开发免费环境） | 发布 15 天后云开发转收费，¥19.9/月 |
| 风险 | 无审核 | 审核裁量（头号被拒原因"类目不符"，可申诉，二次过审率高）|

**决策：先走体验版把产品跑通（朋友局 ≤31 人完全够），代码按"随时可提审上架"的合规标准写**（命名/类目/红线从第一天就按上架标准执行），等想开放给任意群友时再走备案+提审，无需返工。

## 上架合规要点（guandan 专属，写代码前就要遵守）

1. **类目**：注册普通**小程序**（千万不要注册小游戏账号——游戏类目单向锁定不可改回）。类目选 **「工具-计算器」**（个人主体工具类 11 个二级类目之一，资质要求"无"）。慎选"记账"（个人主体版备注"不包含用户自定义生成内容记录及分享"，房间分享功能反而踩备注）。"投票"类目是非个人主体专属——**申报描述以计分/战绩记录为核心，MVP/最闹投票只作房间内附属互动描述**。
2. **命名**：两个以上词汇组合，不能单用"掼蛋"。首选 **「掼蛋计分助手」**（"胡萌萌麻将计分"等先例验证过的命名模式）；若"掼蛋"关键词在昵称审核被拦（open question），备选「牌局计分助手」。简介写"线下牌局计分记录工具"，不出现"对局/开局玩牌/赢钱"。
3. **涉赌红线**（运营规范 6.1.5 + 2.5.1/2.5.6，体验版也别碰）：
   - 只记**级数/排名/荣誉**，永远不做"输赢金额记账/筹码折算"功能（金额记账是审核裁量下最易被联想为赌资结算的特征）
   - 投票仅限 MVP/表现评价，零竞猜/下注/有奖预测
   - 审核截图不出现扑克牌面、筹码、人民币符号；零付费房卡/抽头元素
4. **提审备注模板**："本程序仅为线下掼蛋牌局的计分记录工具，不含任何对局玩法、不发牌不出牌不掷骰。" 首页直达计分功能。被拒走 mp.weixin.qq.com 通知中心看理由 → 整改 + 补演示视频重提。

## 微信社交能力 → 产品映射（个人主体全部可用，已逐条核验）

| 现有 web 功能 | 小程序实现 | 备注 |
|---|---|---|
| 房间链接 + 6 位房间码 | `onShareAppMessage` 分享卡片，`path: "pages/room/room?code=A1B2C3"`，自定义 title/图(5:4) | 点卡片直达房间——比 web 链接+输码流畅一个量级 |
| 围观者 2s 轮询 | 云数据库 `db.watch` 实时推送 + 轮询兜底双通道 | watch 官方无自动重连承诺，onError 自行重建 |
| 房主 auth token | `wx.login` → 云函数 `cloud.getWXContext()` 拿 openid（免 AppSecret） | 静默登录，免现有 ownershipToken 体系 |
| 匿名投票指纹 | openid 天然幂等去重 | 比现有 fingerprint 方案更可靠 |
| 玩家 handle + 照片上传 | 头像昵称填写能力（`<button open-type="chooseAvatar">` + `<input type="nickname">`，2.24.4 起平台自动内容安检）+ 云存储 fileID | getUserProfile 已废（2022-11）；照片不再 base64 |
| —（新能力）| `withShareTicket` + `wx.getGroupEnterInfo` 拿 opengid → 房间绑群、群内战绩榜 | 2018-07-05 起分享方拿不到群 ID，按"打开方上报 opengid"设计；解密走云开发 cloudID 通道 |
| —（新能力）| 动态消息（updatable message）：卡片实时显示"X 人围观中 / 第 N 局" | 为房间邀请量身定做 |
| —（新能力）| 一次性订阅消息："本局结束"通知 | 模板库按类目过滤，注册后实测工具类可选模板（open question）|
| 朋友圈分享 | `onShareTimeline` 仅单页模式（无登录态、禁跳转、只能带 query）| 只做只读战绩海报 + 引导进小程序，不能当房间入口 |
| 聊天工具模式（2025 Beta）| 不依赖 | 高级接口要交易保障/社交金融类目，个人够不到；普通分享链路已覆盖核心诉求 |

## 架构映射（web 版 → 小程序版）

| 层 | web 版（guandan-scorer） | 小程序版（本 repo） |
|---|---|---|
| 前端框架 | vanilla ES6 modules + DOM 直操（40 模块） | **原生 WXML/WXSS/TS**（不用 Taro——web 版没有 React 可复用，单端引入框架只是负收益；miniprogram-api-typings 补类型）|
| 纯逻辑层 | 顶层 `shared/`（994 行：achievementLogic/gameStatus/honorCatalog/roomSnapshotValidation/ruleConfig/voteSessionKey）+ `src/game/calculator.js`（231 行纯函数）〔2026-06-11 注：WXAPP-1 后 shared/ 已扩为 9 模块（新增 aLevelLogic/playerCountMode/version），清单与行数以 docs/PLAN.md §复用资产为准〕 | **原样 vendor 进 `miniprogram/shared-logic/`**——零 DOM 依赖直接跑；upstream（web repo）是单一事实源，改规则先改那边再同步 |
| 规则引擎 | `src/game/rules.js`（算法与 state 单例/events 耦合） | 抽出 checkALevelRules/applyGameResult 纯算法部分，注入 state 快照〔2026-06-11 注：checkALevelRules 已抽纯落地（upstream shared/aLevelLogic.js）；applyGameResult 编排层决定不 vendor，WXAPP-2 在小程序侧重实现〕 |
| 荣誉/统计 | `src/stats/honors.js`（计算+DOM 渲染混合，765 行）、`statistics.js` | 只搬计算半边（HONOR_META + 算法），渲染重写为 WXML |
| 后端 | Vercel Functions + Vercel KV（gd.ax0x.ai） | **云开发**：云函数 + 云数据库。Vercel 这条路对小程序物理性死路：`.ai` 不在工信部可备案 TLD 列表、境外托管无法完成备案、正式版强制已备案合法域名 |
| 房间存储 | KV `room:CODE` JSON，24h TTL | `rooms` 集合单文档/房间（状态收敛进单 doc，CAS 条件更新替代 Redis 语义；roomSnapshotValidation.js 直接复用做校验）|
| 实时同步 | 围观 2s 轮询 + 房主 10s 自动推 | `db.watch`（仅 where/orderBy/limit，≤5000 docs，limit≤200）+ 轮询兜底 |
| 玩家档案 | `player:handle` KV + handle 体系 | `players` 集合，`_id=openid`；现有 stats schema 近乎平移 |
| 样式/主题 | 5 主题 token 系统（oklch） | WXSS 不支持 oklch/color-mix → MVP 单主题（hex 降级），主题系统后置 |
| PNG 导出 | canvas 长图 | `wx.canvasToTempFilePath` + 保存相册（writePhotosAlbum 授权）|
| i18n | 中文 | 朋友局 zh-CN only |

## 开工 checklist

1. **（用户人工）** mp.weixin.qq.com 注册个人主体**小程序**（非小游戏），名称「掼蛋计分助手」，类目「工具-计算器」→ 开发者工具开通云开发（免费环境）→ 后台加体验成员
2. 本 repo scaffold：原生 TS 模板 + vendor `shared-logic/`（含 upstream 提交哈希注记）
3. 最小闭环：建房（云函数）→ 分享卡片带房间码 → 体验成员点卡片进房 → db.watch 看到一轮计分
4. 红线自查随每个 PR：无金额功能、命名合规、截图合规
5. mp 后台隔几个月登录防闲置冻结

## Open questions（动手时核验）

- 体验版二维码 7 天有效期口径冲突（两轮调研结论相反）——用 `getunlimitedqrcode`（`env_version:"trial"`）永久码规避，建号后实测
- "掼蛋"关键词在小程序昵称审核/备案名称筛查是否被棋牌前置审批关键词拦截——注册时即可验证，备选「牌局计分助手」
- 一次性订阅消息在「工具-计算器」类目下实际可选的模板（有无贴合"对局结束"的）——注册后在 mp 后台实测
- 免费云开发环境的并发 watch 连接上限（个人版 ¥19.9/月 被查到仅 10 条并发实时连接 vs 官方案例数千并发，口径冲突）——影响"纯 watch vs watch+轮询混合"权重，反正轮询兜底都要做
- 投票功能的类目合规边界：审核若认定"社交互动"为核心服务可能要求换类目——提审材料弱化投票、突出计分即可规避（低风险）

## 相关文档

- 通用 playbook：`~/.claude/references/wechat-miniprogram-friends-only.md`（备案/认证/版号机制、成员上限官方表、社交 API 清单、云开发定价、H5 备选、全部来源 URL）
- 设计与施工计划：`docs/PLAN.md`（本 repo）
- 姊妹项目同日调研：`~/projects/side-projects/dahua-dice/docs/research/2026-06-11-wechat-miniprogram-port.md`（游戏类视角，体验版路线论证更详细）
- web 版（游戏逻辑单一事实源）：`~/projects/side-projects/guandan-scorer/`
