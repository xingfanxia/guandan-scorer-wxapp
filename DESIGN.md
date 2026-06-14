# DESIGN.md — 闹掼计分器 设计系统

> 2026-06-12 定稿（WXAPP-2 起所有 UI 以此为准；偏离需用户批准）。
> 方向来自用户拍板：**简洁大方、可读性优先、不复刻 web 版主题美学、dark + light 双模式**。

## 0. 定位

- **主体**：线下掼蛋牌局的计分记录工具。手机平放在牌桌上/递着看，环境光从茶馆暗光到户外白天都有。
- **受众**：牌友局，年龄跨度大（含中老年）——字号、对比度、点按目标全部按"隔着桌子瞟一眼能读"设计。
- **单一任务**：最快录入一局名次，最清楚地展示两队当前级牌。
- **三原则**：① 大字优先（数据 > 装饰）；② 一屏一主角（每屏只有一个视觉重心）；③ 牌桌行话做文案（打A/双上/末游，不说系统话）。

## 1. 双模式架构（实现规约）

- `app.json`: `"darkmode": true`；窗口/导航 chrome 色走 `theme.json` 变量（`@navBgColor` 等）。
- 页面内容色走 **WXSS 自定义属性**：`page { --token: ... }` 定义 light 值，`@media (prefers-color-scheme: dark) { page { --token: ... } }` 覆盖 dark 值。
- **铁律**：组件 WXSS 只许引用语义 token（`var(--text-primary)`），禁止硬编码色值/直接引用基础色板。
- **手动外观开关（auto / light / dark，2026-06-13 加）**：首页「模式与规则」卡底部「深色外观」段控件让用户固定主题、覆盖系统。机制 = `core/theme.js` 把 `theme--light` / `theme--dark` 类挂到各页 `.page` 根节点，token 在 `.page` 作用域重定义（`tokens.wxss` 的 `.page.theme--*` 块，class 特异性盖过 `@media`）；同时 `wx.setNavigationBarColor` 同步原生导航栏（chrome 吃不到 WXSS）。auto 不挂类、走 `@media` 跟随系统。偏好存本地 storage（`themePref`）。约束：① 色值同步 **4 处**（`page{}` / `@media page{}` / `.page.theme--light` / `.page.theme--dark`，WXSS 无变量复用）；② `.page` 须自绘 `min-height:100vh; background:var(--bg)` 盖住身后系统主题的 `page{}` 元素，**且必须 `color:var(--text-primary)`** —— 否则普通 `<text>` 继承的是 `page{}` 元素按系统 @media 算好的 color，手动覆盖时与背景反色（文字看不清）；放在 `.page` 才在覆盖后的 token 上重算；③ 各页 `onShow` 调 `applyTheme(this)`，新页务必照做；④ `index.ts` 的 `accentColor`（switch 组件属性，吃不到 var）按 `effectiveTheme()` 同步，非系统主题。

## 2. 色板

基调取自牌桌呢绒的深绿——做品牌色而非背景色，surfaces 保持中性偏冷灰绿调（拒绝米黄+赤陶土、拒绝纯黑纯白、拒绝 #0D1117+霓虹的三套 AI 默认审美）。

### 基础色板（hex，light / dark 各一套）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--bg` | `#F4F6F3` | `#111613` | 页面底（off-white / 带绿调 off-black） |
| `--surface` | `#FFFFFF` | `#1A201C` | 卡片/面板 |
| `--surface-2` | `#ECEFEA` | `#242B26` | 次级面板、输入框底 |
| `--text-primary` | `#1B221E` | `#F0F3EF` | 主文字（对 bg 对比度 ≥ 12:1） |
| `--text-secondary` | `#5A655E` | `#9AA69E` | 次要文字（≥ 4.5:1） |
| `--hairline` | `rgba(27,34,30,0.12)` | `rgba(240,243,239,0.14)` | 1rpx 分隔线/描边 |
| `--accent` | `#15694B` | `#46B98D` | 品牌呢绒绿：主按钮、激活态、roundOwner 标记 |
| `--accent-pressed` | `#0F523A` | `#37A179` | 按压态 |
| `--team-t1` | `#2A5DB0` | `#7CACFF` | 蓝队（与 web 版语义一致） |
| `--team-t2` | `#B6403B` | `#FF8077` | 红队 |
| `--gold-a` | `#A37412` | `#E5B254` | A 级/通关时刻专用鎏金 |
| `--danger` | `#B6403B` | `#FF8077` | 破坏性操作（与 t2 同值不同语义，分开声明） |

规则：状态色（成功/警示）从 `--accent`/`--gold-a`/`--danger` 派生，不再引入新色相。整页同一基调，不许单独插一块异色 section。

## 3. 字体与字阶

系统字栈（小程序无网络字体自由度，把约束做成风格——用**字重与字号的极端对比**造个性，不靠字族）：

```
font-family: -apple-system, "PingFang SC", "HarmonyOS Sans SC", "MiSans", sans-serif;
```

| Token | 字号/行高 | 字重 | 用途 |
|---|---|---|---|
| `--font-level` | 144rpx / 1.0 | 800 | **级牌大字**（签名元素，只在记分牌出现） |
| `--font-num-lg` | 64rpx / 1.1 | 700 | 升级预览数字、结算数字 |
| `--font-title` | 40rpx / 1.3 | 600 | 页面/卡片标题 |
| `--font-body` | 32rpx / 1.6 | 400 | 正文（默认体——比常规 28rpx 大一档，中老年可读性） |
| `--font-label` | 26rpx / 1.4 | 500 | eyebrow/标签，`letter-spacing: 2rpx` |
| 下限 | 24rpx | — | 任何文字不得小于此 |

