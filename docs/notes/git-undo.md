---
title: Git撤销操作
date: 2026-04-12
tags:
  - Git
  - 版本控制
  - 撤销操作
---

# Git 撤销操作

Git 提供了多种撤销操作的方式，理解每种方式的适用场景非常重要。

## 撤销工作区修改

### restore 命令

```bash
# 撤销工作区修改（未暂存）
git restore <file>

# 撤销所有文件的修改
git restore .

# 从特定提交恢复文件
git restore --source=<commit> <file>
```

**实际应用场景：**

```bash
# 场景：误修改了配置文件，想恢复
$ git status
Changes not staged for commit:
  modified:   config.json

$ git restore config.json
# 文件已恢复到最后一次提交的状态

# 场景：恢复误删的文件
$ rm important.js
$ git restore important.js
# 文件已恢复
```

### checkout 命令（旧方式）

```bash
# 撤销工作区修改
git checkout -- <file>

# 恢复特定版本的文件
git checkout <commit> -- <file>
```

## 撤销暂存区修改

### unstage 文件

```bash
# 撤销暂存（保留工作区修改）
git restore --staged <file>
git restore --staged .     # 撤销所有

# 旧语法
git reset HEAD <file>
```

**实际应用场景：**

```bash
# 场景：误将测试文件添加到暂存区
$ git add test.js
$ git status
Changes to be committed:
  new file:   test.js

$ git restore --staged test.js
$ git status
Untracked files:
  test.js      # 变回未跟踪状态
```

## 修改提交

### 修改最后一次提交

```bash
# 修改提交信息
git commit --amend -m "新的提交信息"

# 添加遗漏的文件到最后一次提交
git add forgotten-file.js
git commit --amend --no-edit

# 修改作者信息
git commit --amend --author="Name <email>"
```

**实际应用场景：**

```bash
# 场景：提交后发现漏了一个文件
$ git commit -m "feat: 添加登录功能"
$ git add config.js  # 漏掉的文件
$ git commit --amend --no-edit

# 场景：提交信息写错了
$ git commit -m "fix bug"  # 信息太简单
$ git commit --amend -m "fix: 修复用户登录时的验证错误"
```

> [!warning]
> 不要修改已推送到远程的提交

## 回退提交

### reset 三种模式

```bash
# --soft: 保留工作区和暂存区
git reset --soft HEAD~1
# 效果：撤销提交，修改仍在暂存区

# --mixed（默认）: 保留工作区，清空暂存区
git reset HEAD~1
# 效果：撤销提交，修改在工作区（未暂存）

# --hard: 清空工作区和暂存区
git reset --hard HEAD~1
# 效果：完全撤销，所有修改丢失
```

**模式对比：**

| 模式 | 工作区 | 暂存区 | 提交历史 |
|------|--------|--------|----------|
| --soft | 保留 | 保留 | 回退 |
| --mixed（默认） | 保留 | 清空 | 回退 |
| --hard | 清空 | 清空 | 回退 |

**实际应用场景：**

```bash
# 场景 1：提交了错误内容，想重新提交
$ git reset --soft HEAD~1
# 可以重新修改后再次提交

# 场景 2：想撤销最近几次提交，重新组织
$ git reset --soft HEAD~3
$ git status  # 所有修改都在暂存区
$ git commit -m "feat: 重新组织的提交"

# 场景 3：完全放弃最近的修改
$ git reset --hard HEAD~1
# 危险！所有修改都会丢失
```

### revert 命令

```bash
# 创建一个新提交来撤销指定提交
git revert <commit-hash>

# 撤销多个提交
git revert <hash1> <hash2>

# 撤销范围
git revert <older>^..<newer>
```

**reset vs revert：**

```bash
# reset: 改写历史，适合本地未推送的提交
git reset --hard HEAD~1

# revert: 创建新提交，适合已推送的提交
git revert <commit-hash>
```

**实际应用场景：**

```bash
# 场景：需要撤销一个已推送的提交
$ git log --oneline
abc1234 feat: 有问题的功能
def5678 feat: 正常功能

$ git revert abc1234
# 创建一个新提交来撤销 abc1234 的修改
$ git push origin main
# 安全推送，不会影响其他人
```

## 恢复丢失的提交

### 使用 reflog

```bash
# 查看所有操作历史
git reflog

# 查看特定分支的历史
git reflog show <branch>

# 恢复到特定状态
git reset --hard HEAD@{n}
```

**实际应用场景：**

```bash
# 场景：误执行了 reset --hard，想恢复
$ git reset --hard HEAD~3  # 误操作！
# 发现错了，立即查看 reflog
$ git reflog
abc1234 HEAD@{0}: reset: moving to HEAD~3
def5678 HEAD@{1}: commit: 重要提交
...

$ git reset --hard def5678  # 恢复！
```

### 找回已删除分支

```bash
# 场景：误删了分支
$ git branch -D feature/important
# 找回：
$ git reflog
# 找到分支删除前的提交
$ git checkout -b feature/important <commit-hash>
```

## 撤销远程操作

### 撤销已推送的提交

```bash
# 方法 1：使用 revert（推荐）
git revert <commit-hash>
git push origin main

# 方法 2：使用 reset（危险）
git reset --hard HEAD~1
git push --force-with-lease origin main
```

### 撤销远程分支删除

```bash
# 如果本地还有分支
git push origin <branch-name>

# 如果本地也删了，从 reflog 恢复
git reflog
git checkout -b <branch-name> <commit-hash>
git push origin <branch-name>
```

## 常见问题处理

### 撤销 merge

```bash
# 撤销最近的 merge 提交
git reset --hard HEAD~1

# 或者使用 revert
git revert -m 1 <merge-commit-hash>
# -m 1 表示保留第一个父提交（通常是 main 分支）
```

### 撤销已经 push 的敏感信息

```bash
# 1. 立即修改敏感信息
# 2. 提交修改
git add .
git commit -m "fix: 移除敏感信息"

# 3. 使用 BFG 或 git-filter-branch 清理历史
# 这超出了基本操作范围，请参考专门的文档

# 4. 强制推送（需要所有协作者同步）
git push --force-with-lease origin main

# 5. 通知所有协作者重新克隆或同步
```

> [!warning]
> 以下操作可能导致数据丢失，请谨慎使用：
> - `git reset --hard`
> - `git push --force`
> - `git clean -fd`

## 安全撤销检查清单

1. **确认当前分支**：`git branch`
2. **确认要撤销的内容**：`git status`、`git log`
3. **考虑是否已推送**：已推送用 revert，未推送可用 reset
4. **备份重要修改**：创建临时分支保存工作
5. **确认操作范围**：单文件还是整个提交

> [!tip]
> 不确定时，先用 `git stash` 保存当前修改，再进行撤销操作

## 参考资源

- [[Git基础概念]]
- [[Git远程操作]]
- [[Git常见问题]]
