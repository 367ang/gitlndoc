# 《Git 时间旅行者》开发细化工程文档

> 配套文档：`game-design.md`（游戏设计）、`other/frontend-changes.md`（笔记知识点映射）
> 本文档将游戏设计转化为可执行的工程实现规范：架构、模块、数据、组件、状态、构建与任务拆解。
> 核心原则：**奖励理解、惩罚试错** —— 工程上以「真实 Git 执行 + 目标状态校验」为核心，
> 让玩家通过思考而非盲目敲命令来获得评分。

---

## 1. 技术选型（定稿）

| 维度 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 框架 | React + TypeScript | React 18.3.x / TS 5.6.x | 生态成熟、类型安全、组件化适合状态可视化 |
| 构建 | Vite | 4.x | 启动/构建快、HMR 友好、现代 Web 工具链 |
| 虚拟文件系统 | LightningFS（`@isomorphic-git/lightning-fs`） | latest | 浏览器内完整 POSIX 文件系统，支撑真实 git 仓库 |
| Git 引擎 | isomorphic-git | ^1.27.0 | 浏览器内真实执行 git 对象/引用/索引操作，无需后端 |
| 状态 | Zustand + 原生 Reducer（轻量） | ^5 | 全局会话/关卡状态；命令历史用原生数组 |
| 路由 | 不引入 react-router，用 Zustand + 视图状态机 | — | 单页游戏流程线性，避免额外复杂度 |
| 样式 | CSS Modules + 设计令牌（design tokens） | — | 组件级隔离、主题统一 |
| 持久化 | localStorage（进度/得分/成就） + IndexedDB（仓库快照） | 原生 | 规模小，无需重型库 |
| 测试 | Vitest + @testing-library/react | latest | 单测组件与评分逻辑；集成层用 isomorphic-git 沙箱 |

> **依赖预算**：runtime 依赖仅 `isomorphic-git`、`lightning-fs`、`react`、`react-dom` 与一个轻量状态库，保持包体可控。

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                        │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  UI Layer     │ → │  Store/State │ → │  Game Service    │  │
│  │ (components)  │   │  (Zustand)   │   │  (命令解析/校验)  │  │
│  └──────┬───────┘   └──────┬───────┘   └───────┬─────────┘  │
│         │                   │                   │            │
│  ┌──────▼───────────────────▼───────────────────▼─────────┐ │
│  │                 Git Execution Layer                     │ │
│  │   isomorphic-git + LightningFS (真实 git 对象/索引)      │ │
│  └─────────────────────────┬───────────────────────────────┘ │
│                            │                                 │
│  ┌─────────────────────────▼───────────────────────────────┐ │
│  │                  Level Data / Runtime                    │ │
│  │   关卡定义(JSON Schema) · 进度/得分(localStorage)        │ │
│  │   仓库快照(IndexedDB) · 成就(localStorage)               │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**分层职责**

1. **UI Layer**：纯展示与交互，无业务逻辑。通过 hooks 订阅状态、分发动作。
2. **Store/State**：单一事实来源。会话、当前关卡、命令历史、得分、成就、视图路由。
3. **Game Service**：纯函数。命令 tokenize、命令执行编排、目标状态比对、评分计算、提示生成。
4. **Git Execution Layer**：对 isomorphic-git 的薄封装，统一错误为业务异常；沙箱目录隔离。
5. **Level Data / Runtime**：关卡 schema、关卡集合、进度持久化、成就定义。

---

## 3. 目录结构

