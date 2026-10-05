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

**M1（地基）～ M8（发布收口）全部完成，项目已正式发布（v1.0.0，GitHub Pages）**。M1–M7 为规划里程碑（M7 = 发布候选：提示分级扣分 + 星级分数主轴 + undoable 收窄 + 设置开关 + 32 关可达性总回归 + Playwright E2E + 真机终章/perfect-game 验收 + code-split）；**M8（非规划内，用户拍板的「阶段 A」）完成发布验收复核（三门禁 + E2E + 七段冒烟全量重放）、CI 门禁（`.github/workflows/ci.yml`）、GitHub Pages 部署（`deploy-pages.yml`，`--base /gitlndoc/`）、版本定格 `package.json` 1.0.0 与文档收口**，记录见 `docs/milestones/M8-release-tasks.md`。三门禁当前为 **`typecheck` 0 / `test` 410 passed（12 文件）/ `build` 195.6 kB gzip（3 chunk 无警告）**（M8 实测，与 M7 一致 —— 发布收口不改 `src/`）。全游戏 **32 关可玩**（ch1:4 + ch2:4 + ch3:6 + ch4:5 + ch5:6 + ch6:5 + F:2）。

⚠️ **M7 的两条计分口径变更（后续动关卡数据 / 计分层前必读，详见 M7-tasks.md §二）**：

- **`undoable` 名单已收窄**：只有 `reset`（三模式）与 `checkout -- <path>` 记惩罚；
  `revert` / `restore` 是教学正解（历史只增 / 精确恢复），**不再记 undoable**。
  新增撤销类命令时按「回退型 vs 修复型」归类，不要照 §6.2 的旧字面清单。
- **星级走分数主轴**（GDD §5.2）：★ ≥ winScore；★★ ≥ 0.7·baseScore；
  ★★★ ≥ 0.9·baseScore 且 0 提示。撤销经 undoPenalty 影响落段、**不锁星**。
  提示扣分按层级分档（方向 1× / 命令 2× / 完整答案 4× hintPenalty，GDD §5.1）。
- **新增关卡时 `winScore ≤ 85`**（「用满提示照完整答案执行」的最坏得分
  = base 100 + optimal 20 − 35；若教学剧本含撤销罚分等需另行推导，
  1-4 与 5-6 是先例）。

各里程碑的**产出、三门禁历史、实测环境事实与遗留移交**见 **`docs/milestones/README.md`**（索引）与 `docs/milestones/M*-tasks.md`（各期详情），本文件不复述。

⚠️ **动 `engine/` 或做真实浏览器验收前，务必先读 `docs/milestones/M2-tasks.md` §4「实测环境事实」、`M3-tasks.md`「实测环境事实」、`M4-tasks.md`「执行结果」** —— 下述教训均为实测所得，违反即踩坑：

1. isomorphic-git 的 ff merge **只移 ref 不更新工作区**（merge 后必须补 checkout）；`git rm` 对 untracked 文件静默成功但什么都不做（已拦截）；**无 rebase 命令**（组合实现「搬 tree」，相交改动场景与真 git 不等价 —— 关卡数据须避开）。
2. **「`git init` 创建仓库」类目标无法用状态判定表达**（`reset()` 总会先 init，且 `git init` 幂等）；纯只读命令（`status`/`log`/`diff`）关卡的目标须锚定「玩家用该命令前后必须做到的事」。
3. **jsdom 的 `fireEvent.change` 不受 `readOnly` 限制**，会掩盖「玩家无法输入」类缺陷；涉输入/编辑行为**必须真实浏览器验证**。本机验收需 `--no-sandbox --disable-crashpad`，键盘输入走 CDP `Input.insertText`。
4. LightningFS 对**目录**调 `readFile` 返回 `null` 而非抛错，判存在性必须用 `stat`。
5. `evaluateTarget` 接收 `options`（branch/merged/logOrder 需读仓库）；关卡预置提交**每个都必须带 files**（空提交防御），`on` 缺省回 main。

**M5a 新增的引擎事实（第五章「时空回溯」的全部依据）：**

