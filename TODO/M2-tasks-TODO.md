# M2 任务清单（关卡框架 + 第一章可玩）

> 本清单用于在新会话中执行 M2。开工前请先读：
> `AGENTS.md` → `development-refinement.md` §3/§4/§5/§8/§9.1/§11/§13 → **`TODO/M1-tasks-DONE.md` 末尾的「实测环境事实」**（M2 要动 `engine/` 与 `sandbox`，那节有 3 条会直接影响实现方式的实测结论）。
>
> **M2 目标（§13 原文）**：`levels/schema.ts` + 第一章 4 关、Terminal/FileTree/GoalPanel、目标检测。
> **M2 产出（验收标准）**：第一章可玩（菜单式）。
>
> **M1 已交付**：`engine/`（fs/gitApi/sandbox/errors）、`game/command/`（tokenize/grammar/executor）、store 三件套、极简 UI（Terminal/CommandHistory/FileTree/CommitPanel）、Vitest 环境 + 5 个测试文件（49 真实用例）。`main` 分支三门禁全绿，已推送 `ae75e8d`。

---

## 阶段 0：前置条件

- [ ] **0.1 导出 PATH**（每个新会话第一条 Node 命令前必做）：
  ```bash
  export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
  ```
  验证：`node -v && pnpm -v` → `v26.x` / `12.x`
- [ ] **0.2 基线确认**：`pnpm typecheck && pnpm test:run && pnpm build` 三门禁全绿（应得 `49 passed | 34 todo`）。
- [ ] **0.3 读 M1 遗留项**：`TODO/M1-tasks-DONE.md` 末尾「实测环境事实」与「遗留问题」两节。重点 3 条：
  1. `sandbox.reset()` 对 `LevelInit` 的 `branches`/`tags`/`remotes`/`template:'cloneSource'` 目前是 **fail-fast 报错**（M1 刻意不伪造）—— M2 的第一章关卡**不要使用这些字段**，否则进关即报错。
  2. `LightningFS.promises.writeFile` **不自动建父目录**（`sandbox.ts` 已用 `ensureParentDirs` 处理），关卡 `files` 可用嵌套路径。
  3. **jsdom 测试通过 ≠ 浏览器可用**（M1 的 Buffer 崩溃即此教训）。涉及浏览器专属行为时，务必用真实浏览器验证。

---

## 阶段 1：关卡数据层（§3 `levels/`、§4）

- [ ] **1.1 `src/levels/schema.ts`** —— 关卡定义的类型守卫与校验
  - `Level` / `LevelInit` / `TargetCondition` 等核心类型已在 `src/game/types.ts`（M1 交付，**不要重复定义**），本文件负责**运行时校验**：接收未知数据，判定是否为合法 `Level`，给出可读错误。
  - 校验至少覆盖：`id` 形如 `chN-M` 且与 `chapter` 一致、`difficulty` 在 1–5、`inputMode` 属三者之一、`targets` 非空、`scoring` 字段齐备。
  - 依据：§4.1/§4.2/§4.3。
- [ ] **1.2 `src/levels/presets.ts`** —— 关卡初始化时写入的模板文件内容
  - 第一章是「修复损坏的时间线」，模板文件应贴合叙事（如 `README.md`、`notes/` 下的说明文件），**内容用中文**。
  - 注意：文件内容会被 `sandbox.reset()` 真实写入 `/repo`，保持精简（§14：LightningFS 大仓库性能）。
