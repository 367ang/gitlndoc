# Git 时间旅人 / Git Time Traveler

> 纯浏览器、单机、以时间旅行为主题的 **Git 学习游戏**。玩家通过执行**真实的 Git 命令**修复损坏的「时间线」（一个真实的 git 仓库）。

## 简介

本仓库是「Git 时间旅人」的设计与源码仓库。它有两张面孔：

- **一份可玩的游戏** —— `src/` 是一个单页应用（SPA）。Git 命令由 `isomorphic-git` 在浏览器内真实执行，仓库文件系统由 `LightningFS` 提供，**全程没有后端**。
- **一套可追溯的设计文档** —— 从学习笔记（`docs/notes/`）到游戏设计（`game-design.md`），再到工程细化（`development-refinement.md`）与逐里程碑的执行记录（`docs/milestones/`）。

游戏内容并非凭空设计：每篇 Git 学习笔记都拆分为若干**知识点小节**，每个关卡通过 `relatedKnowledge` 引用具体小节（形如 `git-branches#merge-conflict`），测试会反查这些小节标题是否真实存在 —— 因此**笔记是关卡的知识依据，且被测试锁定**。

**当前进度**：M1–M4 已完成，第一 ~ 三章可玩（`ch1` 4 关 + `ch2` 4 关 + `ch3` 6 关，共 14 关）；第四 ~ 六章与终章在章节菜单中呈**禁用态**，尚未落地。三门禁（`typecheck` / `test` / `build`）全绿：**228 passed**，构建产物约 169.7 kB gzip。详见 [AGENTS.md](./AGENTS.md) 的「当前状态」与 [docs/milestones/](./docs/milestones/)。

## 🚀 快速入门

### 运行本项目

> ⚠️ **环境注意**：本机的 `node` / `pnpm` 装在 Homebrew 路径下，而沙箱 shell 的 PATH 默认不含该目录，直接调用会报 `command not found`。执行任何 Node 相关命令前先导出：
> ```bash
> export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
> ```

```bash
# 0. 前置：Node.js + pnpm（本机实测 Node v26.9.0 / pnpm 12.5.1）
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"

# 1. 安装依赖 —— 必须用 pnpm，以复用仓库内的 pnpm-lock.yaml
pnpm install

# 2. 启动开发服务器（Vite + HMR），按提示打开本地地址
pnpm dev
```

其余命令（完整清单与说明见 [AGENTS.md](./AGENTS.md) 的「命令」一节）：

| 命令 | 作用 |
|---|---|
| `pnpm dev` | Vite 开发服务器（HMR） |
| `pnpm build` | `tsc -b && vite build` —— **构建包含类型检查** |
| `pnpm preview` | 预览生产构建产物 |
| `pnpm typecheck` | `tsc --noEmit` —— 不产出文件的快速类型检查，提交前运行 |
| `pnpm test` | Vitest（watch 模式） |
| `pnpm test:run` | Vitest 单次运行（CI 用）；单文件可写 `pnpm vitest run <file>` |

**每个阶段结束都要跑 `typecheck` + `test` + `build` 三门禁**，确保 `main` 分支始终可运行。

> 📌 仓库内有一个 `pnpm-workspace.yaml`，其 `allowBuilds` 字段用于放行 esbuild 的安装脚本 —— 这是 pnpm 12 的默认安全机制，**不要删除**，否则 `pnpm install` 会报 `ERR_PNPM_IGNORED_BUILDS`。
>
> 📌 真实浏览器的**分段冒烟**脚本在 `tools/smoke/`（Node 侧 CDP 驱动，非 SPA 依赖），方法是「进度种子 + 条件轮询 + `data-*` 属性定位」，方法与前置条件见 [docs/milestones/M4-tasks.md](./docs/milestones/M4-tasks.md) 的「执行结果」。

### 第一次使用 Git

```bash
# 配置用户信息
git config --global user.name "你的名字"
git config --global user.email "your.email@example.com"

# 初始化仓库
git init

# 基础工作流
git add .
git commit -m "feat: 初始化项目"
git push origin main
```

### 常用工作流程

