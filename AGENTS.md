# AGENTS.md

本文件为在此仓库中工作的 AI agent 提供指引，说明代码库的结构与约定。

## 仓库定位

本仓库是 **「Git 时间旅人」 / "Git Time Traveler"** 的设计与源码仓库 —— 一款纯浏览器、单机、以时间旅行为主题的 Git 学习游戏。玩家通过执行真实的 Git 命令来修复损坏的「时间线」（git 仓库）。以下文档构成项目的唯一事实来源，任何代码工作都应与之对齐：

- `game-design.md`（GDD）—— 游戏概念、叙事，以及完整的关卡列表，含难度 / 输入方式 / 关联笔记的映射。
- `development-refinement.md` —— 由 GDD 推导出的工程细化文档：技术选型、分层架构、`src/` 目录结构、核心领域模型、评分系统、持久化、测试策略、里程碑规划。**这是所有实现工作的权威依据** —— 其 §4/§7/§8 需与 GDD 保持一致。
- `docs/notes/*.md` —— 共 9 篇 Git 学习笔记，是关卡设计的**知识依据**（每个关卡通过 `relatedKnowledge` id 引用）。其中 8 篇为知识笔记，按 GDD §8 的映射表与各章对应（Git基础概念→第一章、Git基础操作→第二章、Git分支管理→第三章、Git远程操作→第四章、Git撤销操作→第五章、Git标签管理→第六章、Git最佳实践贯穿各章），另有 `git-cheatsheet.md` 为综合速查总表，不单独对应某一章。因此笔记数与章节数并非一一对应。**归属分类与改动约束见 `docs/notes/README.md`。**
- `docs/notes-change-log.md` —— 记录笔记重构的变更日志；**凡重构或修改 `docs/notes/` 下的笔记，都必须追加记录到本文件**。注意：仓库中并不存在 `.claude/commands/implement-feature.md`（早期文档曾引用该文件），此约定的来源只有本文件与 `README.md`。
- `practice/server/gitrunner.mjs` —— 独立的 Node 沙箱辅助模块（`createSandbox` / `runCommand` / `getGitState`），在临时目录中执行真实 git，屏蔽一组精心整理的 `BLOCKED_SUBCOMMANDS`，并强制固定的学习者身份。它是本项目对「命令沙箱 + 子命令白名单」预期行为的设计参照。注意：`practice/` 目录当前仅含此文件。该模块通过 `child_process` 调用真实 `git`，属于 **Node 侧**代码，是浏览器引擎的设计参照，并非 SPA 直接引用的代码。

## 语言约定

提交信息的**描述性内容使用中文**（依据 README 的「## Language」一节）。采用 Conventional Commits 类型前缀（`feat`/`fix`/`docs`/`refactor`/`test`/`chore`），类型之后的中文即为描述。示例：`feat: 添加第一章关卡数据` —— 与仓库实际历史一致（如 `chore: 添加前端构建配置与开发细化文档`）。

## 当前状态

**M1（地基）～ M4（第 2–3 章、GitGraph、BranchPanel、Tab 补全、文件编辑）均已完成**，三门禁当前为 **`typecheck` 0 / `test` 228 passed / `build` ≈170 kB gzip**（M4 实测）。下一阶段为 **M5（撤销与远程、快照持久化）**。

各里程碑的**产出、三门禁历史、实测环境事实与遗留移交**见 **`docs/milestones/README.md`**（索引）与 `docs/milestones/M*-tasks.md`（各期详情），本文件不复述。

⚠️ **动 `engine/` 或做真实浏览器验收前，务必先读 `docs/milestones/M2-tasks.md` §4「实测环境事实」、`M3-tasks.md`「实测环境事实」、`M4-tasks.md`「执行结果」** —— 下述教训均为实测所得，违反即踩坑：

