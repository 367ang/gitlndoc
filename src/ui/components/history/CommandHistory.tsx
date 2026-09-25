// 命令历史与输出（development-refinement.md §9.1 Terminal）
//
// 纯展示组件：数据全部来自 sessionStore 的命令历史，自身不执行业务逻辑。
// 错误行用醒目色（--gtp-color-danger），与「奖励理解、惩罚试错」的基调一致。

import { useEffect, useRef } from 'react'
import type { CommandEntry } from '../../../game/types'
import styles from './CommandHistory.module.css'

export interface CommandHistoryProps {
  history: CommandEntry[]
}

/** 历史为空时的引导文案（M1 只有自由输入，故直接给出可跑的命令序列） */
const EMPTY_HINT = [
  '时间线尚未被激活。试试依次执行：',
  '  git init',
  '  git add .',
  '  git commit -m "初始提交"',
]

export function CommandHistory({ history }: CommandHistoryProps) {
  const scroller = useRef<HTMLDivElement>(null)

  // 新条目到达时滚到底部（命令行的既有习惯）
  useEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [history.length])

  return (
    <div className={styles.scroller} ref={scroller}>
      <div className={styles.log}>
        {history.length === 0 && (
          <pre className={styles.hint}>{EMPTY_HINT.join('\n')}</pre>
        )}

        {history.map((entry) => (
          <div key={entry.id} className={styles.entry}>
            <p className={styles.command}>
              <span className={styles.prompt}>$</span>
              {entry.input}
            </p>

            {entry.output.map((line, index) => (
              <p key={index} className={styles.output}>
                {line}
              </p>
            ))}

            {entry.error !== undefined && <p className={styles.error}>{entry.error}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
