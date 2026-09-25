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

## 阶段 1：目录骨架（§3）—— ✅ 已完成

按 `development-refinement.md` §3 建立 `src/` 结构。M1 只创建本阶段列出的文件，其余目录留待 M2+。

- [x] **1.1 入口与根组件**
  - `src/main.tsx` —— 挂载 `App` + 初始化沙箱（`index.html` 已引用此路径，**必须在 M1 建好**，否则 `pnpm dev` 白屏）
  - `src/app/App.tsx` —— 根组件：视图状态机调度
  - `src/app/routes.ts` —— 视图枚举
- [x] **1.2 `src/engine/`（Git 执行层）**
  - `src/engine/fs.ts` —— LightningFS 实例与目录初始化
  - `src/engine/gitApi.ts` —— isomorphic-git 薄封装（统一错误）
  - `src/engine/sandbox.ts` —— 仓库沙箱：init / 克隆模板 / 重置
  - `src/engine/errors.ts` —— 业务异常类型（`GitCommandError` 等）
- [x] **1.3 `src/store/`（store 三件套）**
  - `src/store/sessionStore.ts` —— 当前关卡、命令历史、输入
  - `src/store/progressStore.ts` —— 进度 / 得分 / 成就
  - `src/store/viewStore.ts` —— 视图路由状态
- [x] **1.4 样式 token（§9.2）**
  - `src/styles/tokens.css` —— 「时空穿梭 / 星际」主题色：深空背景、星云紫、脉冲蓝、分支用暖橙/青绿；字号/圆角/间距统一由 token 变量控制
  - `src/styles/global.css` —— 全局 reset 与主题

> **M1 暂不创建**：`src/levels/**`（M2）、`src/ui/components/**` 的完整组件集（M2/M4）、`src/persistence/**`（M5）。
> **M1 需要创建**：`src/game/**` 的 `command/` 部分（见阶段 2.5）、`src/__tests__/` 的 5 个测试文件（见阶段 5）。
> §3 的目录规划可作为命名依据。

---

## 阶段 2：Git 执行层实现（§6.1 / §6.2）—— ✅ 已完成

- [x] **2.1 `engine/fs.ts`**：全局单例 LightningFS `fs`，挂载虚拟根目录 `/`（§6.1）
  > 实现上改为**惰性单例** `getFs()` + `configureFs()` 注入入口 + `Proxy` 转发的 `fsp`。原因：模块顶层 `createFs()` 会在 Node 下产生**未捕获的 `ReferenceError`**（详见文末「实测环境事实」第 3 条）。
- [x] **2.2 `engine/sandbox.ts`**：实现 `reset`（§6.1 约定 `sandbox.ts::reset`）
  - 每关开始：清空虚拟根，依据 `LevelInit` 重建
  - 目录约定：`/repo`（玩家主仓库）、`/remote.git`（裸仓库，供第四章用）
  > M1 落地 `files` + `commits`；`branches`/`tags`/`remotes`/`template:'cloneSource'` 属 M4/M5，取 **fail-fast 报错**而非静默忽略（§14 禁止「假装执行」）。
- [x] **2.3 `engine/gitApi.ts`**：**M1 仅需实现 `init` / `add` / `commit`**（外加可视化必需的 `status` / `log`）
  - 全部命令统一走 `gitApi.*`，错误归一为 `engine/errors.ts` 中的业务异常
  - 其余方法（`branch`/`checkout`/`merge`/`reset`/`revert`/`stash`/`tag`/`remote`/`clone`/`push`/`fetch`/`pull`）留待 M4/M5，**不要在 M1 提前实现**