```bash
# 1. 开始新功能开发
git checkout main && git pull
git checkout -b feature/your-feature

# 2. 开发并提交
git add -p                        # 选择性暂存
git commit -m "feat: 添加新功能"

# 3. 同步主分支最新代码
git fetch origin
git rebase origin/main

# 4. 推送并发起 Pull Request
git push -u origin feature/your-feature
```

### 提交信息规范

本项目自身的提交同样遵循 Conventional Commits（**类型前缀 + 中文描述**）：

```
<类型>(<范围>): <简要描述>

类型说明：
  feat     - 新功能
  fix      - Bug 修复
  docs     - 文档更新
  refactor - 代码重构
  test     - 测试相关
  chore    - 构建/工具变更
```

## 🗂️ 仓库结构

```
.
├── README.md                     # 本文件 —— 项目门面（细节见 AGENTS.md）
├── AGENTS.md                     # AI agent 与协作者的工作约定（结构 / 命令 / 架构规则的权威来源）
├── game-design.md                # 游戏设计文档（GDD）：概念、叙事、完整关卡列表、§8 笔记↔关卡映射表
├── development-refinement.md     # 工程细化文档：技术选型、分层架构、领域模型、计分、里程碑（实现工作的权威依据）
├── LICENSE                       # 开源许可证
├── index.html                    # Vite HTML 入口
│
├── src/                          # ★ SPA 源码：本项目的实现主体（75 个文件）
│   ├── main.tsx                  # 入口，挂载 App
│   ├── vite-env.d.ts
│   ├── app/                      # 根组件与视图状态机（App.tsx / routes.ts / startLevel.ts）
│   ├── engine/                   # ── Git 执行层：fs / gitApi / sandbox / errors ──
│   ├── game/                     # ── Game Service（纯函数）──
│   │   ├── command/              #   tokenize / grammar / executor / fragments / completion
│   │   ├── validate/             #   目标状态比对与提示生成
│   │   ├── scoring/              #   计分与成就
│   │   └── graph/                #   提交图（DAG 泳道）计算
│   ├── levels/                   # ── 关卡数据 ──
│   │   ├── schema.ts             #   关卡类型守卫与校验
│   │   ├── presets.ts            #   关卡初始化的模板文件内容
│   │   └── chapters/             #   ch1.ts / ch2.ts / ch3.ts / index.ts（章节注册表）
│   ├── store/                    # ── 状态：sessionStore / progressStore / viewStore ──
│   ├── ui/                       # ── UI Layer（纯展示）──
│   │   ├── components/           #   menu / chapter / level / terminal / history /
│   │   │                         #   fileTree / gitGraph / goalPanel
│   │   └── hooks/                #   useTargetState / useCompletionCandidates
│   ├── styles/                   # 设计令牌与全局样式（tokens.css / global.css）
│   └── __tests__/                # Vitest 用例（7 个测试文件 + setup.ts）
│
├── docs/                         # 全部文档
│   ├── notes/                    # 9 篇 Git 学习笔记 —— 关卡设计的知识依据
│   ├── notes-change-log.md       # 笔记重构变更日志（改笔记必须追加记录于此）
│   └── milestones/               # 逐里程碑的任务拆解与执行结果（M1-preflight / M1 / M2 / M3 / M4）
│
├── tools/
│   └── smoke/                    # Node 侧真实浏览器分段冒烟脚本（CDP 驱动，不被 SPA 引用）
│       ├── cdp-client.cjs        #   共享库：连接、进度种子、条件轮询 waitFor
│       ├── run-legacy.cjs        #   段3：1-4 完整通关补测 + 未通关锁定态
│       ├── run-ch2.cjs           #   段1：ch2 全关冒烟
│       └── run-ch3.cjs           #   段2：ch3 全关冒烟
│
├── practice/
│   └── server/gitrunner.mjs      # Node 侧沙箱设计参照（子命令白名单）；非 SPA 引用的代码
│
├── package.json                  # 依赖与 scripts
├── pnpm-lock.yaml                # 锁文件（应提交入库）
├── pnpm-workspace.yaml           # 放行 esbuild 安装脚本（不要删除）
├── vite.config.ts                # Vite + Vitest 配置（jsdom 环境、setup 文件）
├── tsconfig.json                 # 应用侧 TS 配置
└── tsconfig.node.json            # Node 侧（vite.config.ts）TS 配置
```

