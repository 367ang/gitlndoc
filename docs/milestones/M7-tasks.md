# M7 任务：打磨、调参、E2E —— 发布候选

> 状态：**DONE**（提示分级扣分 + 星级回归 GDD + undoable 名单收窄 + 设置开关 UI +
> 全 32 关可达性总回归 + Playwright E2E + 真机终章 F/perfect-game 验收 + code-split）。
> 依据：`development-refinement.md` §13（M7 = 提示系统、平衡调参、E2E、真机验证、性能）、
> M3/M4/M5/M6 四份文档的「遗留与移交」、GDD §5.1/§5.2。

**本文档结构**

- [一、范围与交付](#一范围与交付)
- [二、开工前决策（用户裁定）](#二开工前决策用户裁定)
- [三、任务拆解与执行结果](#三任务拆解与执行结果)
- [四、验收 / 三门禁](#四验收--三门禁)
- [五、⚠️ 实测环境事实](#五-实测环境事实)
- [六、设计缺口（如实记录）](#六设计缺口如实记录)
- [七、遗留与移交](#七遗留与移交)

## 一、范围与交付

| 批次 | 内容 | 状态 |
|---|---|---|
| 提示系统 | 扣分对齐 GDD §5.1 三级（方向 −5 / 命令 −10 / 完整答案 −20，按层级位置分档）；`gtp:settings:v1` 的 `hintsEnabled` UI 消费方落地（菜单开关 + HintsPanel 隐藏） | ✅ |
| 星级公式 | 回归 GDD §5.2 分数主轴：★ ≥ winScore；★★ ≥ 0.7·base；★★★ ≥ 0.9·base 且 0 提示；撤销经 undoPenalty 影响落段、不再锁星 | ✅ |
| undoable 名单 | 收窄为 reset / checkout --（回退型）；revert / restore 摘出（精确修复型，教学正解不应被罚） | ✅ |
| 调参 | probeBonus 上限 3 经 32 关实测**维持不变**；undoPenalty 15 定稿；1-4 winScore 90→85、5-6 winScore 75→65（「照完整答案执行必能过关」不变量的数据修正） | ✅ |
| 可达性总回归 | 新增 `allLevelsWalkthrough.test.ts`（5 用例）：全 32 关走参考解法必过关、得分 ≥ winScore、零提示 ≥ 2 星、用满提示仍能过关、undoable/probe 定稿复核 | ✅ |
| E2E | Playwright 主链路 2 用例（intro→菜单→1-1 拼接通关→进度落盘→刷新仍在；设置开关行为），`pnpm e2e` | ✅ |
| 真机验收 | 新增冒烟段7 `run-final.cjs`（22 断言）：终章 F 两关真机通关 + perfect-game 成就真机触发 + 结局页真实链路 | ✅ |
| 性能 | vite `manualChunks` 三分块（react-vendor / git-engine / index），chunk >500kB 警告消除，vendor 缓存命中改善 | ✅ |

## 二、开工前决策（用户裁定）

M7 开工前与用户确认五点，全部按建议采纳：

1. **提示扣分对齐 GDD**：按层级分档（方向 −5 / 命令 −10 / 完整答案 −20），
   实现为「`hintPenalty`（现值 5）× 1:2:4 倍率」，关卡数据零改动。
2. **E2E 工具**：Playwright 只补 §11.4 的主链路冒烟；CDP 六段（现七段）冒烟继续
   承担全量通关回归 —— 两套并存，各司其职。
3. **M7 范围**：全做（提示/调参/E2E/真机/性能 + 32 关可达性总回归）。
4. **undoable 名单收窄**（实施中裁定）：revert / restore / checkout -- 原按 §6.2
   字面清单记惩罚，但第五章 5-3/5-4/5-5/5-6 的**参考解法本身就是这些命令** ——
   「照教学正路玩被扣分锁星」与「奖励理解、惩罚试错」（§7 开篇）相悖。收窄为
   reset / checkout -- 两类**回退型**；revert（历史只增不减）与 restore（从归档
   版本精确恢复）是修复手段而非破坏。checkout -- 因与 reset 同向（粗放覆盖工作区）
   保留惩罚，与 restore 形成教学对比。
5. **星级公式回归 GDD §5.2**（实施中裁定）：M3 口径的「undoCount>0 恒 1 星」
   与 4 同源冲突（5-6 的关卡目标**要求**玩家体验 reset 破坏再恢复 —— 照剧本玩
   永远 1 星），且把 perfect-game 成就变成「逼玩家绕开 revert 伪造提交」的负激励。
   改为分数主轴（★★ ≥0.7·base / ★★★ ≥0.9·base 且 0 提示），撤销只经分数影响落段。

## 三、任务拆解与执行结果

### 阶段 0：基线与依据

- [x] 0.1 基线三门禁 —— **typecheck 0 / 399 passed / build 194.74 kB gzip**（与 M6 记录一致）。
- [x] 0.2 通读 M3/M4/M5/M6 四份文档的遗留移交清单，汇总 M7 待办：
      提示分级扣分（M5 遗留 7）、`gtp:settings:v1` 消费方（M5 遗留 5）、
      probeBonus/undoPenalty 调参（M3 遗留 3 / M4 遗留 4 / M5 遗留 7）、
      Playwright E2E（M4/M5 遗留）、「时空能量」评估（M3 遗留）。

### 阶段 1：提示分级扣分（`game/scoring/score.ts`）

- [x] 1.1 `countHintPenalty`：按「已看层级」1..N 累计档位罚分 ——
      首层 1×hintPenalty、中间层 2×、末层 4×（层级位置即档位：关卡提示恒为
      「方向→命令→答案」递进剧本，与 GDD §3.3 三级同构）。
- [x] 1.2 计数语义依据：HintsPanel 逐层上报 + sessionStore 按层级单调去重 +
      「展开即全部可见」⇒ `hintsUsed` 恒等于「已看到的最高层级」且不跳层 ——
      从条数推导档位无需改上报链路。
- [x] 1.3 越界防御：`hintsUsed` 超出 `hints.length` 按总层数封顶（测试锁定）。

### 阶段 2：星级公式与 undoable 名单

- [x] 2.1 `starsOf` 重写（签名去掉 `undoCount` 参数）：★ ≥ winScore；
      ★★ ≥ 0.7·base；★★★ ≥ 0.9·base 且 0 提示。注释完整记录 M3→M7 口径沿革
      与理由（教学正路冲突 + perfect-game 负激励）。
- [x] 2.2 executor 的 `succeed(…, true)` 收窄：revert / restore 两处摘出；
      checkout -- 保留；两处口径注释重写。
- [x] 2.3 数据修正：1-4 winScore 90→85（分级扣分下「用满提示照抄」= 85 分，
      原 90 与提示兜底定位矛盾）；5-6 winScore 75→65（完整教学剧本 5 条成功
      > optimal 2 → 无 optimal；2×reset → −30；无 flawless ⇒ 100−30=70，
      原 75 让照剧本玩无法过关 —— **M5 遗留 7「仍可达 ★★」实为笔误**，旧口径
      undoCount>0 恒 1 星从未成立，本轮订正）。
- [x] 2.4 单测更新：scoring.test.ts 星级/提示/边界三段按新口径重写（26 用例）；
      executor.test.ts 的 undoable 口径用例按新名单改写。

### 阶段 3：设置开关 UI（清偿 M5 遗留 5）

- [x] 3.1 `progressStore` 增 `settings` 状态 + `setSettings`（落盘
      `gtp:settings:v1`）；`hydrate()` 同时读回 settings。
- [x] 3.2 `LevelScreen` 按 `hintsEnabled` 条件渲染 HintsPanel（关闭时不渲染面板，
      提示扣分自然为 0，no-hint 成就照常可判）。
- [x] 3.3 `MenuScreen` 汇总条增「提示开/关」按钮（`data-testid="hints-toggle"`，
      aria-pressed 驱动两态样式）。
- [x] 3.4 单测：components.test.tsx 增开关行为用例（含落盘断言）。

### 阶段 4：全 32 关可达性总回归（`allLevelsWalkthrough.test.ts`）

- [x] 4.1 整合各章 plans 为全 32 关一张表（含 4-5 的 `expectFailure` 标记 ——
      第一条 push 预期被拒是教学起点）。
- [x] 4.2 五条断言：计划表覆盖 32 关不缺号；逐关走参考解法必过关 + 得分 ≥
      winScore + 零提示 ≥ 2 星；用满提示（含 optimal 奖励）仍 ≥ winScore；
      5-6 教学剧本/最简解各得其所（70 分 ★★ / 145 分 ★★★）；probeBonus
      上限 3 实测复核（全部参考解法只读命令 ≤3、探查分不是过关必要条件）。
- [x] 4.3 本用例即 M7-3 调参的实测依据：probeBonus=2 / 上限 3 维持，
      undoPenalty=15 定稿（写入 score.ts 注释）。

### 阶段 5：Playwright E2E（§11.4 落地）

- [x] 5.1 `playwright.config.ts`：自动起 vite dev（5199）+ Chromium
      （浏览器装在工作区 `.playwright-browsers/` —— HOME 缓存目录不可写）。
- [x] 5.2 `e2e/main-flow.spec.ts` 两用例：
      ① 新玩家 intro→菜单→1-1 拼接通关（真实点击片段 + `pressSequentially`
      真实键盘输后缀）→ 结算页 → 进度落 localStorage → 刷新仍在；
      ② 设置开关：关闭后进关故意失败，HintsPanel 不渲染（提示系统整体停用）。
- [x] 5.3 复刻 cdp-client 的三条实测教训（slot0 需先点解锁 slot1 的 React 批处理、
      「history 增长或已离开关卡页」双结局判据、结算页不含关卡 id）。

### 阶段 6：真机验收（冒烟段7 `run-final.cjs`）

- [x] 6.1 F-1 真机通关：编辑器改信标 → 归档 → checkout main → merge（真冲突）→
      编辑器裁决 → 完成合并 → 结算 ★★★。
- [x] 6.2 F-2 真机通关：编辑器新建交付清单 → 两次归档 → describe（无标签报错）
      → 注解标签 → 结算 ★★★。
- [x] 6.3 **perfect-game 首次真机触发**：种子 30 关全 3 星 + 真机 F 两关 3 星 →
      结算页成就卡「完美通关」；菜单成就 6/6；结局页从真实通关链路进入。
- [x] 6.4 既有六段复跑并修正两处分母（`run-ch2` 8/25→8/32、`run-ch3` 14/25→14/32
      —— M6 注册终章后冒烟分母未同步，属既有遗漏）；段7 加固一处时序
      （merge 后等文件树刷新再 editFile）。

### 阶段 7：性能（code-split）

- [x] 7.1 `vite.config.ts` 增 `manualChunks`：`git-engine`（isomorphic-git +
      LightningFS）/ `react-vendor`（react + react-dom + zustand）两个 vendor 块。
- [x] 7.2 效果：index 61.47 + react-vendor 45.69 + git-engine 87.70 ≈ 195 kB gzip，
      >500kB 警告消除；改游戏代码不再使 isomorphic-git 的浏览器缓存失效。

## 四、验收 / 三门禁

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` | **0 错误** |
| `pnpm vitest run` | **410 passed**（12 文件），0 todo |
| `pnpm build` | **195.6 kB gzip**（3 chunk，无警告；预算 ~350 kB） |
| Playwright E2E | **2/2**（两轮无 flake） |
| CDP 冒烟七段 | **152/152**（8+8+15+33+41+25+22；段7 五轮全绿） |

测试计数对齐 M6 的 399 → **410**（新增 11：allLevelsWalkthrough +5、components +1、
scoring 重写后 +5 净增）。

## 五、⚠️ 实测环境事实

1. **`getByLabel` 不能与父 locator 链式用于「组内精确匹配」**：链式语义是
   「父元素的 accessible name」，不是「在父内按 label 找」。组内精确匹配用
   `hasText` + 正则整文本锚（`/^·$/`）—— 字符串 hasText 是子串匹配，
   `'.'` 会撞上 `'README.md'`（Playwright strict mode 直接报 2 elements）。
2. **slot0 的 `data-command` 是完整命令组名**（`git init`），不是裸组名 ——
   Playwright 定位 slot0 要用 `[data-command="git ${group}"]`（探针实测 DOM）。
3. **Playwright 的 click 自带 actionability 重试**，天然解决「slot0 与 slot1
   不可在同一同步块点击」的 React 批处理问题 —— CDP 脚本要手工 sleep，
   Playwright 不需要。
4. **Chromium 的 HOME 缓存目录（`~/Library/Caches/ms-playwright`）在本机不可写**
   （EPERM），须 `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers` 装进工作区
   （已加 .gitignore）。
5. **`@playwright/test` 与 `playwright` 是两个包**：只装后者会
   `ERR_MODULE_NOT_FOUND`（config 导入 @playwright/test 失败），两个都要装。
6. **冒烟 `latestHistory` 恒回 `ok:true`**（DOM 解析无法区分输出行/错误行的
   既有启发式局限）—— 段7 首轮「describe 报错」断言失败是断言写法问题
   （`r.ok === false`），不是应用缺陷（单测已锁 ok:false）。冒烟断言报错类
   行为时用「输出含报错文案」。
7. **段7 曾一轮 flake 在 `editFile`（F-1 冲突裁决）**：merge 后文件树要等一次
   useFileTree 刷新才有编辑入口。加固为 `waitFor` 入口出现再编辑，此后五轮全绿。
8. **「照完整答案执行必能过关」是不变量**：最坏 = base + optimal − Σ分级罚分
   = 100+20−35 = 85。32 关逐一验算后仅 1-4（90）违反 —— 数据修正为 85。
   5-6 是另一处（教学剧本含撤销罚分 + 无 optimal 无 flawless ⇒ 70 < 75），
   修正为 65。**新增关卡时务必让 winScore ≤ 85 或有明确的推导依据**。
9. **`vite build` 的 fs.ts dynamic-import 提示是 info 级既有现象**（M5a 起
   snapshot/fileRemote/gitApi 的动态导入与静态导入并存），不随 manualChunks 消失，
   不影响产物正确性。

## 六、设计缺口（如实记录，不假装完备）

1. **「时空能量」未实现**（M3 遗留 5 的评估结论）：GDD §5.3 只有概念（经验值 +
   提示额度），无任何数值/交互定义；现行的「提示扣分 + 解锁阈值」已完整覆盖其
   教学功能。引入需先扩 GDD，不在打磨期擅自发明。
2. **Tab 补全候选面板未做**（M4 遗留 5 评估结论）：现有「补公共前缀」交互在
   32 关实测下无卡点，候选面板属锦上添花，不为做而做。
3. **redoPenalty 的「同信息去重」口径维持 M4 复核结论**：32 关参考解法无一处
   触发，无误伤证据；不改。
4. **星级 ★★★ 的「0 提示」仍是硬条件**：GDD §5.2 的 ★★★ 描述是「零错误、
   命令数最优、无提示」—— 撤销已放开、提示保留，是有意取舍（「无提示通关」
   成就与 ★★★ 同源）。
5. **Playwright 只覆盖主链路**：章章剧本回归仍由 CDP 冒烟承担（152 断言）；
   两套脚本暂不合并（收益低、回归风险高）。

## 七、遗留与移交

- **无阻塞遗留**。M3/M4/M5/M6 移交的全部条目已清偿或明确评估结论（见设计缺口）。
- 后续可选方向（不构成下一里程碑的承诺）：
  - `git tag -l <pattern>` 与嵌套 tag 解引用（M6 遗留，需第七章扩容再评估）；
  - Playwright 扩展到半拼/自由模式关卡（当前由 CDP 覆盖）；
  - `remoteTag` 目标类型（M6 遗留的「标签已推送」判定，需新增 TargetCondition）。