1. isomorphic-git 的 ff merge **只移 ref 不更新工作区**（merge 后必须补 checkout）；`git rm` 对 untracked 文件静默成功但什么都不做（已拦截）；**无 rebase 命令**（组合实现「搬 tree」，相交改动场景与真 git 不等价 —— 关卡数据须避开）。
2. **「`git init` 创建仓库」类目标无法用状态判定表达**（`reset()` 总会先 init，且 `git init` 幂等）；纯只读命令（`status`/`log`/`diff`）关卡的目标须锚定「玩家用该命令前后必须做到的事」。
3. **jsdom 的 `fireEvent.change` 不受 `readOnly` 限制**，会掩盖「玩家无法输入」类缺陷；涉输入/编辑行为**必须真实浏览器验证**。本机验收需 `--no-sandbox --disable-crashpad`，键盘输入走 CDP `Input.insertText`。
4. LightningFS 对**目录**调 `readFile` 返回 `null` 而非抛错，判存在性必须用 `stat`。
5. `evaluateTarget` 接收 `options`（branch/merged/logOrder 需读仓库）；关卡预置提交**每个都必须带 files**（空提交防御），`on` 缺省回 main。

> 另需注意：`development-refinement.md` §8 的「主要命令集」列曾与 GDD 不一致 —— 第一章被误写为 `init, status, log`、第二章被误写为 `add, commit, .gitignore`，**已于 M2 开工前按 GDD 订正**为「一：`init, add, commit`」「二：`status, diff, log, rm, .gitignore`」。§8 是逐章核对过的，其余行与 GDD 一致（个别概括性差异，如三章未列 `switch`、六章列了 `show`/`describe`，属「主要命令」的合理列举）。**若再改 §8，务必与 `game-design.md` 第 4 节的关卡表逐行比对。**

## 命令

```bash
pnpm dev             # Vite 开发服务器（HMR）
pnpm build           # tsc -b && vite build（构建包含类型检查）
pnpm preview         # 预览生产构建产物
pnpm typecheck       # tsc --noEmit（不产出文件的快速类型检查，提交前运行）
pnpm test            # Vitest（watch 模式）；CI/单次运行用 `pnpm test:run` 或 `pnpm vitest run <file>`
pnpm smoke:legacy    # 真实浏览器冒烟（真实 Chrome + CDP）；三段独立运行，见 tools/smoke/README.md
pnpm smoke:ch2
pnpm smoke:ch3
```

包管理器：**统一使用 pnpm**（与工程文档 §12 的技术选型一致）。`package.json` 中的 `scripts` 字段供 pnpm 调用，不要改用 npm。

> ⚠️ **环境注意**：本机的 `node`/`pnpm` 位于 Homebrew 路径下，但沙箱 shell 的 PATH 默认不含该目录，直接调用会报 `command not found`。执行任何 Node 相关命令前先导出：
> ```bash
> export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
> ```
> 同一原因也会导致 `gh` 不可见（影响推送）。

测试运行器已在 M1 配好：**Vitest + @testing-library/react**（`vite.config.ts` 的 `test` 字段，`environment: 'jsdom'`，`globals: true`），测试置于 `src/__tests__/`。**M4 后共 7 个文件**：`tokenize.test.ts`(22)、`executor.test.ts`(51)、`targetState.test.ts`(32)、`components.test.tsx`(50)、`levels.test.ts`(40)、`scoring.test.ts`(21)、`inputMode.test.ts`(12) 全部为真实用例（**228 passed**，无 todo）。

> ⚠️ `src/__tests__/setup.ts` 里的 `import 'fake-indexeddb/auto'` **不可删除**：jsdom 不提供 `navigator.locks`，LightningFS 的 `DefaultBackend` 会因此回落到需要 `indexedDB` 的 `Mutex` 分支，删掉即全部测试报 `ReferenceError: indexedDB is not defined`。机理详见 `docs/milestones/M1-tasks.md` 的「实测环境事实」第 2 条。

依赖已安装，`pnpm-lock.yaml` 已生成（**应提交入库**）。另有一个 `pnpm-workspace.yaml`，其 `allowBuilds` 字段用于放行 esbuild 的安装脚本 —— 这是 pnpm 12 的默认安全机制，**不要删除该文件**，否则 `pnpm install` 会再次报 `ERR_PNPM_IGNORED_BUILDS`。若在他人机器上安装，请使用 `pnpm install`（而非 npm），以复用同一份 lockfile。

## 仓库状态与注意事项

