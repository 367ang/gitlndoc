// 目标与检测面板（development-refinement.md §9.1 GoalPanel）
//
// 纯展示组件：接收 `game/validate/targetState` 的逐项判定结果，渲染打勾/叉。
// 数据由 LevelScreen 经 `useTargetState()` 提供，本组件**不读 store、不直接调
// targetState** —— 组件测试因此可以用 props 直接驱动，不必 mock 执行层。
//
// ⚠️ 两类「未达成」必须区分（§14 禁止伪造）：
//   - `implemented: true` 且 `ok: false` → 玩家还没做到，画 ✗ 并给抽象引导；
//   - `implemented: false`              → 该条件类型属 M4/M5，**不是玩家的错**，
//     画成灰色「尚未支持」而不是红叉，否则玩家会白白怀疑自己。
//
// ⚠️ 文案全部取自 `TargetResult.detail`（已是面向玩家的抽象说明），
// 本组件不自行编造命令 —— §9.1 要求未达标时不给具体命令。

import type { TargetResult } from '../../../game/validate/targetState'
import styles from './GoalPanel.module.css'

export interface GoalPanelProps {
  /** 逐项目标判定结果，顺序与 `level.targets` 一致 */
  items: TargetResult[]
  /** 是否正在检测（首次为 true，避免首帧把已成立的目标画成未达成） */
  checking: boolean
  /** 未达标时的抽象引导语（无具体命令），由 stepHints 派生 */
  missingHint: string
}

/** 单项的三态：已达成 / 未达成 / 游戏尚未支持 */
type ItemState = 'done' | 'pending' | 'unsupported'

function stateOf(item: TargetResult): ItemState {
  if (!item.implemented) return 'unsupported'
  return item.ok ? 'done' : 'pending'
}

const MARK: Record<ItemState, string> = { done: '✓', pending: '✗', unsupported: '—' }
const MARK_LABEL: Record<ItemState, string> = {
  done: '已达成',
  pending: '未达成',
  unsupported: '游戏尚未支持该条件',
}
const STATE_TEXT: Record<ItemState, string> = {
  done: '已达成',
  pending: '未达成',
  unsupported: '尚未支持',
}

export function GoalPanel({ items, checking, missingHint }: GoalPanelProps) {
  const done = items.filter((item) => item.ok).length
  const allDone = items.length > 0 && done === items.length

  return (
    <section className={styles.panel} aria-label="目标">
      <header className={styles.head}>
        <h2 className={styles.title}>目标</h2>
        <span className={styles.meta} data-testid="goal-progress">
          {done}/{items.length}
        </span>
      </header>

      <ul className={styles.list} role="list">
        {items.length === 0 && <li className={styles.empty}>本关没有可检测的目标。</li>}

        {items.map((item, index) => {
          const state = stateOf(item)
          return (
            <li
              key={`${item.target.type}-${index}`}
              className={styles.item}
              data-state={state}
            >
              <span
                className={styles.mark}
                role="img"
                aria-label={MARK_LABEL[state]}
                data-state={state}
              >
                {MARK[state]}
              </span>
              <span className={styles.text}>{item.detail}</span>
              {/*
                逐项的中文状态**显式**渲染，而不仅靠 ✓ / ✗ 符号：
                屏幕阅读器可读，组件测试也能断言可见中文文案而非 className。
              */}
              <span className={styles.state}>{STATE_TEXT[state]}</span>
            </li>
          )
        })}
      </ul>

      <footer className={styles.footer} role="status" data-state={allDone ? 'done' : 'pending'}>
        {checking && <p className={styles.checking}>正在检测目标状态…</p>}
        {!checking && allDone && <p className={styles.done}>全部目标已达成，时间线修复完成。</p>}
        {!checking && !allDone && (
          <p className={styles.missing}>
            <span className={styles.missingLabel}>还差什么：</span>
            {missingHint}
          </p>
        )}
      </footer>
    </section>
  )
}