- 所有数据数字：`font-feature-settings: "tnum"`（等宽数字，记分对齐）。
- 级牌字符集只有 `2-10 J Q K A`：**可选增强**（不阻塞）——打一个只含这 15 个字形的子集显示字体（几 KB）随包载入 `wx.loadFontFace`，给级牌大字真正的識別度；缺席时 w800 系统黑体兜底，设计不依赖它。

## 4. 空间 / 形状 / 层次

- **间距**：8rpx 网格——`8 / 16 / 24 / 32 / 48 / 64`；页面左右 gutter 32rpx。
- **圆角**：卡片 20rpx、控件 14rpx、玩家 chip 999rpx（胶囊）。
- **层次靠 hairline 不靠阴影**（dark 模式阴影失效）：卡片 = surface + 1rpx `--hairline` 描边；唯一允许的阴影在底部悬浮操作栏（`0 -4rpx 24rpx rgba(0,0,0,0.08)`）。
- **点按目标**：最小 88rpx 高；底栏主按钮 96rpx；相邻可点元素间距 ≥ 16rpx。

## 5. 签名元素 — 级牌记分牌

页面上半屏的双级牌大字是整个产品的识别物（也是合规安全区：纯文字，零牌面图形）：

```
┌─────────────────────────────────┐
│  本局打 10 · 蓝队的级       ← eyebrow（--font-label，--accent）
│                                 │
│   蓝队            红队          │
│    ┏━━━┓                       │
│    ┃ 10 ┃    ：    8           │ ← 144rpx 大字，各队 --team-* 色
│    ┗━━━┛                       │   roundOwner 一侧 4rpx --accent 底线
│   A失败 1/3        —           │ ← strict 模式才显示（--font-label）
└─────────────────────────────────┘
```

- 打到 A：该队级牌换 `--gold-a` + eyebrow 变「冲A · 自己的A级才能通关」。
- 通关时刻：级牌区整体一次性动效（见 §7），全 app 唯一的大动效。

## 6. 组件规范

- **主按钮**（应用结果/创建房间）：`--accent` 底 + 白字 40rpx w600，占满 gutter 宽，96rpx 高；按压 `--accent-pressed` + scale 0.98。**一屏最多一个**。
- **次按钮**（撤销/重置）：transparent 底 + 1rpx hairline + `--text-primary` 字。破坏性（重置/删玩家）用 `--danger` 字色，且必走确认对话框。
- **玩家 chip**：胶囊形，头像(emoji 或微信头像) + 昵称 ≤4字 + 队色左缘 6rpx；选中态 = 队色 12% 透明底。
- **排名录入**：名次槽位横排（1..N），点玩家 chip 填入下一空槽；已填槽再点取消。错误即时提示在槽位下方（不弹 toast）。
- **升级预览条**：录满名次自动出现——`双上 ·  升 3 级 → 打 K`（--font-num-lg 数字 + 行话），是"应用结果"按钮的前置确认。
- **历史行**：`第 4 局 · 蓝队双上 +3 → 打K`，左缘 4rpx 队色条；回滚入口只在最新一行。
- **空态**：一句行动指引（"加 4 个玩家就能开局"），不放插画。
- **对话框**：系统 `wx.showModal` 优先，不自绘。

## 7. 动效（克制到只剩一个时刻）

- **唯一编排动效**：应用结果后级牌数字翻新——旧字 `translateY(-12rpx)+opacity→0`、新字从下入位，240ms ease-out；通关时 `--gold-a` 字色 + 同款动效放大 1.06 一次。
- 其余只有按压反馈（opacity/scale，100ms）。**只动 transform/opacity**，不动布局属性。
- 不做进场动画、不做滚动驱动、不做骨架屏闪光。

## 8. 文案声音

- 牌桌行话：双上 / 末游 / 打A / 通关 / 自己的A级；不说"提交""操作成功"。
- 按钮说结果：「应用结果」→ toast「已记一局，打K」；同一动作全程同名。
- 错误给出路不道歉：「名次不能重复，改一下再应用」。
- 全部 sentence 式，不堆叹号 emoji。

## 9. 合规红线（UI 资产侧）

任何界面/分享卡片/海报**永不出现**：扑克牌面、筹码、货币符号、"赌"字样。级牌只用字符表达。荣誉「赌徒」在 UI 渲染合规别名（WXAPP-5，见 docs/PLAN.md）。

## 10. Token 落地文件

- `miniprogram/styles/tokens.wxss` —— 本文件 §2-§4 在 WXSS 体系内的唯一实现处，`app.wxss` 首行 `@import`。
- `theme.json` —— 仅窗口 chrome 变量。
- **已知例外（文档化）**：`core/poster.js` 的 canvas 镜像常量（canvas 吃不到 CSS 变量，light 色板的逐值镜像）与 `pages/index/index.ts` 的 switch `color` 属性映射（WXML 属性不支持 var()）。改 tokens 时这两处必须同步。
- 验收：grep 全部页面 WXSS，出现 `#` 色值或 `rgba(` 即违规（只允许出现在 tokens.wxss + 上述两个文档化例外）。