- [x] **2.4 `engine/errors.ts`**：定义 `GitCommandError` 等业务异常
- [x] **2.5 `game/command/`（命令解析，已确认归属 M1）**
  - `src/game/command/tokenize.ts` —— 命令行 token 化（引号 / 空白 / 转义）
  - `src/game/command/grammar.ts` —— 每条命令的参数校验
  - `src/game/command/executor.ts` —— 命令 → `gitApi` 调用编排
  - `src/game/types.ts` —— 核心领域类型（§3 将其置于 `game/` 下）
  - M1 只需覆盖 `init` / `add` / `commit`（含可视化的 `status` / `log`）；其余子命令随 M4/M5 扩展

### 实现注意

- 命令解析**属 M1**（用户已确认），因此 `tokenize.test.ts` 与 `executor.test.ts` 在 M1 就有真实被测对象。
- `practice/server/gitrunner.mjs` 是**浏览器引擎的设计参照**（子命令白名单 + 沙箱纪律），但它是 Node 侧代码，**不可被 SPA 引用**。

---

## 阶段 3：可视化最小闭环 —— ✅ 已完成

M1 验收要求"能 init/add/commit 并可视化"，因此需要一个最小可跑界面。

- [x] **3.1 视图状态机**：`viewStore` 实现 §5 的判别联合
  - `view: 'boot' | 'intro' | 'menu' | 'chapter' | 'level' | 'levelComplete' | 'gameComplete'`
  - M1 只需 `boot`（初始化 LightningFS）与 `level`（承载终端）可用
- [x] **3.2 最小 UI**：为验收所需的组件（可先极简，M2 再按 §9.1 正规化）
  - 终端输入区（`ui/components/terminal/`）
  - 命令历史与输出（`ui/components/history/`）
  - 虚拟文件树（`ui/components/fileTree/`）
  > 另附 `src/ui/components/gitGraph/CommitPanel.tsx`（§9.1 GitGraph 的 M1 极简替代）与 `src/ui/hooks/useCommitHistory.ts`。**`LevelScreen.tsx` 置于 `src/app/` 而非 §3 规划的 `src/ui/components/level/`** —— M1 极简取舍，M2 正规化时应迁移。
- [x] **3.3 打通链路**：输入命令 → `gitApi` 执行 → 状态回显 → 文件树刷新

---

## 阶段 4：测试环境与用例（已确认属 M1）—— ✅ 已完成

- [x] **4.1 引入测试依赖**：`pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom`
  - ⚠️ 具体包与版本以实际需要为准（React 18 对应 `@testing-library/react` v14+）
  > 实装：`vitest@^3.2.7`（**刻意不用 vitest 5** —— 它要求 `vite ^6+`，与本仓库 `vite@^5.4.10` peer 冲突）、`@testing-library/react@^16.3.3`、`@testing-library/jest-dom@^7.0.1`、`jsdom@^30.1.1`，另加 **`fake-indexeddb@^6.2.5`**（理由见文末「实测环境事实」第 2 条）。
- [x] **4.2 配置 Vitest**：在 `vite.config.ts` 中加 `test` 字段（`environment: 'jsdom'`、`globals: true`），或在 §11 所述 `src/__tests__/` 约定下另建配置
  > `defineConfig` 改从 `vitest/config` 导入（最小改动方案）；`setupFiles: ['src/__tests__/setup.ts']`。另需 `src/vite-env.d.ts`（`/// <reference types="vite/client" />`）—— 缺它则全部 `*.module.css` 导入报 TS2307。
- [x] **4.3 加 `test` 脚本**：`package.json` 增加 `"test": "vitest"`（单测运行用 `pnpm vitest run <file>`）
- [x] **4.4 建立 5 个测试文件**（结构完整性优先）：
  - `src/__tests__/tokenize.test.ts` —— 引号 / 转义 / 空白边界（M1 写真实用例）
  - `src/__tests__/executor.test.ts` —— 在 LightningFS 内存实例上跑真实 gitApi，断言副作用（M1 写真实用例）
  - `src/__tests__/scoring.test.ts` —— 占位（评分属 M3）
  - `src/__tests__/targetState.test.ts` —— 占位（依赖 `game/validate/`）
  - `src/__tests__/components.test.tsx` —— 占位（需 UI 成型）
  > 实际用例数超出预期：`tokenize.test.ts` 22 个 + `executor.test.ts` 27 个 = **49 个真实用例**（约 130 断言）；三个占位文件共 34 个 `it.todo`，零失败。
