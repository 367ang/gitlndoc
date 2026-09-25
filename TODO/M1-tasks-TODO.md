# M1 任务清单（地基）

> 本清单用于在新会话中执行 M1。开工前请先阅读 `AGENTS.md` 与 `development-refinement.md` §2/§3/§6/§9/§13。
>
> **M1 目标（§13 原文）**：目录骨架、样式 token、`engine/fs.ts`、`engine/gitApi.ts`、`engine/sandbox.ts`、store 三件套。
> **M1 产出（验收标准）**：可跑 shell，能 init/add/commit 并可视化。

---

## 阶段 0：前置条件 —— ✅ 已全部完成

详见 `TODO/M1-preflight-DONE.md`。摘要：

- [x] **0.1 PATH 问题**：`node` / `pnpm` / `gh` 都在 Homebrew 路径下，沙箱 shell 的 PATH 不含该目录。**每个新会话第一条 Node 命令前先执行**：
  ```bash
  export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
  ```
- [x] **0.2 依赖已安装**：包管理器为 **pnpm**（用户确认，与文档 §12 一致）。`pnpm-lock.yaml` 已生成，应提交。
- [x] **0.3 缺失依赖已补齐**：`zustand@5.0.15`、`@isomorphic-git/lightning-fs@4.9.0` 已加入 `package.json`。包名已核实无误。
- [x] **0.4 工具链验证**：`pnpm typecheck` 可跑通；`vite` / `tsc` 可执行；esbuild 已通过 `pnpm-workspace.yaml` 的 `allowBuilds` 放行。
- [x] **0.5 `tsconfig` 路径确认**：`references` 指向 `tsconfig.node.json`（`include: ["vite.config.ts"]`），配置自洽，待 `src/` 建好后复验。

---

## 阶段 1：目录骨架（§3）

按 `development-refinement.md` §3 建立 `src/` 结构。M1 只创建本阶段列出的文件，其余目录留待 M2+。

- [ ] **1.1 入口与根组件**
  - `src/main.tsx` —— 挂载 `App` + 初始化沙箱（`index.html` 已引用此路径，**必须在 M1 建好**，否则 `pnpm dev` 白屏）
  - `src/app/App.tsx` —— 根组件：视图状态机调度
  - `src/app/routes.ts` —— 视图枚举
- [ ] **1.2 `src/engine/`（Git 执行层）**
  - `src/engine/fs.ts` —— LightningFS 实例与目录初始化
  - `src/engine/gitApi.ts` —— isomorphic-git 薄封装（统一错误）
  - `src/engine/sandbox.ts` —— 仓库沙箱：init / 克隆模板 / 重置
  - `src/engine/errors.ts` —— 业务异常类型（`GitCommandError` 等）
- [ ] **1.3 `src/store/`（store 三件套）**
  - `src/store/sessionStore.ts` —— 当前关卡、命令历史、输入
  - `src/store/progressStore.ts` —— 进度 / 得分 / 成就
  - `src/store/viewStore.ts` —— 视图路由状态
- [ ] **1.4 样式 token（§9.2）**
  - `src/styles/tokens.css` —— 「时空穿梭 / 星际」主题色：深空背景、星云紫、脉冲蓝、分支用暖橙/青绿；字号/圆角/间距统一由 token 变量控制
  - `src/styles/global.css` —— 全局 reset 与主题

> **M1 暂不创建**：`src/levels/**`（M2）、`src/ui/components/**` 的完整组件集（M2/M4）、`src/persistence/**`（M5）。
> **M1 需要创建**：`src/game/**` 的 `command/` 部分（见阶段 2.5）、`src/__tests__/` 的 5 个测试文件（见阶段 5）。
> §3 的目录规划可作为命名依据。

---

## 阶段 2：Git 执行层实现（§6.1 / §6.2）