6. **`resolveRef` 不支持任何 ref 表达式**：`HEAD~1` / `HEAD^` / `HEAD@{n}` / 短 hash **全部抛 `NotFoundError`**（逐一实测）。`engine/refExpr.ts` 为此自研；短 hash 可经 `git.expandOid` 还原。**第五章的核心命令（`git reset --soft HEAD~1`、`git reset --hard HEAD@{n}`）全依赖这一层。**
7. **`HEAD@{n}` 的语义 =「倒数第 n+1 条 reflog 记录的 `to`」**（以真 git 的 `git rev-parse HEAD@{n}` 实测校准）。曾误以为要取 `from`，导致恢复剧本接到错误提交 —— ⚠️ 单看 `@{0}` 恰好也对，**只有 `@{1}` 会露馅**。
8. **`git commit({ amend: true })` 可用，但不复刻真 git 的「无内容可修补」拒绝**：真 git 报 `You have nothing to amend`，isomorphic-git 照样产出新提交 —— M5a 已在 `gitApi.commit` 补空修补防御（复用 `status()` 的 `staged` 判据）。
9. **`reset` 三模式的底层组合**（实测与笔记 `git-undo.md` 的模式对比表逐格吻合）：`--soft` = 只 `writeRef`；`--mixed` = `writeRef` + **逐文件** `git.resetIndex({ filepath })`（⚠️ 省略 `filepath` 抛 `MissingParameterError`）；`--hard` = `writeRef` + `checkout({ force: true })`。
10. **`LevelInit.dirty`（M5a 新增字段）**：`commits` 只能预置「已归档的正确状态」、`files` 只能预置「未追踪的新文件」，**都无法表达「已追踪文件的工作区被改写 / 被误删」** —— 而第五章的叙事前提正是「错误已经发生」。`dirty` 在所有预置提交之后执行；`null` 值走 `fsp.unlink` 而非 `git rm`（后者会把删除记进索引，玩家就不需要「恢复」了）。
11. **测试环境的 `localStorage`**：本仓库的 jsdom（30.x）**不提供 `window.localStorage`**（`typeof localStorage === 'undefined'`，不是抛错）。`src/__tests__/setup.ts` 已注入内存垫片，**不可删**（与 `fake-indexeddb/auto` 同理）。
12. **`smoke` 脚本必须在开头 `resetStorage()`**：M5a 起进度落 localStorage，上次冒烟留下的记录会被下次读到（段3 的「无进度时 ch2 锁定」因此失败，实测）。
13. **不要给 LightningFS 换实例**（M5a 已否决并移除 `mountFs`）：切换出的新实例上 isomorphic-git 的写入会**静默丢失**（`git.init` 返回成功但 `.git` 没落盘）—— 其 `_activate()` 是逐操作惰性异步的，任何等待/读同步点都无法可靠消除该竞态。仓库快照因此走 `persistence/snapshot.ts` 的**显式导出/导入**（fs 单例不动，遍历虚拟根 → 单一 IndexedDB 库 `gtp:snapshots:v1` → 恢复时按「父先于子」写回）；`gtp:active-level:v1` 记「正在哪一关」，boot 的恢复分支**绝不调 `sandbox.reset()`**。

**M5b 新增的引擎事实（第四章「星际连接」的全部依据）：**

14. **远程宇宙 = 内存裸仓库 + 进程内 smart-HTTP 服务端**（`engine/fileRemote.ts`）。
    ⚠️ 关键认知：**isomorphic-git 的 `fetch`/`push`/`clone` 都接受自定义 `http` 客户端，
    且已完整实现智能 HTTP 的「客户端」侧** —— 故我们只需实现**服务端**应答，
    不必自写协议编解码器。走的是真协议、真 pkt-line、真 packfile。
15. ⚠️ **`git.packObjects({ oids })` 不做可达性递归**（本里程碑最费时的坑）：
    只传提交 oid 会得到「只有提交对象」的残缺 pack —— fetch 协商成功、ref 也建好了，
    但一检出工作区就报 `NotFoundError: Could not find <tree oid>`。
    **服务端必须自己走图**（`collectReachableObjects`：commit → tree → 子树/blob + 祖先提交）。
16. ⚠️ **`git.readObject` 没有 `'parsed'` 格式**（只接受 `deflated`/`wrapped`/`content`，
    传错抛 `InternalError`，TS 类型也不拦）；要读结构化对象须用
    `git.readCommit` / `git.readTree`。另：**`readTree` 返回的 `tree` 就是条目数组**
    （`TreeObject = TreeEntry[]`），**不是**带 `.entries` 的对象。
17. ⚠️ **ref advertisement 必须同时有 `HEAD` 行与 `symref=HEAD:refs/heads/<分支>` capability**：
    少 HEAD → 多分支 fetch 报「找不到指定的文件或提交」；
    有 HEAD 但无 symref → HEAD 被当普通 ref，`refs/remotes/origin/main` **根本没建立**
    （fetch 不报错，随后的 `git merge origin/main` 才报「找不到」）。
    以 `git upload-pack --advertise-refs` 实测校准。
18. ⚠️ **`indexPack` 的 `filepath` 必须是相对 `dir` 的路径**：内部无条件 `join(dir, filepath)`，
    传绝对路径会双拼，且 `FileSystem.read` 把 ENOENT **静默吞成 `null`**，
    最终报 `TypeError: Cannot read properties of null`（与真因毫无关系）。
