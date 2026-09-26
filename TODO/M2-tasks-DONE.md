# M2 任务清单（关卡框架 + 第一章可玩）—— ✅ 已完成

> 本文档记录 M2 的执行结果、验收证据与实测环境事实。原 `M2-tasks-TODO.md` 的任务清单保留在下方（已勾选）。
>
> **M2 目标（§13 原文）**：`levels/schema.ts` + 第一章 4 关、Terminal/FileTree/GoalPanel、目标检测。
> **M2 产出（验收标准）**：第一章可玩（菜单式）。 → **已达成**

---

## 〇、验收结论（Lead 独立复跑）

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` | **退出码 0** |
| `pnpm test:run` | **141 passed \| 12 todo**（5 文件通过、1 跳过）；连跑 3 次一致，无 flake |
| `pnpm build` | **通过**，约 `153.8 kB gzip`（§12 预算 ~350 KB，余量充裕；数值随构建波动 ±0.1 kB） |
| `pnpm dev` + 真实浏览器冒烟（§5.5） | **17/18 项通过**（唯一「失败」为验收脚本自身查询时机问题，见 §5.5 说明） |
| `it.todo` 数量 | 34 → **12**（剩余 12 全属 `scoring.test.ts`，计分属 M3，按要求不动） |

**结论：第一章四关在真实浏览器中可完整通关**（menu → chapter → 1-1 → … → 1-4 → 结算页），
且真实键盘输入、跨关卡清理、目标增量判定均经独立验证。

---

## 一、交付内容

### 新增文件（32 个）

**关卡数据层（`src/levels/`）**
| 文件 | 行数 | 说明 |
|---|---|---|
| `schema.ts` | 320 | 运行时校验 + 类型守卫；`IMPLEMENTED_TARGET_TYPES` 为实现进度的单一事实来源 |
| `presets.ts` | 79 | 5 份中文叙事模板文件 |
| `chapters/ch1.ts` | 289 | 第一章 4 关定义 |
| `chapters/index.ts` | 146 | `CHAPTERS` / `getLevel` / `getChapterLevels`（按数值序号排序）/ `getAllLevels` / `getChapterMeta` |

**目标检测（`src/game/validate/`）**
| 文件 | 行数 | 说明 |
|---|---|---|
| `targetState.ts` | 395 | 5 种已实现 + 6 种明确报「尚未实现」 |
| `stepHints.ts` | 115 | 按 `unlockAfterFailures` 分层解锁 |
| `stillMissingHint.ts` | 39 | GoalPanel 的抽象引导语（§9.1：不给具体命令） |

**拼接纯函数层（`src/game/command/`）**
| 文件 | 行数 | 说明 |
|---|---|---|
| `fragments.ts` | 253 | 片段表 + 槽位组装 + 置灰闸门（GDD §3.2「点击拼接」） |

**UI 层**
| 文件 | 说明 |
|---|---|
| `ui/components/level/LevelScreen.{tsx,module.css}` | 关卡主界面（§9.1 布局），**从 `src/app/LevelScreen.tsx` 迁移而来** |
| `ui/components/level/LevelComplete.{tsx,module.css}` | 过关结算（含下一关/重玩/返回菜单） |
| `ui/components/goalPanel/GoalPanel.{tsx,module.css}` | 目标与检测面板，逐项打勾/叉 |
| `ui/components/terminal/CommandBuilder.{tsx,module.css}` | 点击拼接式输入 |
| `ui/components/menu/MenuScreen.{tsx,module.css}` | 主菜单 + 章节选择 |
| `ui/components/chapter/ChapterScreen.{tsx,module.css}` | 章节介绍 |
| `ui/hooks/useTargetState.ts` | 经 `evaluateTargets` 做目标检测 |
| `app/startLevel.ts` | 进入关卡的统一入口（`reset → setLevel → goLevel`） |

**测试（`src/__tests__/`）**
| 文件 | 之前 | 现在 |
|---|---|---|
| `targetState.test.ts` | 15 `it.todo` | **32 真实用例** |
| `components.test.tsx` | 7 `it.todo` | **31 真实用例**（含 Lead 补的 readOnly 回归锁） |
| `levels.test.ts` | — | **27 真实用例**（新建） |

### 修改 / 删除
- `src/app/App.tsx` —— 接上 menu/chapter/level/levelComplete 四个真实视图
- `src/store/sessionStore.ts` —— `level` 接真实关卡，新增 `targetState` / `draft`（拼接草稿）
- `src/ui/components/terminal/Terminal.tsx` —— `onExecuted` 回传 `ok`；输入行改组件内 state
- **删除** `src/app/LevelScreen.tsx`、`LevelScreen.module.css`（已迁至 §3 规划的 `src/ui/components/level/`）

---

## 二、验收标准的逐条核对（§13 M2）

- [x] `levels/schema.ts` —— 运行时校验（id 形如 `chN-M` 且与 chapter 一致、difficulty 1–5、inputMode 三选一、targets 非空、scoring 齐备）
- [x] 第一章 4 关 —— 严格照 GDD 第 77–80 行：1-1 时间线初始化 / 1-2 第一次快照 / 1-3 三态之谜 / 1-4 历史之链
- [x] Terminal / FileTree / GoalPanel —— 三者在关卡界面均真接线（非空转）
- [x] 目标检测 —— 只实现第一章用到的 5 种；其余 6 种明确报「尚未实现」
- [x] **第一章可玩（菜单式）** —— 真实浏览器实测四关全部通关

### 已确认决策的落实
1. **点击拼接，不做拖拽** ✅ —— `CommandBuilder` 为点击式，片段按钮 + 槽位组装
2. **M2 只做过关判定，不做计分与星级** ✅ —— `Level.scoring` 仅填占位值，**UI 一次都没读它**；结算页只显示「过关」，不显示任何分数/星级
3. **目标检测只实现 5 种** ✅ —— 其余 6 种返回 `implemented: false`，GoalPanel 渲染为灰色「尚未支持」而非红叉

---

## 三、执行中发现并修掉的真实缺陷（共 9 个）

> 这些**没有一个是按清单走能遇到的** —— 全部由实际验证（真实引擎 / 真实浏览器 / 突变测试）暴露。
> 其中两个是 M1 教训（「jsdom 通过 ≠ 真能跑」）的直接延续。

### 数据层 / 目标检测（3 个，由 data-validate 发现）

1. **`file` 目标无法判定目录存在性** —— LightningFS 对**目录**调用 `readFile` **不抛错、返回 `null`**（不是 ENOENT）。若按 catch-ENOENT 判存在性，`.git` 会被误判为「不存在」。
   **修法**：改用 `stat()`。**这是隐藏炸弹**：即使没有缺陷 2，它也会让 1-1 永远无法过关。

2. **1-1 开局即过关（设计错误）** —— `sandbox.reset()` 内部**总是**调 `gitApi.init()`，因此进关时 `.git` 已存在 → 若目标是 `file:.git exists`，玩家零操作即过关，属彻头彻尾的伪判定。
   **修法**：重构为 `commitCount>=1` + `workdirClean`，并预置一份「档案封面」文件，玩家必须真正归档才能让工作区重新干净。

3. **`commitExists` 全等匹配会卡死玩家** —— 提交信息自然长于关键词（「第一环：链条起点」vs 目标「第一环」），全等会让玩家「归档成功却过不了关」。
   **修法**：改为**子串包含**，与真 git 的 `git log --grep` 直觉一致（需要精确匹配时本就有 `commitMessage`(RegExp)）。

### UI / 交互层（4 个，由 ui-level 发现）

4. **`git add add .` 重复子命令** —— 片段表中 slot 0（`text="git add"`）与 slot 1（`text="add"`）语义重叠，玩家最自然的「先点子命令再点动词」路径拼出非法命令，实测 `git add add .` 直接报「找不到 add」。
   **修法**：改为**方案 B**（slot 0 只承载 `git`，子命令独立成 slot 1，槽位不重叠）。

5. **路径片段全为空，玩家根本拼不出 `git add README.md`** —— 路径原本只从 `targets` 的 `type:'file'` 推导，但第一章 4 关全用 `commitCount` + `workdirClean`（刻意避开了会「开局即达标」的 `file` 条件）→ 路径按钮全部为空。
   **修法**：改为同时从 `init.files` 推导。

6. **空格位缝合怪（语法层抓不到）** —— `git -m`、`git .` 都是某条合法命令的合法前缀，`parse()` 不报错但语义错误。
   **修法**：新增 `isFragmentEnabled` 置灰闸门（候选命令的所有较低槽位必须已填）。用**置灰而非隐藏**，避免按钮位置乱跳。

7. **🔴 1-1 在真实浏览器中无法通关（本轮最有价值的发现）** —— 拼接输入行被整体设为 `readOnly`，而拼接只给到 `-m` 为止，引号里的提交信息**必须玩家手敲** → `commit` 永远因缺消息被语法层拒绝，**1-1 卡死**。
   **为什么 jsdom 抓不到**：`fireEvent.change` **不受 `readOnly` 限制**，组件测试照样全绿。只有真实键盘输入才暴露。
   **修法**：输入行拆成两段语义 —— 片段拼出的部分只读展示（保证替换语义不失效），玩家手写后缀为可编辑 `<input>`（绑定 `Draft.suffix`）。
   **Lead 补充**：验收时为这一类缺陷加了 **`readOnly` 回归锁**（显式断言 `input.readOnly === false`），并用**突变测试**验证该断言确实会失败 —— 补上 jsdom 抓不到的那一环。

### 交互层（1 个，由用户人工验收发现）

9. **导航出口不全（用户人工验收发现，两轮）** —— 本项目**刻意不用 react-router**（§1 决策），浏览器后退键会直接离开应用，故每级导航都必须有显式按钮，遗漏即成死角：
   - **第一轮：「章节详情」无任何返回入口**。`LevelScreen` 与 `LevelComplete` 都有「返回菜单」，唯独 `ChapterScreen` 没有，玩家进了章节页就出不来。
     **修法**：页头左上角加「← 返回菜单」（复用 `viewStore.goMenu()`，无需新增 action）。
   - **第二轮：进关后只有「返回菜单」（跳两级），缺「返回章节」这一层**。
     **修法**：关卡页顶部加「返回章节」（`goChapter(level.chapter)`，仅在真实关卡下显示 —— 自由沙箱没有所属章节）。中途返回不重置会话是安全的：再进任意一关时 `startLevel` 会整体重建。
   **排查**：已对全部六个视图做**出口矩阵**核查（intro / menu / chapter / level / levelComplete / gameComplete），确认无其他死角。
   **回归锁**：`components.test.tsx` 新增「导航出口」用例组（31 → 35）—— 锁章节页出口、关卡页两级出口（返回章节 / 返回菜单各自有效且并存）、以及出口不干扰进关功能。

### 引擎层（1 个，由 Lead 发现，**M2 范围外，未修**）

8. **`gitApi.commit()` 不检查索引与 HEAD 差异，允许真 git 会拒绝的空提交**（详见 §5 已知问题）

---

## 四、实测环境事实（M3+ 务必以此为准）

### 1. LightningFS 对**目录**调用 `readFile` 返回 `null` 而非抛错

```js
await fsp.readFile('/repo/.git')  // → null（不抛 ENOENT！）
await fsp.stat('/repo/.git')      // → Stats { isDirectory: () => true }
```
**判存在性必须用 `stat`**。若用 `readFile` + catch-ENOENT 的写法判目录，会得到「不存在」的错误结论。
`targetState.ts` 的 `TargetContext.pathExists()` 因此改用 `stat`，并在注释中写明。

### 2. jsdom 的 `fireEvent.change` **不受 `readOnly` 限制**

这是一个会**掩盖真实缺陷**的测试环境差异：
```js
// 元素 readOnly 时，jsdom 的下面这行**照样能改值**
fireEvent.change(input, { target: { value: 'x' } })
```
真实浏览器中玩家却完全无法输入。**凡涉及「玩家能否输入/编辑」的行为，必须用真实浏览器验证**，或在单测中显式断言属性本身（如 `expect(input.readOnly).toBe(false)`）。
本轮 1-1 卡死缺陷即由此掩盖（见 §3 缺陷 7）。

### 3. `tsconfig.json` 的 `types` 白名单不含 `@types/node`

测试中若需读仓库内文本文件（如反查笔记小节），**不能用 `node:fs` / `__dirname`**（报 TS2307 / TS2304）。
**对策**：用 Vite 的 `?raw` 导入（`vite/client` 已提供类型）：
```ts
import gitBasicsRaw from '../../notes/git-basics.md?raw'
```
已验证**笔记正文不会进入生产 bundle**（构建产物中 grep 不到）。路径仅测试侧解析。

### 4. `relatedKnowledge` 的 slug 有两套无法统一机械推导的规则

`notes/git-basics.md` 的标题转 slug 时：
- `### 本地仓库 (Local Repository)` → 取**英文括注** → `local-repository`
- `## 对象模型` → 取**意译 slug** → `object-model`

