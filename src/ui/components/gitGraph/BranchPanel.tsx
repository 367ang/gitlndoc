// 分支面板（development-refinement.md §9.1 BranchPanel；M4 新增）
//
// 纯展示：数据经 executor 跑 `git branch` 解析（与 useFileTree 同一取舍 ——
// UI 不直连 gitApi，维持「UI → executor」单通道）。当前分支用 `*` 高亮。

import { useEffect, useState } from 'react'
import { executeToEntry } from '../../../game/command/executor'
import styles from './BranchPanel.module.css'

export interface BranchPanelProps {
  /** 刷新流水号（每条命令执行后自增） */
  version: number
}

interface BranchRow {
  name: string
  current: boolean
}

/** `git branch` 的一行：`* main` / `  dev` */
const BRANCH_LINE = /^(\*?)\s*(\S+)$/

export function BranchPanel({ version }: BranchPanelProps) {
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await executeToEntry('git branch')
      if (cancelled) return
      if (!result.ok) {
        setFailed(true)
        return
      }
      const rows: BranchRow[] = []
      for (const line of result.output) {
        const matched = BRANCH_LINE.exec(line)
        if (matched) rows.push({ name: matched[2], current: matched[1] === '*' })
      }
      setBranches(rows)
      setFailed(false)
    })()
    return () => {
      cancelled = true
    }
  }, [version])

  return (
    <section className={styles.panel} data-testid="branch-panel">
      <header className={styles.head}>
        <h2 className={styles.title}>分支</h2>
        <span className={styles.meta}>{branches.length} 条</span>
      </header>
      {failed && <p className={styles.empty}>无法读取分支。</p>}
      {!failed && branches.length === 0 && <p className={styles.empty}>还没有任何分支。</p>}
      <ul className={styles.list}>
        {branches.map((branch) => (
          <li
            key={branch.name}
            className={styles.item}
            data-current={branch.current}
            aria-current={branch.current ? 'true' : undefined}
          >
            {branch.current ? '★' : '☆'} {branch.name}
          </li>
        ))}
      </ul>
    </section>
  )
}
