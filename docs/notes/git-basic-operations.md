---
title: Git基础操作
date: 2026-04-12
tags:
  - Git
  - 版本控制
  - 基础操作
---

# Git 基础操作

日常开发中最常用的 Git 命令及其使用场景。

## 初始化和配置

### 初始化仓库

```bash
# 在当前目录创建新仓库
git init

# 克隆已有仓库
git clone <url>
git clone <url> <directory>  # 克隆到指定目录
```

**实际应用场景：**
- 开始新项目：`git init`
- 参与已有项目：`git clone https://github.com/user/repo.git`

### 用户配置

```bash
# 配置用户信息（必须）
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# 配置默认编辑器
git config --global core.editor "code --wait"

# 配置默认分支名
git config --global init.defaultBranch main

# 查看所有配置
git config --list
```

**配置文件位置：**
- `--global`: `~/.gitconfig`（用户级别）
- `--local`: `.git/config`（仓库级别）
- `--system`: `/etc/gitconfig`（系统级别）

## 日常操作流程

### 查看状态

```bash
# 查看当前状态
git status

# 简洁输出
git status -s

# 查看变更内容
git diff              # 工作区 vs 暂存区
git diff --staged     # 暂存区 vs 最新提交
git diff HEAD         # 工作区 vs 最新提交
```

**实际应用场景：**

```bash
# 场景：开始工作前检查状态
$ git status
On branch main
Changes not staged for commit:
  modified:   src/index.js    # 已修改但未暂存

Untracked files:
  src/utils.js                # 新文件，未跟踪

# 决定要提交的内容
$ git add src/index.js
$ git status
Changes to be committed:
  modified:   src/index.js    # 已暂存，准备提交
```

### 添加文件

```bash
# 添加指定文件
git add <file>

# 添加多个文件
git add file1.js file2.js

# 添加所有文件
git add .

# 添加已跟踪的修改文件（不包括新文件）
git add -u

# 交互式添加（选择部分修改）
git add -p
```

**实际应用场景：**

```bash
# 场景：同一文件有多处修改，想分开提交
$ git add -p index.js
# Git 会逐个显示修改块，让你选择：
# y - 暂存此块
# n - 不暂存
# s - 分割成更小的块
# q - 退出
```

### 提交更改

```bash
# 提交暂存区内容
git commit -m "提交信息"

# 跳过暂存区，直接提交已跟踪文件
git commit -a -m "提交信息"

# 打开编辑器写提交信息
git commit

# 追加到上一次提交（未推送到远程时）
git commit --amend
```

**提交信息规范：**

```bash
# 格式：<type>: <subject>
git commit -m "feat: 添加用户登录功能"
git commit -m "fix: 修复密码验证错误"
git commit -m "docs: 更新 README 文档"
git commit -m "refactor: 重构用户模块"
git commit -m "test: 添加登录测试用例"
```

### 查看历史

```bash
# 查看提交历史
git log

# 简洁格式
git log --oneline

# 图形化显示分支
git log --oneline --graph

# 显示每次提交的变更
git log -p

# 只显示最近 n 次提交
git log -n 3

# 按作者筛选
git log --author="张三"

# 按时间范围
git log --since="2024-01-01" --until="2024-12-31"
```

**实际应用场景：**

```bash
# 场景：查看某文件的历史变更
$ git log --oneline --follow src/config.js
a1b2c3d refactor: 简化配置结构
d4e5f6g feat: 添加数据库配置
h7i8j9k chore: 初始化项目配置

# 场景：查看本周的提交
$ git log --since="1 week ago" --oneline
```

## 文件操作

### 删除文件

```bash
# 删除文件并暂存删除操作
git rm <file>

# 只从 Git 移除，保留本地文件
git rm --cached <file>

# 删除目录
git rm -r <directory>
```

### 重命名文件

```bash
# 重命名文件
git mv <old> <new>

# Git 会检测到重命名
# 相当于: mv old new; git rm old; git add new
```

### 忽略文件

创建 `.gitignore` 文件：

```gitignore
# 忽略特定文件
.env
secrets.json

# 忽略目录
node_modules/
dist/
build/

# 忽略特定扩展名
*.log
*.tmp

# 但保留特定文件
!.gitkeep
```

## 常见工作流程

### 新功能开发流程

```bash
# 1. 开始工作前拉取最新代码
git pull origin main

# 2. 创建新分支
git checkout -b feature/user-auth

# 3. 进行开发和提交
git add .
git commit -m "feat: 添加用户认证功能"

# 4. 推送到远程
git push origin feature/user-auth

# 5. 创建 Pull Request
```

### 修复 Bug 流程

```bash
# 1. 创建修复分支
git checkout -b fix/login-bug

# 2. 修复问题
git add src/auth.js
git commit -m "fix: 修复登录验证问题"

# 3. 推送并创建 PR
git push origin fix/login-bug
```

> [!tip]
> 养成良好的提交习惯：每次提交只做一件事，提交信息清晰描述变更内容

## 参考资源

- [[Git基础概念]]
- [[Git分支管理]]
