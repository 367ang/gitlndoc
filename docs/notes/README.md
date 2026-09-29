# Git 学习笔记（docs/notes/）

本目录存放 9 篇 Git 学习笔记。它们既是关卡设计的**知识依据**，也是「母本速查表」的拆分产物 —— 全部由 `git-cheatsheet.md` 拆分而来，变更记录见 [docs/notes-change-log.md](../notes-change-log.md)。

## 9 篇笔记的归属分类

| 类别 | 笔记 | 说明 |
|---|---|---|
| ① **关卡知识依据** | `git-basics.md`（Git基础概念）、`git-basic-operations.md`（Git基础操作）、`git-branches.md`（Git分支管理）、`git-remotes.md`（Git远程操作）、`git-undo.md`（Git撤销操作） | 已被关卡数据通过 `relatedKnowledge` 逐条引用（ch1/ch2/ch3/ch5 已落地 5 篇中的 4 篇；`git-remotes.md` 待 M5b 接入） |
| ② **待接入** | `git-tags.md`（Git标签管理）、`git-best-practices.md`（Git最佳实践）、`git-faq.md`（Git常见问题） | 已拆分完成、尚无关卡引用；待 M5/M6（标签、综合终章）接入 |
| ③ **母本速查表** | `git-cheatsheet.md`（Git学习笔记） | 综合速查总表，**不参与游戏**、不单独对应某一章 |

按 `game-design.md` §8 的映射表，各章与笔记的预期对应为：第一章→Git基础概念、第二章→Git基础操作、第三章→Git分支管理、第四章→Git远程操作、第五章→Git撤销操作、第六章→Git标签管理、Git最佳实践贯穿各章。**笔记数与章节数并非一一对应**（速查表不单独对应某章，最佳实践贯穿各章），且当前前三章与**第五章**已有落地关卡（第四章属 M5b）。

## ⚠️ 关键约束（改动本目录前必读）

1. **本目录被 `src/__tests__/levels.test.ts` 以 `?raw` 导入。** 当前导入 4 篇：`git-basics.md`、`git-basic-operations.md`、`git-branches.md`、**`git-undo.md`**（M5a 起，见该文件顶部的 `?raw` import 区）。**移动或重命名本目录/这些文件，必须同步修改 `levels.test.ts`** —— 测试用 Vite 的 `?raw` 读取笔记正文（而非 `node:fs`，原因见 M2 文档「实测环境事实」第 3 条：`tsconfig.json` 的 `types` 白名单不含 `@types/node`）。

2. **slug 反查依赖逐字标题。** 关卡的 `relatedKnowledge` 形如 `git-basics#local-repository`，测试会把 slug 反查回**笔记小结标题的逐字文本**再做匹配。**改动笔记的小节标题会导致 `levels.test.ts` 中相关断言失败**（属于 228 个用例中的一部分）。新增笔记小节时须同步在映射表补一行。

3. **权威映射表是 `src/__tests__/levels.test.ts` 的 `SLUG_BY_HEADING` 常量** —— 这是「笔记小节 ↔ slug」的**唯一事实来源**。该表还带**反向校验**（防僵尸条目）：表里登记的每个标题都必须在某篇笔记中逐字存在。

   > 补充：标题转 slug 有**两套无法机械统一的规则** —— `### 本地仓库 (Local Repository)` 取英文括注 → `local-repository`，而 `## 对象模型` 取意译 → `object-model`。因此必须显式登记，详见 M2 文档「实测环境事实」第 4 条。

4. **改笔记必须追加记录到 [docs/notes-change-log.md](../notes-change-log.md)。** 这是仓库既有约定：凡重构或修改本目录下的笔记，都要在该变更日志中留痕。

5. **⚠️ 注意同名误区：`src/levels/chapters/*.ts` 里的 `'notes/observation.md'`、`'notes/three-states.md'`、`'notes/timeline-log.md'` 等字符串是「沙箱虚拟仓库内的路径」（关卡数据，写在 `/repo` 里给玩家操作），与磁盘上的 `docs/notes/` 目录毫无关系**，不要因同名而误改。
