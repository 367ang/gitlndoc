# Frontend Changes

## 变更概述

将 `notes/git-cheatsheet.md` 拆分为 8 个独立的模块化文档。

## 新增文件

1. **notes/git-basics.md** - Git 核心概念（工作区、暂存区、仓库、远程仓库）及对象模型说明
2. **notes/git-basic-operations.md** - 日常操作命令（初始化、配置、添加、提交、查看历史）及实际使用场景
3. **notes/git-branches.md** - 分支创建、切换、合并、删除操作及分支工作流（Feature、GitFlow、GitLab Flow）
4. **notes/git-remotes.md** - 远程仓库管理、fetch/pull/push 操作及 Fork 工作流
5. **notes/git-undo.md** - restore、reset、revert 等撤销操作详解及恢复方法
6. **notes/git-tags.md** - 标签创建、查看、推送、删除及语义化版本规范
7. **notes/git-best-practices.md** - 提交规范、分支策略、团队协作、安全建议
8. **notes/git-faq.md** - 合并冲突、提交丢失、推送被拒绝等常见问题解决方案

## 变更详情

每个文档包含：
- 完整的 YAML frontmatter（title、date、tags）
- 模块化的知识结构
- 实际应用场景和代码示例
- 相关文档的交叉引用
- 提示和警告信息

## 文档关系

```
notes/git-basics.md  ──────┬──→ notes/git-basic-operations.md
                      │
                      ├──→ notes/git-branches.md ──→ notes/git-remotes.md
                      │                           │
                      └──→ notes/git-undo.md ─────────┘
                                  │
                                  ↓
notes/git-faq.md ←──── notes/git-best-practices.md
                      │
                      ↓
               notes/git-tags.md
```
