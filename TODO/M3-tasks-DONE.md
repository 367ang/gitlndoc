# M3 任务：计分 / 星级 / 成就

> 状态：**DONE**（M3 已完成，见文末「执行结果」）
> 依据：`development-refinement.md` §7（评分系统）、§13（M3 定义）、`game-design.md` §5（评分/星级/成就）、
> `TODO/M2-tasks-DONE.md` §9（M3 建议）与 §4/§5（实测环境事实、已知问题）。
> **动 `engine/` 前务必先读 `TODO/M2-tasks-DONE.md` §4「实测环境事实」与 §5「已知问题」。**

## 〇、已确认的决策（Lead 与用户于 M3 开工前确认）

1. **范围**：核心范围（计分引擎 + 星级 + 结算展示 + store 接线 + 测试）**附加全部三项**：
   ① 引擎空提交修复；② Hints 面板 UI；③ 菜单页计分展示 + 成就入口。
2. **optimalBonus 判定**：`Level` **增加 `optimalMoves` 字段**（参考命令数），
   「与参考一致或更短」即给 `optimalBonus`。需改 `schema.ts`、ch1 四关数据、`levels.test.ts` 校验。
3. **成就清单**：5 个 —— GDD §5.3 的 3 个示例（零回溯大师 / 一次成型 / 无提示通关）
   + 2 个进度类（首次通关 / 章节完美）。成就 UI 仅在菜单页。
4. **probeBonus 上限**：实现完整计数逻辑，**上限常量取占位值并留 TODO 注释**，数值待 M7 平衡调参。
   注意：第一章命令集只有 `init/add/commit`，无只读探查命令，probeBonus 在第一章实际不触发。

## 一、任务拆解

### 阶段 1：计分引擎 `game/scoring/`（纯函数层）

- [x] `src/game/scoring/score.ts` —— 纯函数 `evaluateScore(level, history, opts)`：
  - 输入：`Level`（含 `scoring` 与 `winScore`）、`CommandEntry[]`、会话附加信息（提示使用次数等）；
  - 基础分：目标达成度加权（§7.1），全部目标满足才过关；
  - 惩罚：撤销类命令 `-undoPenalty`、同目标重复提交 `-redoPenalty`、每步提示 `-hintPenalty`（§7.2）；
  - 奖励：命令数 ≤ `optimalMoves` 给 `+optimalBonus`、0 撤销 0 提示给 `+flawlessBonus`、
    只读探查（status/log/branch）小额 `+probeBonus` 且受上限约束（§7.3）；
  - **得分下限为 0**，星级按 §7.4：★ 过关；★★ `≥0.8·winScore` 且无撤销；★★★ `≥0.95·winScore` 且 0 提示 0 撤销。
- [x] `src/game/scoring/achievement.ts` —— 成就判定纯函数（何时调用 `unlockAchievement`，
  按 `progressStore` 约定**不放 store 层**）。
- [x] 填充 `src/__tests__/scoring.test.ts` 的 12 个 `it.todo`（4 星级 + 4 扣分 + 4 奖励/边界），
  并为 `optimalMoves` 判定与 probeBonus 上限新增用例。

### 阶段 2：关卡数据层 —— `optimalMoves`

- [x] `game/types.ts` 的 `Level` 增加 `optimalMoves: number`（参考命令数）；
- [x] `levels/schema.ts` 增加校验（有限正整数）；
- [x] ch1 四关填入 `optimalMoves`（按各关参考解法逐关核定，写入处注释说明）；
- [x] `levels.test.ts` 增加 `optimalMoves` 齐备性用例。

### 阶段 3：引擎修复 —— 空提交语义（M2 §5.1 遗留）

- [x] `engine/gitApi.ts` 的 `commit()`：暂存区与 HEAD 树无差异时返回「nothing to commit」失败语义，
  不再产出真 git 会拒绝的空提交；