- [ ] **1.3 `src/levels/chapters/ch1.ts`** —— 第一章 4 关定义
  - 严格照 GDD 第 77–80 行与 §8 映射表：

    | 关卡 | 名称 | 目标 | 关联笔记 | 输入 | 难度 |
    |---|---|---|---|---|---|
    | 1-1 | 时间线初始化 | 用 `git init` 创建仓库 | 基础概念·仓库 | 拼接 | ★ |
    | 1-2 | 第一次快照 | `add` + `commit` 生成首个提交 | 基础概念·快照/提交 | 拼接 | ★ |
    | 1-3 | 三态之谜 | 理解工作区/暂存区/仓库三态 | 基础概念·三态 | 拼接 | ★★ |
    | 1-4 | 历史之链 | 识别提交对象与父提交关系 | 基础概念·对象模型 | 拼接 | ★★ |

  - ✅ **第一章命令集已定论：`init` / `add` / `commit`**（用户裁定，2025-09）。
    - 原 `development-refinement.md` §8 表格将第一章写作 `init, status, log`、第二章写作 `add, commit, .gitignore`，与 GDD 第 77–80 行矛盾。
    - **已订正 §8 表格**（以 GDD 为准）：
      - 一 基础概念 → `init, add, commit`
      - 二 基础操作 → `status, diff, log, rm, .gitignore`
    - 根因：`add`/`commit` 被错放到了第二章；GDD 第二章实际是 `status`/`diff`/`log`/`rm`/`.gitignore`。
    - **对 M2 的影响**：1-2「第一次快照」的 `targets` 需围绕 `add` + `commit` 编写（如 `commitCount: { op:'gte', value:1 }` + `commitMessage` + `workdirClean`）。M1 的 `gitApi` 已实现这五个子命令，无障碍。
  - `relatedKnowledge` 的 id 取自 `notes/git-basics.md` 的实际小节。该笔记现有 `##` 级小节为：
    「三大核心区域」「工作流程图解」「为什么要有暂存区？」「对象模型」「参考资源」。
    **打开笔记核对后再填**，不要臆造 id。注意 GDD 的「关联」列写的是「基础概念·仓库 / 快照 / 三态 / 对象模型」，与上述小节名**并非逐字对应**，需要你建立映射关系（这本身就是一项设计工作）。
  - 每关需写全 `Level` 的全部字段（含 `winScore`、`scoring`、`hints`）。**`scoring` 在 M2 只作占位**（计分属 M3），字段填合理默认值即可。
  - **不要使用 `branches`/`tags`/`remotes`**（见阶段 0.3 第 1 条）。
- [ ] **1.4 `src/levels/chapters/index.ts`** —— 汇总导出 + 章节元信息
  - 导出全部章节、按 id 查关卡的辅助函数（`getLevel(id)`、`getChapterLevels(chapterId)` 之类），供 UI 使用。

---

## 阶段 2：目标检测（§4.3、§3 `game/validate/`）

- [ ] **2.1 `src/game/validate/targetState.ts`** —— 目标状态比对（**纯函数层**）
  - 依据已确认决策：**只实现第一章实际用到的 5 种** `TargetCondition`：

    | 类型 | 语义 | 用于哪关 |
    |---|---|---|
    | `file` | 文件存在 / 内容匹配 | 1-1、1-3 |
    | `commitCount` | 提交数量（`gte` / `eq`） | 1-2、1-3、1-4 |
    | `commitMessage` | 最近提交信息匹配（`RegExp`） | 1-2、1-4 |
    | `commitExists` | 存在特定提交 | 1-4 |
    | `workdirClean` | 工作区是否干净 | 1-1、1-2、1-3 |

  - 其余 6 种（`branch`/`headBranch`/`tag`/`merged`/`logOrder`/`remote`）**留待对应章节实现**（依赖 M4/M5 的命令）。对未实现的类型，**明确返回「该类型尚未实现」而非静默当作通过**（§14 禁止伪造）。
  - 出口形如 `{ satisfied: boolean; results: { target, ok, detail }[] }`，需能驱动 GoalPanel 逐项打勾/叉并给出「还差什么」的抽象提示（§9.1：**不给具体命令**）。
  - **⚠️ 依赖 M1 的 `gitApi.status()`**：其中 `workdirClean` 必须用 `status()` 的 `staged`/`unstaged`/`untracked` 三者皆空来判。注意 M1 修过一个 bug（`unstaged` 误报）与「等长改写」漏报，实现时不要绕开 `gitApi` 自行判断。
  - 纯函数纪律：不引入副作用、不直接碰 fs、不 import React/zustand。只读 `gitApi` 的结果。