- **`.gitignore` 已补齐**（涵盖 `node_modules/`、`dist/`、日志、编辑器与系统文件等）。历史提交 `08361a4`、`d1a259c` 曾声称添加过它，但此前工作树中并不存在；现有文件为本仓库实际的忽略规则来源。
- **`docs/milestones/` 存放里程碑相关的规划与检查文档**（每期一份，记录任务拆解与执行结果）：`M1-preflight.md`（M1 开工前的环境核查）、`M1-tasks.md`、`M2-tasks.md`、`M3-tasks.md`、`M4-tasks.md`。
  - **文件名不带状态后缀** —— 完成状态由 `docs/milestones/README.md` 的索引表表达，**不要**再用 `-DONE` / `-TODO` 后缀命名（该约定已废弃）。
  - **新里程碑**直接在本目录新建 `<里程碑名>-tasks.md`（如 `M5-tasks.md`），并同步在 `docs/milestones/README.md` 补一行索引。
- 设计文档（`game-design.md`、`development-refinement.md`）**已提交入库**，且成文于任何 `src/` 代码存在之前。本文件通篇引用的章节编号（§2–§14）目前在这些文档中是稳定的；但若你改动了这些文档，请同步更新此处的交叉引用。

## 架构（整体图景）

应用是单页应用（SPA）：viewStore 中的**视图状态机**（`boot → intro → menu → chapter → level → levelComplete → (menu/chapter)`）驱动根组件切换，**不经路由**。分层自外向内为 **UI → Store → Game Service → Git 执行层 → isomorphic-git + LightningFS**，旁挂关卡数据与运行时（`levels/`、`persistence/`）。各层目录与职责的权威版本见 `development-refinement.md` §2、§5；本次重组后的实际目录布局见 `README.md`。

**需要保持的架构规则（硬约束）：**

- **UI 层为纯展示** —— 不含业务逻辑；通过 hooks 订阅、通过派发 action 驱动。
- **Game Service 为纯函数** —— 命令 tokenize → 语法校验 → executor 编排 → 目标状态比对 → 计分。副作用不得进入该层。
- **Git 执行层是对 isomorphic-git 的薄封装**。玩家的所有命令统一走 `gitApi.*`；错误被归一为业务异常（`GitCommandError` 等）。`practice/server/gitrunner.mjs` 体现了预期的子命令白名单与沙箱纪律 —— 浏览器引擎应与之保持一致。
- **不使用 `react-router`** —— 这是刻意设计，以保持线性流程简单。路由即 `viewStore` 中的判别联合类型 `view`。
- **沙箱模型**：全局单例 LightningFS `fs` 挂载于虚拟根目录 `/`；每关的目录约定为 `/repo`（玩家主仓库）与 `/remote.git`（「远程宇宙」裸仓库，供第四章使用）。每次关卡开始时清空虚拟根目录并按 `LevelInit` 重建（`sandbox.ts::reset`）。

以下为**指针**（权威内容在别处，本文件不再复述，以免与实际漂移）：核心领域模型（`Level` / `LevelInit` / `TargetCondition` / `CommandEntry`）见 `development-refinement.md` §4；计分与星级理念见 §7；持久化设计（localStorage + IndexedDB 快照键）见 §10；输入方式随章节演进（菜单/拼接 → 半拼 → 自由输入）见 `game-design.md` §3.2；里程碑划分见 §13 及 `docs/milestones/README.md`。

## Git 子命令覆盖率注意事项

isomorphic-git 对 `revert`/`stash`/`pull` 自动合并的支持不完整 —— `gitApi` 必须用底层原语组合实现这些命令。对于受支持子集之外的命令，语法层应给出「该版本不支持」的提示，而不是伪造执行。各关卡的仓库体积应尽量保持精简，以避免 LightningFS 的性能问题。

## 里程碑

推进顺序为 M1（地基）→ M2（关卡框架 + 第一章）→ M3（计分 / 星级 / 成就）→ M4（第 2–3 章、GitGraph、BranchPanel、Tab 补全）→ M5（撤销与远程、快照持久化）→ M6（标签 + 综合终章）→ M7（打磨、调参、E2E）。**每个阶段结束时都必须运行 `typecheck` + `test` + `build`**，确保 `main` 始终可运行。各期定义与当前进度见 `development-refinement.md` §13 与 `docs/milestones/README.md`。