```
src/
├── main.tsx                      # 入口，挂载 App + 初始化沙箱
├── app/
│   ├── App.tsx                   # 根组件：视图状态机调度
│   └── routes.ts                 # 视图枚举（menu/chapter/level/…）
├── engine/                       # ── Git 执行层 ──
│   ├── fs.ts                     # LightningFS 实例与目录初始化
│   ├── gitApi.ts                 # isomorphic-git 薄封装（统一错误）
│   ├── sandbox.ts                # 仓库沙箱：init/克隆模板/重置
│   └── errors.ts                 # 业务异常类型（GitCommandError…）
├── game/                         # ── Game Service（纯函数） ──
│   ├── command/
│   │   ├── tokenize.ts           # 命令行 token 化（引号/空白/转义）
│   │   ├── grammar.ts            # 每条命令的参数校验
│   │   └── executor.ts           # 命令 → gitApi 调用编排
│   ├── validate/
│   │   ├── targetState.ts        # 目标状态比对（文件/分支/提交/标签）
│   │   └── stepHints.ts          # 分步提示生成
│   ├── scoring/
│   │   ├── score.ts              # 命令/撤销/分支多维度计分
│   │   └── achievement.ts        # 成就判定
│   └── types.ts                  # 核心领域类型
├── levels/                       # ── 关卡数据 ──
│   ├── schema.ts                 # 关卡 JSON Schema（TS 类型守卫）
│   ├── chapters/
│   │   ├── ch1.ts … ch6.ts       # 各章关卡定义（初始化脚本/目标/提示/评分参数）
│   │   └── index.ts              # 汇总导出 + 章节元信息
│   └── presets.ts                # 关卡初始化时写入的模板文件内容
├── store/                        # ── 状态 ──
│   ├── sessionStore.ts           # 当前关卡、命令历史、输入
│   ├── progressStore.ts          # 进度/得分/成就（含持久化中间件）
│   └── viewStore.ts              # 视图路由状态
├── ui/                           # ── UI Layer ──
│   ├── components/
│   │   ├── menu/                 # 主菜单、章节选择、关卡选择
│   │   ├── chapter/              # 章节介绍
│   │   ├── level/                # 关卡主界面
│   │   ├── terminal/             # 命令行输入区
│   │   ├── history/              # 命令历史与输出
│   │   ├── fileTree/             # 虚拟文件树
│   │   ├── gitGraph/             # git 提交图可视化
│   │   ├── branchPanel/          # 分支/标签面板
│   │   ├── goalPanel/            # 目标状态与检测
│   │   ├── scoring/              # 得分与星级
│   │   ├── hints/                # 提示系统
│   │   ├── achievements/         # 成就
│   │   ├── intro/                # 开场叙事
│   │   └── common/               # Button、Modal、Toast 等通用件
│   └── hooks/                    # useGitGraph、useFileTree 等
├── styles/
│   ├── tokens.css                # 设计令牌（颜色/间距/字体）
│   └── global.css                # 全局 reset 与主题
├── persistence/
│   ├── progress.ts               # localStorage 读写（版本化 key）
│   └── snapshot.ts               # IndexedDB 仓库快照存取
└── __tests__/                    # 单元/组件测试
    ├── tokenize.test.ts
    ├── scoring.test.ts
    ├── executor.test.ts
    └── components.test.tsx
```

---

## 4. 核心领域模型（TypeScript）

### 4.1 关卡定义 `Level`

```ts
interface Level {
  id: string;                    // "ch3-2"：章节-关卡
  chapter: ChapterId;
  title: string;
  objective: string;             // 玩家目标描述（中文）
  difficulty: 1 | 2 | 3 | 4 | 5; // ★~★★★★★
  inputMode: 'free' | 'half' | 'menu'; // 自由输入 / 半拼 / 菜单式
  relatedKnowledge: string[];    // 关联笔记知识点 id（用于提示与后测）
  init: LevelInit;               // 初始化沙箱仓库
  targets: TargetCondition[];     // 达标条件（至少全部满足才过关）
  winScore: number;              // 过关所需最低得分
  scoring: ScoringParams;        // 计分参数（见 §7）
  hints: HintStep[];             // 分步提示（按失败次数解锁）
  timeoutMs?: number;            // 可选倒计时（默认不限时）
}
```

### 4.2 初始化 `LevelInit`

```ts
interface LevelInit {
  template?: 'blank' | 'emptyRepo' | 'cloneSource'; // 初始化方式
  files?: Record<string, string>; // 预置文件路径 → 内容（首次写入）
  commits?: InitCommit[];          // 预置提交（author/date/msg/message）
  branches?: { name: string; from: string }[]; // 预置分支
  tags?: { name: string; at: string }[];
  remotes?: { name: string; url: string }[];
}
```

> 实现上通过 `fs` 直接写文件 + `gitApi`（isomorphic-git）建提交/分支/标签，从而获得**真实对象库**。

### 4.3 达标条件 `TargetCondition`

