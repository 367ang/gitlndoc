---
title: Git常见问题
date: 2026-04-12
tags:
  - Git
  - 版本控制
  - 问题解决
---

# Git 常见问题处理

记录 Git 使用中常见的问题及解决方案。

## 合并冲突

### 冲突产生原因

当两个分支修改了同一文件的同一位置，Git 无法自动合并时产生冲突。

### 冲突标记解读

```text
<<<<<<< HEAD
当前分支的内容
=======
要合并分支的内容
>>>>>>> feature/branch
```

### 解决冲突步骤

```bash
# 1. 查看冲突文件
git status
# Unmerged paths:
#   both modified:      src/index.js

# 2. 打开冲突文件，手动编辑
# 选择保留的内容，删除冲突标记

# 3. 标记为已解决
git add src/index.js

# 4. 继续合并
git commit -m "merge: 解决合并冲突"
```

### 使用合并工具

```bash
# 使用图形化工具
git mergetool

# VS Code 配置
git config --global merge.tool vscode
git config --global mergetool.vscode.cmd 'code --wait $MERGED'
```

### 常见冲突场景

```bash
# 场景：同一函数不同修改
# 文件: utils.js

// HEAD (当前分支)
function formatDate(date) {
  return date.toISOString();
}

// feature/branch (要合并的分支)
function formatDate(date) {
  return date.toLocaleDateString();
}

// 解决方案：选择一个或合并两者
function formatDate(date) {
  // 使用更详细的格式
  return `${date.toLocaleDateString()} ${date.toISOString()}`;
}
```

## 提交丢失恢复

### 使用 reflog

```bash
# 查看所有操作历史
git reflog
# abc1234 HEAD@{0}: reset: moving to HEAD~2
# def5678 HEAD@{1}: commit: 重要提交
# ...

# 恢复到特定状态
git reset --hard def5678
```

### 恢复已删除分支

```bash
# 查找分支最后的提交
git reflog
# 找到: abc1234 checkout: moving from feature/lost to main

# 恢复分支
git checkout -b feature/lost abc1234
```

### 恢复误删文件

```bash
# 找到文件存在的最后提交
git log --all --full-history -- path/to/file

# 恢复文件
git checkout <commit>^ -- path/to/file
```

## 推送被拒绝

### 问题：non-fast-forward

```bash
$ git push
! [rejected]        main -> main (non-fast-forward)
```

**解决方案：**

```bash
# 方法 1：拉取合并后推送
git pull --rebase origin main
git push origin main

# 方法 2：查看差异后决定
git fetch origin
git log HEAD..origin/main --oneline
git merge origin/main
git push origin main
```

### 问题：权限不足

```bash
$ git push
remote: Permission denied
```

**解决方案：**

```bash
# 检查 SSH 密钥
ssh -T git@github.com

# 或使用 HTTPS + Token
git remote set-url origin https://<token>@github.com/user/repo.git
```

## 文件状态问题

### 无法添加文件

```bash
$ git add file.txt
The following paths are ignored by one of your .gitignore files
```

**解决方案：**

```bash
# 检查被哪个规则忽略
git check-ignore -v file.txt

# 强制添加（不推荐）
git add -f file.txt

# 修改 .gitignore 规则
```

### 文件未跟踪

```bash
# 跟踪所有文件
git add .

# 查看被忽略的文件
git status --ignored
```

## 分支问题

### 无法删除分支

```bash
$ git branch -d feature/branch
error: The branch is not fully merged
```

**解决方案：**

```bash
# 检查未合并的内容
git log main..feature/branch

# 确认后强制删除
git branch -D feature/branch

# 或先合并
git merge feature/branch
git branch -d feature/branch
```

### 分支落后太多

```bash
$ git status
Your branch is behind 'origin/main' by 100 commits
```

**解决方案：**

```bash
# 查看差异
git fetch origin
git log HEAD..origin/main --oneline

# 合并更新
git merge origin/main

# 或变基
git rebase origin/main
```

## 大文件问题

### 文件过大无法推送

```bash
$ git push
remote: error: File large-file.zip is 150.00 MB
```

**解决方案：**

```bash
# 使用 Git LFS
git lfs install
git lfs track "*.zip"
git add .gitattributes
git add large-file.zip
git commit -m "chore: 使用 LFS 管理大文件"
git push origin main
```

### 清理历史中的大文件

```bash
# 使用 BFG Repo-Cleaner（推荐）
bfg --delete-files large-file.zip
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 或使用 git filter-branch
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch path/to/large-file' \
  --prune-empty --tag-name-filter cat -- --all
```

## 性能问题

### Git 操作缓慢

```bash
# 检查仓库大小
git count-objects -v

# 清理优化
git gc
git prune

# 禁用自动 gc，手动执行
git config --global gc.auto 0
```

### 克隆太慢

```bash
# 浅克隆
git clone --depth 1 <url>

# 单分支
git clone --single-branch --branch main <url>

# 后续获取完整历史
git fetch --unshallow
```

## 编码问题

### 中文文件名乱码

```bash
# 解决方案
git config --global core.quotepath false
```

### 换行符问题

```bash
# Windows/Mac 换行符转换
# 提交时转换为 LF，检出时保持 LF
git config --global core.autocrlf input

# Windows 用户（检出时转换为 CRLF）
git config --global core.autocrlf true
```

## 回退操作问题

### 撤销已推送的提交

```bash
# 方法 1：使用 revert（推荐）
git revert <commit-hash>
git push origin main

# 方法 2：回退并强制推送（危险）
git reset --hard <commit-hash>
git push --force-with-lease origin main
```

### 撤销 merge

```bash
# 撤销最近的 merge
git reset --hard HEAD~1

# 或使用 revert
git revert -m 1 <merge-commit>
```

## 清理仓库

### 清理未跟踪文件

```bash
# 预览要删除的文件
git clean -n

# 删除未跟踪文件
git clean -f

# 删除未跟踪文件和目录
git clean -fd

# 同时删除被忽略的文件
git clean -fdx
```

### 清理旧分支

```bash
# 删除已合并的本地分支
git branch --merged | grep -v "\*" | xargs -n 1 git branch -d

# 清理远程已删除的分支引用
git fetch --prune
```

## 诊断命令

### 检查仓库状态

```bash
# 仓库完整性检查
git fsck

# 查看对象信息
git cat-file -p <hash>

# 查看提交详情
git show <commit>

# 查看文件历史
git log --follow -p <file>
```

### 调试配置

```bash
# 查看所有配置
git config --list --show-origin

# 查看特定配置
git config --get user.name

# 测试 SSH 连接
ssh -vT git@github.com
```

> [!warning]
> 以下操作可能导致数据丢失，请谨慎使用：
> - `git reset --hard`
> - `git clean -fd`
> - `git push --force`

## 预防措施

1. **定期备份**：推送代码到远程
2. **提交前检查**：`git status` 和 `git diff`
3. **了解命令**：使用前了解命令的作用
4. **保护重要分支**：设置分支保护规则
5. **使用 stash**：不确定时先保存修改

## 参考资源

- [[Git撤销操作]]
- [[Git最佳实践]]
