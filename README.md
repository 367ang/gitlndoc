# Git 学习笔记

> 关于 Git 版本控制系统的系统性学习笔记，涵盖基础概念到最佳实践。

## 简介

本仓库是一套完整的 Git 学习文档，适合初学者入门及有经验的开发者查阅参考。所有文档以中文编写，配有丰富的命令示例和真实使用场景，帮助读者快速理解并掌握 Git 的核心用法。

## 📚 文档目录

| 文档 | 内容简介 |
|------|---------|
| [Git基础概念](./Git基础概念.md) | 工作区、暂存区、本地仓库、远程仓库的概念及 Git 对象模型 |
| [Git基础操作](./Git基础操作.md) | 日常开发中最常用的命令：init、add、commit、log 等 |
| [Git分支管理](./Git分支管理.md) | 分支的创建、切换、合并、删除及主流工作流介绍 |
| [Git远程操作](./Git远程操作.md) | 远程仓库管理、fetch/pull/push、Fork 工作流 |
| [Git撤销操作](./Git撤销操作.md) | restore、reset、revert 的区别与使用场景 |
| [Git标签管理](./Git标签管理.md) | 标签创建、推送、语义化版本及发布流程 |
| [Git常见问题](./Git常见问题.md) | 合并冲突、推送被拒、文件恢复、性能问题等常见场景解决方案 |
| [Git最佳实践](./Git最佳实践.md) | 提交规范、分支策略、团队协作及安全注意事项 |
| [Git学习笔记](./Git学习笔记.md) | 综合命令速查表及工作流程总览 |

## 🗺️ 知识结构

```
Git 核心知识
├── 基础概念
│   ├── 三大核心区域（工作区 / 暂存区 / 本地仓库）
│   ├── 远程仓库
│   └── Git 对象模型（Blob / Tree / Commit）
├── 日常操作
│   ├── 仓库初始化与配置
│   ├── 文件跟踪（add / rm / mv）
│   ├── 提交管理（commit / log / diff）
│   └── 文件忽略（.gitignore）
├── 分支管理
│   ├── 分支基础操作
│   ├── 合并策略（merge / rebase）
│   └── 工作流（Feature Branch / GitFlow / GitLab Flow）
├── 远程协作
│   ├── fetch / pull / push
│   ├── Fork 工作流
│   └── 远程分支追踪
├── 撤销与恢复
│   ├── 工作区 / 暂存区撤销
│   ├── 提交回退（reset / revert）
│   └── reflog 找回丢失提交
└── 规范与实践
    ├── Conventional Commits 提交规范
    ├── 语义化版本（SemVer）
    └── 安全操作指南
```

## 🚀 快速入门

### 第一次使用 Git

```bash
# 配置用户信息
git config --global user.name "你的名字"
git config --global user.email "your.email@example.com"

# 初始化仓库
git init

# 基础工作流
git add .
git commit -m "feat: 初始化项目"
git push origin main
```

### 常用工作流程

```bash
# 1. 开始新功能开发
git checkout main && git pull
git checkout -b feature/your-feature

# 2. 开发并提交
git add -p                        # 选择性暂存
git commit -m "feat: 添加新功能"

# 3. 同步主分支最新代码
git fetch origin
git rebase origin/main

# 4. 推送并发起 Pull Request
git push -u origin feature/your-feature
```

### 提交信息规范

```
<类型>(<范围>): <简要描述>

类型说明：
  feat     - 新功能
  fix      - Bug 修复
  docs     - 文档更新
  refactor - 代码重构
  test     - 测试相关
  chore    - 构建/工具变更
```

## Language

对于 commit 的描述性内容请使用中文。

## 参考资源

- [Pro Git（官方免费书籍）](https://git-scm.com/book/zh/v2)
- [GitHub 官方文档](https://docs.github.com)
- [Conventional Commits 规范](https://www.conventionalcommits.org/zh-hans/)