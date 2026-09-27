# 真实浏览器冒烟（tools/smoke/）

M4 引入的**分段冒烟**脚本（方案 A），用真实 Chrome + CDP 驱动应用跑完整通关流程，覆盖 jsdom 单测**无法**覆盖的行为（真实键盘输入、`readOnly`、异步 `startLevel` 时序、真实 DOM 点击）。

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
```

三段**互相独立**，必须分别运行（每段自行 `connect()` → `openApp()` → 播种/通关 → 断言）。三段合计 **30/30**（8 + 8 + 14），两轮连跑无 flake。

| 脚本 | 断言数 | 覆盖范围 |
|---|---|---|
| [run-legacy.cjs](run-legacy.cjs) | 8/8 | **段3**：不种进度 → 断言 ch2/ch3 锁定态（含 🔒 文案）→ 通关 1-1~1-3 → 1-4 第一环 → 编辑器**新建文件**制造第二环改动 → 归档过关 → ch2 解锁（闭环 M3 遗留 1） |
| [run-ch2.cjs](run-ch2.cjs) | 8/8 | **段1**：种子 ch1 全通关 → 验 ch2 解锁 / ch3 仍锁定 → 2-1（status 探查 + probeBonus）→ 2-2/2-3（编辑器）→ 2-4（`rm` 真删 + `.gitignore` + workdirClean）→ ch3 解锁 |
| [run-ch3.cjs](run-ch3.cjs) | 14/14 | **段2**：种子 ch1+ch2 全通关 → 半拼骨架预填断言（3-1~3-6 进关即验 `command-preview`）→ branch/checkout/switch → 3-3 ff 合并 → **3-4 冲突消解全链路** → 3-5 rebase + logOrder → 3-6 → GitGraph/BranchPanel 渲染 → 汇总 14/14 |

共享库 [cdp-client.cjs](cdp-client.cjs)（390 行）导出 `connect` / `openApp` / `waitFor` / `evalJs` / `check` / `summarize` / `seedProgress` / `enterLevel` / `waitSettled` / `backToMenu` / `clickFrag` / `runCommand` / `typeSuffix` / `editFile` / `runAdd` / `runCommit` / `runGit` / `installCounter` 等。

**零第三方依赖** —— 直接用 Node 22+ 的全局 `WebSocket` 与内置 `http`。

## 三条工程决策（方案 A，后续里程碑复用）

1. **进度种子**：经 CDP 对运行中的应用调用 `useProgressStore.setState()`，直接种入前置章节的通关记录，**不脚本通关前置章节**（省 200+ 次点击）。每段 3 分钟内完成，失败只重跑该段。
   ⚠️ **种子后不可 reload** —— 进度存在内存 store（M5 才持久化），reload 会清空种子。
2. **条件轮询 `waitFor()` 替代一切固定 sleep**：每个导航/渲染动作后轮询目标 DOM 特征直到出现（默认 15s 超时即失败）。已知坑：`startLevel` 是 async（`sandbox.reset` 耗时不可预估）；结算页正文**不含关卡 id**，判据须用「过关」+「时间线已锚定」这类通用文案。
3. **片段定位用 `data-command` / `data-slot`，不用 `aria-label`**：`aria-label="拼接命令片段：git"` 在页面上有 **12 个重复按钮**（每组 slot0 一个），`querySelector` 恒取第一个会点错命令组、清空草稿。**aria 无重复时才可用 aria。**

## 两条 DOM 教训

- **React 18 批处理下，slot0 与 slot1 的点击不可放在同一同步块** —— `disabled` 未提交，第二击被忽略。
- **编辑器写 textarea 必须走原生 setter + `input` 事件**（直接赋值不触发 React 受控组件）。

## 其他约束

- 真实键盘输入走 CDP `Input.insertText`（`Runtime.evaluate` 直接改 value 不触发 React 受控组件，也无法暴露 `readOnly` 类缺陷）。
- CDP WebSocket 客户端须**先挂 `onmessage` 再 `await` open**，否则首个 `send` 的 Promise 永不 settle。
- **M5 持久化落地后需复核**：进度种子可改为 localStorage 预填（不再受「不可 reload」限制）。
