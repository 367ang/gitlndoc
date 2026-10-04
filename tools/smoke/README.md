# 真实浏览器冒烟（tools/smoke/）

M4 引入的**分段冒烟**脚本（方案 A），用真实 Chrome + CDP 驱动应用跑完整通关流程，覆盖 jsdom 单测**无法**覆盖的行为（真实键盘输入、`readOnly`、异步 `startLevel` 时序、真实 DOM 点击）。
M5a 新增**段4（ch5）**，并给共享库加了 free 模式输入、reload、清 storage 三个原语。
**M5b 新增段5（ch4）**：第四章远程关卡 —— 真实智能 HTTP 协议（push/pull/clone）、
URL 白名单的负向路径、以及「push 被拒 → fetch → merge」的完整协作冲突剧本。
同时修好了共享库的 5 处既有隐患（见文末「M5b 修正」）。

⚠️ **jsdom 的 `fireEvent.change` 不受 `readOnly` 限制**，会掩盖「玩家无法输入」类缺陷 —— 凡涉及输入/编辑的行为，必须靠本套脚本（或人工验收）验证。详见 [M2-tasks.md「实测环境事实」](../../docs/milestones/M2-tasks.md)。

## 运行前置

1. **Chrome headless + CDP（端口 9223）**
   ```bash
   /path/to/Chrome --headless=new --no-sandbox --disable-crashpad --remote-debugging-port=9223
   ```
   ⚠️ 沙箱环境**必须**带 `--no-sandbox --disable-crashpad`，否则渲染进程直接崩溃（`Trace/BPT trap`，日志报 `sandbox initialization failed: Operation not permitted`）。
2. **Vite dev（端口 5199）**：`pnpm dev --port 5199`（脚本常量 `APP = 'http://localhost:5199/'`）。
3. 环境 PATH：`node`/`pnpm` 位于 Homebrew 路径下，先 `export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"`。

脚本常量在 [cdp-client.cjs](cdp-client.cjs) 顶部：`CDP_PORT = process.env.CDP_PORT || 9223`、`APP = 'http://localhost:5199/'`。

## 三条 pnpm script

```bash
pnpm smoke:legacy   # node tools/smoke/run-legacy.cjs
pnpm smoke:ch2      # node tools/smoke/run-ch2.cjs
pnpm smoke:ch3      # node tools/smoke/run-ch3.cjs
pnpm smoke:ch5      # node tools/smoke/run-ch5.cjs   ← M5a 新增
pnpm smoke:ch4      # node tools/smoke/run-ch4.cjs   ← M5b 新增
pnpm smoke:ch6      # node tools/smoke/run-ch6.cjs   ← M6 新增
```

四段**互相独立**，必须分别运行（每段自行 `connect()` → `resetStorage()` → `openApp()` → 播种/通关 → 断言）。四段合计 **64/64**（8 + 8 + 15 + 33），ch5 段两轮连跑无 flake。

> ⚠️ **M5a 起每段开头必须 `resetStorage()`**：进度已落 localStorage（`gtp:progress:v1`），
> 上一次冒烟留下的记录会被下一次读到 —— 段3 的「无进度时 ch2 锁定」会因此失败（实测）。
> 该原语清三个 storage 键 + 删 `gtp:snapshot:*` 快照库 + reload。