- [x] `executor.test.ts` 补回归用例（**须用 LightFS 真实 init/add 流程构造，勿信 jsdom 单层模拟**，
  参考 M2 §4.2 对 `fireEvent.change` 的教训）。

### 阶段 4：UI 接线

- [x] `LevelScreen`：顶栏「得分 · 星级（M3）」占位替换为实时得分；接 Hints 面板
  （`stepHints.ts` 已就绪，缺 UI）并记录提示使用次数供计分；
- [x] `LevelComplete`：结算页增补（**不重写**，遵守其头注释）—— 得分、星级、扣分/奖励明细、成就解锁提示；
- [x] `MenuScreen`：总得分/星级汇总展示 + 成就查看入口（5 个成就列表与解锁状态）。

### 阶段 5：验收

- [x] 三门禁：`typecheck` 0 错误 / `test` 全绿（12 todo 全部转实）/ `build` 通过且 gzip 体积无明显膨胀；
- [x] 真实浏览器冒烟（**按 M2 §4.5**：`--no-sandbox --disable-crashpad`，键盘走 CDP `Input.insertText`）：
  实际通关 1-1~1-4，验证得分/星级/成就解锁/菜单展示；
- [x] 完成后本文档改名 `M3-tasks-DONE.md`，执行结果按 M2 文档体例（含实测环境事实与遗留）追加记录。

## 二、范围边界（M3 不做）

- 持久化接入（progressStore 落 localStorage 属 **M5**，§10）；
- 章节解锁逻辑（跨章推进属 **M4**，需第 2–3 章关卡数据先行）；
- 「时空能量」经验值与提示额度（GDD §5.3，未纳入 M3，随 M7 打磨评估）；
- 时空能量之外的反作弊检测（GDD §5.4，属引擎语义修复的自然结果，M3 只修空提交一项）。

## 三、风险与注意

| 风险 | 对策 |
|---|---|
| `undoable` 恒 false（撤销类命令属 M4/M5），扣分路径在第一章不可实测 | 单元测试用假 history 覆盖逻辑；真实触发留待 M4/M5，测试注明 |
| probeBonus 第一章不触发（无只读命令） | 同上，测试层面覆盖 |
| `redoPenalty`「同目标重复提交」的判定语义（§7.2 未定义「同目标」） | 以 `commitMessage` 目标命中后再次 commit 计 redo；实现处注释说明，M4 有真实案例后复核 |
| Hints 面板引入失败次数状态提升 | `failures` 已在 `LevelScreen` useState，计分取数路径须与之一致，勿双源 |


---

## 执行结果（M3 完成，Lead 记录）

### 交付清单

| 阶段 | 交付物 | 结果 |
|---|---|---|
| 1 计分引擎 | `src/game/scoring/score.ts`（`evaluateScore` + `starsOf`）、`src/game/scoring/achievements.ts`（5 成就注册表 + `evaluateAchievements`） | ✅ |
| 1 测试 | `scoring.test.ts` 12 个 todo 全部转实 + 7 个 starsOf 边界用例 = **21 用例** | ✅ |
| 2 数据层 | `Level.optimalMoves`（types/schema 校验/ch1 四关 3·2·2·5/levels.test 用例） | ✅ |
| 3 引擎修复 | `gitApi.commit()` 空提交防御（复用 status() 推导，不重算状态）+ `executor.test.ts` 3 个回归用例 | ✅ |
| 4 UI | `LevelScreen`（实时得分 + HintsPanel）、`LevelComplete`（得分卡/成就卡/落库）、`MenuScreen`（汇总条 + 成就面板） | ✅ |
| 4 测试 | `components.test.tsx` 新增 8 个 M3 用例（HintsPanel 计数、结算落库、菜单汇总） | ✅ |
| 5 验收 | 三门禁 + 真实浏览器冒烟 20/20 | ✅ |

### 三门禁（最终）

