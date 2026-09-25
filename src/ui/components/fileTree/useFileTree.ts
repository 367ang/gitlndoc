// 虚拟文件树与提交历史的数据获取（development-refinement.md §9.1 FileTree / §2 分层职责）
//
// UI 层为**纯展示**：不直接 import `gitApi`（§2），一切仓库读取都经
// `game/command/executor` 的 `executeToEntry()`，即「UI → 命令 → 仓库」这一条既有契约。
// 本 hook 借此跑两条只读命令：
//   1. `git status --short` —— 条目状态（staged / modified / untracked）；
//   2. `git log --oneline`  —— 提交历史。工作区干净之后文件内容不再变化，
//      若只渲染文件树，玩家执行 `git commit` 后会看不出任何变化。

import { useEffect, useState } from 'react'
import { executeToEntry } from '../../../game/command/executor'

/**
 * 沙箱仓库的默认分支名。
 *
 * 刻意在此重声明而**不** import `engine/gitApi` 的 `DEFAULT_BRANCH`：
 * §2 要求 UI 层不依赖执行层模块，UI 与执行层之间的通道只有 executor。
 * M1 沙箱恒为 `main`（`sandbox.reset()` 的约定），此处为展示用常量。
 */
const DISPLAY_BRANCH = 'main'

/** 条目的暂存/工作区状态，取自 `git status --short` 的两列状态码 */
export type GitFileState = 'staged' | 'modified' | 'untracked'

/** 文件树的一个节点 */
export interface FileTreeNode {
  /** 节点名；目录为单段名（如 `docs`），文件为文件名 */
  name: string
  /** 仓库内相对路径，如 `docs/intro.md` */
  path: string
  /** 是否为目录 */
  isDir: boolean
  /** git 状态；无改动的已提交文件为空数组 */
  states: GitFileState[]
  /** 子节点，目录在前、再按名称排序 */
  children: FileTreeNode[]
}

/** 提交历史的一条（`git log --oneline` 的一行） */
export interface CommitLine {
  shortHash: string
  message: string
}

/** `useFileTree()` 的返回值 */
export interface FileTreeState {
  /** `/repo` 的直接子项 */
  tree: FileTreeNode[]
  /** 提交历史，新→旧（与 `git log` 一致） */
  commits: CommitLine[]
  /** 当前分支名 */
  branch: string | null
  /** 是否正在读取 */
  loading: boolean
}

/**
 * `git status --short` 的一行：`XY <path>`，X 为索引列，Y 为工作区列。
 *
 * ⚠️ 空工作区时该命令返回**空数组**（`executor.renderStatus()` 对空 `entries`
 * 直接给出 `[]`，既不回显分支名也不回显「无文件要提交」），故不能靠输出行数
 * 判断「仓库是否已初始化」—— 详见本文件末尾的说明。
 */
const SHORT_STATUS_LINE = /^(.{2})\s+(.+)$/

/** 同层排序：目录在前，其次按名称 */
function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** 构建过程中的可变节点 */
interface DraftNode {
  name: string
  path: string
  isDir: boolean
  states: Set<GitFileState>
  children: Map<string, DraftNode>
}

/**
 * 解析 `git status --short` 的输出，产出扁平条目表。
 *
 * M1 子集（写法见 `executor.renderStatus`）：
 *   - 索引列为 `A`/`M`/`D` → 已暂存；
 *   - 工作区列为 `M`/`D` → 未暂存改动；
 *   - `??` → 未追踪。
 */
function parseStatusOutput(output: string[]): { path: string; states: GitFileState[] }[] {
  const entries: { path: string; states: GitFileState[] }[] = []

  for (const raw of output) {
    const matched = SHORT_STATUS_LINE.exec(raw.replace(/\s+$/, ''))
    if (!matched) continue

    const [, codes, path] = matched
    const [indexCode, worktreeCode] = codes
    const states: GitFileState[] = []

    if (worktreeCode === '?') {
      states.push('untracked')
    } else {
      if (indexCode === 'A' || indexCode === 'M' || indexCode === 'D') states.push('staged')
      if (worktreeCode === 'M' || worktreeCode === 'D') states.push('modified')
    }

    entries.push({ path, states })
  }

  return entries
}

