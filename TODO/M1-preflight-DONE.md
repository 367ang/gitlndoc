# M1 前置检查清单

> 面向"进入 M1 阶段前"的环境与配置核查。所有结论均经实机验证，非文档转述。
> 时间基点：`origin/main` = `91e287d` + 本地未提交的前置改动。
>
> **状态：阻塞项已全部解除，决策项已全部确认。可以开工。**

---

## 一、阻塞项（均已解决）

### 1.1 ✅ Node.js / pnpm 不在默认 PATH —— 已定位并记录

| 项 | 事实 |
|---|---|
| 沙箱 shell 的 PATH | `/usr/bin:/bin:/usr/sbin:/sbin`（**不含 Homebrew**） |
| 不加 PATH 时 | `node` / `npm` / `pnpm` 均报 `command not found` |
| 实际安装位置 | `/opt/homebrew/opt/node/bin`（Homebrew 已装 `node`、`node@22`、`node@24`、`node@26`）、`/opt/homebrew/bin/pnpm` |
| 验证结果 | 加 PATH 后 → `node v26.9.0`、`npm 11.19.1`、`pnpm 12.5.1` ✅ |

**每个新会话的第一条 Node 相关命令前，必须先导出**：

```bash
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
```

> ⚠️ 这是**环境性**问题，不是"没装 Node"。同一根因也会导致 `gh` 不可见（影响 git push）。
> 新会话若不处理，极易误判为"未安装"进而重复安装。此说明已同步写入 `AGENTS.md`。

### 1.2 ✅ 缺失的两个运行时依赖 —— 已安装

`development-refinement.md` §1 要求但 `package.json` 原先未声明，现已补齐：

| 依赖 | 文档依据 | 现已安装 | 用途 |
|---|---|---|---|
| `zustand` | §1 技术选型（`^5`）、§2 架构图 | `5.0.15` ✅ | store 三件套（M1 核心产出） |
| `@isomorphic-git/lightning-fs` | §1 技术选型、§6.1 沙箱 | `4.9.0` ✅ | `engine/fs.ts`（M1 核心产出） |

> **包名已核实**：文档 §1 写作 `@isomorphic-git/lightning-fs` 是**正确的**；裸包名 `lightning-fs` 在 npm 上返回 404。`zustand` 最新 `5.0.15` 满足文档要求的 `^5`。

### 1.3 ✅ 依赖安装与 lockfile —— 已完成

- **包管理器：pnpm（用户已确认）**，与工程文档 §12 的技术选型一致。
- `pnpm-lock.yaml`（约 51KB）已生成，**应提交入库**。
- `node_modules/` 已安装（约 221M），被 `.gitignore` 正确忽略。

### 1.4 ✅ esbuild 构建脚本授权 —— 已处理

pnpm 12 默认阻止依赖的 postinstall，首次安装报 `ERR_PNPM_IGNORED_BUILDS`（`esbuild@0.21.5`）。

- 实测确认：即便未授权，**最小 vite 构建仍返回 `BUILD_OK`**，不阻断开发。
- 但仍显式放行以使配置规范化，`pnpm-workspace.yaml` 内容为：
  ```yaml
  allowBuilds:
    esbuild: true
  ```
- 重跑 `pnpm install` 后 postinstall 正常执行。**该文件不可删除**，否则警告复现。
- ⚠️ 注意：esbuild 是 vite 的传递依赖，pnpm 严格隔离下它**不会**出现在顶层 `node_modules/.bin/`，这是正常的，不代表安装损坏。

---

## 二、已确认的决策（用户拍板）

| # | 事项 | 决定 |
|---|---|---|
| 1 | 包管理器 | **pnpm**（修正了 `AGENTS.md` 中此前误写的 npm） |
| 2 | 测试框架 | **M1 引入**；Vitest + @testing-library/react；**5 个测试文件全部建立**以保证结构完整 |
| 3 | 命令解析归属 | **M1**（`game/command/` 的 `tokenize` / `grammar` / `executor`，不用临时直通方案） |
| 4 | persistence | **M5 落地**，M1 不实现 |

详细展开见 `TODO/M1-tasks-TODO.md` 的「已确认的决策」章节。

---

## 三、环境一致性核查（全部通过）

| 检查项 | 结果 |
|---|---|
| `index.html` 引用 `/src/main.tsx` | ✅ 与 §3 规划一致；**M1 必须建此文件**，否则 `pnpm dev` 白屏 |
| `tsconfig.json` `include: ["src"]` | ✅ 合理；`src/` 存在前 `pnpm typecheck` 无实际意义（当前可跑通，因无输入文件） |
| `tsconfig.node.json` `include: ["vite.config.ts"]` | ✅ 覆盖正确，`references` 配置自洽 |
| `vite.config.ts` 预打包 `isomorphic-git` | ✅ 已含 `optimizeDeps.include`，符合 §12 体积/tree-shaking 关切 |
| `build.target: es2020` | ✅ 与 `tsconfig` 的 `target: ES2020` 一致 |
| `.gitignore` 生效 | ✅ 实测 `git check-ignore node_modules` 命中 |
| git 身份 | ✅ 仓库级已配置 `367ang <sxl_367@outlook.com>` |
| 工具链可用 | ✅ `pnpm typecheck` 通过（退出码 0）；`vite` / `tsc` 可执行 |