19. ⚠️ **远程 URL 必须长得像 http**：`GitRemoteManager` 只注册了 `http`/`https` 两个 transport，
    任何 `file://` 都抛 `UnknownTransportError`。沙箱地址因此定为
    `http://sandbox/remote.git`（`gitApi.ALLOWED_REMOTE_URL`），
    **白名单是必要的** —— 实测 `git.addRemote` 自己不做任何 URL 校验。
20. ⚠️ **`git.clone` 前必须清空目标目录**：`/repo` 已被 `sandbox.reset()` 初始化过，
    直接在已有仓库上 clone 会报与真因无关的 `NotFoundError`。
21. ⚠️ **`git push` 会自行检测非快进**并抛 `PushRejectedError`
    （`data.reason: 'not-fast-forward'`）；服务端也按真 git 的
    `receive.denyNonFastForwards` 语义做一次判定。两条路径都要保留。
22. ⚠️ **新增章节时必须同时补三处**，缺一即「命令能执行但玩家拼不出来」：
    ① `grammar` 白名单；② `executor` 分发；③ **`fragments.ts` 的本章片段表
    + `COMMON_GIT_SLOT` 里该章每个命令组的 slot0**（缺 slot0 会让
    `draftFromSkeleton` 静默返回空草稿、执行按钮恒灰）。`inputMode.test.ts` 有回归锁。
23. ⚠️ **冒烟脚本不要用 `import('/src/store/*.ts')` 读应用状态**：经 CDP `evalJs`
    拿到的**不是应用正在用的模块实例**（实测 `sameModule === false`），
    其 `history`/`view` 恒为初始态，断言会稳定假失败。
    一律改为读 **DOM**（`data-testid="command-history"` 等渲染结果才是事实来源）。

**M6 新增的引擎事实（第六章「历史锚点」与终章的全部依据，详见 M6-tasks.md §五）：**

24. ⚠️ **注解标签必须走 `git.annotatedTag()`**：isomorphic-git 1.27 的 `git.tag()`
    **根本不接收 message 参数**（源码确认 + 探针实测），传了也只产轻量标签，
    `readTag` 随即抛 `ObjectTypeError`（ref 指向的是提交）—— 坑的外观是
    「-a -m 静默变成轻量标签」。
25. ⚠️ **`readTag()` 返回 `{ oid, tag: TagObject, payload }`**：标签名在 `.tag.tag`、
    目标提交在 `.tag.object`（peel 一层即够）。轻量标签的 `readTag` 必然抛
    `ObjectTypeError` —— 这是「注解/轻量两分法」的判定依据，不是异常路径。
26. **tag 推送走真协议全链路可行**：`git.push({ ref: '<tag名>' })` 经 `refpaths`
    解析为 `refs/tags/<名>`，tag 对象由 `listCommitsAndTags` 一并打包；
    旧标签重推被客户端拒（`PushRejectedError('tag-exists')`，与真 git 同义）。
27. ⚠️ **push 的分支参数不能用 `resolveRef` 判定是否为标签**：`resolveRef` 对未知
    名字按「完整引用名」回退（`v1.0` → `refs/tags/v1.0`），会把标签误判成分支；
    二义性判定必须查 `listTags` 名字表。
28. ⚠️ **`sandbox` 收尾检出位置的例外必须显式声明**（`LevelInit.stayOnBranch`）：
    隐式规则（「最后一条预置在哪个分支就停哪」）实测破坏 ch3-2/ch3-3/ch4-3/4-5
    四关的既有前提 —— 谁需要例外谁声明，其余关卡恒回 main。
29. ⚠️ **合并冲突需要「两侧都改且内容不同」**：只有 feature 一侧改过文件时 merge
    是安静的三方合并 —— F-1 因此在 main 侧也预置了一次信标改写。

> 另需注意：`development-refinement.md` §8 的「主要命令集」列曾与 GDD 不一致 —— 第一章被误写为 `init, status, log`、第二章被误写为 `add, commit, .gitignore`，**已于 M2 开工前按 GDD 订正**为「一：`init, add, commit`」「二：`status, diff, log, rm, .gitignore`」。§8 是逐章核对过的，其余行与 GDD 一致（个别概括性差异，如三章未列 `switch`、六章列了 `show`/`describe`，属「主要命令」的合理列举）。**若再改 §8，务必与 `game-design.md` 第 4 节的关卡表逐行比对。**

## 命令