/** 把扁平条目表整理成树；中间层级按需补齐（`git status` 只给叶子路径） */
function buildTree(entries: { path: string; states: GitFileState[] }[]): FileTreeNode[] {
  const root = new Map<string, DraftNode>()

  for (const { path, states } of entries) {
    const segments = path.split('/')
    let level = root
    let current = ''

    segments.forEach((segment, index) => {
      current = current ? `${current}/${segment}` : segment
      const isLeaf = index === segments.length - 1

      let node = level.get(segment)
      if (!node) {
        node = { name: segment, path: current, isDir: !isLeaf, states: new Set(), children: new Map() }
        level.set(segment, node)
      }
      // 叶子明确为文件：同一路径既被当作中间层又被当作叶子时以叶子为准
      if (isLeaf) {
        node.isDir = false
        for (const value of states) node.states.add(value)
      }
      level = node.children
    })
  }

  const toNodes = (level: Map<string, DraftNode>): FileTreeNode[] =>
    [...level.values()]
      .map((node) => ({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        states: [...node.states],
        children: toNodes(node.children),
      }))
      .sort(compareNodes)

  return toNodes(root)
}

/** 把 `<shortHash> <message>` 形式的行拆成两段 */
function parseCommitLines(output: string[]): CommitLine[] {
  return output
    .map((raw) => raw.replace(/\s+$/, ''))
    .filter((line) => line.length > 0)
    .map((line) => {
      const [shortHash, ...rest] = line.split(' ')
      return { shortHash, message: rest.join(' ') }
    })
}

const EMPTY: FileTreeState = {
  tree: [],
  commits: [],
  branch: null,
  loading: false,
}

/**
 * 读取仓库快照。
 *
 * ⚠️ 为什么不需要「仓库是否已初始化」这个状态：
 * 实测（M1 收敛时逐条验证）`git status` 在**没有任何 `.git` 的目录**上依旧返回
 * `位于分支 main / 无文件要提交，干净的工作区`，`unborn` 亦为 true ——
 * 即经 executor 这条通道，未初始化与初生仓库**不可区分**。
 * 而 M1 的沙箱由入口 `main.tsx` 在挂载前完成 `git init`，`/repo` 恒为已初始化仓库，
 * 因此此处不臆造一个「未初始化」分支去误导玩家；真正需要区分时属 M2 的关卡初始化职责。
 *
 * ⚠️ 两条命令用 `Promise.all` 并发而非串行：它们只读、互不依赖，
 * 串行会让每次刷新多等一轮，而文件树在每条命令后都要刷新。
 *
 * @param version 由 Terminal 在每条命令执行后自增的「流水号」，用于触发重新读取。
 *                文件树的刷新由它驱动，无需额外的事件总线。
 */
export function useFileTree(version: number): FileTreeState {
  const [state, setState] = useState<Omit<FileTreeState, 'loading'> & { loading: boolean }>({
    ...EMPTY,
    loading: true,
  })

  useEffect(() => {
    // 已触发新一轮读取或组件已卸载时丢弃旧结果，避免过期数据覆盖新状态
    let cancelled = false

    void (async () => {
      // `executeToEntry` 在设计上不抛异常（executor 内部已把 gitApi 的失败收敛为
      // `ok: false`），此处仍加一层兜底，避免执行层万一出现未捕获 rejection
      // 冒到 React 之外变成白屏。
      let shortStatus
      let log
      try {
        ;[shortStatus, log] = await Promise.all([
          executeToEntry('git status --short'),
          executeToEntry('git log --oneline'),
        ])
      } catch (error) {
        if (cancelled) return
        console.error('[useFileTree] 仓库状态读取失败', error)
        setState(EMPTY)
        return
      }
      if (cancelled) return

      setState({
        tree: buildTree(parseStatusOutput(shortStatus.output)),
        commits: log.error === undefined ? parseCommitLines(log.output) : [],
        // M1 沙箱的分支恒为 main（`sandbox.reset()` 的约定），且 `--short` 在空工作区
        // 不回显分支名，故此处取展示用常量而非再跑一条 verbose status。
        branch: DISPLAY_BRANCH,
        loading: false,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [version])

  return state
}
