# M5 任务：撤销与远程、快照持久化（拆分为 M5a / M5b）

> 状态：**进行中**（M5a 开工；M5b 待 M5a 交付后启动）
> 依据：`development-refinement.md` §4/§6/§8/§10/§13/§14（M5 定义）、`game-design.md` §4（第 4–5 章关卡表）、
> §6.5（持久化）、§10（`reset --hard` 沙箱可恢复裁定）、`docs/milestones/M4-tasks.md`「遗留与移交」。
> **动 `engine/` 前务必先读 M2 §4、M3、M4 的「实测环境事实」。**

**本文档结构**

- [〇、已确认的决策（Lead 与用户于 M5 开工前确认）](#〇已确认的决策lead-与用户于-m5-开工前确认)
- [一、拆分与范围](#一拆分与范围)
- [二、M5a 任务拆解](#二m5a-任务拆解)
- [三、M5b 任务拆解](#三m5b-任务拆解)
- [四、范围边界（M5 不做）](#四范围边界m5-不做)
- [五、风险与注意](#五风险与注意)
- [六、开工前探针实测（Lead）](#六开工前探针实测lead)
- [执行结果](#执行结果)

## 〇、已确认的决策（Lead 与用户于 M5 开工前确认）

用户于 M5 开工前对以下 6 点全部采纳 Lead 建议，并追加裁定：**拆分为 M5a / M5b 两批交付**。

1. **拆分**：M5 按 §13 的字面定义是「两个里程碑的量」（第 4 章远程需自写 Git 智能 HTTP
   客户端，是 M1–M7 中最大的单块工作量；另有第 5 章撤销 6 关 + 持久化）。故拆为
   **M5a = 撤销与快照持久化**（本地可交付、无外部依赖）、**M5b = 远程**
   （ch4 五关 + 本地远程客户端）。每批独立跑三门禁与冒烟。
2. **远程通道 = 本地内存裸仓库 + 自写最小智能 HTTP 客户端**（选项 A）。
   `/remote.git` 保持 `fs.ts` 既定的沙箱路径约定；隔离性来自「独立的内存后端实例 +
   自写客户端」两层，而非另一条路径常量。**不走 `corsProxy` + 真实 GitHub**
   （本机网络不可达 TUNA 外的源，且依赖外网与「单机游戏」定位冲突）；
   **不用文件系统路径直接读写裸仓库**（不是真 Git 协议，违背「真实执行」的课程价值）。
   *（本条属 M5b，此处记录以保持决策链完整。）*
3. **`remote add` 的 URL 设白名单**（选项 A）：只接受指向沙箱远程宇宙的形态，
   其它 URL 明确回「本关的远程宇宙只接受 file:// 本地通道」。
   依据：探针 2 实测 `git.addRemote` **不做任何 URL 校验**，任意字符串都会写进
   `remote.origin.url`；若不设限，玩家照抄第五章笔记的 `https://github.com/...`
   会「添加成功但后续命令全崩」，属 §14 禁止的「假装执行」。*（本条属 M5b。）*
4. **`stash` 不纳入 M5**（选项 A）：`development-refinement.md` §8 第 3 行（第三章）列了
   `stash`，但 **GDD §4 第三章六关的命令列里没有 stash，GDD 全部关卡中 stash 从未出现**
   （仅在最段实践/FAQ 笔记里作为建议提及）。以 GDD 为准，§8 该行属概括性差异
   （同 AGENTS.md 已记录的「六章列了 `show`/`describe`」一类）。`git stash` 在语法层
   继续回「该版本不支持」。
5. **`reset --hard` 的「记错来源」不改 `TargetCondition`**（选项 A）：引擎内部记录
   ref 移动日志（含 action 分类与 `from`/`to`），`git reflog` 如实输出笔记
   `git-undo.md` 里的 `"<hash> HEAD@{n}: <action>"` 格式；过关判定用**现有 target 组合**
   表达（`commitCount eq N` + `commitExists "…"` + `commitMessage` + `workdirClean`）——
   玩家只有走完「误操作 → reflog 查看 → 恢复」才能达成。
   **理由**：§4.3 的判别联合是文档基线，新增类型要同步改动 4 个文件（含两份目标类型
   名单的互补断言）；而教学效果由「引擎保真 + reflog 输出」承担，不依赖判定细节。
6. **关卡名与输入模式以 GDD 为准**：
   - 关卡名取自 `game-design.md` §4 的关卡表（4-1 建立航道 … 5-6 时间跳跃）；
   - 同时把 `ChapterMeta.title` 与 GDD 的 4 处不一致**一并对齐**（文档已标记「待 M5/M6 统一」）：
     第四章 遥远回响→**星际连接**、第五章 时间倒流→**时空回溯**、
     第六章 永恒印记→**历史锚点**、终章 时间线终点→**大统一**；
   - ch4 = `half`（半拼）、ch5 = `free`（自由），依 GDD §3.2 与关卡表。

## 一、拆分与范围

| 批次 | 内容 | 产出 | 状态 |
|---|---|---|---|
| **M5a** | 第五章 6 关（`reset` 三模式 / `restore` / `commit --amend` / `revert` / `reflog`）+ 快照持久化（§10） | 撤销章可玩；进度与仓库快照跨刷新存活 | 进行中 |
| **M5b** | 第四章 5 关（`remote add` / `push` / `fetch`/`pull` / `clone` / 协作冲突）+ 本地远程客户端 | 远程章可玩；M5 全量交付 | 待启动 |

**为什么这样切**：M5a 的依赖全部在仓库内（isomorphic-git 原语 + 浏览器 Storage），
可独立跑完三门禁与冒烟；M5b 需要新写协议客户端并让 `/remote.git` 真正参与，
是独立的风险面。M4 遗留 1（「进度种子依赖内存 store，M5 持久化后复核」）落在 M5a，
正好被 M5b 的冒烟脚本复用（种子可改为 localStorage 预填，不再受「不可 reload」限制）。

## 二、M5a 任务拆解

### 阶段 0：基线

- [x] 0.1 导出 PATH；复跑三门禁确认基线 —— **typecheck 0 / 228 passed / build 169.73 kB gzip**
      （与 M4 文档记录一致：228 / 169.76 kB）。

### 阶段 1：撤销引擎 `engine/`

- [ ] 1.1 `gitApi` 扩展 `commit()`：支持 `amend`（底层 `git.commit({ amend: true })` 已确认可用）。
  - `--amend --no-edit` 复用原提交信息；`--amend -m` 改写信息；
  - 与既有的 **MERGE_HEAD 双亲机制**、**空提交防御** 的交互必须明确并测到
    （amend 时原提交的父提交保持不变；amend 后旧提交成为孤儿，与真 git 一致）；
  - 真 git 拒绝「amend 后内容与父提交完全一致」的场景（`You have nothing to amend`）——
    需实测 isomorphic-git 行为后决定是否对齐。
- [ ] 1.2 `gitApi` 新增 `reset()`：`--soft` / `--mixed`（缺省）/ `--hard` 三模式。
  - 底层用 `writeRef` 移动当前分支指针 + 按模式同步索引与工作区；
  - **`--hard` 必须真正重写工作区**（isomorphic-git 无 reset，用 `checkout` 的
    `force` 路径或逐文件回写实现，以探针实测为准）；
  - 目标可为 `HEAD~n` / `HEAD@{n}` / 提交 hash / 分支名。
- [ ] 1.3 `gitApi` 新增 `restore()`：`git restore <path>`（工作区回退到索引版本）
   与 `git restore --staged <path>`（索引回退到 HEAD 版本，工作区保留）。
  - 与既有 `checkout -- <path>` 旧语法等价，二者都要支持（笔记 `git-undo.md` 两种都讲）。
- [ ] 1.4 `gitApi` 新增 `revert()`：生成反向提交（§14 已知 isomorphic-git 无 revert，
    用组合实现：读目标提交与其父的 tree diff → 在当前 HEAD 上应用反向改动 → commit）。
  - 冲突场景明确报「当前版本不支持」（与 `rebase` 同款纪律），关卡数据避开；
  - `revert` 的提交信息对齐真 git：`Revert "原提交信息"`。
- [ ] 1.5 **ref 移动日志（reflog）**：`engine` 层记录每次 ref 移动的
    `{ from, to, action, ts }`，并新增 `git reflog` 查询出口，输出格式对齐
    `docs/notes/git-undo.md` 的 `"<hash> HEAD@{n}: <action>"`。
  - ⚠️ 记录点在 `gitApi` 的 **ref 写入出口**（commit / reset / checkout 切分支 /
    branch / merge / rebase / revert / push/fetch 的本地 ref 更新），不是散落各处；
  - 日志需在 `sandbox.reset()` 时清空（每关独立）；
  - 是否落盘（随快照持久化）留到阶段 1.5 实测后决定 —— 优先级低于「格式正确」。
- [ ] 1.6 `resolveRef` 语法扩展：`HEAD~1` / `HEAD~2` / `HEAD^` / `HEAD@{n}` / 短 hash。
  - ⚠️ 这是 5-2/5-6 的关键路径：笔记的核心命令就是 `git reset --soft HEAD~1`
    与 `git reset --hard HEAD@{n}`，不做则整个第五章无法照抄笔记操作。

**验证**：`executor.test.ts` 新增用例 —— 每种 reset 模式断言「工作区 / 暂存区 / 提交历史」
三态（对齐笔记 `git-undo.md` 的模式对比表）；amend 断言旧提交成为孤儿、父提交不变；
revert 断言「树内容回到目标提交之前、历史向前增长」。

### 阶段 2：输入层 `game/command/`

- [ ] 2.1 `grammar.ts`：白名单加入 `reset` / `restore` / `revert` / `reflog`，
  并补 `commit --amend` 的合法解析（`--amend --no-edit` / `--amend -m <msg>`）。
  - `reset` 的三模式与 `restore --staged` 的参数校验；
  - `checkout -- <path>` 旧语法的解析（笔记 `git-undo.md` 明确保留该写法）。
- [ ] 2.2 `executor.ts`：分发新命令；**`undoable` 接线** —— §7.2 的撤销类命令
  （`reset` / `revert` / `checkout --` / `restore`）记 `true`，计分层的撤销扣分由此首次真实生效。
  - ⚠️ 需复核 `game/scoring/score.ts` 的 `countUndoables` 口径：**误操作后的恢复是否该扣两次分**
    （5-6 的教学剧本天然包含一次 `reset --hard` 误操作，扣分设计要在关卡数据里验证不误伤）。
- [ ] 2.3 `fragments.ts` + `completion.ts`：
  - ch5 是 `free` 模式（走 M1 的 Terminal），但要确认**片段表在 free 模式下不渲染**且不报错；
  - Tab 补全候选扩展：`HEAD~1` / `HEAD@{0}` 这类 ref 表达式不属候选词表，需实测其可用性。

**验证**：`tokenize`/`grammar`/`executor` 单测；修订 `executor.test.ts:316`
那条「`commit --amend` 明确回『不支持』（属 M5 范围）」的**过时断言**（改为成功断言）。

### 阶段 3：目标检测 `game/validate/`

- [ ] 3.1 复核 `targetState` 对第五章 6 关的判定能力（决策 ⑤ 依赖现有 target 组合）。
  - 若 5-2「撤销暂存」需判定「索引干净但工作区有改动」，现有 `workdirClean` 不够用 ——
    先落地实测，必要时用 `file` 的 `content` 目标间接表达；
  - ⚠️ **不得为了过关而放宽判定**（§14）。
- [ ] 3.2 若 `reset --hard` 误操作需被判定捕捉，明确采用哪种 target 组合，并在关卡注释里写清剧本。

### 阶段 4：关卡数据 `levels/`

- [ ] 4.1 `presets.ts`：第五章的预置文件（误提交的档案、待丢弃的草稿等，保持精简）。
- [ ] 4.2 `ch5.ts`：6 关（5-1 修正笔误 / 5-2 撤销暂存 / 5-3 丢弃改动 / 5-4 安全反转 /
    5-5 危险与安全 / 5-6 时间跳跃），`inputMode: 'free'`，难度按 GDD（★★★ ~ ★★★★★）。
  - 每个预置提交必须带 `files`（M3 空提交防御，M4 已实测的硬约束）；
  - **5-5 的 OR 语义限制**同 3-6：`TargetCondition` 为 AND 语义，本关按「revert 路径」判定
    （叙事说明 reset 适用本地未推送、revert 适用已推送），实现处注释留档；
  - **5-6 的剧本**：预置 3 个提交 → 玩家误 `reset --hard HEAD~2`（或按叙事指定的错误操作）
    → `git reflog` 查看 → `git reset --hard HEAD@{n}` 恢复。目标用 `commitCount eq 3` +
    `commitExists "重要提交"` + `workdirClean` 组合，**只有走过恢复路径才能达成**。
- [ ] 4.3 `chapters/index.ts`：注册 `CHAPTER_5_LEVELS`，`ch5.playable = true`；
  章名对齐 GDD（第五章 → 时空回溯；另 3 处见决策 ⑥）。
- [ ] 4.4 笔记接入：`levels.test.ts` 的 `?raw` 导入扩到 `git-undo.md`，
  `SLUG_BY_HEADING` 补第五章小节表（⚠️ 两套 slug 规则，见 `docs/notes/README.md` 约束 3）。
  - 第五章涉及小节：`### restore 命令` / `### 修改最后一次提交` / `### reset 三种模式` /
    `### revert 命令` / `### 使用 reflog` —— 逐字标题必须与笔记一致。

**验证**：`levels.test.ts` 对 6 关断言「开局不达标 + schema 通过 + 参考解在真实引擎上走通」
（沿用 M4 的 `freshSandbox` + `execute` 模式）。

### 阶段 5：快照持久化（§10）

- [ ] 5.1 `src/persistence/progress.ts`：`gtp:progress:v1`（每关得分/星级/通关）、
  `gtp:achievements:v1`（成就）、`gtp:settings:v1`（设置）。
  - 版本化 key；**损坏数据安全降级**（JSON 解析失败 → 空进度，不白屏）；
  - localStorage 不可用（隐私模式）时静默降级为内存态。
- [ ] 5.2 `src/persistence/snapshot.ts`：`gtp:snapshot:<levelId>` 的仓库快照（IndexedDB）。
  - ⚠️ §10 的策略是「进关建快照；每 N 条命令或关键提交后增量写；退出清除」。
    实现前先实测两条路径：(a) 复用 LightningFS 的 IndexedDB 超级块
    （需给 `fs.ts` 扩展一个 `name` 透传出口并**先 spike 验证**能否可靠往返）；
    (b) 若超级块路径不可靠，退化为**导出虚拟根文件树**（决策 ③ 在 M5b 已用同款做法）。
  **可靠性优先于性能** —— 快照是「刷新不丢进度」的唯一依据。
- [ ] 5.3 接线：
  - `store/progressStore.ts` 接入持久化中间件（写回 + 启动加载）；
  - `main.tsx` / `App.tsx` 的 boot：**`hasProgress()` → menu，否则 intro**（清偿 M2 起的 TODO）；
  - `startLevel()`：进关建快照 / 有快照则询问或自动恢复（交互口径在实现时按最小方案定：
    优先「自动恢复」，不新增 UI）；退出清除；
  - ⚠️ `firstAttempt` 成就口径（M3 遗留 2）随持久化一起复核：重启浏览器后
    `clearedBefore` 应仍为 `true`（进度已持久化），M4 的注释已标注此处需复核。
- [ ] 5.4 ⚠️ **`App.tsx` 的 boot 分流改动会影响 M2–M4 的 3 段冒烟脚本**
  （它们靠 `seedProgress` 种内存 store 后不 reload）。必须在阶段 6.3 复跑三段冒烟，
  并把种子改为 **localStorage 预填**（或 reload 后重种）。

**验证**：jsdom + `fake-indexeddb`（`setup.ts` 已内置）单测「写入 → 重载 → 读回一致」；
真实浏览器冒烟验证「刷新后进度与仓库状态保留」。

### 阶段 6：测试与验收

- [ ] 6.1 新增/修订用例：`executor.test.ts`（撤销命令全链路）、`targetState.test.ts`（如有新判定）、
  `levels.test.ts`（ch5 6 关）、新增 `persistence.test.ts`；修订 M4 遗留的过时断言。
- [ ] 6.2 三门禁：`typecheck` 0 / `test` 全绿（记录总数）/ `build` 记录 gzip（关注 350 kB 预算）。
- [ ] 6.3 真实浏览器冒烟：新增 `tools/smoke/run-ch5.cjs`（含**真实键盘输入**，参 M2 教训 3），
  并复跑 `smoke:legacy` / `smoke:ch2` / `smoke:ch3` 确认持久化接线未破坏既有流程。
- [ ] 6.4 文档收尾：本文件「执行结果」补全 + `docs/milestones/README.md` 索引行 +
  `AGENTS.md`「当前状态」同步。

## 三、M5b 任务拆解（待 M5a 交付后展开）

- [ ] R1 `engine/fileRemote.ts`：内存裸仓库（`git.init({ bare: true })` + 导出 `.git` 文件树，
  探针 5 已验证 7 个文件 1 次写入可行）+ 最小 Git 智能 HTTP 客户端
  （`GET /info/refs?service=git-upload-pack`、`POST /git-upload-pack`、
  `POST /git-receive-pack`；复用 isomorphic-git 的 `packObjects` / `indexPack` 原语）。
- [ ] R2 `gitApi`：`addRemote` / `listRemotes` / `deleteRemote` / `clone` / `push` / `fetch` / `pull`。
  - URL 白名单（决策 ③）；本地路径直连快速路径可选（**须与协议路径共享同一套语义**，
    不得让两条路径行为分叉）。
- [ ] R3 `sandbox`：落地 `LevelInit.remotes` 与 `template: 'cloneSource'`
  （删掉 `assertSupportedScope` 的 deferred fail-fast），`/remote.git` 每关重建。
- [ ] R4 `targetState`：`remote` 目标类型转正；`schema.ts` 两份名单同步（9+2 → 10+1）。
- [ ] R5 `ch4.ts` 5 关 + 章节注册 + 笔记接入（`git-remotes.md`）
  + 4-5「协作冲突」的剧本设计（多人推送冲突 = 远程领先时 push 被拒 → fetch → 合并 → push）。
- [ ] R6 `grammar`/`executor`/`completion` 的远程命令接线 + `undoable` 复核。
- [ ] R7 测试与验收：`run-ch4.cjs` 冒烟 + 三门禁 + M5 全量文档收尾。

## 四、范围边界（M5 不做）

- 第六章 `tag` 与终章 F-1/F-2（M6）；`tag` 目标类型维持 `implemented: false`；
- `stash`（决策 ④）；`branch -d` / `-m` 等分支管理；
- intro / gameComplete 完整叙事（M6）；
- Playwright E2E（M7）；提示系统与计分数值调参（M7）；
- 真实网络远程（GitHub 等）—— 明确不做，见决策 ②。

## 五、风险与注意

| 风险 | 对策 |
|---|---|
| isomorphic-git **无 reset 命令**，`--hard` 要自己重写工作区 | 先写探针实测 `checkout` 的 force 路径与逐文件回写，再定实现；关卡数据只依赖实测语义 |
| isomorphic-git **无 revert 命令** | 组合实现（tree diff + 反向 apply + commit）；冲突场景明确报不支持，关卡避开 |
| `HEAD~1` / `HEAD@{n}` 的 ref 语法自研 | 优先级最高的 1.6 项；先支持关卡与笔记用到的子集，超出报「暂不支持」而非猜 |
| amend 与 MERGE_HEAD / 空提交防御交互 | 三种组合逐一实测并写回归用例（M3 空提交防御是硬约束） |
| ref 移动日志的记录点分散易漏 | 收敛到 `gitApi` 的 ref 写入出口，不在各命令里各写一份 |
| `reset --hard` 的 undoable 扣分在 5-6 可能双扣 | 计分口径在关卡数据落地时用真实剧本验算，必要时改判据（属 M5a 内的复核点） |
| 快照持久化选型（超级块 vs 导出文件树）未定 | 5.2 先 spike 验证再定；**可靠性优先**，退化方案已备 |
| 持久化改动破坏 M2–M4 三段冒烟 | 6.3 强制复跑；种子改 localStorage 预填（正是 M4 遗留 1 的复核点） |
| boot 分流从「恒 intro」改为「有进度进 menu」 | 影响首启体验与全部冒烟入口；改动最小化并逐段验证 |

## 六、开工前探针实测（Lead）

M5 开工前的环境与行为核实（Node v26.9.0 / pnpm 12.5.1 / isomorphic-git ^1.27.0 实际装 1.42.x）：

1. **基线三门禁**：`typecheck` 0 错误、`test` **228 passed**、`build` **169.73 kB gzip**
   —— 与 M4 文档记录的 228 / 169.76 kB 一致，无回归。
2. **`git.addRemote` 不做 URL 校验**：任意字符串（含 `https://github.com/...`、`/remote.git`）
   都会成功写入配置，`listRemotes` 原样返回。→ 决策 ③ 的白名单是必要的，不是洁癖。
3. **`git.clone` 拒绝虚拟路径**：传 `/remote.git` 抛
   `UrlParseError: Cannot parse remote URL: "/remote.git"`。→ 远程通道必须自写客户端。
4. **`git.commit` 支持 `amend: true`**（在 `index.d.ts` 的 `commit` 参数中确认），
   但 M1 起 `executor` 对 `--amend` 一律回「不支持」，`executor.test.ts:316` 有对应断言
   —— M5a 落地时需一并修订该过时断言。
5. **`git.init({ bare: true })` + 导出 `.git` 可行**：探针把 `/seed` 仓库的 `.git`
   导出为内存 Map 仅得 **7 个文件**（objects 3 + refs/heads/main + config + HEAD + index），
   一次写入即可重建 —— M5b 的内存裸仓库方案成立。
6. **`sandbox.reset` 的 fail-fast 范围**：`template:'cloneSource'` / `tags` / `remotes`
   三者在 `assertSupportedScope` 中报错（`branches` 已于 M4 转正）—— M5b 落地时需删对应分支。

### 阶段 1 开工前的撤销引擎探针（决定实现路径，全部实测）

7. **`git.commit({ amend: true })` 可用**：amend 后新提交的 `parent` **仍为原父提交**
   （实测 `[c2]`），旧提交成为孤儿、`git log` 不再列出 —— 与真 git 一致，直接可用。
8. **`amend` 不复刻真 git 的「无内容可修补」拒绝**：真 git 在「索引树与父提交树相同」时
   报 `You have nothing to amend` 并退出；isomorphic-git **照样产出新提交**（实测）。
   → 需在 `gitApi.commit()` 里补一道与前作同款的**空修补防御**（复用 `status()` 的
   `staged.length === 0` 判据），否则 5-1「修正笔误」可被「什么都不改直接 amend」绕过。
9. **`resolveRef` 完全不支持 ref 表达式**：`HEAD~1` / `HEAD~2` / `HEAD^` / `HEAD@{0}` /
   `HEAD@{1}` / 短 hash **全部 `NotFoundError`**（实测逐一验证）。
   - 短 hash 可由 `git.expandOid({ oid })` 还原（实测可用）；
   - `expandRef` 对 `HEAD~1` 同样失败（它只处理 `refs/…` 全名补全）。
   → **ref 语法（`~n` / `^` / `@{n}` / 短 hash）必须自研**，这是第五章的关键路径：
     笔记 `git-undo.md` 的核心命令就是 `git reset --soft HEAD~1` 与
     `git reset --hard HEAD@{n}`，不做则整个第五章无法照笔记操作。
10. **`reset` 三模式可用底层原语精确组合**（逐一实测三态 `statusMatrix` + 工作区内容）：
    - `--hard`：`writeRef(refs/heads/<b>, target)` + `checkout({ ref: branch, force: true })`
      → 工作区与索引**都**同步到目标提交（实测 workdir `v3`→`v2`，矩阵回 `[1,1,1]` 干净）；
    - `--soft`：**只** `writeRef`，不动索引与工作区 → 矩阵稳定在 `[1,2,2]`（已暂存），
      正是笔记「撤销提交，修改仍在暂存区」的语义；
    - `--mixed`：`writeRef` + 逐文件 `git.resetIndex({ filepath, ref: 'HEAD' })`
      → 矩阵落到 `[1,2,1]`（未暂存），工作区保留 —— 与笔记模式对比表逐格吻合。
    - ⚠️ **`resetIndex` 必须带 `filepath`**：省略参数抛 `MissingParameterError`（实测），
      故 `--mixed` 需遍历索引路径逐个复位。
11. **`revert` 的组合实现路径可行**：读目标提交与其父的 tree → 取双方路径并集 →
    逐路径比对「HEAD 上的当前版本」与「目标提交引入的版本」：
    - 一致 → 可安全反向（实测 `a.txt` 由 `BAD` 回到 `v1`）；
    - 不一致 → 说明目标提交之后该路径又被改过，真 git 会冲突 → 明确报「当前版本不支持」
      （与 `rebase` 同款纪律，§14 不伪造）。
    - 未被改动但出现在父/子 tree 差异中的路径（实测 `b.txt` 两侧同内容）会被自然跳过。

---

## 执行结果（M5a 完成，Lead 记录）

> 状态：**M5a DONE**（第五章「时空回溯」6 关 + 快照持久化）。M5b（第四章远程 + 本地远程客户端）尚未开工。

### 交付清单

**引擎层 `engine/`**
- `refExpr.ts`（新增）—— ref 表达式解析（`HEAD~1` / `HEAD^n` / `HEAD@{n}` / 短 hash）。
  isomorphic-git 的 `resolveRef` 对这些写法**一律抛 NotFoundError**（探针逐一实测），故必须自研。
- `reflog.ts`（新增）—— ref 移动日志（isomorphic-git 无 reflog 实现），
  输出格式与 `docs/notes/git-undo.md` 逐字一致。
- `gitApi.ts`：`commit({ amend })`（含**空修补防御**）、`reset`（三模式）、
  `restore`（含 `--staged`）、`checkoutPaths`、`revert`（组合实现）、`reflog`、
  `resolveRef`（支持 ref 表达式）、各 ref 写入出口的 reflog 记录。
- `sandbox.ts`：`LevelInit.dirty` 落地（见下「新增能力」）+ reflog 每关清空。

**输入层 `game/command/`**
- `grammar.ts`：白名单加入 `reset` / `restore` / `revert` / `reflog`；
  `commit --amend --no-edit`、`checkout -- <path>` 旧语法的解析。
- `executor.ts`：四个新命令的分发与中文回显；`undoable` 接线（§6.2 / §7.3 口径）。

**数据层**
- `game/types.ts`：**新增 `LevelInit.dirty`**（见下）。
- `levels/chapters/ch5.ts`（新增）—— 第五章 6 关。
- `levels/presets.ts`：第五章的 13 个预置文件常量。
- `levels/chapters/index.ts`：注册 ch5、`playable: true`、**四处章名对齐 GDD**。

**持久化 `persistence/`（新增目录，§10）**
- `progress.ts` —— `gtp:progress:v1` / `gtp:achievements:v1` / `gtp:settings:v1`。
- `snapshot.ts` —— 快照库命名（`gtp:snapshot:<levelId>`）与清理。
- `boot.ts` —— 持久化接线与 `boot → intro/menu` 分流判据。
- `store/progressStore.ts` 接入 `hydrate()` / 落盘；`main.tsx` / `App.tsx` / `startLevel.ts` 接线。

**测试与冒烟**
- 新增 `refExpr.test.ts`(24)、`persistence.test.ts`(22)、`progression.test.ts`(9)；
  `executor.test.ts` +20（撤销命令全链路）、`levels.test.ts` +14（ch5 六关）。
- `tools/smoke/run-ch5.cjs`（新增，33 断言）+ `cdp-client.cjs` 扩展
  （`runFree` / `latestHistory` / `reload` / `resetStorage`）。
- ⚠️ `src/__tests__/setup.ts` **新增 localStorage 垫片**：本仓库的 jsdom（30.x）
  不提供 `window.localStorage`（实测 `typeof localStorage === 'undefined'`），
  而 M5a 的持久化层依赖它。

### 三门禁（最终）

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` | **0 错误** |
| `pnpm test:run` | **317 passed**，0 failed（10 个测试文件） |
| `pnpm build` | **178.26 kB gzip**（预算 ~350 kB，余量充足） |

对比 M4：228 → **317**（+89 用例）、169.73 → 178.26 kB gzip（+8.5 kB）。

### 真实浏览器冒烟（四段全绿，两轮连跑无 flake）

| 脚本 | 结果 | 说明 |
|---|---|---|
| `smoke:legacy` | **8/8** | 段3：1-4 完整通关 + 未通关锁定态 |
| `smoke:ch2` | **8/8** | 段1：ch2 四关 + 章节解锁 |
| `smoke:ch3` | **15/15** | 段2：ch3 六关 + GitGraph + ch5 解锁链路（M5a 追加 1 断言） |
| `smoke:ch5` | **33/33** | **M5a 新增**：第五章六关全流程 + 持久化 reload 复核 |

合计 **64/64**。ch5 段覆盖：free 模式**真实键盘输入**（CDP `Input.insertText`）、
`--amend` 替换而非追加、`restore --staged` 保住工作区、`restore` 找回误删、
`revert` 反向提交、**完整「误 reset --hard → reflog → HEAD@{1} 恢复」剧本**、
进度落 localStorage 且 **reload 后仍在**。

### 执行中发现并修正的缺陷（8 个，全部有回归测试或冒烟覆盖）

1. **`parseRefExpr` 对普通分支名全线失败**（`engine/refExpr.ts`）：早期实现用「边扫边解析」
   的循环，首字符是字母时立即 break，`index` 停在 0 → base 变空串 →
   **所有普通分支名（`main` / `feature`）都被判为「缺少基础名称」**。
   连带使 `targetState` 的 `merged` 判定失败（ch3-3 可解性测试抓到）。
   修法：先 `findBaseEnd()` 切出基础段，再循环解析后缀。回归锁见 `refExpr.test.ts`。
2. **`HEAD@{n}` 语义搞错**（`engine/reflog.ts`）：曾误以为要取「该条记录的 `from`」，
   导致 `HEAD@{1}` 返回更早的落点、5-6 的恢复剧本接到错误位置。
   经**真 git 实测**（`git rev-parse HEAD@{n}` 逐项对照）确认：**一律取 `to`**。
   这是本里程碑最隐蔽的一处 —— 单看 `@{0}` 恰好也对，只有 `@{1}` 会露馅。
3. **`@{ }` / `@{}` 被静默当成 `@{0}`**：`Number(' ')` 与 `Number('')` 都是 0，
   早期用 `Number.isInteger(Number(inner))` 判合法性因而放过它们。
   改用 `/^\d+$/` 先校验（同时排除 `1.5` / `-1` / `+1`）。
4. **`reset --hard` 的 reflog 记录点漏了「同头分支切换」**：`checkout` 原本按
   `previous !== next` 判断是否记录，但 `main` 与刚创建的空分支同头，
   真 git 照样留记录。改为按**分支名是否变化**判断。
5. **ch5 因 ch4 未实现而永久锁死**（`game/progression.ts`，冒烟实测发现）：
   M4 的规则是「第 N 章解锁 ⇔ 第 N-1 章全部通关」，逐级相邻；而 ch4（M5b）
   关卡数为 0 → `isChapterCleared('ch4')` 恒 false → **M5a 已交付的 ch5 进不去**。
   修订为「回溯到最近一个**有关卡**的章节」；将来 ch4 落地后规则自动变回逐级相邻。
   回归锁见 `progression.test.ts`(9)。
6. **M5a 的持久化打破了 M2~M4 三段冒烟的「全新玩家」假设**（M4 已预警的风险）：
   上一次冒烟留下的进度会被下一次读到 → 段3 的「无进度时 ch2 锁定」失败。
   修法：新增 `H.resetStorage()`（清三个键 + 删快照库 + reload），三段脚本开头调用；
   同时把段1/段2 的汇总断言分母从 14 更新为 20（ch5 注册后关卡总数变化）。

7. **冒烟脚本的收尾必须 `process.exit()`**：`run-ch5.cjs` 首版只调了 `summarize()`
   而没退出，WebSocket 让 Node 进程**永不结束**（脚本看似「挂起」）。
   其余三段都有 `process.exit(ok ? 0 : 1)`，新脚本沿用时遗漏了。
8. **`enterLevel` 的就绪判据必须区分输入模式**：menu / half 模式渲染 `command-preview`，
   而 **free 模式（第五章起）渲染 Terminal 的 `[aria-label="命令输入"]`** ——
   沿用旧判据必然超时（实测）。已改为「二者其一 + 页面含关卡 id」。

### 新增能力：`LevelInit.dirty`（第五章的前提）

`commits` 只能预置「已归档的正确状态」、`files` 只能预置「未追踪的新文件」——
两者**都无法表达「已追踪文件的工作区被改写 / 被误删」**，而第五章的叙事前提
恰恰是「错误已经发生」（5-2 的已暂存改动、5-3 的改乱与误删）。

故新增 `LevelInit.dirty: Record<string, string | null>`（M5a）：
- 在所有预置提交与检出游标归位**之后**执行；
- 字符串值 → 覆盖工作区内容（= 有未暂存改动）；`null` → 从工作区删除（模拟误删）；
- 删除走 `fsp.unlink` 而非 `git rm`（后者会把删除记进索引，玩家就不需要「恢复」了，
  与关卡要考的动作相反 —— 实测确认）。

### 设计缺口（如实记录，未假装判定完备）

§4.3 的 `TargetCondition` **没有「文件当前处于哪一层（工作区 / 暂存区）」的判据**，
因此：

- **5-2「撤销暂存」**：「草稿被误 add 又退出暂存」与「压根没 add」在判定上不可区分。
  本关用「草稿正文完好（`file`）+ 提交数（`commitCount`）」逼近该语义，
  并把「别把草稿一起归档」交由 hints 第三级明确警告。
- **5-6「时间跳跃」**：**「玩家执行过 reflog 恢复」无法被现有类型判定**。
  M5 决策 ⑤ 明确不新增类型，故目标锚在「提交数 + 工作区干净」这一**结果**上，
  完整剧本的可达性由 `levels.test.ts` 的专门用例锁定（走全流程：误 reset →
  reflog → `HEAD@{1}` 恢复 → 仍满足目标）。**已知宽松**：不犯错、直接归档也能过关。
- **5-1「修正笔误」**：无法表达「提交数没有增加」（预置已是 N 条，任何 `eq N`
  都开局即达标），故只用 `commitMessage` 一项正向判据（读 HEAD 的信息）。

三处都**没有**为了「看起来完备」而放宽或伪造判定（§14）；若将来要精确判定，
需新增 `TargetCondition` 类型（如「文件未被任何提交追踪」「历史经过 reflog 恢复」），
属 §4.3 的模型扩展，应作为独立议题提出。

### 遗留与移交

1. **ch4（远程）属 M5b**：`/remote.git` 仍是空目录，`LevelInit.remotes` /
   `template: 'cloneSource'` 仍在 `sandbox.assertSupportedScope` 的 deferred 名单里
   （fail-fast，不伪造）。`TargetCondition.remote` 仍为 `implemented: false`。
2. **ch6（标签）与终章 F 属 M6**：`TagCondition.tag` 同上。
3. **`stash` 不做**（M5 决策 ④）：语法层继续回「该版本不支持」。
4. **快照的恢复路径未接 UI**：`snapshot.ts` 提供了库命名与清理，
   LightningFS 自身会把每关的 fs 持久化在该库里（`fileDbName`），
   但**「刷新后自动恢复到关卡中途」的用户可见行为尚未接线** —— 当前刷新会回到
   boot 分流（有进度 → 菜单），而不会自动跳回关卡内。是否要做「恢复中途进度」
   属产品决策，留给 M5b/M7 与用户确认（见下方「待用户确认」）。
   ⚠️ 另外 `clearSnapshot()` 因 LightningFS 未公开关闭单例的出口，
   删库可能触发 `onblocked`（已设立即放行，不会卡 UI，但旧库可能残留）。
5. **`gtp:settings:v1`** 有读写函数与测试，但**尚无 UI 消费方**（提示开关属 M7 打磨）。
6. **`firstAttempt` 口径已复核**（清偿 M3 遗留 2）：进度持久化后，
   「重启浏览器再重玩某关」不再被误判为首次尝试。
7. **`probeBonus` / `undoPenalty` 的数值**仍留 M7 调参；第五章的 `undoPenalty: 15`
   与前三章持平，5-6 的「误操作 + 恢复」会记两次 undoable（扣 30 分），
   在 `winScore: 75` 下仍可达 ★★，属有意的设计（惩罚鲁莽但不阻断教学）。

### 待用户确认（M5b 开工前）

- **快照恢复的产品口径**：刷新关卡页后应「自动恢复中途进度」还是「回菜单重新开始」？
  前者要接 UI 与恢复时序（风险：恢复出的仓库状态与目标判定的交互），
  后者则 `snapshot.ts` 只需保留清理职责（当前实现即按此）。
- M5b 的定稿已在本文档 §三，可直接开工。
