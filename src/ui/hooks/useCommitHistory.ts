// 命令历史读取（development-refinement.md §9.1 Terminal / §2 分层职责）
//
// UI 层为纯展示：这里只从 sessionStore 读历史并按需派生两个视图——
// 提交历史（用于 GitGraph 的极简替代）与「最近一次错误」。
// 不在此处做任何仓库读取。

import { useSessionStore, type SessionState } from '../../store/sessionStore'

/** 一条提交记录，由命令历史中的 `git commit` 回显（原文）解析而来 */
export interface CommitRecord {
  /** 取自命令条目 id，作为列表 key */
  id: string
  /** 短 hash，7 位 */
  shortHash: string
  /** 首行提交信息 */
  message: string
}

/** `[main abc1234] 初始提交` —— executor 的 commit 回显格式 */
const COMMIT_LINE = /^\[(\S+)\s+([0-9a-f]{7,})\]\s*(.*)$/

/**
 * 从命令历史中提取提交记录（按发生顺序，新→旧与 `git log` 相反）。
 *
 * ⚠️ 为什么不用 `git log` 而要回读命令回显：M1 的 executor 已经把短 hash 与
 * 提交信息渲染进了提交输出（`[main abc1234] msg`），这是「玩家刚做了什么」的
 * 第一手证据，且不额外触发仓库读取（文件树那边已经在读）。
 */
export function useCommitHistory(): CommitRecord[] {
  const history = useSessionStore((state: SessionState) => state.history)

  const commits: CommitRecord[] = []
  for (const entry of history) {
    if (!entry.ok) continue
    const first = entry.output[0]
    const matched = first ? COMMIT_LINE.exec(first) : null
    if (matched) commits.push({ id: entry.id, shortHash: matched[2], message: matched[3] })
  }
  return commits
}
