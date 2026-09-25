# AGENTS.md

本文件为在此仓库中工作的 AI agent 提供指引，说明代码库的结构与约定。

## 仓库定位

本仓库是 **「Git 时间旅人」 / "Git Time Traveler"** 的设计与源码仓库 —— 一款纯浏览器、单机、以时间旅行为主题的 Git 学习游戏。玩家通过执行真实的 Git 命令来修复损坏的「时间线」（git 仓库）。以下文档构成项目的唯一事实来源，任何代码工作都应与之对齐：

- `game-design.md`（GDD）—— 游戏概念、叙事，以及完整的关卡列表，含难度 / 输入方式 / 关联笔记的映射。
- `development-refinement.md` —— 由 GDD 推导出的工程细化文档：技术选型、分层架构、`src/` 目录结构、核心领域模型、评分系统、持久化、测试策略、里程碑规划。**这是所有实现工作的权威依据** —— 其 §4/§7/§8 需与 GDD 保持一致。
- `notes/*.md` —— 共 9 篇 Git 学习笔记，是关卡设计的**知识依据**（每个关卡通过 `relatedKnowledge` id 引用）。其中 8 篇为知识笔记，按 GDD §8 的映射表与各章对应（Git基础概念→第一章、Git基础操作→第二章、Git分支管理→第三章、Git远程操作→第四章、Git撤销操作→第五章、Git标签管理→第六章、Git最佳实践贯穿各章），另有 `git-cheatsheet.md` 为综合速查总表，不单独对应某一章。因此笔记数与章节数并非一一对应。
- `other/frontend-changes.md` —— 记录笔记重构的变更日志；**凡重构或修改 `notes/` 下的笔记，都必须追加记录到本文件**。注意：仓库中并不存在 `.claude/commands/implement-feature.md`（早期文档曾引用该文件），此约定的来源只有本文件与 `README.md`。
- `practice/server/gitrunner.mjs` —— 独立的 Node 沙箱辅助模块（`createSandbox` / `runCommand` / `getGitState`），在临时目录中执行真实 git，屏蔽一组精心整理的 `BLOCKED_SUBCOMMANDS`，并强制固定的学习者身份。它是本项目对「命令沙箱 + 子命令白名单」预期行为的设计参照。注意：`practice/` 目录当前仅含此文件 —— `README.md` 中列出的 `practice/a.txt`、`b.txt`、`c.txt` 已在提交 `518d452` 中删除，故 README 的仓库结构树在这一点上已过时。该模块通过 `child_process` 调用真实 `git`，属于 **Node 侧**代码，是浏览器引擎的设计参照，并非 SPA 直接引用的代码。

## 语言约定

提交信息的**描述性内容使用中文**（依据 README 的「## Language」一节）。采用 Conventional Commits 类型前缀（`feat`/`fix`/`docs`/`refactor`/`test`/`chore`），类型之后的中文即为描述。示例：`feat: 添加第一章关卡数据` —— 与仓库实际历史一致（如 `chore: 添加前端构建配置与开发细化文档`）。

## 当前状态

前端正处于起步阶段。`package.json`、`vite.config.ts`、`tsconfig.json`/`tsconfig.node.json`、`index.html` 均已存在，但 **`src/` 目录尚未创建** —— `index.html` 中引用的 `/src/main.tsx` 正是 `development-refinement.md` §3 所规划的入口。开始 M1 工作时，请按 §3 建立 `src/` 骨架。

## 命令

```bash
npm run dev          # Vite 开发服务器（HMR）
npm run build        # tsc -b && vite build（构建包含类型检查）
npm run preview      # 预览生产构建产物
npm run typecheck    # tsc --noEmit（不产出文件的快速类型检查，提交前运行）
```

包管理器：文档中提到 `pnpm`，但本仓库的 `package.json` 直接使用 npm scripts —— 请统一使用 `npm run <script>`。

当前尚未配置测试运行器（`package.json` 中没有 `test` 脚本），尽管工程文档 §11 要求引入 **Vitest + @testing-library/react**，测试置于 `src/__tests__/`。配置完成后，预期命令为 `npm test`，单测运行用 `npx vitest run <file>`。首批应编写的测试为 `tokenize.test.ts`、`scoring.test.ts`、`targetState.test.ts`、`executor.test.ts`（§11.1 单元测试），以及 `components.test.tsx`（§11.2 组件测试）。

依赖已在 `package.json` 中声明，但 **`node_modules/` 尚未安装，且没有提交任何 lockfile**。在运行 `npm run dev`/`build`/`typecheck` 之前须先执行 `npm install`，并应把生成的 `package-lock.json` 一并提交。

## 仓库状态与注意事项

- **`.gitignore` 已补齐**（涵盖 `node_modules/`、`dist/`、日志、编辑器与系统文件等）。历史提交 `08361a4`、`d1a259c` 曾声称添加过它，但此前工作树中并不存在；现有文件为本仓库实际的忽略规则来源。
- **`README.md` 的结构树已过时**：其中仍列出 `practice/a.txt`、`b.txt`、`c.txt`（已在 `518d452` 中删除），且未包含 `development-refinement.md`、`AGENTS.md` 及各项构建配置文件。推断仓库布局时，请以本文件与 `development-refinement.md` 为准，而非 README 的结构树。
- 设计文档（`game-design.md`、`development-refinement.md`）**已提交入库**，且成文于任何 `src/` 代码存在之前。本文件通篇引用的章节编号（§2–§14）目前在这些文档中是稳定的；但若你改动了这些文档，请同步更新此处的交叉引用。