```ts
type TargetCondition =
  | { type: 'file'; path: string; content?: string; exists: boolean } // 文件内容/存在
  | { type: 'branch'; name: string; exists: boolean }                 // 分支存在
  | { type: 'headBranch'; name: string }                             // 当前检出分支
  | { type: 'commitCount'; op: 'gte'|'eq'; value: number }           // 提交数量
  | { type: 'commitMessage'; match: RegExp }                          // 最近提交信息
  | { type: 'commitExists'; message: string }                        // 存在特定提交
  | { type: 'tag'; name: string; exists: boolean }                    // 标签存在
  | { type: 'merged'; branch: string; into: string }                 // 分支已合并
  | { type: 'logOrder'; order: string[]; branch: string }            // 提交顺序
  | { type: 'workdirClean'; value: boolean }                         // 工作区干净
  | { type: 'remote'; name: string; hasRemote: boolean }             // 远程关联
```

### 4.4 命令历史

```ts
interface CommandEntry {
  id: string;
  input: string;          // 玩家输入原文
  tokens: string[];       // tokenize 结果
  ok: boolean;            // 执行是否成功
  output: string[];       // stdout 行
  error?: string;         // stderr / 错误信息
  ts: number;             // 时间戳
  undoable?: boolean;     // 是否触发撤销类评分事件
}
```

---

## 5. 视图状态机（路由）

单页线性流程，用 `viewStore` 的判别联合驱动根组件切换：

```
view: 'boot' | 'intro' | 'menu' | 'chapter' | 'level' | 'levelComplete' | 'gameComplete'

boot ─→ intro ─→ menu ─→ chapter ─→ level ─→ levelComplete ─→ menu/chapter
                                  ↑              │
                                  └── retry ─────┘
menu ─→ gameComplete（全部通关后菜单可进入结局）
```

- **boot**：初始化 LightningFS，加载持久化进度，决定进入 intro 或 menu。
- **level**：承载终端 + 可视化面板 + 目标 + 提示。`levelComplete` 弹出结算并写回进度。

---

## 6. Git 执行层设计

### 6.1 LightningFS 沙箱

- 单例 `fs`，挂载于虚拟根目录 `/`。
- 每关开始：清空虚拟根，依据 `LevelInit` 重建仓库（`sandbox.ts::reset`）。
- 沙箱内目录约定：`/repo`（玩家操作的主仓库）、`/remote.git`（作为「远程宇宙」的裸仓库，用于第四章模拟）。

### 6.2 isomorphic-git 封装 `gitApi`

所有命令统一走 `gitApi.*`，内部映射 isomorphic-git 函数并做错误归一：

| 玩家命令 | gitApi 方法 | 底层 isomorphic-git |
|---|---|---|
| `git init` | `init()` | `init` |
| `git add` | `add(paths)` | `add` / `remove` |
| `git commit` | `commit()` | `commit` |
| `git status` | `status()` | `status` + `statusMatrix` |
| `git branch` | `branch()` | `listBranches` / `branch` |
| `git checkout` | `checkout()` | `checkout` |
| `git merge` | `merge()` | `merge` |
| `git log` | `log()` | `log` |
| `git reset` | `reset()` | `resetIndex` + `writeRef` + fs 恢复 |
| `git revert` | `revert()` | 组合实现（新建反向提交） |
| `git stash` | `stash()` | 组合实现 |
| `git tag` | `tag()` | `listTags` / `tag` |
| `git remote` | `remote()` | `listRemotes` / `addRemote` / … |
| `git clone` | `clone()` | `clone`（从 `/remote.git`） |
| `git push/fetch/pull` | `push()/fetch()/pull()` | 对应函数 |

> **撤销类命令（reset/revert/checkout --）** 属于「惩罚试错」重点，全部记录 `undoable` 事件，供评分扣分。

### 6.3 命令解析与校验

1. **tokenize**：处理空白、单双引号、反斜杠转义（POSIX 风格）。
2. **grammar**：按 `git <verb> [flags] [args]` 校验参数个数/合法性，产出规范化的参数对象。
3. **executor**：调度到 `gitApi`，捕获 `GitCommandError` 转成用户可读的中文报错（对照真实 git 报错风格）。

> 支持**半拼模式**：语法校验通过但参数名被提示词部分隐藏（如 `git check__t`），由 UI 校验输入时高亮残缺 token 并给提示。

---

## 7. 评分系统（奖励理解、惩罚试错）

### 7.1 基础分

