---
title: Git最佳实践
date: 2026-04-12
tags:
  - Git
  - 版本控制
  - 最佳实践
---

# Git 最佳实践

良好的 Git 使用习惯能提高团队协作效率，减少问题发生。

## 提交规范

### 提交信息格式

```bash
# 推荐格式
<type>(<scope>): <subject>

<body>

<footer>
```

### 提交类型

| 类型 | 说明 | 示例 |
|------|------|------|
| feat | 新功能 | feat: 添加用户登录功能 |
| fix | Bug 修复 | fix: 修复密码验证错误 |
| docs | 文档更新 | docs: 更新 API 文档 |
| style | 代码格式 | style: 格式化代码 |
| refactor | 重构 | refactor: 重构用户模块 |
| test | 测试 | test: 添加单元测试 |
| chore | 构建/工具 | chore: 更新构建配置 |
| perf | 性能优化 | perf: 优化查询性能 |

### 提交信息示例

```bash
# 简单提交
git commit -m "feat: 添加用户头像上传功能"

# 带 scope 的提交
git commit -m "feat(auth): 添加 JWT 验证"

# 完整格式的提交
git commit -m "feat(user): 添加用户权限管理

- 支持角色权限配置
- 添加权限检查中间件
- 更新用户管理接口

Closes #123"
```

### 提交粒度

```bash
# 好：一个提交只做一件事
git commit -m "feat: 添加用户登录功能"
git commit -m "test: 添加登录功能测试"

# 不好：混合多种修改
git commit -m "添加登录功能、修复 bug、更新文档"
```

## 分支策略

### 主分支原则

```bash
# main/master：稳定的生产代码
- 只接受经过审查的合并
- 每次合并都应该打标签
- 禁止直接提交

# develop：开发分支
- 功能分支的基础
- 接受功能分支的合并

# feature/*：功能分支
- 从 develop 创建
- 完成后合并回 develop

# hotfix/*：紧急修复
- 从 main 创建
- 合并回 main 和 develop
```

### 分支命名规范

```bash
# 功能分支
feature/user-authentication
feature/payment-integration

# 修复分支
fix/login-validation
bugfix/memory-leak

# 发布分支
release/v1.2.0

# 热修复分支
hotfix/security-patch

# 个人分支（不合并到主分支）
wip/experimental-feature
```

## 工作流建议

### 开始工作前

```bash
# 1. 更新本地仓库
git fetch --all
git pull origin main

# 2. 创建功能分支
git checkout -b feature/new-feature

# 3. 确保分支是最新的
git rebase origin/main
```

### 工作过程中

```bash
# 1. 频繁提交
git add -p              # 选择性暂存
git commit -m "..."     # 及时提交

# 2. 定期同步
git fetch origin
git rebase origin/main

# 3. 保持提交历史整洁
git rebase -i HEAD~3    # 整理最近 3 个提交
```

### 完成工作后

```bash
# 1. 确保测试通过
npm test

# 2. 整理提交历史
git rebase -i origin/main

# 3. 推送分支
git push origin feature/new-feature

# 4. 创建 Pull Request
```

## 代码审查

### Pull Request 规范

```markdown
## 变更说明
简要描述本次变更的目的和内容

## 变更类型
- [ ] 新功能
- [ ] Bug 修复
- [ ] 重构
- [ ] 文档更新

## 测试说明
如何测试这些变更

## 截图
UI 变更的截图

## 相关 Issue
Closes #xxx
```

### 审查清单

**提交者检查：**
- [ ] 代码能正常运行
- [ ] 有足够的测试
- [ ] 没有引入新的警告
- [ ] 文档已更新
- [ ] 提交信息清晰

**审查者检查：**
- [ ] 代码逻辑正确
- [ ] 符合编码规范
- [ ] 没有安全隐患
- [ ] 性能可接受

## 安全最佳实践

### 敏感信息处理

```bash
# 不要提交的内容
.env                 # 环境变量
secrets.json         # 密钥
*.pem                # 证书
credentials.json     # 凭证
```

```gitignore
# .gitignore 示例
# 敏感信息
.env
.env.local
*.key
*.pem

# 依赖
node_modules/
vendor/

# 构建产物
dist/
build/

# IDE
.idea/
.vscode/

# 系统文件
.DS_Store
Thumbs.db
```

### 提交前检查

```bash
# 检查将要提交的内容
git diff --cached

# 检查是否有敏感信息
git diff --cached | grep -i "password\|secret\|key"
```

## 性能优化

### 大文件处理

```bash
# 使用 Git LFS 管理大文件
git lfs track "*.psd"
git lfs track "*.zip"
git lfs track "*.mp4"

# 查看 LFS 配置
cat .gitattributes
```

### 仓库优化

```bash
# 清理未引用的对象
git gc

# 更激进的优化
git gc --aggressive

# 检查仓库状态
git fsck
```

### 克隆优化

```bash
# 浅克隆（只获取最近的历史）
git clone --depth 1 <url>

# 单分支克隆
git clone --single-branch --branch main <url>

# 排除大文件克隆
GIT_LFS_SKIP_SMUDGE=1 git clone <url>
```

## 团队协作

### 冲突预防

```bash
# 1. 频繁同步
git pull --rebase origin main

# 2. 小步提交，快速合并

# 3. 沟通协调
# 团队成员间及时沟通正在修改的文件
```

### 冲突解决

```bash
# 1. 拉取最新代码
git fetch origin

# 2. 变基解决冲突
git rebase origin/main

# 3. 解决冲突后
git add .
git rebase --continue

# 4. 推送
git push origin feature/branch
```

### 保持历史整洁

```bash
# 使用 rebase 而非 merge（对于功能分支）
git rebase origin/main

# 压缩多个提交
git rebase -i origin/main
# 将多个提交合并为一个

# 清理历史后再推送
git push --force-with-lease origin feature/branch
```

## 常见陷阱

### 避免的操作

```bash
# 不要在公共分支上使用
git reset --hard
git push --force

# 不要
git commit --amend  # 已推送的提交
git rebase          # 已推送的提交

# 不要忽略
git status          # 提交前检查状态
```

### 推荐的替代方案

```bash
# 代替 reset --hard
git stash           # 保存修改

# 代替 push --force
git push --force-with-lease

# 代替修改已推送提交
git revert          # 创建撤销提交
```

## 工具推荐

### Git 配置增强

```bash
# 有用的别名
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.lg "log --oneline --graph --all"
git config --global alias.last "log -1 HEAD"
git config --global alias.unstage "restore --staged"

# 自动补全
# 大多数系统自带，或需要配置

# 彩色输出
git config --global color.ui auto
```

### 推荐工具

- **commitizen**: 规范提交信息
- **husky**: Git hooks 管理
- **lint-staged**: 提交前检查
- **git-lfs**: 大文件管理

> [!success]
> 良好的 Git 习惯需要时间养成，但一旦养成将大大提高工作效率

## 参考资源

- [[Git基础概念]]
- [[Git基础操作]]
- [[Git分支管理]]
- [[Git常见问题]]
