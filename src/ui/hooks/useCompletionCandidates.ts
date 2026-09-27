// Tab 补全候选采集（development-refinement.md §9.1）
//
// UI 层为纯展示：不 import gitApi（§2），候选采集走「UI → executor」既有单通道：
//   - 分支名 ← `git branch` 输出解析（`* ` 标记行与普通行）；
//   - 文件路径 ← `git status --short` 输出的路径列。
// 两组随 version（流水号）刷新；白名单常量由 completion.ts 提供。

import { useEffect, useState } from 'react'
import { executeToEntry } from '../../game/command/executor'

/** 补全候选集合 */
export interface CompletionCandidates {
  /** 本地分支名（不含 `* ` 标记） */
  branches: string[]
  /** 工作区文件路径（status --short 可见的全部路径） */
  paths: string[]
  /** 是否正在读取 */
  loading: boolean
}

const EMPTY: CompletionCandidates = { branches: [], paths: [], loading: false }

/** `git branch` 的一行：`* main` / `  dev` */
const BRANCH_LINE = /^\*?\s*(\S+)$/

/** `git status --short` 的一行：`XY <path>` 或 `?? <path>` */
const SHORT_LINE = /^(..)\s+(.+)$/

/**
 * 采集 Tab 补全候选。
 *
 * @param version 刷新流水号（每条命令执行后自增，与 useFileTree 同源）
 */
export function useCompletionCandidates(version: number): CompletionCandidates {
  const [state, setState] = useState<CompletionCandidates>({ ...EMPTY, loading: true })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [branchOut, statusOut] = await Promise.all([
          executeToEntry('git branch'),
          executeToEntry('git status --short'),
        ])
        if (cancelled) return

        const branches: string[] = []
        if (branchOut.ok) {
          for (const line of branchOut.output) {
            const matched = BRANCH_LINE.exec(line.trim())
            if (matched) branches.push(matched[1])
          }
        }

        const paths: string[] = []
        if (statusOut.ok) {
          for (const line of statusOut.output) {
            const matched = SHORT_LINE.exec(line)
            if (matched) paths.push(matched[2])
          }
        }

        setState({ branches, paths, loading: false })
      } catch (error) {
        if (cancelled) return
        console.error('[useCompletionCandidates] 候选采集失败', error)
        setState(EMPTY)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [version])

  return state
}