每关过关有基准分 `baseScore`，由目标达成度加权：全部 `targets` 满足得满分，否则按满足比例给分；但**必须全部满足才算过关**。

### 7.2 惩罚项（试错惩罚）

| 事件 | 扣分 |
|---|---|
| 执行撤销类命令（reset / revert / checkout -- / stash 丢弃） | `-undoPenalty` |
| 提交后又修改重做（同目标重复提交） | `-redoPenalty` |
| 使用了提示 | 每步 `-hintPenalty` |
| 无提示直接成功 | 不扣，另有奖励 |

### 7.3 奖励项（理解奖励）

| 事件 | 加分 |
|---|---|
| 最优命令序列（与参考方案一致或更短） | `+optimalBonus` |
| 首次尝试直接过关（0 撤销 0 提示） | `+flawlessBonus` |
| 使用探索性只读命令（status/log/branch）后正确决策 | 小额 `+probeBonus`（上限） |

### 7.4 星级

```
★：得分 ≥ winScore（过关）
★★：得分 ≥ winScore * 0.8 且无撤销
★★★：得分 ≥ winScore * 0.95 且 0 提示 0 撤销（完美通关）
```

`winScore` 默认 = `baseScore`；各章可调 `ScoringParams`。

---

## 8. 关卡内容 → 工程任务映射

| 章节 | 关卡数 | 主要命令集（gitApi） | 关联笔记 | 输入模式 |
|---|---|---|---|---|
| 一 基础概念 | 4 (1-1~1-4) | init, status, log | 第一章 1-1~1-4 | 菜单式 |
| 二 基础操作 | 4 (2-1~2-4) | add, commit, .gitignore | 第二章 2-1~2-4 | 半拼 |
| 三 分支管理 | 6 (3-1~3-6) | branch, checkout, merge, rebase, stash | 第三章 3-1~3-6 | 半拼/自由 |
| 四 远程操作 | 5 (4-1~4-5) | remote, push, fetch, pull, clone | 第四章 4-1~4-5 | 半拼 |
| 五 撤销操作 | 6 (5-1~5-6) | reset, revert, checkout --, restore | 第五章 5-1~5-6 | 自由 |
| 六 标签管理 | 5 (6-1~6-5) | tag, show, describe | 第六章 6-1~6-5 | 半拼 |
| 综合挑战 F-1/F-2 | 2 | 综合 | 全部 | 自由 |

> 每个关卡在 `levels/chapters/chN.ts` 中独立定义 `LevelInit` 与 `targets`，可独立开发与测试。

---

## 9. UI 组件设计要点

### 9.1 关卡主界面布局（`level/`）

```
┌───────────────────────────────────────────────────────────────┐
│ 顶部栏：章节/关卡名 · 目标摘要 · 得分 · 星级 · 暂停             │
├──────────────────────────────┬────────────────────────────────┤
│  GoalPanel（目标与检测）      │  FileTree / 状态树               │
│  ────────────────────────────│────────────────────────────────│
│  Terminal（命令输入+历史）    │  GitGraph 提交图 + BranchPanel    │
│                              │  Hints（提示面板）               │
└──────────────────────────────┴────────────────────────────────┘
```

- **Terminal**：可滚动命令历史，输入框支持历史上下翻、Tab 补全（半拼模式补全已暴露部分）。
- **GitGraph**：基于 `gitApi.log` 全分支遍历绘制提交图，节点颜色按分支、标注 tag。
- **GoalPanel**：实时对 `targets` 做检测，逐项打勾/叉，未达标给「还差什么」的抽象提示（不给具体命令）。
- **Hints**：按失败次数解锁 `hints` 中的分步提示，解锁即计提示扣分。

### 9.2 主题

`styles/tokens.css` 定义「时空穿梭 / 星际」主题色：深空背景、星云紫、脉冲蓝、代表分支的暖橙/青绿。全局字号、圆角、间距统一由 token 变量控制。

---

## 10. 持久化设计

| 数据 | 存储 | key | 说明 |
|---|---|---|---|
| 进度（每关得分/星级/是否通关） | localStorage | `gtp:progress:v1` | 版本化，未来升级可迁移 |
| 成就 | localStorage | `gtp:achievements:v1` | 布尔集合 |
| 设置（提示开关等） | localStorage | `gtp:settings:v1` | |
| 当前仓库快照（供退出恢复） | IndexedDB | `gtp:snapshot:<levelId>` | 关卡内崩溃/刷新恢复 |