两类无法用同一套规则推出，故 `levels.test.ts` 中**显式登记** `SLUG_BY_HEADING` 映射表，并做反向校验（防僵尸条目）。新增笔记时需同步补表。

### 5. 真实浏览器验收在本机的可行做法（供 M4+ 复用）

- Chrome **必须以 `--no-sandbox --disable-crashpad` 启动**：沙箱环境会拦截 crashpad / network service，否则渲染进程直接崩溃（`Trace/BPT trap`，日志报 `sandbox initialization failed: Operation not permitted`）。
- 用 headless + CDP：`--headless=new --no-sandbox --remote-debugging-port=<port>`，经 `http://127.0.0.1:<port>/json/list` 取 `webSocketDebuggerUrl`。
- **真实键盘输入走 `Input.insertText`**（`Runtime.evaluate` 直接改 value 不能触发 React 受控组件，也无法暴露 `readOnly` 类缺陷）。
- CDP WebSocket 客户端须**先挂 `onmessage` 再 await open**，否则首个 `send` 的 Promise 永不 settle。

---

## 五、已知问题与遗留（不阻塞 M2 验收）

### 1. 🔴 引擎保真缺陷：允许真 git 会拒绝的空提交（**建议后续里程碑修**）

实测对照真 git 二进制：

| 场景 | 真 git | 本项目引擎 |
|---|---|---|
| 干净工作区 → `add .` → `commit` | exit 1「nothing to commit」**不产生提交** | ✅ 创建了第 2 个提交 |
| 空仓库 → 直接 `commit` | exit 1，**不产生提交** | ✅ 创建了「空提交」 |
| 改了文件但没 add → `commit` | exit 1 | ✅ 创建了提交（且不含该改动） |