- [x] **4.5 `pnpm test` 可跑通**（占位用例以 `it.todo` / skip 形式存在，不产生失败）

---

## 阶段 5：验收 —— ✅ 已通过（Lead 独立复跑）

- [x] **5.1 `pnpm typecheck`** 通过 —— `tsc --noEmit` 退出码 0
- [x] **5.2 `pnpm dev`** 启动，页面不白屏 —— `vite ready in 103ms`，`index.html` 与 `/src/main.tsx` 均 HTTP 200
- [x] **5.3 手动冒烟**：能执行 `git init` → `git add` → `git commit`，且结果可视化正确
  - 真实输出：`git init` → `已在 /repo 初始化空的 Git 仓库。`；`git add .` → ok；`git commit -m "初始提交：修复时间线"` → `[main 9991113] 初始提交：修复时间线`
  - 副作用：`/repo` 出现 `.git`，`gitApi.log()` 1 条，`status` 为「无文件要提交，干净的工作区」
  - 可视化：页面渲染出提交信息与分支/工作区状态
- [x] **5.4 `pnpm test`** 通过 —— `2 passed | 3 skipped (5)`，`49 passed | 34 todo`，退出码 0
- [x] **5.5 `pnpm build`** 通过 —— `✓ 245 modules transformed`，`dist/assets/index-*.js 457.58 kB │ gzip: 145.23 kB`（在 §12 的 ~350KB 预算内），退出码 0
- [x] **5.6 提交** —— **按用户要求暂不提交**，改动完成待用户确认

> §13 要求"每阶段结束都跑 `typecheck` + `test` + `build`"。`test` 脚本由 4.3 引入。

### 实施结果补充

**实际产出 42 个文件**（超出原清单的部分已在下文说明）。原清单未列出但实际必需的文件：

- `src/vite-env.d.ts` —— `/// <reference types="vite/client" />`。**缺它则全部 `*.module.css` 导入报 TS2307**（共 7 处）。原因见下文「遗留问题」第 1 条。
- `src/ui/hooks/useCommitHistory.ts`、`src/ui/components/gitGraph/CommitPanel.tsx`、`src/ui/components/fileTree/useFileTree.ts` —— 极简 UI 的配套 hook / 面板。
- `src/app/LevelScreen.tsx`、`src/app/ViewPlaceholder.tsx` —— 注意 `LevelScreen` 置于 `src/app/` 而非 §3 规划的 `src/ui/components/level/`；这是 M1 极简实现的取舍，**M2 正规化 §9.1 布局时应迁移**。

**本次执行中修掉的 3 个真实缺陷**（均由 teammate 主动发现并上报，非按清单走能遇到的）：

1. **`gitApi.status()` 对「新增且已暂存」误报 `unstaged:true`** —— 原判据 `workdir===1 && head===1` 把 `head===0` 的新增文件排除在复核之外。会让 M2 的 `workdirClean` 目标误判。
2. **等长改写（`hi\n`→`v2\n`，同为 3 字节）连 `git.status()` 都漏报** —— isomorphic-git 的索引带 stat 缓存（mtime+size），LightningFS 同毫秒改写给出相同 mtime、尺寸又相同 → 判「未修改」。这正是玩家「改一行字」最常见的操作。**改判据为内容哈希比对**（与真 git 同构）后，9/9 场景与真 git 二进制逐一对齐。
3. **删除文件后 `git add -A` 整个命令失败** —— `expandPathspec` 把「工作区已删除」的条目塞进 add 列表，而 isomorphic-git 的 `add` 对缺失路径抛 `NotFoundError`（它不做删除暂存）。**不修则 M5/M6 任何涉及删除文件的关卡都无法完成**（删除永远无法暂存、也就无法提交）。已按 `workdir === 'deleted'` 分流到 `gitApi.remove()`。

