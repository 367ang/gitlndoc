# M8 任务：发布收口（阶段 A）—— v1.0.0

> M7 交付的是**发布候选**；本里程碑是用户拍板的「阶段 A：正式发布」—— 发布验收复核、
> 部署基建（CI + GitHub Pages）、版本定格 v1.0.0、文档收口。
> 依据：M7-tasks.md §七「无阻塞遗留」；本目录命名约定见 README.md（文件名不带状态后缀）。

## 目录

- [一、任务与执行结果](#一任务与执行结果)
- [二、验收 / 三门禁](#二验收--三门禁)
- [三、实测环境事实](#三实测环境事实)
- [四、遗留与移交](#四遗留与移交)

---

## 一、任务与执行结果

### 阶段 1：发布验收复核（本地）

在 M7 之后、动任何发布基建之前，对 main（`e1a8293 feat: M7 打磨、调参、E2E —— 发布候选`）做一次**全量重放**：

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 0 错误 |
| `pnpm test:run` | **410 passed**（12 文件），0 todo |
| `pnpm build` | 195.6 kB gzip（3 chunk，无警告；fs.ts dynamic-import 提示为 M7 已记录的 info 级既有现象） |
| `pnpm e2e` | 2 passed（主链路两用例） |
| 七段 CDP 冒烟 | **152/152**（8 + 8 + 15 + 41 + 33 + 25 + 22，每段独立全绿） |

**结论：main 处于真实可发布状态**，M7 记录的数字在发布时点可复现。

### 阶段 2：部署基建（`.github/workflows/`）

1. **[ci.yml](../../.github/workflows/ci.yml)** —— CI 门禁：push(main)/PR 触发，
   `pnpm install --frozen-lockfile` → `typecheck` → `test:run` → `build` → Playwright E2E。
   版本钉 node 26 / pnpm 12.5.1（与开发机实测一致）。
   **分段 CDP 冒烟不进 CI**：依赖本机 Chrome 路径发现（`/Applications/...`），属 macOS 本机
   验收，继续按 `tools/smoke/README.md` 的方法人工执行。
2. **[deploy-pages.yml](../../.github/workflows/deploy-pages.yml)** —— GitHub Pages 部署：
   push(main) / 手动触发，`pnpm build --base /gitlndoc/`（**CLI 注入前缀，不改 vite.config.ts**
   —— 本地 dev/build 行为不变）→ upload-pages-artifact → deploy-pages。
   **前置条件：仓库 Settings → Pages 的 Source 须选「GitHub Actions」**。
3. **base 前缀构建实测**：`pnpm build --base /gitlndoc/` 产物抽查通过 ——
   `dist/index.html` 的脚本/样式均带 `/gitlndoc/assets/...`；动态分块
   （`resumeLevel` → react-vendor/git-engine）经 Vite preload helper 的路径解析函数
   注入同一前缀（产物内 `Sr=function(e){return"/gitlndoc/"+e}` 实测确认）。

### 阶段 3：版本定格

`package.json` `0.1.0` → **`1.0.0`**。

### 阶段 4：文档收口

1. **README.md**：「当前进度」停留在「M1–M4、14 关、228 tests」（M4 时期旧账）——
   更新为 v1.0.0 / 32 关 / 410 tests 现状；目录树补齐 M5–M7 期间新增的冒烟脚本
   （ch5/ch4/ch6/final）、`e2e/`、`.github/workflows/`；「9 篇笔记」三分类从「待接入」
   改为全接入现状（ch4/ch5/ch6/最佳实践已落地）；里程碑文档表补 M5/M6/M7/M8 行；
   新增「在线游玩」节（Pages URL）。
2. **development-refinement.md §3**：「章节命名双轨（⚠️ 待统一）」已过时 ——
   代码侧 `ChapterMeta.title` 实际在 M5/M6 已按 GDD 统一（M5-tasks.md §6 有当时记录），
   本节订正为「章节命名（✅ 已统一）」并留历史注记。
3. **docs/milestones/README.md**：索引表补 M8 行 + 三门禁历史表补 M8 行。
4. **AGENTS.md**：「当前状态」更新为 v1.0.0 发布事实 + 本页指针。

### 阶段 5：发布动作（main 上执行）

1. 提交上述全部变更（`feat: 发布收口 —— CI、GitHub Pages 部署、v1.0.0`）。
2. 推送 main（**M5b 起 main 领先 origin，M6/M7 两笔提交此行一并上远端**）。
3. 打 tag **`v1.0.0`**（annotated，推送到 origin）—— 仓库此前 0 个 tag，这是首个版本锚点
   （与 GDD 6-5「语义化版本」的教学主题自洽）。
4. 在 GitHub 仓库 Settings → Pages 启用「GitHub Actions」来源，触发/确认
   deploy-pages 工作流，线上 URL 验证。

---

## 二、验收 / 三门禁

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` | 0 错误 |
| `pnpm test:run` | 410 passed（12 文件），0 todo |
| `pnpm build` | 195.6 kB gzip（3 chunk，无警告） |

（发布收口不改任何 `src/` 代码，三门禁数字应与 M7 一致；实跑确认。）

## 三、实测环境事实

1. **E2E 的 webServer 会把 dev server 留在后台**：`pnpm e2e` 结束后 5199 端口仍有
   vite 在听（`reuseExistingServer: true` 的产物）。之后手工再起 `pnpm dev --port 5199`
   会报 `Port 5199 is already in use` —— 冒烟前先 `lsof -nP -iTCP:5199 -sTCP:LISTEN`
   确认属主，健康即复用，不必重启。
2. **CI 冒烟边界**：七段 CDP 冒烟的 Chrome 发现逻辑写死了本机
   `/Applications/Google Chrome.app/...` 路径，ubuntu runner 上跑不了；CI 只覆盖
   jsdom 单测 + Playwright E2E，真机冒烟仍是发布前人工步骤。
3. **`pnpm build --base` 与动态分块**：CLI 传 base 时，Vite 会把前缀同时注入
   preload helper 的路径解析函数（产物内可见 `"/gitlndoc/"+e`），动态 import 的
   三个 chunk 均可正确解析 —— 不必为 base 改 vite.config.ts。

## 四、遗留与移交

- **无阻塞遗留**。可选后续方向（不构成承诺，承接 M7 §七）：
  - `git tag -l <pattern>` 与嵌套 tag 解引用（需第七章扩容再评估）；
  - Playwright 扩展到半拼/自由模式关卡（当前由 CDP 冒烟覆盖）；
  - `remoteTag` 目标类型（「标签已推送」判定，需新增 TargetCondition）；
  - CI 中补「Pages 部署后 URL 冒烟」（当前线上验证为发布时点的一次性人工步骤）。
