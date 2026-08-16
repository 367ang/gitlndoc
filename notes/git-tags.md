---
title: Git标签管理
date: 2026-04-12
tags:
  - Git
  - 版本控制
  - 标签管理
---

# Git 标签管理

标签（Tag）是 Git 中用于标记特定提交的引用，通常用于版本发布。

## 标签类型

### 轻量标签 vs 注释标签

| 特性 | 轻量标签 | 注释标签 |
|------|---------|---------|
| 创建命令 | `git tag name` | `git tag -a name -m "msg"` |
| 存储内容 | 仅提交引用 | 完整对象（作者、日期、信息） |
| 校验和 | 无 | 有 |
| 推荐场景 | 临时标记 | 版本发布 |

## 创建标签

### 创建注释标签（推荐）

```bash
# 创建注释标签
git tag -a v1.0.0 -m "版本 1.0.0 发布"

# 为特定提交创建标签
git tag -a v0.9.0 <commit-hash> -m "补打标签"

# 创建带 GPG 签名的标签
git tag -s v1.0.0 -m "签名版本发布"
```

### 创建轻量标签

```bash
# 创建轻量标签
git tag v1.0.0-beta

# 为特定提交创建
git tag v0.8.0 <commit-hash>
```

## 查看标签

### 列出标签

```bash
# 列出所有标签
git tag

# 按模式筛选
git tag -l "v1.*"
git tag -l "v2.0*"

# 查看标签详情
git show v1.0.0

# 查看标签对应的提交
git rev-list -n 1 v1.0.0
```

### 查看标签信息

```bash
# 查看完整标签信息
git show v1.0.0

# 只查看标签信息
git tag -v v1.0.0  # 验证签名标签
```

## 推送标签

### 推送到远程

```bash
# 推送单个标签
git push origin v1.0.0

# 推送所有标签
git push origin --tags

# 推送代码和标签一起
git push origin main --tags
```

### 检出标签

```bash
# 检出标签对应的代码
git checkout v1.0.0

# 基于 tag 创建分支
git checkout -b fix/v1.0.0-bug v1.0.0
```

## 删除标签

### 删除本地标签

```bash
# 删除本地标签
git tag -d v1.0.0

# 删除多个标签
git tag -d v1.0.0 v1.0.1
```

### 删除远程标签

```bash
# 方法 1
git push origin --delete v1.0.0

# 方法 2
git push origin :refs/tags/v1.0.0

# 删除本地和远程
git tag -d v1.0.0
git push origin --delete v1.0.0
```

## 语义化版本

### 版本号规范

```
v主版本号.次版本号.修订号[-预发布标识]

示例：
v1.0.0    - 正式版本
v1.1.0    - 新功能
v1.1.1    - Bug 修复
v2.0.0    - 重大更新
v1.0.0-beta  - 测试版本
v1.0.0-rc.1  - 候选版本
```

### 版本号规则

| 变更类型 | 版本号变化 | 示例 |
|---------|-----------|------|
| 不兼容的 API 变更 | 主版本号 | v1.x.x → v2.0.0 |
| 向后兼容的新功能 | 次版本号 | v1.0.x → v1.1.0 |
| 向后兼容的 Bug 修复 | 修订号 | v1.0.0 → v1.0.1 |

## 发布流程示例

### 标准发布流程

```bash
# 1. 确保在正确的分支
git checkout main
git pull origin main

# 2. 创建发布分支（可选）
git checkout -b release/v1.2.0

# 3. 进行最后的测试和修复
git add .
git commit -m "chore: 准备 v1.2.0 发布"

# 4. 合并回 main
git checkout main
git merge release/v1.2.0

# 5. 创建标签
git tag -a v1.2.0 -m "版本 1.2.0 发布

新功能：
- 添加用户权限管理
- 支持多语言

修复：
- 修复登录超时问题
- 修复数据导出错误

优化：
- 提升查询性能
- 减少内存占用"

# 6. 推送代码和标签
git push origin main --tags

# 7. 清理发布分支
git branch -d release/v1.2.0
```

### 使用标签进行部署

```bash
# 生产环境部署
git fetch --tags
git checkout v1.2.0
npm install --production
npm run build
# 部署...

# 或在 CI/CD 中
# 当检测到新标签时自动部署
```

## 标签管理最佳实践

### 标签命名规范

```bash
# 推荐格式
v1.0.0           # 正式版本
v1.0.0-beta.1    # 测试版本
v1.0.0-rc.1      # 候选版本
v1.0.0-alpha     # 内部测试

# 不推荐
release-1.0      # 格式不统一
1.0               # 缺少主版本号
stable            # 无法区分版本
```

### 标签信息模板

```bash
git tag -a v1.2.0 -m "版本 1.2.0 发布 ($(date +%Y-%m-%d))

## 新功能
- 功能描述

## 修复
- 修复描述

## 升级说明
- 迁移指南
"
```

### 标签保护

```bash
# 在 GitHub/GitLab 中设置标签保护
# 防止标签被误删或覆盖

# 查看标签是否被篡改
git tag -v v1.0.0
```

## 常见问题

### 补打历史标签

```bash
# 找到需要打标签的提交
git log --oneline

# 为历史提交打标签
git tag -a v0.9.0 <commit-hash> -m "补打标签"

# 推送到远程
git push origin v0.9.0
```

### 修改标签

```bash
# Git 标签不可修改，只能删除重建
git tag -d v1.0.0
git tag -a v1.0.0 -m "新的标签信息"
git push origin --delete v1.0.0
git push origin v1.0.0
```

### 查看两个标签之间的差异

```bash
# 查看提交差异
git log v1.0.0..v1.1.0 --oneline

# 查看文件差异
git diff v1.0.0 v1.1.0

# 查看变更统计
git diff v1.0.0 v1.1.0 --stat
```

> [!tip]
> 使用注释标签并编写详细的发布说明，方便追溯和问题排查

## 参考资源

- [[Git基础操作]]
- [[Git远程操作]]