**根因**：`gitApi.commit()` 无条件提交当前索引，不检查索引是否与 HEAD 相同。
**影响**：1-4「历史之链」的提示（「第二次归档前要先改动工作区内容」）目前**可被绕过** —— 玩家不改动、重复 `add .` + `commit -m "第二环"` 也能过关。关卡仍可通关，但该关的教学点被削弱。
**现状处置**：已在 `ch1.ts` 的 `LEVEL_1_4` 注释中记录机制、对照表、影响与「勿把提示文案当强约束」；提示文案已强化为明确点出「必须先让工作区产生**新的**改动」。
**正确修复落点**：M3/M4 修 `gitApi.commit()` 时，在 `executor.test.ts` 补「`nothing to commit`」语义的用例 —— 那时它锁的是**修复后的正确行为**，方向正确。

> **为何不补「锁定当前错误行为」的测试**：那类断言的语义是「锁定缺陷」（修复即误报），生命周期管理成本高于收益；且它属**引擎契约**，放在 `levels.test.ts` / `targetState.test.ts` 会造成职责越界。

### 2. 架构性预警：「`git init` 创建仓库」这类目标无法用状态判定表达（**对 M4 第二章直接预警**）

因为 (a) `sandbox.reset()` 总会先 `init()`；(b) 即便加「不自动 init」的模板，`git init` 对已初始化目录是**幂等**的 —— 执行前后仓库状态完全相同，**没有任何可观测差异可供判定**。