- [ ] **2.1 `engine/fs.ts`**：全局单例 LightningFS `fs`，挂载虚拟根目录 `/`（§6.1）
- [ ] **2.2 `engine/sandbox.ts`**：实现 `reset`（§6.1 约定 `sandbox.ts::reset`）
  - 每关开始：清空虚拟根，依据 `LevelInit` 重建
  - 目录约定：`/repo`（玩家主仓库）、`/remote.git`（裸仓库，供第四章用）
- [ ] **2.3 `engine/gitApi.ts`**：**M1 仅需实现 `init` / `add` / `commit`**（外加可视化必需的 `status` / `log`）
  - 全部命令统一走 `gitApi.*`，错误归一为 `engine/errors.ts` 中的业务异常
  - 其余方法（`branch`/`checkout`/`merge`/`reset`/`revert`/`stash`/`tag`/`remote`/`clone`/`push`/`fetch`/`pull`）留待 M4/M5，**不要在 M1 提前实现**
- [ ] **2.4 `engine/errors.ts`**：定义 `GitCommandError` 等业务异常
- [ ] **2.5 `game/command/`（命令解析，已确认归属 M1）**
  - `src/game/command/tokenize.ts` —— 命令行 token 化（引号 / 空白 / 转义）
  - `src/game/command/grammar.ts` —— 每条命令的参数校验
  - `src/game/command/executor.ts` —— 命令 → `gitApi` 调用编排
  - `src/game/types.ts` —— 核心领域类型（§3 将其置于 `game/` 下）
  - M1 只需覆盖 `init` / `add` / `commit`（含可视化的 `status` / `log`）；其余子命令随 M4/M5 扩展

### 实现注意

- 命令解析**属 M1**（用户已确认），因此 `tokenize.test.ts` 与 `executor.test.ts` 在 M1 就有真实被测对象。
- `practice/server/gitrunner.mjs` 是**浏览器引擎的设计参照**（子命令白名单 + 沙箱纪律），但它是 Node 侧代码，**不可被 SPA 引用**。

---

## 阶段 3：可视化最小闭环

M1 验收要求"能 init/add/commit 并可视化"，因此需要一个最小可跑界面。

- [ ] **3.1 视图状态机**：`viewStore` 实现 §5 的判别联合
  - `view: 'boot' | 'intro' | 'menu' | 'chapter' | 'level' | 'levelComplete' | 'gameComplete'`
  - M1 只需 `boot`（初始化 LightningFS）与 `level`（承载终端）可用
- [ ] **3.2 最小 UI**：为验收所需的组件（可先极简，M2 再按 §9.1 正规化）
  - 终端输入区（`ui/components/terminal/`）
  - 命令历史与输出（`ui/components/history/`）
  - 虚拟文件树（`ui/components/fileTree/`）
- [ ] **3.3 打通链路**：输入命令 → `gitApi` 执行 → 状态回显 → 文件树刷新

---

## 阶段 4：测试环境与用例（已确认属 M1）

- [ ] **4.1 引入测试依赖**：`pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom`
  - ⚠️ 具体包与版本以实际需要为准（React 18 对应 `@testing-library/react` v14+）
- [ ] **4.2 配置 Vitest**：在 `vite.config.ts` 中加 `test` 字段（`environment: 'jsdom'`、`globals: true`），或在 §11 所述 `src/__tests__/` 约定下另建配置
- [ ] **4.3 加 `test` 脚本**：`package.json` 增加 `"test": "vitest"`（单测运行用 `pnpm vitest run <file>`）
- [ ] **4.4 建立 5 个测试文件**（结构完整性优先）：
  - `src/__tests__/tokenize.test.ts` —— 引号 / 转义 / 空白边界（M1 写真实用例）
  - `src/__tests__/executor.test.ts` —— 在 LightningFS 内存实例上跑真实 gitApi，断言副作用（M1 写真实用例）
  - `src/__tests__/scoring.test.ts` —— 占位（评分属 M3）
  - `src/__tests__/targetState.test.ts` —— 占位（依赖 `game/validate/`）
  - `src/__tests__/components.test.tsx` —— 占位（需 UI 成型）