```bash
pnpm dev             # Vite 开发服务器（HMR）
pnpm build           # tsc -b && vite build（构建包含类型检查）
pnpm preview         # 预览生产构建产物
pnpm typecheck       # tsc --noEmit（不产出文件的快速类型检查，提交前运行）
pnpm test            # Vitest（watch 模式）；CI/单次运行用 `pnpm test:run` 或 `pnpm vitest run <file>`
pnpm e2e             # M7 新增：Playwright 主链路 E2E（自动起 dev server + Chromium；浏览器在工作区 .playwright-browsers/）
pnpm smoke:legacy    # 真实浏览器冒烟（真实 Chrome + CDP）；七段独立运行，见 tools/smoke/README.md
pnpm smoke:ch2
pnpm smoke:ch3
pnpm smoke:ch5       # M5a 新增（第五章六关 + 持久化/刷新恢复复核）
pnpm smoke:ch4       # M5b 新增（第四章五关 + 远程协议 + 协作冲突剧本）
pnpm smoke:ch6       # M6 新增（第六章五关 + GitGraph 标签徽标 + 结局页）
pnpm smoke:final     # M7 新增（终章 F 两关真机通关 + perfect-game 成就 + 结局页真实链路）
```

包管理器：**统一使用 pnpm**（与工程文档 §12 的技术选型一致）。`package.json` 中的 `scripts` 字段供 pnpm 调用，不要改用 npm。

> ⚠️ **环境注意**：本机的 `node`/`pnpm` 位于 Homebrew 路径下，但沙箱 shell 的 PATH 默认不含该目录，直接调用会报 `command not found`。执行任何 Node 相关命令前先导出：
> ```bash
> export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
> ```
> 同一原因也会导致 `gh` 不可见（影响推送）。

测试运行器已在 M1 配好：**Vitest + @testing-library/react**（`vite.config.ts` 的 `test` 字段，`environment: 'jsdom'`，`globals: true`），测试置于 `src/__tests__/`。**M7 后共 12 个文件，410 个真实用例（无 todo）**（新增 `allLevelsWalkthrough.test.ts` 全 32 关可达性总回归），逐文件计数见 `docs/milestones/M7-tasks.md`「验收 / 三门禁」。Playwright E2E（`e2e/main-flow.spec.ts` + `playwright.config.ts`）随 M7 引入：`pnpm e2e` 自动起 dev server，浏览器装在工作区 `.playwright-browsers/`（`PLAYWRIGHT_BROWSERS_PATH`，已 gitignore）。

> ⚠️ `src/__tests__/setup.ts` 里的 `import 'fake-indexeddb/auto'` **不可删除**：jsdom 不提供 `navigator.locks`，LightningFS 的 `DefaultBackend` 会因此回落到需要 `indexedDB` 的 `Mutex` 分支，删掉即全部测试报 `ReferenceError: indexedDB is not defined`。机理详见 `docs/milestones/M1-tasks.md` 的「实测环境事实」第 2 条。

依赖已安装，`pnpm-lock.yaml` 已生成（**应提交入库**）。另有一个 `pnpm-workspace.yaml`，其 `allowBuilds` 字段用于放行 esbuild 的安装脚本 —— 这是 pnpm 12 的默认安全机制，**不要删除该文件**，否则 `pnpm install` 会再次报 `ERR_PNPM_IGNORED_BUILDS`。若在他人机器上安装，请使用 `pnpm install`（而非 npm），以复用同一份 lockfile。

## 仓库状态与注意事项

- **`.gitignore` 已补齐**（涵盖 `node_modules/`、`dist/`、日志、编辑器与系统文件等）。历史提交 `08361a4`、`d1a259c` 曾声称添加过它，但此前工作树中并不存在；现有文件为本仓库实际的忽略规则来源。
- **`docs/milestones/` 存放里程碑相关的规划与检查文档**（每期一份，记录任务拆解与执行结果）：`M1-preflight.md`（M1 开工前的环境核查）、`M1-tasks.md`、`M2-tasks.md`、`M3-tasks.md`、`M4-tasks.md`、`M5-tasks.md`、`M6-tasks.md`、`M7-tasks.md`、`M8-release-tasks.md`。
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

推进顺序为 M1（地基）→ M2（关卡框架 + 第一章）→ M3（计分 / 星级 / 成就）→ M4（第 2–3 章、GitGraph、BranchPanel、Tab 补全）→ M5（撤销与远程、快照持久化）→ M6（标签 + 综合终章）→ M7（打磨、调参、E2E）→ M8（发布收口：CI + GitHub Pages + v1.0.0）。**每个阶段结束时都必须运行 `typecheck` + `test` + `build`**，确保 `main` 始终可运行。各期定义与当前进度见 `development-refinement.md` §13 与 `docs/milestones/README.md`。