**`git status --short` 渲染对齐真 git**：`renderStatus` 的第一列须结合 `head` 判断（`head=0`+`stage≥2` 才是 `A`，`head=1` 时是 `M`），第二列在「暂存删除」时应抑制（真 git 是 `D ` 而非 `DD`）。最终 11/11 场景与真 git 逐一对齐。

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

## ⚠️ 实测环境事实（订正 `M1-preflight-DONE.md` §3 的两条结论）

以下均经**运行时对照实验**得出（非文档转述）。两条与原结论**相反**，M2+ 务必以此为准。

### 1. LightningFS 的 `db` / `backend` 是**两层**选项，不是一个选项的两种写法

lightning-fs@4.9.0 的两层结构与各自的选项名：

| 层级 | 选项名 | 源码位置 | 接受的接口 |
|---|---|---|---|
| `PromisifiedFS`（顶层） | **`backend`** | `src/PromisifiedFS.js:106` → `options.backend \|\| new DefaultBackend()` | 完整 FS 后端（`mkdir`/`stat`/`readdir`/`rename`…） |
| `DefaultBackend`（内部） | **`db`** | `src/DefaultBackend.js:24,32` → `db = null` … `db \|\| new IdbBackend(...)` | `FS.IDB`（`saveSuperblock`/`loadSuperblock`/`readFile`/`writeFile`/`unlink`/`wipe`/`close`） |

`MemoryBackend` 实现的是 **`FS.IDB`**，即内层 `db` 的接口 —— 所以**只有 `{ db: MemoryBackend }` 能跑通**：

```
{db: MB}              OK   _backend=DefaultBackend  _idb=MemoryBackend
{backend: MB}         FAIL TypeError: this._backend.mkdir is not a function
{} 默认                FAIL ReferenceError: indexedDB is not defined
```

> **订正 §3.2**：原文称「选项名是 `db`，不是 `backend`；`index.d.ts` 把 `db` 错标为 `backend`」——**方向说反了**。顶层读的是 `backend`；`index.d.ts:316` 的 `db?: FS.IDB` 标的正是 `DefaultBackend` 层，并没错标。「`{db}` 之所以生效」的真实机理是：`PromisifiedFS._init()` 在选定 `_backend` 后，会把**整个 `options`** 传给 `DefaultBackend.init(name, options)`（`PromisifiedFS.js:108`），在那里被解构成 `db`。
>
> `engine/fs.ts` 的 `createFs` 因此保持对外字段名 `backend`、内部作为 `db` 传下去（`FsIdb` 类型名 + `FsBackend` deprecated 别名），并已在注释中写明。

### 2. 真正的测试环境坑是 `navigator.locks`，不是 indexedDB 本身

`DefaultBackend.init()` 必建一把锁（`src/DefaultBackend.js:33`）：

```js
this._mutex = navigator.locks ? new Mutex2(name) : new Mutex(lockDbName, lockStoreName);
```

- `Mutex2`：用 Web Locks，纯内存，**不需要 indexedDB**
- `Mutex`：用 `@isomorphic-git/idb-keyval` → **需要 indexedDB**

实测环境差异 —— **这解释了两个 teammate 对同一份代码得出相反结论的原因**：

| 环境 | `navigator.locks` | `indexedDB` | 走哪把锁 | `{db: MemoryBackend}` |
|---|---|---|---|---|
| 纯 Node 26 | ✅ `object` | ✗ | `Mutex2` | ✅ **可用** |
| jsdom 30（Vitest 配置） | ✗ **undefined** | ✗ | `Mutex` | ❌ `indexedDB is not defined` |