**推论**：涉及**纯只读命令**（`status` / `log` / `diff`）的关卡有同样问题 —— 只读命令本身不改变状态，目标必须锚定在「玩家用该命令之前必须先做到的事」上，否则会**开局即过关**。
**1-1 的解法是该类关卡的可复用范式**：把目标转为「仓库里真的有了归档物」。

### 3. 其他遗留

- **`fragments.ts` 的片段表是第一章专用的**（`FIRST_CHAPTER` 8 个片段硬编码）。M4 接第 2–3 章时需按章节扩展。
- **`Terminal.tsx`（自由输入）的输入行现为组件内 state**，不再是 `sessionStore.input`。对 M2 无影响（第一章全走拼接），但 **M5 接第五章自由输入时**若需「切视图不丢输入」，需重新引入持久字段（已在文件顶部注释写明理由）。
- **`intro` 与 `gameComplete` 仍为最小实现**（`ViewPlaceholder`）。二者不在 M2 验收链路上；完整叙事属 M6。
- **非 ch1 章节显示「尚未开放 · 后续里程碑」且不渲染开始按钮** —— 防御生效，M4 补章节数据后自动生效。

---

## 六、测试策略的落实（§11）

- **§11.1 单元测试**：`targetState.test.ts`（32）、`levels.test.ts`（27，新增）均在**真实 LightningFS 内存实例**上跑；`scoring.test.ts` 保持 12 个 `it.todo`（计分属 M3）。
- **§11.2 组件测试**：`components.test.tsx`（31）覆盖 Terminal 输入/历史、GoalPanel 三态、拼接片段追加与穷举不变式。
- **§11.3 集成（手动/冒烟）**：真实 Chrome + CDP 驱动四关全链路通关（见 §5.5）。
- **§11.4 E2E**：未引入 Playwright（属 M7）；本轮用一次性 CDP 脚本完成等效冒烟。