- [ ] **2.2 `src/game/validate/stepHints.ts`** —— 分步提示生成（§3 已规划，M2 最小实现）
  - 依据 `Level.hints`（`HintStep[]`，按失败次数解锁）与当前目标达成情况，产出**下一步该提示什么**。
  - 分级提示（GDD §3.3）：方向提示 → 命令提示 → 完整答案。M2 只需能按 `unlockAfterFailures` 返回对应层级文本；**计分扣分属 M3**，此处不算分。

---

## 阶段 3：关卡 UI（§9.1、§5）

- [ ] **3.1 `src/ui/components/level/LevelScreen.tsx`** —— 关卡主界面容器
  - **注意**：M1 的 `LevelScreen.tsx` 临时放在 `src/app/`。按 §3 目录规划，本阶段应迁移到 `src/ui/components/level/`，并同步更新 `src/app/App.tsx` 的引用。这是 M1 已记录的遗留项。
  - 组装 GoalPanel + Terminal + CommandHistory + FileTree（§9.1 布局的左右分栏可先做简化版，但结构要与 §9.1 一致，便于 M4 增补 GitGraph/BranchPanel/Hints）。
- [ ] **3.2 `src/ui/components/goalPanel/GoalPanel.tsx`** —— 目标与检测面板（§9.1）
  - 实时对 `targets` 做检测，逐项打勾/叉；未达标给**抽象的**「还差什么」（不给具体命令）。
  - 数据来自阶段 2.1 的 `targetState`。
- [ ] **3.3 拼接式输入组件**（已确认决策：**点击拼接**，不做拖拽）
  - 位置可置于 `src/ui/components/terminal/` 下（与 Terminal 同域）。
  - 给出命令片段按钮（`git` / `init` / `add` / `commit` / `-m` / `.` 等），**点击追加**到输入行，玩家能看到拼出的完整命令，再执行。
  - 仅当 `level.inputMode === 'menu'` 时启用；`'free'` 仍用 M1 的 Terminal。
  - 依据：GDD §3.2「命令拼接 —— 将分散的命令片段拖拽/点击拼接成完整命令」。
- [ ] **3.4 视图与关卡数据的接线**
  - `sessionStore` 的 `level` 字段（M1 中恒为 `null`）在本阶段接上真实 `Level`。
  - 进入关卡时调 `sandbox.reset(level.init)` 重建沙箱（M1 的 `LevelScreen` 里已留 `TODO(M2, §3)`）。
  - `boot`/`menu`/`chapter` 视图给出**最小可用**实现，使玩家能从 menu 进到第一章关卡（`ViewPlaceholder.tsx` 可替换或填充）。
- [ ] **3.5 过关判定与结算（不做计分）**
  - 全部 `targets` 满足即过关 → 切到 `levelComplete` 视图，显示「过关」。
  - 依据已确认决策：**只做过关判定**，`winScore` / 星级 / 成就属 M3，本阶段不实现。

---

## 阶段 4：测试（§11）

- [ ] **4.1 `src/__tests__/targetState.test.ts`** —— 把 M1 的**占位替换为真实用例**
  - M1 留下了 15 个 `it.todo`，本阶段填充第一章用到的 5 种条件的判定逻辑测试（含边界：空仓库、无提交、文件内容不匹配、`commitCount` 的 `gte`/`eq` 差异等）。
  - 在真实 LightningFS 内存实例上跑（`configureFs({ name, backend: new MemoryBackend() })`，见 M1 已建立的模式）。
- [ ] **4.2 `src/__tests__/components.test.tsx`** —— 把 M1 的**占位替换为真实用例**（§11.2）
  - M1 留下 7 个 `it.todo`。至少覆盖：Terminal 输入/历史、GoalPanel 打勾、拼接式输入的片段追加。