- [ ] **4.5 `pnpm test` 可跑通**（占位用例以 `it.todo` / skip 形式存在，不产生失败）

---

## 阶段 5：验收

- [ ] **5.1 `pnpm typecheck`** 通过
- [ ] **5.2 `pnpm dev`** 启动，页面不白屏
- [ ] **5.3 手动冒烟**：能执行 `git init` → `git add` → `git commit`，且结果可视化正确
- [ ] **5.4 `pnpm test`** 通过
- [ ] **5.5 `pnpm build`** 通过
- [ ] **5.6 提交**：按仓库规范用中文描述，例如 `feat: 搭建 M1 引擎骨架与 store`

> §13 要求"每阶段结束都跑 `typecheck` + `test` + `build`"。`test` 脚本由 4.3 引入。

---

## 已确认的决策（用户拍板，2025-09）

1. **测试框架在 M1 引入** ✅
   - M1 配好 Vitest + @testing-library/react 环境（加依赖 + 配置）。
   - **5 个测试文件全部建立**，以保证 `src/__tests__/` 结构完整：
     `tokenize.test.ts`、`scoring.test.ts`、`targetState.test.ts`、`executor.test.ts`（§11.1 单元测试）+ `components.test.tsx`（§11.2 组件测试）。
   - 与被测代码同步的（`tokenize`、`executor`）写真实用例；尚未实现对应模块的（`scoring` 属 M3、`targetState` 依赖 `validate/`、`components` 需 UI 成型）先建立文件占位（`describe`+`it.todo` 或 skip），留待后续里程碑填充。
   - ⚠️ 拟建文件是本清单的**推定命名**，非文档原文规定，实施时可按实际情况调整。

2. **命令解析归属 M1** ✅
   - `game/command/` 的 `tokenize.ts`、`grammar.ts`、`executor.ts` 在 M1 落地（不再用临时直通解析）。
   - 这使 M1 的 `executor.test.ts` / `tokenize.test.ts` 有了真实被测对象。

3. **persistence 在 M5 落地** ✅
   - M1 **不实现** `src/persistence/`（`progress.ts` / `snapshot.ts`）。
   - 依据：§13 把持久化排在 M5；M1 无 `Level` 模型、无得分数据，提前实现属过度设计。
   - M1 的 `boot` 视图做**最小实现**：初始化 LightningFS 后直接进入 `intro`/`menu`，把"加载持久化进度"留为 TODO 注释，待 M2/M3 有真实进度数据后接入。

---

## 执行约束（沿用仓库既有约定）

- **语言**：代码标识符、命令、路径、类型名保持英文；描述性内容与提交信息用中文（见 `AGENTS.md`）。
- **提交规范**：Conventional Commits（`feat`/`fix`/`docs`/`refactor`/`test`/`chore`），类型之后为中文描述。
- **不要擅自提交**：遵循本仓库历史习惯，改动完成并经用户确认后再提交。
- **推送需先导出 PATH**：`export PATH="/opt/homebrew/bin:$PATH"`（否则 `gh` 不可见，HTTPS 推送会报 `could not read Username`）。
- **`.gitignore` 已就位**，`node_modules/`、`dist/` 等已被忽略。

---

## 参考索引

| 内容 | 位置 |
|---|---|
| 仓库约定与当前状态 | `AGENTS.md` |
| 技术选型 | `development-refinement.md` §1 |
| 总体架构与分层职责 | §2 |
| 完整目录结构 | §3 |
| 视图状态机 | §5 |
| LightningFS 沙箱与 gitApi 封装 | §6.1、§6.2 |
| UI 组件与主题 | §9.1、§9.2 |
| 测试策略 | §11 |
| 构建与质量门禁 | §12 |
| 里程碑 M1 定义 | §13 |
| 沙箱白名单设计参照 | `practice/server/gitrunner.mjs` |
