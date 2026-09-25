// 提交历史面板（development-refinement.md §9.1 中 GitGraph 的 M1 极简替代）
//
// 纯展示。数据来自命令历史（见 `useCommitHistory`）；真正的提交图 M4 再做。

import type { CommitRecord } from '../../hooks/useCommitHistory'
import styles from './CommitPanel.module.css'

export interface CommitPanelProps {
  commits: CommitRecord[]
}

export function CommitPanel({ commits }: CommitPanelProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>提交历史</h2>
        <span className={styles.meta}>{commits.length} 个提交</span>
      </header>

      <ol className={styles.list}>
        {commits.length === 0 && <li className={styles.empty}>还没有提交记录。</li>}
        {commits.map((commit) => (
          <li key={commit.id} className={styles.item}>
            <span className={styles.hash}>{commit.shortHash}</span>
            <span className={styles.message}>{commit.message}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