## 架构（整体图景）

本应用是单页应用（SPA）。**没有使用路由** —— 由 `viewStore` 中的视图状态机驱动根组件切换。分层职责如下（见 `development-refinement.md` §2、§5）：

```
UI Layer（ui/components, ui/hooks）
        ↓ 订阅 / 派发
Store / State（store/: sessionStore, progressStore, viewStore）   ← 单一事实来源
        ↓
Game Service（game/: command/, validate/, scoring/）  ← 纯函数
        ↓
Git 执行层（engine/: fs, gitApi, sandbox, errors）
        ↓
isomorphic-git + LightningFS  ← 浏览器内执行真实的 git 对象/索引操作，无后端
        ↓
关卡数据与运行时（levels/, persistence/）
```

需要保持的关键架构规则：

- **UI 层为纯展示** —— 不含业务逻辑；通过 hooks 订阅、通过派发 action 驱动。
- **Game Service 为纯函数** —— 命令 tokenize → 语法校验 → executor 编排 → 目标状态比对 → 计分。副作用不得进入该层。
- **Git 执行层是对 isomorphic-git 的薄封装**。玩家的所有命令统一走 `gitApi.*`；错误被归一为业务异常（`GitCommandError` 等）。`practice/server/gitrunner.mjs` 体现了预期的子命令白名单与沙箱纪律 —— 浏览器引擎应与之保持一致。
- **视图状态机**：`boot → intro → menu → chapter → level → levelComplete → (menu/chapter)`；全部通关后可从菜单进入 `gameComplete`。`boot` 负责初始化 LightningFS、加载持久化进度，并决定进入 intro 还是 menu。
- **不使用 `react-router`** —— 这是刻意设计，以保持线性流程简单。路由即 `viewStore` 中的判别联合类型 `view`。

### 沙箱模型

全局单例 LightningFS `fs`，挂载于虚拟根目录 `/`。每关的目录约定：`/repo`（玩家操作的主仓库）、`/remote.git`（作为「远程宇宙」的裸仓库，用于第四章的远程关卡）。每次关卡开始时：清空虚拟根目录，并依据 `LevelInit` 重建（`sandbox.ts::reset`）。

### 核心领域模型（§4）

- `Level` —— id（`chN-M`）、chapter、objective、难度 1–5、`inputMode: 'free' | 'half' | 'menu'`、`relatedKnowledge[]`、`LevelInit`、`TargetCondition[]`、`winScore`、`ScoringParams`、`HintStep[]`。
- `LevelInit` —— `template`、`files`、`commits`、`branches`、`tags`、`remotes`。实现方式是：通过 fs 写入文件，并通过 gitApi 构建 commit/branch/tag，从而得到**真实的对象数据库**。
- `TargetCondition` —— 判别联合类型（`file`/`branch`/`headBranch`/`commitCount`/`commitMessage`/`commitExists`/`tag`/`merged`/`logOrder`/`workdirClean`/`remote`）。**所有**目标均满足时，关卡才算通过。
- `CommandEntry` —— input + tokens + ok + output + error + ts + `undoable`（驱动计分）。

### 计分理念：奖励理解、惩罚试错

- 基础分按目标达成度加权；**必须满足全部目标才算过关**。
- 惩罚项：撤销类命令（reset/revert/`checkout --`/stash drop）、重复完成同一目标、使用提示。
- 奖励项：最优命令序列、一次通过且零失误（0 撤销 0 提示）、只读探查的小额加分（status/log/branch）。
- 星级：★ 过关；★★ 得分 ≥0.8·winScore 且无撤销；★★★ 得分 ≥0.95·winScore 且 0 提示 0 撤销。
- 细化：区分 reset 模式 —— `--soft/--mixed` 轻度惩罚，`--hard` 重度惩罚。

### 持久化（§10）

localStorage（带版本号的键 `gtp:progress:v1`、`gtp:achievements:v1`、`gtp:settings:v1`）+ IndexedDB 存储仓库快照（`gtp:snapshot:<levelId>`），以便在关卡中途刷新或崩溃后恢复。

## 输入方式随章节演进（GDD §3.2）

第 1–2 章为**菜单 / 拼接**（拖拽、点击命令片段）→ 第 3–4 章为**半拼**（给出骨架 + 填空）→ 第 5–6 章及终章为**自由输入**（完整键入，支持别名）。语法层需支持半拼模式下的「残缺 token」高亮流程。

## Git 子命令覆盖率注意事项

isomorphic-git 对 `revert`/`stash`/`pull` 自动合并的支持不完整 —— `gitApi` 必须用底层原语组合实现这些命令。对于受支持子集之外的命令，语法层应给出「该版本不支持」的提示，而不是伪造执行。各关卡的仓库体积应尽量保持精简，以避免 LightningFS 的性能问题。

## 里程碑（§13）

工作按以下顺序推进：M1（引擎骨架 + store 三件套 + init/add/commit 可视化）→ M2（关卡框架 + 第一章可玩）→ M3（计分 / 星级 / 成就）→ M4（第 2–3 章、GitGraph、BranchPanel、Tab 补全）→ M5（撤销与远程、快照持久化）→ M6（标签 + 综合终章）→ M7（打磨、调参、E2E）。每个阶段结束时都要运行 `typecheck` + `test` + `build`，确保 `main` 分支始终可运行。