### 测试质量保障：突变测试（Lead 独立执行）

为避免「测试全绿但什么都没测」，对两个关键回归锁做了**突变测试**（故意注入原缺陷，确认测试变红）：

| 突变 | 结果 |
|---|---|
| 把 `pathExists` 改回有 bug 的 `readFile` 判据 | **恰好 2 个针对性用例失败**（目录存在性 + content 指向目录），其余全绿 |
| 给后缀输入框重新加 `readOnly` | **恰好 1 个用例失败**（新增的 readOnly 回归锁） |

两次突变后均已还原并确认 `git diff` 无残留、测试回到全绿。**这证明回归锁精确命中缺陷，且未靠过宽的断言「顺带通过」。**

### 值得保留的测试写法

- **`g` 标志的 `lastIndex` 陷阱**：带 `g` 的正则 `test()` 会残留 `lastIndex`，导致同一输入**第二次**判定出错 —— 故必须**连续断言多次**，并附**负对照**（`expect([raw.test(x), raw.test(x)]).toEqual([true, false])`）证明该用例不是空测。
- **拼接不变式**：**不要**断言「首 token 必须是 `git`」（合法序列可从 slot 1 起步，中间态如 `add` 是正常过场态）。正确不变式是「**产物是合法命令，或某条已知合法命令的 token 前缀**」。
- **负向断言不写入测试**：见 §5.1 说明。

---

## 七、§5.5 真实浏览器冒烟实测记录（Lead 独立执行）

**方法**：`pnpm dev`（Vite 5173）+ 真实 Chrome 154 headless + CDP，`Input.insertText` 模拟真实键盘，真实 DOM 点击。
**结果：17/18 项通过。**

```
=== 1-1 ===
✅ 首帧目标进度 0/2（非空白、不白送）
✅ 拼出 git init
✅ 拼出 git add README.md
✅ 拼出 git commit -m
✅ 真实键盘可输入提交信息（readOnly 回归已修）
✅ 1-1 过关

=== 1-2 ===
✅ 可进入下一关
✅ 无 1-1 文件残留（跨关卡清理正确）
✅ 首帧未达成 0/3
✅ 拼出 git add .
✅ 1-2 过关

=== 1-3 === ✅ 过关
=== 1-4 ===
✅ 首帧 0/4
✅ 第一轮后增量判定为 2/4（**非一次性全勾**）
✅ 第二轮后 4/4 或过关

=== 控制台 ===
✅ 无 JS 异常
✅ 无 Buffer / indexedDB 报错
```

**唯一「失败」项说明**：脚本断言「1-1 过关后 `goal-progress` 仍为 `2/2`」，但过关后应用已切到**结算页**，该元素不存在（返回 `null`）。这是**验收脚本自身的查询时机问题，非应用缺陷** —— 同一次运行中「1-1 过关」（出现结算文案）与「可进入下一关」两项均已通过，足以证明过关判定正确。

**补充确认**：`menu → chapter → level → levelComplete` 四视图均可达；每次过关正确切结算页并显示「过关」徽章 + 三个出口按钮；「进入下一关 ch1-N」文案与跳转目标一致；每次执行成功后拼接输入行清空（无残留污染下一条命令）。

---

## 八、原任务清单（执行记录）

### 阶段 0：前置条件 —— ✅
- [x] **0.1 导出 PATH** —— `node v26.9.0` / `pnpm 12.5.1`
- [x] **0.2 基线确认** —— 改动前三门禁全绿，`49 passed | 34 todo`（与文档预期一致）
- [x] **0.3 读 M1 遗留项** —— 已读「实测环境事实」与「遗留问题」；三条重点均已遵守（第一章 4 关不用 `branches`/`tags`/`remotes`；嵌套路径依赖 `ensureParentDirs`；浏览器实测不可省）

### 阶段 1：关卡数据层 —— ✅
- [x] **1.1 `src/levels/schema.ts`** —— 运行时校验与类型守卫
- [x] **1.2 `src/levels/presets.ts`** —— 5 份中文叙事模板
- [x] **1.3 `src/levels/chapters/ch1.ts`** —— 第一章 4 关（命令集恒为 `init`/`add`/`commit`）
- [x] **1.4 `src/levels/chapters/index.ts`** —— 汇总导出 + 查询辅助

