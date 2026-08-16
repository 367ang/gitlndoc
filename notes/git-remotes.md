---
title: Git远程操作
date: 2026-04-12
tags:
  - Git
  - 版本控制
  - 远程操作
---

# Git 远程操作

远程仓库是团队协作的基础，理解远程操作对于多人开发至关重要。

## 远程仓库管理

### 查看远程仓库

```bash
# 查看远程仓库名称
git remote

# 查看详细信息（包括 URL）
git remote -v

# 查看特定远程仓库详情
git remote show origin
```

### 添加远程仓库

```bash
# 添加远程仓库
git remote add origin <url>

# 添加多个远程仓库
git remote add upstream <url>    # 原始仓库
git remote add origin <url>      # 你的 fork

# 示例
git remote add origin https://github.com/username/repo.git
git remote add origin git@github.com:username/repo.git
```

### 修改远程仓库

```bash
# 修改远程仓库 URL
git remote set-url origin <new-url>

# 重命名远程仓库
git remote rename old-name new-name

# 删除远程仓库
git remote remove <name>
```

## 拉取远程代码

### fetch vs pull

```bash
# fetch: 只获取，不合并
git fetch origin
git fetch origin main

# pull: 获取并合并
git pull origin main

# pull = fetch + merge
# 等价于：
git fetch origin main
git merge origin/main
```

**实际应用场景：**

```bash
# 场景 1：查看远程是否有更新
$ git fetch origin
$ git status
Your branch is behind 'origin/main' by 3 commits.

# 场景 2：安全地拉取更新
$ git fetch origin
$ git log HEAD..origin/main --oneline  # 查看远程新提交
abc1234 feat: 新功能
def5678 fix: 修复问题
$ git merge origin/main  # 确认后合并

# 场景 3：拉取并变基
git pull --rebase origin main
# 等价于：
git fetch origin
git rebase origin/main
```

### 拉取特定分支

```bash
# 拉取指定分支
git pull origin feature/branch

# 设置上游分支并拉取
git pull -u origin main
# 之后可以直接用 git pull
```

## 推送本地代码

### 基本推送

```bash
# 推送到远程分支
git push origin main

# 推送并设置上游分支
git push -u origin main
# 之后可以直接用 git push

# 推送所有分支
git push origin --all

# 推送所有标签
git push origin --tags
```

### 强制推送

```bash
# 强制推送（慎用）
git push --force origin main

# 更安全的强制推送（推荐）
git push --force-with-lease origin main
```

**实际应用场景：**

```bash
# 场景：本地 rebase 后需要强制推送
$ git rebase main
# 历史已改变，需要强制推送
$ git push --force-with-lease origin feature/my-feature

# 为什么用 --force-with-lease？
# 它会检查远程分支是否被其他人更新过
# 如果有其他人推送的新提交，推送会失败
# 这避免了覆盖其他人的工作
```

### 推送新分支

```bash
# 创建并推送新分支
git checkout -b feature/new-feature
git push -u origin feature/new-feature

# 推送本地分支到不同名称的远程分支
git push origin local-branch:remote-branch
```

## Fork 工作流

### 完整的 Fork 流程

```bash
# 1. Fork 仓库后在本地克隆
git clone https://github.com/your-username/original-repo.git

# 2. 添加原始仓库为 upstream
git remote add upstream https://github.com/original-owner/original-repo.git

# 3. 创建功能分支
git checkout -b feature/my-contribution

# 4. 开发并提交
git add .
git commit -m "feat: 添加新功能"

# 5. 推送到你的 fork
git push origin feature/my-contribution

# 6. 创建 Pull Request

# 7. 保持 fork 同步
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

### 同步 Fork 仓库

```bash
# 获取 upstream 最新代码
git fetch upstream

# 合并到本地 main
git checkout main
git merge upstream/main

# 推送到你的 fork
git push origin main
```

## 远程分支操作

### 跟踪远程分支

```bash
# 查看远程分支
git branch -r

# 创建跟踪远程分支的本地分支
git checkout -b <local-branch> origin/<remote-branch>

# 或简写（当本地和远程分支名相同时）
git checkout --track origin/<branch>

# 设置已有分支跟踪远程分支
git branch -u origin/<branch>
```

### 删除远程分支

```bash
# 删除远程分支
git push origin --delete feature/old-feature

# 清理本地已不存在的远程分支引用
git fetch --prune
git remote prune origin
```

## 常见问题处理

### 推送被拒绝

```bash
# 场景：远程有新提交，推送被拒绝
$ git push
! [rejected] main -> main (non-fast-forward)

# 解决方法 1：拉取合并后再推送
$ git pull --rebase origin main
$ git push origin main

# 解决方法 2：查看差异后决定
$ git fetch origin
$ git log HEAD..origin/main  # 查看远程新提交
$ git merge origin/main
$ git push origin main
```

### 解决远程冲突

```bash
# 场景：拉取时有冲突
$ git pull origin main
CONFLICT (content): Merge conflict in file.js

# 解决冲突
# 1. 编辑冲突文件
# 2. 标记为已解决
$ git add file.js
# 3. 完成合并
$ git commit -m "merge: 解决与远程分支的冲突"
# 4. 推送
$ git push origin main
```

### 撤销已推送的提交

```bash
# 方法 1：创建新提交来撤销
git revert <commit-hash>
git push origin main

# 方法 2：回退并强制推送（危险操作）
git reset --hard <commit-hash>
git push --force-with-lease origin main
```

> [!warning]
> 对公共分支使用 `reset --hard` 和 `--force` 非常危险，会覆盖其他人的工作

## 参考资源

- [[Git分支管理]]
- [[Git撤销操作]]
- [[Git最佳实践]]