| 脚本 | 断言数 | 覆盖范围 |
|---|---|---|
| [run-legacy.cjs](run-legacy.cjs) | 8/8 | **段3**：不种进度 → 断言 ch2/ch3 锁定态（含 🔒 文案）→ 通关 1-1~1-3 → 1-4 第一环 → 编辑器**新建文件**制造第二环改动 → 归档过关 → ch2 解锁（闭环 M3 遗留 1） |
| [run-ch2.cjs](run-ch2.cjs) | 8/8 | **段1**：种子 ch1 全通关 → 验 ch2 解锁 / ch3 仍锁定 → 2-1（status 探查 + probeBonus）→ 2-2/2-3（编辑器）→ 2-4（`rm` 真删 + `.gitignore` + workdirClean）→ ch3 解锁 |
| [run-ch3.cjs](run-ch3.cjs) | 15/15 | **段2**：种子 ch1+ch2 全通关 → 半拼骨架预填断言（3-1~3-6 进关即验 `command-preview`）→ branch/checkout/switch → 3-3 ff 合并 → **3-4 冲突消解全链路** → 3-5 rebase + logOrder → 3-6 → GitGraph/BranchPanel 渲染 → 汇总 → **ch5 解锁链路**（M5a 追加） |
| [run-ch5.cjs](run-ch5.cjs) | **41/41** | **段4（M5a）**：free 模式真实键盘输入 → `commit --amend`（替换而非追加）→ `restore --staged`（保住工作区）→ `restore` 找回误删 → `revert` 反向提交 → **5-6 完整「误 reset --hard → reflog → `HEAD@{1}` 恢复」剧本** → 进度落 localStorage 且 **reload 后仍在**（清偿 M4 遗留 1） |
| [run-ch6.cjs](run-ch6.cjs) | **25/25** | **段6（M6）**：种子 ch1~ch5 → 菜单解锁态双向断言（ch6 可玩 / 结局入口未出现）→ free 模式五关通关（轻量标签 / 注解标签 / 预置标签查看 + 归档命名 / 版本发布）→ GitGraph 标签徽标 → 全部主线通关后「进入结局」入口出现 → 结局页叙事与统计 |

共享库 [cdp-client.cjs](cdp-client.cjs) 导出 `connect` / `openApp` / `waitFor` / `evalJs` / `check` / `summarize` / `seedProgress` / `enterLevel` / `waitSettled` / `backToMenu` / `clickFrag` / `runCommand` / `typeSuffix` / `editFile` / `runAdd` / `runCommit` / `runGit` / `installCounter`，以及 M5a 新增的 `runFree` / `latestHistory` / `reload` / `resetStorage`。

**零第三方依赖** —— 直接用 Node 22+ 的全局 `WebSocket` 与内置 `http`。

## 三条工程决策（方案 A，后续里程碑复用）

1. **进度种子**：经 CDP 对运行中的应用调用 `useProgressStore.setState()`，直接种入前置章节的通关记录，**不脚本通关前置章节**（省 200+ 次点击）。每段 3 分钟内完成，失败只重跑该段。
   ⚠️ **种子后不可 reload** —— 进度存在内存 store（M5 才持久化），reload 会清空种子。
2. **条件轮询 `waitFor()` 替代一切固定 sleep**：每个导航/渲染动作后轮询目标 DOM 特征直到出现（默认 15s 超时即失败）。已知坑：`startLevel` 是 async（`sandbox.reset` 耗时不可预估）；结算页正文**不含关卡 id**，判据须用「过关」+「时间线已锚定」这类通用文案。
3. **片段定位用 `data-command` / `data-slot`，不用 `aria-label`**：`aria-label="拼接命令片段：git"` 在页面上有 **12 个重复按钮**（每组 slot0 一个），`querySelector` 恒取第一个会点错命令组、清空草稿。**aria 无重复时才可用 aria。**

## 两条 DOM 教训

- **React 18 批处理下，slot0 与 slot1 的点击不可放在同一同步块** —— `disabled` 未提交，第二击被忽略。
- **编辑器写 textarea 必须走原生 setter + `input` 事件**（直接赋值不触发 React 受控组件）。

## M5a 新增的三条教训

- **`enterLevel` 的就绪判据必须区分输入模式**：menu / half 模式渲染 `command-preview`，
  而 **free 模式（第五章起）渲染 Terminal 的 `[aria-label="命令输入"]`** ——
  沿用旧判据会必然超时（实测）。现已改为「二者其一 + 页面含关卡 id」。