> ⚠️ `development-refinement.md` §3 给出的 `src/` 目录树**已被实际实现超前**（其中 `persistence/`、部分 UI 子目录尚未创建，实际另有 `game/graph/`、`game/editor.ts` 等）。**推断 `src/` 结构请以磁盘实际为准**；本节结构树已按磁盘核对过。

## 📚 文档与笔记

### 9 篇 Git 学习笔记

这 9 篇笔记**并非地位相同的并列文档**，而是分三类。判定依据是 [game-design.md](./game-design.md) §8「内容映射表（笔记 ↔ 关卡）」与 `src/` 中的 `relatedKnowledge` 引用。**下表「关联章节」列逐行取自 GDD §8**，章节名沿用 GDD §4 的命名（注：已实现的 ch4–ch6 章节标题在 `src/levels/chapters/index.ts` 中另作「遥远回响 / 时间倒流 / 永恒印记」，此处以 GDD 为准）：

**① 关卡知识依据** —— 被关卡数据以 `<note>#<slug>` 形式引用；`src/__tests__/levels.test.ts` 会**反查小节标题是否逐字存在于笔记中**，改标题即挂测试。

| 笔记 | 关联章节 | 该章游戏进度 |
|---|---|---|
| [Git基础概念](./docs/notes/git-basics.md) | 第一章「创世纪元」（1-1 ~ 1-4） | ✅ 已实现（ch1，4 关） |
| [Git基础操作](./docs/notes/git-basic-operations.md) | 第二章「日常秩序」（2-1 ~ 2-4） | ✅ 已实现（ch2，4 关） |
| [Git分支管理](./docs/notes/git-branches.md) | 第三章「平行宇宙」（3-1 ~ 3-6） | ✅ 已实现（ch3，6 关） |
| [Git远程操作](./docs/notes/git-remotes.md) | 第四章「星际连接」（4-1 ~ 4-5） | 🚧 待接入（M5） |
| [Git撤销操作](./docs/notes/git-undo.md) | 第五章「时空回溯」（5-1 ~ 5-6） | 🚧 待接入（M5） |

**② 待接入** —— 在 GDD §8 中有对应行，但游戏侧尚未实现（`src/levels` 目前**零引用**）。

| 笔记 | 关联章节 | 说明 |
|---|---|---|
| [Git标签管理](./docs/notes/git-tags.md) | 第六章「历史锚点」（6-1 ~ 6-5） | 🚧 待接入（M6） |
| [Git最佳实践](./docs/notes/git-best-practices.md) | 贯穿各章（merge/rebase、reset/revert、语义化版本等） | 🚧 待接入（无独立章节，横向贯穿） |

**③ 母本速查表** —— **不参与游戏**。

| 笔记 | 关联章节 | 说明 |
|---|---|---|
| [Git学习笔记（速查表）](./docs/notes/git-cheatsheet.md) | —— （GDD §8 映射表中**没有它的行**） | 其余 8 篇的**拆分母本**与综合命令速查表，是笔记来源而非关卡依据 |

> 📌 关于 `git-faq`：[Git常见问题](./docs/notes/git-faq.md) 同样**不在 GDD §8 映射表中**（该表共 8 行），目前**无明确关联章节**，亦未被 `src/levels` 引用。它的知识内容与各章「常见错误」提示的潜在结合点属未决事项。

> 📌 变更日志：[docs/notes-change-log.md](./docs/notes-change-log.md) 记录了「`git-cheatsheet.md` 一分为八」的重构过程。**凡重构或修改 `docs/notes/` 下的笔记，都必须追加记录到该文件。**

### 设计文档与里程碑记录