### 3.1 ✅ 核心链路实机验证（重要）

不只是"依赖装上了"，而是**实测跑通了 M1 的核心技术路径**：

```js
import LightningFS from '@isomorphic-git/lightning-fs';
import { MemoryBackend } from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

const fs = new LightningFS('test', { db: new MemoryBackend() });
// mkdir → git.init → writeFile → git.add → git.commit → git.log  全链路成功
```

**验证结论**：
- `git.init` / `add` / `commit` / `log` / `statusMatrix` 均工作正常；
- 提交信息支持中文（实测 `首次提交` 正确写入）。

### 3.2 ⚠️ 关键发现：LightningFS 后端的正确用法

这是实施 M1 时必须知道的细节，**容易踩坑**：

| 项 | 说明 |
|---|---|
| **默认后端** | `IdbBackend`，依赖浏览器的 `indexedDB`。**在纯 Node 环境会抛 `ReferenceError: indexedDB is not defined`** —— 这不是缺陷，是预期行为 |
| **选项名是 `db`，不是 `backend`** | 传 `{ backend: ... }` 会被静默忽略，随后报 `this._backend.saveSuperblock is not a function` |
| **测试用内存后端** | `new LightningFS(name, { db: new MemoryBackend() })` —— 这正是 §11.1 所说"测试用 LightningFS 内存实例"的实现方式 |
| **导入方式** | 包无 `exports` 字段，子路径需按 CommonJS 解析（`require('.../src/MemoryBackend.js')`）；ESM 下用命名导入 `{ MemoryBackend }` |

**对 M1 的影响**：`executor.test.ts` 可直接用 `MemoryBackend`，**无需 `indexedDB` polyfill**（如 `fake-indexeddb`），也不必强依赖 jsdom 的 IndexedDB 支持。这降低了测试环境配置的复杂度。

### 3.3 ✅ 浏览器侧打包实测

用一个引用全部核心依赖（`isomorphic-git` + `lightning-fs` + `zustand` + `react`）的入口做真实构建：

- **打包成功**，产物约 **265.5 KB**（未压缩）
- 低于 §12 的 ~350KB 预算（gzip 后会更小）
- 说明 `vite.config.ts` 现有配置足以支撑 M1

---

## 四、实施步骤（更新版）

```text
步骤 1：导出 PATH（每个新会话必做）
        export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
        验证：node -v && pnpm -v          → v26.9.0 / 12.5.1

步骤 2：依赖已就绪，如需重装
        pnpm install                      # 不要用 npm
        验证：node_modules/ 存在；pnpm-lock.yaml 未变

步骤 3：建立 src/ 骨架（§3）
        含 main.tsx、app/、engine/、store/、styles/
        验证：pnpm typecheck 通过

步骤 4：实现 engine 层 + game/command/ 命令解析（均属 M1）
        验证：可在浏览器跑通 init/add/commit

步骤 5：实现 store 三件套 + 最小 UI
        验证：pnpm dev 不白屏，命令回显与文件树正确

步骤 6：引入 Vitest 环境，建立 5 个测试文件
        验证：pnpm test 通过（占位用例不失败）

步骤 7：阶段验收
        pnpm typecheck && pnpm test && pnpm build
        验证：全部通过；手动冒烟 init→add→commit 可视化正确

步骤 8：提交（中文描述，见 AGENTS.md）
        验证：git status 仅含预期文件
```

---

## 五、检查过程中的意外操作（均已处理）

1. **pnpm 意外触发下载**：执行 `pnpm node --version` 时 pnpm 自动安装依赖，创建了不完整的 `node_modules/`。已终止后台任务并删除残留。
2. **npm 缓存探测残留**：验证 npm 可行性时创建了 `.npm-cache/`（732K）。确定改用 pnpm 后已删除。
3. **vite 构建探测**：为验证 esbuild 可用性，临时创建 `.vite-probe.mjs` / `probe-entry.js`，验证得 `BUILD_OK` 后已清理。

三次操作均**未污染 git**，工作区最终仅含预期的改动文件。

---

## 六、参考

| 内容 | 位置 |
|---|---|
| M1 任务清单（分阶段） | `TODO/M1-tasks-TODO.md` |
| 仓库约定与当前状态 | `AGENTS.md` |
| 技术选型 / 架构 / 目录结构 | `development-refinement.md` §1、§2、§3 |
| 视图状态机 | §5 |
| 沙箱与 gitApi 封装 | §6.1、§6.2 |
| 持久化设计（M5） | §10 |
| 测试策略 / 构建门禁 | §11、§12 |
| M1 里程碑定义 | §13 |
| 沙箱白名单设计参照（Node 侧） | `practice/server/gitrunner.mjs` |
