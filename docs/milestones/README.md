# 里程碑文档索引

本目录存放**已完成的里程碑规划与执行记录**。每份文档都是对应里程碑的权威执行记录（任务拆解 + 交付清单 + 三门禁数字 + 实测环境事实 + 遗留移交）。

**命名约定：文件名不带状态后缀。** 新里程碑直接在本目录新建 `<里程碑名>-tasks.md`（如 `M5-tasks.md`），完成状态由**下方索引表**表达，不再像早期那样用 `-DONE` / `-TODO` 文件名后缀区分。

⚠️ **动 `engine/` 或做真实浏览器验收前**，务必先读 M2 / M3 / M4 三份文档的「实测环境事实」小节。

## 索引

| 里程碑 | 文档 | 状态 | 一句话产出 |
|---|---|---|---|
| M1（地基） | [M1-preflight.md](M1-preflight.md) | ✅ 完成 | M1 开工前的环境与配置核查（Node/pnpm PATH、依赖安装、lockfile、esbuild 授权、LightningFS 用法与浏览器打包实测） |
| M1（地基） | [M1-tasks.md](M1-tasks.md) | ✅ 完成 | `src/` 骨架 + `engine/`（fs/gitApi/sandbox/errors）+ `game/command/`（tokenize/grammar/executor）+ store 三件套 + 样式 token + 极简可跑 UI，打通 init/add/commit 可视化 |
| M2（关卡框架） | [M2-tasks.md](M2-tasks.md) | ✅ 完成 | `levels/schema.ts` + 第一章 4 关 + Terminal/FileTree/GoalPanel + 目标检测，第一章（菜单式）可玩 |
| M3（计分） | [M3-tasks.md](M3-tasks.md) | ✅ 完成 | 计分引擎（`evaluateScore`/`starsOf`）+ 5 成就 + 结算 UI + 空提交引擎修复 |
| M4（第 2–3 章） | [M4-tasks.md](M4-tasks.md) | ✅ 完成 | ch2 四关 + ch3 六关 + GitGraph + BranchPanel + Tab 补全 + 文件编辑器（含新建文件）+ 章节解锁 |
| M5（撤销与远程、快照持久化） | [M5-tasks.md](M5-tasks.md) | 🚧 M5a ✅ / M5b ⏳ | **拆为两批**：**M5a ✅** 第五章 6 关（reset/restore/amend/revert/reflog）+ 快照持久化 + 刷新自动恢复中途进度；**M5b ⏳** 第四章 5 关 + 本地远程客户端 |

### M1 两篇文档的关系

`M1-preflight.md` 是**开工前**的环境与配置核查清单 —— 回答「进入 M1 前环境是否就绪」（阻塞项、用户拍板决策、核心链路实机验证）。`M1-tasks.md` 是**M1 本身**的任务拆解与执行记录 —— 回答「M1 做了什么、怎么验收的」。

⚠️ `M1-tasks.md` 末尾的「⚠️ 实测环境事实」小节对 `M1-preflight.md` §3 的两条结论做了**订正**（LightningFS 的 `db`/`backend` 是两层选项；真正的测试环境坑是 `navigator.locks` 而非 indexedDB 本身）。两者冲突时**以 `M1-tasks.md` 为准**。

## 三门禁历史（各文档「验收 / 三门禁」章节实测值）

| 里程碑 | `typecheck` | `test` | `build`（gzip） |
|---|---|---|---|
| M1 | 0 错误 | 49 passed \| 34 todo | 145.23 kB |
| M2 | 0 错误 | 141 passed \| 12 todo | 约 153.8 kB |
| M3 | 0 错误 | 176 passed，0 todo | 157.53 kB |
| M4 | 0 错误 | 228 passed，0 todo | 169.76 kB |
| M5a | 0 错误 | **332 passed**，0 todo | **179.69 kB** |

构建预算见 `development-refinement.md` §12（约 350 kB），当前余量充足。

## 真实浏览器冒烟历史

| 里程碑 | 结果 | 方法 |
|---|---|---|
| M2 | 17/18（唯一「失败」为验收脚本自身查询时机问题，非应用缺陷） | `pnpm dev` + 真实 Chrome headless + CDP，`Input.insertText` 真实键盘输入 |
| M3 | 20/20 | 沿 M2 方法 |
| M4 | 分段 30/30（两轮连跑无 flake） | 方案 A：进度种子 + 条件轮询 + data 属性定位，脚本见 [tools/smoke/](../../tools/smoke/README.md) |
| M5a | **四段 72/72**（ch5 段两轮连跑无 flake） | 沿 M4 方案；新增 `smoke:ch5`（41 断言）+ free 模式真实键盘输入 + 持久化 reload 复核 + **刷新自动恢复中途进度**断言 |