| 文档 | 内容简介 |
|---|---|
| [game-design.md](./game-design.md) | **游戏设计文档（GDD）** —— 概念、世界观、核心玩法、§4 完整关卡列表、§5 评分规则、§8 笔记↔关卡映射表 |
| [development-refinement.md](./development-refinement.md) | **工程细化文档（实现权威依据）** —— 技术选型、分层架构、核心领域模型、计分系统、持久化、测试策略、里程碑规划 |
| [AGENTS.md](./AGENTS.md) | 仓库约定与「整体图景」：分层职责、架构规则、沙箱模型、实测环境事实、命令清单 |
| [M1-preflight](./docs/milestones/M1-preflight.md) | M1 开工前的环境与依赖预检结论 |
| [M1-tasks](./docs/milestones/M1-tasks.md) | M1（引擎骨架 + store + init/add/commit 可视化）任务与执行结果 |
| [M2-tasks](./docs/milestones/M2-tasks.md) | M2（关卡框架 + 第一章可玩）任务与执行结果 |
| [M3-tasks](./docs/milestones/M3-tasks.md) | M3（计分 / 星级 / 成就）任务与执行结果 |
| [M4-tasks](./docs/milestones/M4-tasks.md) | M4（第 2–3 章、GitGraph、BranchPanel、Tab 补全、文件编辑）任务与执行结果 |

> ⚠️ **M5 及以后凡动 `engine/` 或做真实浏览器验收，务必先读 M2 / M3 / M4 三份文档的「实测环境事实」** —— 那里记录了 isomorphic-git 与 LightningFS 的一批反直觉行为（ff merge 不更新工作区、无 rebase 命令、目录 `readFile` 返回 `null`、jsdom 不受 `readOnly` 限制等）。

## 🧭 架构速览

```
UI Layer（ui/components, ui/hooks）        ← 纯展示，不含业务逻辑
        ↓ 订阅 / 派发
Store / State（store/）                    ← 单一事实来源
        ↓
Game Service（game/: command/, validate/, scoring/）  ← 纯函数
        ↓
Git 执行层（engine/: fs, gitApi, sandbox, errors）
        ↓
isomorphic-git + LightningFS               ← 浏览器内真实的 git 对象/索引操作，无后端
        ↓
关卡数据（levels/）
```

- **无后端、无路由** —— 不用 `react-router`，视图是 `viewStore` 中的状态机：`boot → intro → menu → chapter → level → levelComplete`。
- **命令沙箱** —— 每关重建虚拟根目录（`/repo` 主仓库；`/remote.git` 作远程宇宙）。[practice/server/gitrunner.mjs](./practice/server/gitrunner.mjs) 是 Node 侧的子命令白名单设计参照，浏览器引擎与之保持一致。
- **分层规则**（改代码前请读 [AGENTS.md](./AGENTS.md) 的「架构」一节）：UI 纯展示、Game Service 纯函数、Git 访问统一走 `gitApi.*`。

## 🗺️ 知识结构

```
Git 核心知识
├── 基础概念
│   ├── 三大核心区域（工作区 / 暂存区 / 本地仓库）
│   ├── 远程仓库
│   └── Git 对象模型（Blob / Tree / Commit）
├── 日常操作
│   ├── 仓库初始化与配置
│   ├── 文件跟踪（add / rm / mv）
│   ├── 提交管理（commit / log / diff）
│   └── 文件忽略（.gitignore）
├── 分支管理
│   ├── 分支基础操作
│   ├── 合并策略（merge / rebase）
│   └── 工作流（Feature Branch / GitFlow / GitLab Flow）
├── 远程协作
│   ├── fetch / pull / push
│   ├── Fork 工作流
│   └── 远程分支追踪
├── 撤销与恢复
│   ├── 工作区 / 暂存区撤销
│   ├── 提交回退（reset / revert）
│   └── reflog 找回丢失提交
└── 规范与实践
    ├── Conventional Commits 提交规范
    ├── 语义化版本（SemVer）
    └── 安全操作指南
```

## Language

对于 commit 的描述性内容请使用中文。

## 参考资源

- [Pro Git（官方免费书籍）](https://git-scm.com/book/zh/v2)
- [GitHub 官方文档](https://docs.github.com)
- [Conventional Commits 规范](https://www.conventionalcommits.org/zh-hans/)