> `relatedKnowledge` 映射由 Lead 核定（GDD 的「关联」列与笔记实际小节名并非逐字对应）：
> | 关卡 | GDD 关联 | 笔记实际小节 | id |
> |---|---|---|---|
> | 1-1 | 基础概念·仓库 | `### 本地仓库 (Local Repository)` | `git-basics#local-repository` |
> | 1-2 | 基础概念·快照/提交 | `## 工作流程图解` | `git-basics#workflow` |
> | 1-3 | 基础概念·三态 | `## 三大核心区域` + `## 为什么要有暂存区？` | `git-basics#three-areas` + `git-basics#why-staging` |
> | 1-4 | 基础概念·对象模型 | `## 对象模型` | `git-basics#object-model` |

### 阶段 2：目标检测 —— ✅
- [x] **2.1 `src/game/validate/targetState.ts`** —— 5 种已实现；其余 6 种明确报「尚未实现」
- [x] **2.2 `src/game/validate/stepHints.ts`** —— 分级提示解锁

### 阶段 3：关卡 UI —— ✅
- [x] **3.1 `LevelScreen.tsx`** —— 已迁移至 `src/ui/components/level/`（M1 遗留项已清）
- [x] **3.2 `GoalPanel.tsx`** —— 实时检测，逐项打勾/叉，抽象提示
- [x] **3.3 拼接式输入** —— 点击拼接（位置：`ui/components/terminal/CommandBuilder.tsx`）
- [x] **3.4 视图与关卡数据接线** —— `sessionStore.level` 接真实关卡；进关调 `sandbox.reset(level.init)`；menu/chapter/levelComplete 最小可用
- [x] **3.5 过关判定与结算** —— 全部 targets 满足 → `levelComplete`（不做计分）

### 阶段 4：测试 —— ✅
- [x] **4.1 `targetState.test.ts`** —— 15 个 `it.todo` → **32 真实用例**
- [x] **4.2 `components.test.tsx`** —— 7 个 `it.todo` → **31 真实用例**
- [x] **4.3 `src/__tests__/levels.test.ts`** —— 新建，**27 真实用例**
- [x] **4.4 `scoring.test.ts` 保持占位** —— 12 个 `it.todo` 未动

### 阶段 5：验收 —— ✅
- [x] **5.1 `pnpm typecheck`** —— 退出码 0
- [x] **5.2 `pnpm test`** —— 139 passed | 12 todo
- [x] **5.3 `pnpm build`** —— 通过，约 153.8 kB gzip
- [x] **5.4 `pnpm dev`** —— 页面不白屏（真实浏览器验证）
- [x] **5.5 手动冒烟** —— 真实浏览器四关全链路通关（见 §7）
- [ ] **5.6 提交** —— **未提交**，按用户要求待确认

---

## 九、下一步（M3 建议）

1. **计分与星级**（§7）：`game/scoring/score.ts` + `achievement.ts`，填充 `scoring.test.ts` 的 12 个占位。
   - 注意：`Level.scoring` 的占位值已就位，UI 侧尚未接线（顶层栏保留了「得分 · 星级（M3）」位置）。
   - M2 已有的可用计分输入：`CommandEntry.ok`（错误次数）、`CommandEntry.undoable`（撤销事件）、`history` 长度（命令数）。
2. **修 §5.1 的引擎保真缺陷**（`gitApi.commit()` 的空提交语义），并在 `executor.test.ts` 补回归用例。
3. **Hints 面板**（§9.1）：`stepHints.ts` 已就绪，缺 UI；需接 `hintPenalty` 记录（计分前置）。

---

## 参考索引

| 内容 | 位置 |
|---|---|
| 仓库约定与当前状态 | `AGENTS.md` |
| M1 实测环境事实 | `TODO/M1-tasks-DONE.md` 末尾 |
| 第一章关卡列表与输入方式 | `game-design.md` 第 77–80 行、§3.2 |
| 关卡定义 / 初始化 / 达标条件 | `development-refinement.md` §4.1、§4.2、§4.3 |
| 目录结构 | §3 |
| 视图状态机 | §5 |
| 关卡内容→工程任务映射 | §8 |
| 关卡主界面布局 | §9.1 |
| 测试策略 | §11 |
| 里程碑 M2 定义 | §13 |
| 第一章知识依据 | `notes/git-basics.md` |
