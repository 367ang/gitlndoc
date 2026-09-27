# 笔记重构变更日志

## 变更概述

将 `docs/notes/git-cheatsheet.md` 拆分为 8 个独立的模块化文档。

## 新增文件

1. **docs/notes/git-basics.md** - Git 核心概念（工作区、暂存区、仓库、远程仓库）及对象模型说明
2. **docs/notes/git-basic-operations.md** - 日常操作命令（初始化、配置、添加、提交、查看历史）及实际使用场景
3. **docs/notes/git-branches.md** - 分支创建、切换、合并、删除操作及分支工作流（Feature、GitFlow、GitLab Flow）
4. **docs/notes/git-remotes.md** - 远程仓库管理、fetch/pull/push 操作及 Fork 工作流
5. **docs/notes/git-undo.md** - restore、reset、revert 等撤销操作详解及恢复方法
6. **docs/notes/git-tags.md** - 标签创建、查看、推送、删除及语义化版本规范
7. **docs/notes/git-best-practices.md** - 提交规范、分支策略、团队协作、安全建议
8. **docs/notes/git-faq.md** - 合并冲突、提交丢失、推送被拒绝等常见问题解决方案

## 变更详情

每个文档包含：
- 完整的 YAML frontmatter（title、date、tags）
- 模块化的知识结构
- 实际应用场景和代码示例
- 相关文档的交叉引用
- 提示和警告信息

## 文档关系

```
docs/notes/git-basics.md  ──────┬──→ docs/notes/git-basic-operations.md
                                │
                                ├──→ docs/notes/git-branches.md ──→ docs/notes/git-remotes.md
                                │                                 │
                                └──→ docs/notes/git-undo.md ──────┘
                                          │
                                          ↓
docs/notes/git-faq.md ←──── docs/notes/git-best-practices.md
                                │
                                ↓
                     docs/notes/git-tags.md
```

---

## 变更二：文档目录重组（`notes/` → `docs/notes/`）

**本次变更只移动位置，笔记正文内容未做任何改动。**

- `notes/*.md`（9 篇）→ `docs/notes/*.md`
- `other/frontend-changes.md` → **本文件** `docs/notes-change-log.md`

**留痕理由**：仓库既有约定是「凡重构或修改 `docs/notes/` 下的笔记，都必须追加记录到本文件」。目录搬迁虽未改笔记正文，但改变了**所有引用路径**（含 `README.md`、`AGENTS.md`、`src/__tests__/levels.test.ts` 的 `?raw` 导入），值得留痕以备回溯。

⚠️ **特别注意**：`src/__tests__/levels.test.ts` 以 Vite 的 `?raw` 导入本目录中的笔记（当前 3 篇）。**再次移动或重命名本目录/这些文件，必须同步修改该测试** —— 详见 `docs/notes/README.md`。

