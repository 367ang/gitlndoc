---
title: Git分支管理
date: 2026-04-12
tags:
  - Git
  - 版本控制
  - 分支管理
---

# Git 分支管理

分支是 Git 最强大的特性之一，让你能够并行开发不同功能而不互相干扰。

## 分支基础操作

### 查看分支

```bash
# 查看本地分支
git branch

# 查看所有分支（包括远程）
git branch -a

# 查看远程分支
git branch -r

# 查看分支及其最后一次提交
git branch -v
```

### 创建分支

```bash
# 创建新分支（不切换）
git branch <branch-name>

# 创建并切换到新分支
git checkout -b <branch-name>
git switch -c <branch-name>    # Git 2.23+ 推荐

# 基于指定提交创建分支
git branch <branch-name> <commit-hash>

# 基于远程分支创建本地分支
git checkout -b <branch-name> origin/<branch-name>
```

### 切换分支

```bash
# 切换到已有分支
git checkout <branch-name>
git switch <branch-name>       # Git 2.23+ 推荐

# 切换到上一个分支
git checkout -
git switch -
```

### 删除分支

```bash
# 删除已合并的分支
git branch -d <branch-name>

# 强制删除未合并的分支
git branch -D <branch-name>

# 删除远程分支
git push origin --delete <branch-name>
```

## 分支合并

### 基本合并

```bash
# 将指定分支合并到当前分支
git merge <branch-name>

# 合并并生成合并提交
git merge --no-ff <branch-name>

# 压缩合并（将所有提交压缩成一个）
git merge --squash <branch-name>
```

### 合并冲突处理

**实际应用场景：**

```bash
# 场景：合并分支时发生冲突
$ git merge feature/new-ui
Auto-merging styles.css
CONFLICT (content): Merge conflict in styles.css
Automatic merge failed; fix conflicts and then commit.

# 查看冲突文件
$ git status
Unmerged paths:
  both modified:   styles.css

# 手动编辑冲突文件
# 文件内容会显示：
<<<<<<< HEAD
当前分支的内容
=======
要合并分支的内容
>>>>>>> feature/new-ui

# 解决后标记为已解决
$ git add styles.css
$ git commit -m "merge: 合并 new-ui 分支，解决样式冲突"
```

### 使用合并工具

```bash
# 使用可视化合并工具
git mergetool

# 配置合并工具
git config --global merge.tool vscode
```

## 分支工作流

### Feature 分支工作流

```mermaid
graph LR
    A[main] --> B[创建 feature 分支]
    B --> C[开发新功能]
    C --> D[提交代码]
    D --> E[创建 PR]
    E --> F[代码审查]
    F --> G[合并到 main]
    G --> H[删除 feature 分支]
```

**实际操作：**

```bash
# 1. 从 main 创建功能分支
git checkout main
git pull
git checkout -b feature/user-profile

# 2. 开发并提交
git add .
git commit -m "feat: 添加用户个人主页"

# 3. 推送并创建 PR
git push origin feature/user-profile

# 4. PR 合并后删除分支
git checkout main
git pull
git branch -d feature/user-profile
git push origin --delete feature/user-profile
```

### GitFlow 工作流

```bash
# 分支结构：
# main        - 生产环境代码
# develop     - 开发分支
# feature/*   - 功能分支
# release/*   - 发布分支
# hotfix/*    - 紧急修复分支

# 创建功能分支
git checkout develop
git checkout -b feature/login

# 完成功能后合并回 develop
git checkout develop
git merge --no-ff feature/login

# 准备发布
git checkout -b release/1.0.0

# 发布到 main
git checkout main
git merge --no-ff release/1.0.0
git tag -a v1.0.0 -m "Release 1.0.0"

# 紧急修复
git checkout -b hotfix/urgent-fix main
# 修复后合并到 main 和 develop
```

### GitLab Flow 工作流

```bash
# 简化版本：环境分支
# main        - 开发环境
# staging     - 预发布环境
# production  - 生产环境

# 功能开发
git checkout main
git checkout -b feature/new-api

# 合并到 main 进行测试
# 测试通过后合并到 staging
# 最终合并到 production
```

## 分支管理最佳实践

### 分支命名规范

```bash
# 功能分支
feature/user-authentication
feature/payment-system

# 修复分支
fix/login-validation
bugfix/memory-leak

# 发布分支
release/v1.2.0
release/2024-01

# 热修复分支
hotfix/critical-security-patch
```

### 分支管理策略

1. **保持 main 分支稳定** - 所有代码通过 PR 合并
2. **及时删除已合并分支** - 保持分支列表整洁
3. **定期同步远程分支** - 避免分支落后太多

```bash
# 清理已合并的本地分支
git branch --merged | grep -v "\*" | xargs -n 1 git branch -d

# 清理远程已删除的分支引用
git fetch --prune
```

### Rebase vs Merge

```bash
# Merge：保留完整历史
git merge feature/branch
# 优点：历史完整，适合公共分支
# 缺点：会产生合并提交，历史可能混乱

# Rebase：线性历史
git rebase feature/branch
# 优点：历史线性，清晰易读
# 缺点：改写历史，不适合公共分支
```

**实际应用场景：**

```bash
# 场景：在功能分支上同步 main 最新代码
git checkout feature/my-feature
git fetch origin
git rebase origin/main

# 解决可能的冲突后继续
git rebase --continue

# 强制推送（因为历史被改写）
git push --force-with-lease
```

> [!warning]
> 不要对已推送到远程的公共分支使用 rebase

## 参考资源

- [[Git基础概念]]
- [[Git远程操作]]
- [[Git最佳实践]]