- `typecheck`：0 错误
- `test`：**176 passed**（原 143 + 新增 33），0 todo
- `build`：157.53 kB gzip（M2 为 153.95，+3.58 kB，属计分引擎与结算 UI 的合理增量）

### 真实浏览器冒烟（20/20，方法沿 M2 §4.5）

- 菜单：汇总条 0 起步、成就 0/5、展开列表 5 项全未解锁 ✅
- 1-1：实时得分 0 → 通关 → 结算 **145 分 / ★★★**（100+最优20+一次通过25）✅
- 新解锁成就 4 项（零回溯大师/一次成型/无提示通关/初露锋芒）✅
- 1-2、1-3 通关 ✅
- **1-4 空提交被拒**：重复 `add .` + `commit "第二环"` 终端报「没有可提交的内容」，未过关 —— M2 时代同样操作可过关，教学点「没有新内容就没有新快照」现在真实成立 ✅
- 回菜单：总得分 435、成就 4/5（完美篇章未满，正确）✅
- 控制台无 JS 异常 ✅

### 执行中发现并修正的设计问题（2 个）

1. **§7.4 星级公式数学退化**（实施中与用户确认订正）：字面公式「★★ ≥0.8·winScore」
   在过关前提（≥winScore）下恒满足，0.8/0.95 系数失效。按用户裁定改为
   **系数基于 baseScore**（★★ ≥0.8·baseScore、★★★ ≥0.95·baseScore），与 GDD §5.2
   百分比分段一致。ch1 下三档为 ≥60/≥80/≥95。`starsOf` 注释记录了完整推导。
2. **提示计分语义**：「解锁即计数」会惩罚从未查看提示的玩家（面板自动解锁的
   方向提示也扣分），与「惩罚求助」的本意相悖。改为**查看即计数**：HintsPanel
   仅在玩家展开面板时对可见层级逐层上报；`sessionStore.settlement.hintCountedLevel`
   在 store 层按层级去重（StrictMode 重挂安全，单测含回归锁）。

### 实测环境事实（M4+ 注意）

1. **1-4 现在不可被空提交绕过**，但 UI 无文件编辑功能，「产生新改动」仍无玩家手段 ——
   1-4 完整通关需 M4 的文件编辑能力（FileTree 或编辑面板）。冒烟验证到「拒绝」为止。
2. **StrictMode 对「渲染期 setState + 副作用」的重放**：HintsPanel 首版在渲染期调
   `onHintUsed` + 本地 setState 去重，重挂后本地状态归零导致重复计数。教训：
   **跨渲染去重一律放 store 层**（本例 `hintCountedLevel`），组件内 ref/useState 均不可靠。
3. 冒烟脚本与选择器：CommandBuilder 的按钮用 `aria-label="拼接命令片段：*"` /
   `"执行拼接的命令"`，suffix 输入框为 `"补充命令参数，例如提交信息"` ——
   CDP 冒烟应按 aria-label 定位而非文本（文本随文案迭代漂移）。

### 遗留与移交（不阻塞 M3 验收）

1. **1-4 无法在 UI 内通关**：依赖 M4 文件编辑功能（见「实测环境事实」1）。
   M4 落地编辑后应补一条 1-4 完整通关的冒烟用例。
2. **`firstAttempt` 在浏览器重启后会失真**：progressStore 无持久化（M5），
   重启后 levelRecords 为空 → 再次进关被判「首次」。「一次成型」成就口径
   需随 M5 持久化复核（已写入 startLevel 注释）。
3. **probeBonus 上限常量 3** 为占位值（`PROBE_BONUS_MAX_EVENTS`，types.ts），
   第一章不可实测，M4 引入 status/log 关卡后复核，最终数值 M7 调参。
4. `redoPenalty` 的「同目标」判据 = **同提交信息去重**（score.ts 注释记录了
   裁定理由），M4 有真实撤销/分支关卡后复核是否误伤正常工作流。
