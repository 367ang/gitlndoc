// 分步提示面板（development-refinement.md §9.1 Hints）
//
// 纯展示组件：数据由 `game/validate/stepHints` 的纯函数按失败次数算出，
// 本组件只负责渲染与「展开/收起」的本地 UI 状态。
//
// ⚠️ 提示扣分的计数点在**解锁回调**：面板每展示出一条「此前未展示过」的提示，
//    就调一次 `onHintUsed(latest.level)`（LevelScreen 转给 sessionStore.markHintUsed）。
//    计数随「本关已展示过的提示条数」单调递增 —— 同一条提示反复展开/收起不重复计数
//    （去重逻辑由父组件持有「已计数的最大层级」完成，见 LevelScreen 的 hintCountedRef）。
//
// ⚠️ §9.1 纪律：本面板只展示 `Level.hints` 中已解锁的条目，不显示未解锁条目的存在 ——
//    「还有 N 条未解锁」的暗示会让玩家故意失败刷提示，违背「奖励理解」的初衷。

import { useState } from 'react'
import type { HintState } from '../../../game/validate/stepHints'
import styles from './HintsPanel.module.css'

export interface HintsPanelProps {
  /** stepHints.getUnlockedHints() 的结果（LevelScreen 随 failures 派生） */
  hints: HintState
  /** 本关是否为拼接模式（拼接模式没有终端焦点问题，面板可常开；自由模式默认收起） */
  defaultOpen?: boolean
  /** 有新提示解锁时回调（带上解锁层级；去重在 store 层做） */
  onHintUsed: (level: number) => void
}

export function HintsPanel({ hints, defaultOpen = false, onHintUsed }: HintsPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  // 「已计过分」的最高提示层级：解锁层级超过它才触发 onHintUsed（去重）
  const [countedLevel, setCountedLevel] = useState(0)

  const latest = hints.unlocked.length > 0 ? hints.unlocked[hints.unlocked.length - 1] : null

  // 尚无任何提示解锁：不渲染面板（避免「提示」按钮空转，也无从暗示未解锁条目）
  if (latest === null) return null

  // 「查看即计数」（§7.2「使用了提示」的语义）：只统计玩家**实际展开看过**的层级。
  // 自动解锁但从未展开不扣分 —— 惩罚「求助」而非「失败」，与「奖励理解」一致。
  // 计数放在渲染期 + store 层按层级去重（sessionStore.markHintUsed）：
  // StrictMode 重挂只重放同样的 level，不会重复 +1。
  if (open && latest.level > countedLevel) {
    // 展开瞬间把「从上一计过层级到最新层级」之间的每层都算作被看到 ——
    // 面板是列表式展示，展开即全部可见，逐层上报与扣分口径（每步 -hintPenalty）一致。
    for (let level = countedLevel + 1; level <= latest.level; level++) onHintUsed(level)
    setCountedLevel(latest.level)
  }

  return (
    <section className={styles.panel} data-testid="hints-panel">
      <button
        className={styles.toggle}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        提示（已解锁 {hints.unlocked.length} 条{hints.hasMore ? ` · 再失败 ${hints.failuresUntilNext} 次可得下一条` : ' · 已全部解锁'}）
        <span className={styles.arrow} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ol className={styles.list}>
          {hints.unlocked.map((hint) => (
            <li key={hint.level} className={styles.item} data-final={hint.isFinal}>
              <span className={styles.level}>层级 {hint.level}</span>
              <span className={styles.text}>{hint.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