**对策（已落地）**：`pnpm add -D fake-indexeddb` + `src/__tests__/setup.ts` 顶部 `import 'fake-indexeddb/auto'`。正负对照实证：注释掉即 3 failed，恢复即 3 passed。
> 注意：`{db: MemoryBackend}` **仍会构造 `DefaultBackend`**，因此**仍要过 Mutex 这一关** —— `MemoryBackend` 只替换 `_idb`，并不绕过锁。故 `fake-indexeddb` 对「注入 MemoryBackend」与「用默认 IdbBackend」两条路都是必需的。

**验证脚本务必用 plain Node 跑**（`node x.mjs`），**不要用 vitest/jsdom** —— 否则会因上述差异得到误导性结论。脚本须放在**仓库内**，否则 `node` 解析不到 `@isomorphic-git/lightning-fs`（`ERR_MODULE_NOT_FOUND`）。

### 3. 模块顶层构造 LightningFS 会产生**未捕获**异常

`export const fs = createFs()` 这种写法是错的。`new LightningFS(name, opts)` 构造即 `init`，且在未传 `defer` 时会**不 await 就触发 `stat('/')`**（`PromisifiedFS.js:122`）；顶层构造的那次异步调用在纯 Node 下会变成**未捕获的 `ReferenceError: indexedDB is not defined`** —— 事后用 `{db}` 重新 init 单例也救不回来。

`engine/fs.ts` 因此改为：`getFs()` 惰性创建 + `configureFs()` 替换单例 + `fsp` 用 `Proxy` 实时转发（替换单例后已导入的模块仍有效）。`gitApi` 也统一改成**调用时**才 `getFs()`。

### 4. `LightningFS.promises.writeFile` **不自动创建父目录**

实测写 `/repo/b/c.txt` 且 `/repo/b` 不存在时抛 `ENOENT`。`sandbox.ts` 已加 `ensureParentDirs()` 逐级补齐 —— 否则 `LevelInit.files` 里的嵌套路径（如 `notes/intro.md`）会直接失败。**M2 关卡数据会大量用到，务必知悉。**

### 5. 其他

- `LightningFS` 有未释放句柄，Node 脚本跑完不会自动退出 —— 加 `process.exit(0)` 即可，不是错误。
- 该包**无 `exports` 字段**，ESM 下用命名导入 `import { MemoryBackend } from '@isomorphic-git/lightning-fs'`（运行时可解析），但**类型不过**（`index.d.ts` 是 `export = FS`，未声明该具名导出）→ 需 `import * as NS` + 类型断言。这是**第三方包的类型缺陷**。
- 该包**不能开 `esModuleInterop`**，否则 `import type { FS }` 报 TS2595；`fs.ts` 用 `InstanceType<typeof LightningFS>` 反推实例类型规避。

---

## 遗留问题（不影响 M1 验收，建议后续处理）

1. **`tsconfig.json` 的 `types` 白名单会屏蔽 `vite/client`** —— T1 设了 `types: ["vitest/globals", "@testing-library/jest-dom"]`，而 `vite/client` 提供 `*.module.css` 的模块声明。M1 靠新增 `src/vite-env.d.ts`（`/// <reference types="vite/client" />`）解决。**M2 若引入 `import.meta.env` 等其他 Vite 特性，需注意同一处。**
2. **`git status --short` 无法区分「未 init」与「初生仓库」** —— 实测：无 `.git` 的目录上 `git status` 仍返回「位于分支 main / 无文件要提交，干净的工作区」，`unborn` 亦为 `true`。经 executor 通道两者不可区分。UI 因此**删掉了臆造的 `initialized` 标志**（它会恒为真，把文件树永久锁在空态）。若 M2 需要真区分，需在执行层加接口。
3. **`practice/` 与 `README.md` 结构树仍过时**（`AGENTS.md` 已记录），本次未动。

---

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
