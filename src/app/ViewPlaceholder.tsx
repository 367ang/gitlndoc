// 后续里程碑视图的占位页（development-refinement.md §5）
//
// M1 只实现 `boot` 与 `level`；其余视图由本组件统一占位，
// 明确告知「该视图属后续里程碑」，避免玩家误以为功能缺失。

import { VIEW_TITLE, type View } from './routes'
import styles from './ViewPlaceholder.module.css'

export interface ViewPlaceholderProps {
  view: View
  description: string
  /** 可选的主行动按钮文案与回调 */
  actionLabel?: string
  onAction?: () => void
}

export function ViewPlaceholder({ view, description, actionLabel, onAction }: ViewPlaceholderProps) {
  return (
    <section className={styles.card}>
      <p className={styles.kicker}>M1 占位</p>
      <h1 className={styles.title}>{VIEW_TITLE[view]}</h1>
      <p className={styles.description}>{description}</p>
      {actionLabel && onAction && (
        <button className={styles.action} type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </section>
  )
}
