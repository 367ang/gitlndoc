# M4 任务：第 2–3 章、GitGraph、BranchPanel、Tab 补全、文件编辑

> 状态：**DONE**（M4 已完成，见文末「执行结果」）
> 依据：`development-refinement.md` §4/§6/§8/§9/§13（M4 定义）、`game-design.md` §3.2/§4（第 2–3 章关卡表）、
> `docs/milestones/M2-tasks.md` §4「实测环境事实」/ §5.2「架构性预警」、`docs/milestones/M3-tasks.md`「实测环境事实」与「遗留与移交」。
> **动 `engine/` 前务必先读 M2 §4 与 M3「实测环境事实」。**

**本文档结构**

- [〇、已确认的决策（Lead 与用户于 M4 开工前确认）](#〇已确认的决策lead-与用户于-m4-开工前确认)
- [一、任务拆解](#一任务拆解)
- [二、范围边界（M4 不做）](#二范围边界m4-不做)
- [三、风险与注意](#三风险与注意)
- [执行结果（M4 完成，Lead 记录）](#执行结果m4-完成lead-记录)

## 〇、已确认的决策（Lead 与用户于 M4 开工前确认）

1. **范围**：一次交付 ch2（4 关）+ ch3（6 关）+ GitGraph + BranchPanel + Tab 补全 + 文件编辑 + 章节解锁。
   验收口径 = §13 的「分支章节可玩」。
2. **第 2 章输入模式 = 拼接（menu）**，以 GDD §3.2 与关卡表为准；`development-refinement.md` §8
   表格中 ch2 的「半拼」为笔误，**不改代码改认知**——若后续要改 §8 须与 GDD 第 4 节逐行比对（AGENTS.md 约定）。
   ch3 = 半拼（half），两份文档一致。
3. **3-5 rebase = gitApi 组合实现真实 rebase**：`findMergeBase` + 复用原提交 tree 重写 parent 链 +
   移动分支指针；**不处理 rebase 冲突**（遇冲突明确报「当前版本不支持」，关卡数据避开冲突场景）。
4. **文件编辑 = FileTree 内嵌编辑器**：点击文件 → 编辑 → 保存写入工作区（限 `/repo` 内、禁 `.git`）。
   同时清偿 M3 遗留 1（1-4 完整通关）并支撑 2-2/2-4/3-4。
5. **章节解锁 = 通关上一章全部关卡**（ch2 解锁 ⇔ ch1 全通关；ch3 同理）。章内关卡维持全可见（GDD 未定义章内锁）。
6. **GitGraph = 泳道式 DAG**（SVG 连线，节点按分支着色），数据走「全分支遍历 log」。

## 一、任务拆解

### 阶段 0：基线

- [x] 0.1 导出 PATH；复跑三门禁确认基线（预期：typecheck 0 / **176 passed** / build ≈157.5 kB gzip）。

### 阶段 1：引擎层 `engine/`（gitApi + sandbox）

- [x] 1.1 `gitApi.branch(name, { from? })` —— 创建分支（`git.branch`）；`listBranches()` + `currentBranch()` 封装。
- [x] 1.2 `gitApi.checkout(ref)` —— 切换分支（`git.checkout`）。⚠️ 先实测对未提交改动的行为（真 git 拒绝冲突切换），
      关卡数据保证切换前工作区干净；必要时映射 `CheckoutConflictError`。
- [x] 1.3 `gitApi.merge(theirs)` —— `git.merge({ abortOnConflict: false })`：
      - 无冲突 → ff 或 merge commit（固定学习者身份），返回结构化结果（ff / mergeCommit）；
      - 冲突 → **抛 `MergeConflictError` 前由本层拦截**：冲突标记已写入工作区，返回
        `{ ok: false, conflictedPaths }`，并把 **MERGE_HEAD 写入 gitdir**（`writeRef`）；
      - `commit()` 检测 MERGE_HEAD 存在 → 构造双亲提交 `parent: [HEAD, MERGE_HEAD]`，提交后删除 MERGE_HEAD
        （模拟真 git 的 MERGE_HEAD 语义，`executor.test.ts` 必须覆盖此流程）。
      - ⚠️ 1.9 的空提交防御需兼容「合并完成提交」（索引与 HEAD 有差异即可，双亲不改变判据）。
- [x] 1.4 `gitApi.rebase(upstream)` —— 无冲突 rebase 组合实现：
      `findMergeBase(HEAD, upstream)` → 收集 base..HEAD 提交（旧→新）→ 以 upstream 头为新起点
      逐个用**原提交 tree + 重写 parent 链**构造新提交（author/时间保留，committer 为学习者）→
      移动原分支指针 → checkout 回原分支。遇多 merge-base / 冲突风险 → 明确报「不支持」。
- [x] 1.5 `gitApi.removePaths(paths)` —— `git rm` 真删：fs 删工作区文件 + `git.remove` 暂存删除
      （现有 `remove()` 是 `--cached` 语义，保留不动；`--cached` 变体由 executor 分流）。
- [x] 1.6 `.gitignore` 语义 —— `gitApi.status()` 对 untracked 条目经 `git.isIgnored` 过滤；
      `expandPathspec`（executor）因此天然不暂存 ignored 文件。⚠️ 实测 `isIgnored` 对**目录规则**（`build/`）的覆盖。
- [x] 1.7 `git diff` —— isomorphic-git 无 diff 命令，gitApi 新增 `diff({ staged? })`：
      walk（HEAD/STAGE/WORKDIR）比对 blob → 逐文件输出行级差异（朴素行对比，教学够用）；
      `git diff` = 工作区 vs 索引，`git diff --staged` = 索引 vs HEAD。
- [x] 1.8 `gitApi.logAll()` —— 全分支遍历：`listBranches` 各自 log + parents BFS 补全合并提交，按时间排序输出。
      （`git log --all` 由 grammar 的 `--all` 旗标通往此处，供 GitGraph 与终端。）
- [x] 1.9 `sandbox.reset` 支持**分支化预置**：
      - `InitCommit` 扩展 `on?: string`（提交所在分支；首次出现 = 从当前 HEAD 创建并切换，已存在 = 切换）
        与 `files?: Record<string, string>`（本次提交前写入并暂存的文件内容覆盖）；
      - `init.branches: [{ name, from }]` 保留语义 = 从 `from` 分支头创建空分支（无独有提交）；
      - schema.ts 同步校验（on 为合法分支名、files 路径规则与 init.files 一致）。
      ⚠️ 该模型要能表达 3-4 的冲突预置（同文件在两分支不同内容），写 ch3 数据前先写引擎测试验证。
- [x] 1.10 `commit()` 返回值升级为 `{ hash, branch }`（修 executor 回显硬编码 `main`）；
       executor 的 commit/checkout/branch/merge/rebase/rm 回显对齐真 git 文案。
- [x] 1.11 `grammar.ts` 白名单扩展：`branch` / `checkout` / `switch` / `merge` / `rebase` / `rm` / `diff`，
       及 `log --all`、`checkout -b`、`switch -c`、`rm --cached`、`diff --staged`；
       `stash` / `branch -d` 等仍走 `unsupported`（属 M5 / 未纳入）。
- [x] 1.12 `executor.ts` 分发新 verbs + `undoable` 口径：**维持 §7.2 字面清单**（reset/revert/checkout --/stash drop），
       分支切换与 rebase 不记 undoable；实现处注释说明 3-5 的评分依赖 optimalMoves 而非撤销罚分。

### 阶段 2：目标检测 `game/validate/targetState.ts`

- [x] 2.1 实现 4 种：`branch`（`listBranches` 含 name ⇔ exists）、`headBranch`（currentBranch 相等）、
      `merged`（branch 头是 into 头的祖先，用 `git.isDescendent`）、
      `logOrder`（branch 的 log 信息序列逐一包含 `order` 关键词，子串匹配，从新到旧）。
- [x] 2.2 `schema.ts` 名单迁移：IMPLEMENTED += 前 4 种（共 9 种），UNIMPLEMENTED 只剩 `tag` / `remote`（M5/M6）。
- [x] 2.3 `targetState.test.ts` 新增 4 类判定用例（真实 LightningFS 构造分支/合并/rebase 状态）。

### 阶段 3：关卡数据层

- [x] 3.1 `presets.ts` 扩充 ch2/ch3 叙事文件（中文模板，沿用现有体例）。
- [x] 3.2 `ch2.ts` —— 4 关（**拼接**输入；命令集 status/diff/log/rm/.gitignore）：
      - 通用约束：**只读命令不可直接判定**（M2 §5.2 预警），目标锚定「玩家用只读命令前后必须做到的事」；
        probeBonus 首次真实生效（status/log/diff/branch 探查加分）。
      - 2-1 状态感知（★）：预置「已归档 + 未跟踪」两态文件，目标 = 归档新文件 + 工作区干净
        （status 是通关最优路径，探查即奖励）；
      - 2-2 记录变更（★★）：玩家**用文件编辑器**制造改动 → diff 查看 → 归档；目标 = commitMessage 正则
        （提交信息需描述改动）+ commitCount；
      - 2-3 日志回溯（★★）：预置多提交历史，玩家 log 阅读；目标 = 新归档 + commitCount（log 走 probeBonus）；
      - 2-4 移除与忽略（★★）：目标 = `file: secrets.log exists:false`（rm）+ `.gitignore` 存在且内容匹配
        （编辑器创建）+ workdirClean；开局两目标皆未达成 ✓。
      - 每关 `optimalMoves` 按参考解法核定并注释；hints 沿用 3 级（0/1/3）。
- [x] 3.3 `ch3.ts` —— 6 关（**半拼**输入；命令集 branch/checkout/switch/merge/rebase）：
      - 3-1 分裂宇宙（★★）：目标 = `branch: dev exists` + `headBranch: main`（创建≠切换的教学点）；
      - 3-2 穿越宇宙（★★）：init.branches 预置 feature，目标 = `headBranch: feature`（+ commitCount 门槛防白送）；
      - 3-3 合并宇宙（★★★）：main 2 提交 + feature 1 独有提交（无冲突），目标 = `merged feature into main` + commitCount；
      - 3-4 冲突消解（★★★★）：同文件两分支各自改写 → merge 冲突 → **编辑器解决** → add + commit（MERGE_HEAD 双亲）；
        目标 = merged + 文件内容匹配预期解 + commitCount；
      - 3-5 变基重写（★★★★）：目标 = `logOrder: feature`（feature 提交应在 main 最新提交之上）+ `headBranch: feature`；
      - 3-6 分支博弈（★★★★）：merge vs rebase 的**实践关**——叙事传达选择标准（最佳实践笔记），
        判定锚定其中一条可判定路径（实施时细化，倾向 merge 路径 + 叙事说明 rebase 的适用场景）。
        ⚠️ TargetCondition 为 AND 语义，无法表达「merge 或 rebase 任一过关」；若要 OR 需新增目标类型 —— 默认不做。
- [x] 3.4 `chapters/index.ts` 注册 ch2/ch3（playable: true）。
- [x] 3.5 章节解锁：MenuScreen / ChapterScreen 从 progressStore **纯派生**（ch2 可玩 ⇔ ch1 全通关），
      锁定章节按钮禁用 + 「完成上一章全部关卡后解锁」文案；不新增 store 字段。
- [x] 3.6 `levels.test.ts` 扩展：ch2/ch3 数据校验、开局不达标、正解可通关、
      relatedKnowledge 反查（`?raw` 导入 git-basic-operations / git-branches 两篇，
      `SLUG_BY_HEADING` 按两篇笔记**实际小节标题**核定补表，沿用 ch1 的两套规则约定）。

### 阶段 4：命令输入层 `game/command/`

- [x] 4.1 `fragments.ts` 片段表按章节拆分：CH2_FRAGMENTS（status/-s/diff/--staged/log/--oneline/rm/.gitignore…）
      + CH3_FRAGMENTS（branch/checkout/-b/switch/-c/merge/rebase…）；`fragmentsForLevel` 按 `level.chapter` 选表。
      ⚠️ 槽位不重叠约束继续成立；穷举不变式测试同步扩展。
- [x] 4.2 半拼模式（half）：`Level.halfSkeleton?: string`（如 `'git checkout'`）——
      进关时初始草稿预填骨架片段，玩家在骨架上补参数（suffix 输入）+ 可用片段池收窄；
      数据 schema 校验：half 关卡必须提供 halfSkeleton。
- [x] 4.3 Tab 补全：Terminal（自由输入）与 CommandBuilder 的 suffix 输入框支持 Tab ——
      候选 = 动词白名单 ∪ 当前分支名（经 executor 执行 `git branch` 解析，UI 不直连 gitApi）∪ 工作区文件路径；
      只在光标位于行尾最后一个 token 时生效。实现最小化，可达性（aria）同步。

### 阶段 5：UI 层

- [x] 5.1 `game/graph/gitGraph.ts`（game 层纯函数 + 数据采集，模式对齐 targetState）：
      `buildGraph()` —— 全分支遍历 log → 提交节点（parents）+ 分支归属 + **泳道分配**；
      `ui/components/gitGraph/GitGraph.tsx` SVG 泳道图（节点按分支着色、连线表达 parent），
      替换 CommitPanel（其头注释已预告）；`BranchPanel.tsx` 分支列表（名称 + 当前态 + 指向短 hash）。
- [x] 5.2 FileTree 内嵌编辑器：点击文件节点 → 编辑面板（textarea + 保存/取消）→
      `game/editor.ts`（路径安全封装：限 `/repo` 相对路径、拒绝 `.git`）写入工作区 → 自增 version 刷新。
      ⚠️ 保存走**事件回调**（StrictMode 双跑教训）。
- [x] 5.3 LevelScreen：inputMode 三态接线（menu → CommandBuilder / half → 骨架预填的 Builder / free → Terminal）；
      GitGraph + BranchPanel 上位。
- [x] 5.4 MenuScreen/ChapterScreen 解锁态 + 章节小计（已有汇总条自动涵盖新章节）。

### 阶段 6：计分复核（M3 移交）

- [x] 6.1 `PROBE_VERBS` += `diff`（§7.3 只读探查语义）；`PROBE_BONUS_MAX_EVENTS=3` 经 ch2 实测量复核合理性，
      数值微调仍留 M7（注释如实更新）。
- [x] 6.2 `redoPenalty`「同信息去重」口径经 ch2/ch3 实测复核（预期无误伤，注释更新结论）。

### 阶段 7：测试

- [x] 7.1 `executor.test.ts`：新 verbs 引擎链路（含 MERGE_HEAD 双亲提交、rebase 历史重写、rm 真删、
      .gitignore 过滤、commit 回显带分支名、diff 输出）。
- [x] 7.2 `tokenize/grammar` 相关用例扩展（新 verbs 解析与拒绝面）。
- [x] 7.3 `components.test.tsx`：GitGraph/BranchPanel 渲染、编辑器保存、半拼骨架预填、Tab 补全、章节解锁禁用态。
- [x] 7.4 `scoring.test.ts`：probeBonus-diff 用例。
- [x] 7.5 `levels.test.ts`（见 3.6）。

### 阶段 8：验收与收尾

- [x] 8.1 三门禁：typecheck 0 / test 全绿 / build 通过且 gzip 增量合理（预算 ~350 kB）。
- [x] 8.2 真实浏览器冒烟（沿 M2 §4.5：`--no-sandbox --disable-crashpad`，键盘走 CDP `Input.insertText`，aria 定位）：
      - ch2 四关 + ch3 六关全通关（3-4 含编辑器解决冲突全流程）；
      - **1-4 完整通关补测**（M3 遗留 1：编辑器制造新改动 → 第二环归档）；
      - GitGraph 泳道渲染（分叉/合并形态）、BranchPanel、Tab 补全、章节解锁与禁用态；
      - 控制台无 JS 异常。
- [x] 8.3 `docs/milestones/M4-tasks.md` 定稿（原命名约定为 `TODO/M4-tasks-TODO.md` → `-DONE`，含实测环境事实与遗留），AGENTS.md「当前状态」同步。

## 二、范围边界（M4 不做）

- `tag` / `remote` 目标类型与四章远程能力（M5/M6）；
- `stash`、`branch -d`、`reset` / `revert` / `checkout --`（M5 撤销章）；
- 持久化（M5，§10）；
- intro / gameComplete 完整叙事（M6）；
- Playwright E2E（M7）；
- 「merge 或 rebase 任一过关」的 OR 型目标类型（3-6 用叙事 + 单一路径判定替代，见 3.3）。

## 三、风险与注意

| 风险 | 对策 |
|---|---|
| isomorphic-git `checkout` 对未提交改动可能覆盖或抛错 | 引擎测试先探行为；关卡数据保证切换前干净；错误映射 CheckoutConflictError |
| MERGE_HEAD 手工机制与真 git 语义有差（如无 MERGE_MSG） | executor.test 对照真 git 行为写回归；文案对齐真 git 输出 |
| rebase 重写依赖「复用原 tree」假设（无冲突时成立） | findMergeBase 唯一性校验；多 base / 冲突风险明确报不支持；关卡数据避开 |
| `.gitignore` 生效面：isIgnored 只对 untracked 有意义；目录规则待实测 | 阶段 1.6 先实测再定 status 过滤实现；关卡只依赖已实测语义 |
| 半拼与槽位模型的兼容（骨架预填 vs 置灰闸门） | 骨架 = 预填槽位（走既有 applyFragment 路径），复用 isFragmentEnabled 不变量 |
| StrictMode 双跑（编辑器保存、骨架预填、刷新） | 保存走事件回调；跨渲染去重放 store 层（M3 教训 2） |
| LightningFS 性能（ch3 预置提交/分支较多） | 关卡仓库保持精简（每关 ≤6 提交、≤6 文件） |
| Tab 补全动态候选（分支名）经 executor 取数较绕 | 只读查询走 `git branch` 输出解析，保持「UI → executor」单通道（§2） |
| ch2 拼接片段表膨胀（status/diff/log/rm 多组） | 沿用槽位不重叠 + 置灰闸门；片段按钮文案全局唯一（M2 缺陷 4/6 教训） |


---

## 执行结果（M4 完成，Lead 记录）

### 交付清单

| 阶段 | 交付物 | 结果 |
|---|---|---|
| 1 引擎层 | `gitApi`：branch / checkout / merge（含 MERGE_HEAD 双亲机制）/ rebase（组合实现）/ removePaths（真删+untracked 拦截）/ diff（两模式）/ logAll / logWithRef / resolveRef / isDescendent；`.gitignore` 过滤（status）；commit 返回 `{hash, branch, merge}` | ✅ |
| 1 沙箱 | `sandbox.reset` 支持 `InitCommit.on`（分支落点，缺省回 main）/ `InitCommit.files`（提交级文件）/ `init.branches`（空分支预置） | ✅ |
| 1 语法执行 | grammar 白名单 5→12 verbs（branch/checkout/switch/merge/rebase/rm/diff + log --all）；executor 全部分发 + 分支操作不记 undoable（§7.2 口径注释） | ✅ |
| 2 目标检测 | branch / headBranch / merged（isDescendent）/ logOrder 四种实现；`evaluateTarget` 接收 options（修复 options 丢失缺陷）；schema 名单 9+2 | ✅ |
| 3 关卡数据 | presets 12 个新模板；ch2 四关（拼接）+ ch3 六关（半拼 + halfSkeleton）；章节注册 + 解锁（game/progression.ts 纯派生） | ✅ |
| 4 输入层 | fragments 按章三表 + COMMON_GIT_SLOT 全组 slot0；draftFromSkeleton（半拼骨架）；completion.ts + Tab 补全（Terminal/CommandBuilder 双端，唯一匹配直补/多候选补公共前缀） | ✅ |
| 5 UI | GitGraph（泳道 SVG）+ BranchPanel 替换 CommitPanel；FileTree 内嵌编辑器 + **新建文件入口**（干净工作区盲区修复）；LevelScreen 三态输入接线 | ✅ |
| 6 计分 | PROBE_VERBS += diff（ch2 首次真实生效）；redoPenalty 口径经 ch2/ch3 复核无误伤 | ✅ |
| 7 测试 | 228 passed（基线 176 → +52）：executor +19（分支/冲突全链路/rebase/rm/gitignore/data 定位）、levels +10（ch2/ch3 数据/可解性/slug）、inputMode 12 新建、components +7 | ✅ |
| 8 冒烟 | **分段冒烟 30/30**（方案 A：进度种子 + 条件轮询 + data 属性定位） | ✅ |

### 三门禁（最终）

- `typecheck`：0 错误
- `test`：**228 passed**（基线 176，+52），0 todo
- `build`：169.76 kB gzip（M3 为 157.53，+12.2 kB —— 分支引擎 + 两章关卡 + GitGraph 的合理增量；预算 ~350 kB 余量充足）

### 真实浏览器冒烟（分段 30/30，两轮连跑无 flake）

- **段3 legacy（8/8）**：无进度锁定态 → 1-1~1-3 通关 → 1-4 第一环 → 编辑器新建第二环 → 过关 → ch2 解锁（M3 遗留 1 闭环）
- **段1 ch2（8/8）**：ch1 全通关解锁 ch2 → 2-1（status 探查 + probeBonus 生效）→ 2-2/2-4（编辑器）→ 2-4（rm 真删 + .gitignore）→ ch3 解锁
- **段2 ch3（14/14）**：半拼骨架预填断言（3-1/3-2/3-3/3-5）→ 3-3 ff 合并 → **3-4 冲突消解全链路**（merge 报冲突 → 标记落工作区 → 编辑器裁决 → 双亲合并提交）→ 3-5 rebase → 3-6 → **汇总 14/14（1672 分 / 42 星 / 成就 5/5）**

### 冒烟方案 A 的三条工程决策（后续里程碑复用）

1. **进度种子**：冒烟经 CDP 对运行中的应用 `useProgressStore.setState()` 直接种入通关记录，
   不脚本通关前置章节 —— 每段 3 分钟内完成，失败只重跑该段。
   ⚠️ 种子后**不可 reload**（内存 store 清空，M5 持久化前）。
2. **条件轮询 waitFor()** 替代一切固定 sleep：每个导航/渲染动作轮询目标 DOM 特征
   （超时 15s 报错）。已知坑：`startLevel` 是 async（sandbox.reset 耗时不可预估）、
   结算页正文**不含关卡 id**（判据用「过关」+「时间线已锚定」通用文案）。
3. **片段定位用 data-command/data-slot**：aria-label「拼接命令片段：git」有 12 个重复
   按钮（每组 slot0 一个），querySelector 恒取第一个会点错命令组清空草稿。
   另两条 DOM 教训：React 18 批处理下 slot0 与 slot1 的点击**不可在同一同步块**
   （disabled 未更新，第二击被忽略）；编辑器写 textarea 必须走原生 setter + input 事件。

### 执行中发现并修正的引擎/产品缺陷（8 个，全部有回归测试或冒烟覆盖）

1. **isomorphic-git 的 ff merge 只移 ref 不更新工作区/索引**（读源码 + 探针确认）→
   gitApi.merge 的 ff 与 merge commit 路径统一补 checkout 同步工作区。
2. **`git rm` 对 untracked 文件静默成功但什么都不做**（真 git 报 did not match）→
   removePaths 显式拦截（HEAD 与索引都无该路径即报错）——2-4 关卡数据随之改为
   「密钥残片先入库再 rm」。
3. **rebase 冲突检测按路径交集误判**（双方 tree 都含 base 就有的文件 ≠ 冲突）→
   改为比较「双方都改且改成的内容不同」。
4. **evaluateTargets 丢失 options** → branch/merged/logOrder 判定落到默认 /repo
   （测试注入 dir 时必炸）→ `evaluateTarget(target, context, options)` 全量下传。
5. **sandbox 预置：无 `on` 的提交沿用了当前分支**（3-5 的主线推进落进了 feature）→
   语义改为「on 缺省回 main」，与关卡书写直觉一致。
6. **2-1 开局即达标**：预置提交把 init.files 的待归档文件顺带入库 → staged 集合改为
   只含本提交 files；连带修出「每个预置提交必须带 files」的约束（空提交防御）。
7. **FileTree 编辑器盲区**：树只显示 status 有变化的文件，**干净工作区没有任何编辑
   入口** —— 而制造新改动正是 1-4 第二环/2-2/2-4 的核心动作 → 新增「＋新建文件」入口。
8. **fragments 章节表缺 slot0 / draftFromSkeleton 锁错命令组**：aria 重复的同源问题，
   COMMON_GIT_SLOT 扩到全 12 组；骨架用「token2 决定命令组」的两段式匹配。

### 遗留与移交（不阻塞 M4 验收）

1. **M5 持久化后复核三处**：进度种子依赖内存 store（M5 后可改为 localStorage 预填）；
   `firstAttempt` 成就口径（M3 遗留 2）；关卡快照恢复与「新建文件」的交互。
2. **rebase 的「搬 tree」语义差异**：重放保留原提交 tree，不含 upstream 的改动 ——
   与真 git 三方合并不同（executor.test.ts 有回归锁）。关卡 3-5 数据保证 feature 与
   main 改动互不相交，此场景下与真 git 结果一致；若未来引入相交改动的变基关，
   需先升级 rebase 实现为三方合并。
3. **`merge` 冲突文件清单从 stderr 解析**（isomorphic-git 归一化丢失 error.data）——
   上游若改 message 格式会静默退化为空清单（有 null 守卫，不炸）。
4. **probeBonus 上限常量 3** 经 ch2 实测量复核维持不变，最终数值仍留 M7 调参。
5. Tab 补全多候选时补公共前缀、不弹候选列表 —— 交互保持最小；候选面板留 M7 打磨。