- **绝不可用 `evalJs('location.reload()')`**：页面上下文在求值途中被销毁，
  该 CDP 调用**永不返回**，脚本静默挂死（实测）。改用 `H.reload()`（走 `Page.navigate`
  + 等 `Page.loadEventFired`；`onMessage` 里为此单列了事件分支，因 CDP 事件没有 id）。
- **5-6 的操作顺序有约束**：该关目标含 `workdirClean` 与 `commitCount`，
  **归档残片后关卡会立即结算、输入框消失**；故脚本必须**先制造破坏**（`reset --hard`
  让提交数掉回 2、目标重新不满足），再归档收尾。

## 其他约束

- 真实键盘输入走 CDP `Input.insertText`（`Runtime.evaluate` 直接改 value 不触发 React 受控组件，也无法暴露 `readOnly` 类缺陷）。
- CDP WebSocket 客户端须**先挂 `onmessage` 再 `await` open**，否则首个 `send` 的 Promise 永不 settle。
- ~~**M5 持久化落地后需复核**：进度种子可改为 localStorage 预填（不再受「不可 reload」限制）。~~
  ✅ **M5a 已复核**：进度确已落 localStorage（`gtp:progress:v1`），
  `smoke:ch5` 末尾专门断言了 reload 后记录仍在；`seedProgress` 仍走应用内 store
  （它会顺带落盘），两种方式都可行。

## M5b 修正（共享库的既有隐患）

段5（ch4）落地时暴露并修好了共享库的 5 处问题 —— 它们此前**一直存在**，只是断言恰好
落在可读的时序上而没被触发：

1. ⚠️ **不要用 `import('/src/store/*.ts')` 读应用状态**：经 CDP `evalJs` 拿到的
   **不是应用正在用的模块实例**（实测 `sameModule === false`），其 `history` / `view`
   恒为初始态。原实现据此判断「命令执行完成」，会稳定假失败。
   **改为读 DOM**：`histCount` / `histCountExpr` / `latestHistory` / `captureLastEntry`
   全部基于 `data-testid="command-history"` 的渲染结果（渲染结果才是事实来源）。
   为此给 `CommandHistory.tsx` 补了该 `data-testid`。
2. ⚠️ **`$` 提示符独占一行**：`CommandHistory` 渲染为
   `<p><span>$</span>{input}</p>`，`innerText` 里 `$` 与命令文本是**两行**。
   解析「最近一条命令」时须按此结构切分（曾误以为同行，导致输出多算一行）。
3. ⚠️ **命令可能「一次过关」**：若某条命令正好达成本关最后一项判据，应用会立刻切到
   结算页、命令历史面板随之卸载 —— 此时计数恒不增长，只等计数必然超时
   （`run-ch4.cjs` 全程、`run-ch5.cjs` 的 5-1 都是这样）。
   `runCommand` / `runFree` 的完成判据因此同时接受「history 增长」与「已离开关卡页」；
   `captureLastEntry` 在已结算时合成成功结果（命令若失败不可能过关）。
4. ⚠️ **`resetStorage` 的就绪判据不能只认菜单**：M5a 起刷新会自动恢复到所在关卡，
   boot 落点可能是关卡页/章节页/结算页。判据放宽为「已到 app 源且 `#root` 已渲染」。
5. ⚠️ **CDP target 选择要优先精确匹配 `APP`**：反复导航会留下多个同源标签页，
   `find(url.includes('localhost'))` 可能选到**已失去渲染进程**的那个 ——
   表现为「所有 waitFor 都超时，而页面看着好好的」。

另：M5b 起关卡总数 20 → **25**（ch4 注册），故 `run-ch2.cjs` 的汇总断言改为
`通关 8/25`、`run-ch3.cjs` 改为 `通关 14/25`；`run-ch3.cjs` 末尾的解锁断言也从
「ch5 可进入」改为「**ch4 可进入**」（ch4 有卡后，解锁规则自动回到逐级相邻）。