**snapshot 策略**：进入关卡建立快照；每 N 条命令或关键提交后增量写 IndexedDB；退出关卡清除。恢复时直接从快照重建 LightningFS 状态。

---

## 11. 测试策略

### 11.1 单元测试（Vitest）
- `tokenize.test.ts`：引号/转义/空白边界。
- `scoring.test.ts`：星级判定、撤销/提示扣分、奖励加分边界。
- `validate/targetState.test.ts`：各类 `TargetCondition` 的判定逻辑。
- `executor.test.ts`：在测试用 LightningFS 内存实例上跑真实 gitApi，断言副作用。

### 11.2 组件测试
- `components.test.tsx`：Terminal 输入/历史、GoalPanel 打勾、Hints 解锁流程。

### 11.3 集成（手动/冒烟）
- 用真实 isomorphic-git 在 `/remote.git` 与 `/repo` 之间跑第四章 clone/push/fetch 全链路。
- 五章撤销关卡：构造「错误提交 → reset → 正确提交」完整剧本验证星级判定。

### 11.4 E2E（后续可选）
- Playwright 冒烟：进菜单 → 进第一关 → 输命令 → 过关 → 写入进度。

---

## 12. 构建与质量门禁

- `pnpm dev` 开发（Vite HMR）；`pnpm build` = `tsc -b && vite build`。
- `pnpm typecheck`（`tsc --noEmit`）与 `pnpm test`（Vitest）纳入 CI 前必跑。
- lint：eslint + prettier（待加入配置）。
- 依赖体积预算：runtime 产物 gzip 尽量控制在 ~350KB 内，关注 isomorphic-git 的 tree-shaking。

---

## 13. 里程碑与任务拆解（建议顺序）

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 地基 | 目录骨架、样式 token、`engine/fs.ts`、`engine/gitApi.ts`、`engine/sandbox.ts`、store 三件套 | 可跑 shell，能 init/add/commit 并可视化 |
| M2 关卡框架 | `levels/schema.ts` + 第一章 4 关、Terminal/FileTree/GoalPanel、目标检测 | 第一章可玩（菜单式） |
| M3 评分 | `game/scoring/*`、星级、成就 | 过关结算+星级 |
| M4 进阶命令 | 二~三章（半拼/自由）、GitGraph、BranchPanel、Tab 补全 | 分支章节可玩 |
| M5 撤销与远程 | 四~五章、reset/revert/stash、remote/push/fetch/clone、snapshot 持久化 | 全主线可玩 |
| M6 标签与综合 | 六章 + F-1/F-2、成就完善、intro/结局 | 全游戏可玩 |
| M7 打磨 | 提示系统、平衡调参、E2E、真机验证、性能 | 发布候选 |

> 每阶段结束都跑 `typecheck` + `test` + `build`，保证主分支始终可运行。

---

## 14. 开放风险与对策

| 风险 | 对策 |
|---|---|
| isomorphic-git 部分命令（revert/stash/pull 自动合并）能力不完整 | gitApi 用组合实现兜底；必要时退化为「引导式多命令」脚本 |
| LightningFS 大仓库性能 | 每关仓库小而精简；快照增量写入控制 IO |
| 命令语法与真实 git 不完全一致 | grammar 层做子集白名单，超出范围给「该版本不支持」提示而非假装执行 |
| 撤销语义判定误伤（如 reset 也用于正常操作） | 细分 reset 模式：`--soft/--mixed` 用于重建视为「纠错」轻扣，`--hard` 重扣 |
| 浏览器刷新丢进度 | IndexedDB 快照 + localStorage 进度双写，boot 阶段恢复 |

---

## 附：与 GDD 的对应关系

| GDD 章节 | 本文档落实 |
|---|---|
| 1 概述 | §1 技术选型、§2 架构 |
| 2 游戏流程 | §5 视图状态机 |
| 3 关卡/4 交互 | §4 领域模型、§6 执行层、§8 关卡映射、§9 UI |
| 5 评分/成就 | §7 评分系统、§11 测试 |
| 6 技术方案 | §3 目录、§10 持久化、§12 构建 |

*本文档为工程实现基线，随开发迭代可修订，但须保持 §4/§7/§8 与 GDD 一致。*