- [ ] **4.3 新增 `src/__tests__/levels.test.ts`** —— 关卡数据校验
  - 4 关全部通过 `schema.ts` 校验；`relatedKnowledge` 的 id 在笔记中确有对应；`targets` 非空且类型均在已实现范围内。
  - **价值**：关卡数据是手写的，最容易出现「id 拼错」「用了未实现的 target 类型」这类问题，且只在运行时才暴露。
- [ ] **4.4 `src/__tests__/scoring.test.ts` 保持占位**（计分属 M3，M2 不动）。

---

## 阶段 5：验收

- [ ] **5.1 `pnpm typecheck`** 通过（退出码 0）
- [ ] **5.2 `pnpm test`** 通过（新增用例全绿，`scoring.test.ts` 仍为占位不失败）
- [ ] **5.3 `pnpm build`** 通过（关注体积，§12 预算 ~350KB gzip）
- [ ] **5.4 `pnpm dev`** 启动，页面不白屏
- [ ] **5.5 手动冒烟（M2 验收核心）**：从 menu 进入第一章 1-1 → 用**拼接式**输入拼出 `git init` 并执行 → GoalPanel 打勾 → 过关 → 结算页 → 进入 1-2，重复至 1-4 可玩。
  - **⚠️ 必须在真实浏览器验证**（不要只用 jsdom —— M1 的 Buffer 崩溃就是被 jsdom 掩盖的）。
- [ ] **5.6 提交**：中文描述，例如 `feat: 实现 M2 关卡框架与第一章四关`

---

## 已确认的决策（用户拍板，执行前请勿擅自更改）

1. **拼接输入用「点击拼接」，不做拖拽** ✅
   - 点击命令片段追加到输入行。拖拽交互工作量明显更大，M2 不做。
2. **M2 只做过关判定，不做计分与星级** ✅
   - 依据 §13：`game/scoring/*`、星级、成就均划在 M3。`Level.scoring` 字段填占位值。
3. **目标检测只实现第一章用到的 5 种 `TargetCondition`** ✅
   - `file` / `commitCount` / `commitMessage` / `commitExists` / `workdirClean`。
   - 其余 6 种留待对应章节；未实现的类型要**明确报「尚未实现」**，不得静默通过。

---

## 执行约束（沿用仓库既有约定）

- **语言**：代码标识符、命令、路径、类型名保持英文；描述性内容、注释、提交信息用中文（见 `AGENTS.md`）。
- **提交规范**：Conventional Commits（`feat`/`fix`/`docs`/`refactor`/`test`/`chore`），类型之后为中文描述。
- **不要擅自提交**：改动完成并经用户确认后再提交。
- **推送需先导出 PATH**：`export PATH="/opt/homebrew/bin:$PATH"`（否则 `gh` 不可见）。
- **分层纪律**（§2）：UI 层纯展示、Game Service 纯函数、Git 执行层薄封装。玩家的所有命令统一走 `executor`，不直接调 `gitApi`。
- **门禁**：每阶段结束跑 `typecheck` + `test` + `build`（§13）。

---

## 参考索引

| 内容 | 位置 |
|---|---|
| 仓库约定与当前状态 | `AGENTS.md` |
| M1 实测环境事实（**先读**） | `TODO/M1-tasks-DONE.md` 末尾 |
| 第一章关卡列表与输入方式 | `game-design.md` 第 77–80 行、§3.2 |
| 关卡定义 / 初始化 / 达标条件 | `development-refinement.md` §4.1、§4.2、§4.3 |
| 目录结构 | §3 |
| 视图状态机 | §5 |
| 关卡内容→工程任务映射 | §8 |
| 关卡主界面布局 | §9.1 |
| 测试策略 | §11 |
| 里程碑 M2 定义 | §13 |
| 第一章知识依据 | `notes/git-basics.md` |
