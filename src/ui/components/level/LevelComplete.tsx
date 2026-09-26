// 关卡结算页（development-refinement.md §5 `levelComplete` 视图）
//
// ⚠️ M2 **只做过关判定，不做计分与星级**（已确认决策第 2 条）：
// 本页只说「过关」，并给出「下一关 / 重玩本关 / 返回菜单」三个出口。
// 得分、星级、成就属 M3，届时应在本页增补而非重写。
//
// ⚠️ 「下一关」与「重玩本关」都会重新走 `startLevel()`，即**重新 reset 沙箱** ——
// 这是必须的：不 reset 就会带着上一关残留的工作区进入下一关。
// 两次调用都发生在**点击回调**里，不在 effect 中（原因见 `startLevel.ts`）。

import { useState } from 'react'
import { getChapterLevels, getLevel } from '../../../levels/chapters'
import { startLevel } from '../../../app/startLevel'
import { useSessionStore } from '../../../store/sessionStore'
import { useViewStore } from '../../../store/viewStore'
import styles from './LevelComplete.module.css'

export function LevelComplete() {
  const level = useSessionStore((state) => state.level)
  const goMenu = useViewStore((state) => state.goMenu)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** 同章内的下一关；已是最后一关则为 null（M2 不做跨章自动推进） */
  const nextLevelId = findNextLevelId(level?.id ?? null)

  async function handleStart(levelId: string) {
    setError(null)
    setBusy(true)
    const result = await startLevel(levelId)
    setBusy(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <section className={styles.screen}>
      <p className={styles.badge}>过关</p>
      <h1 className={styles.title}>{level ? `${level.title} · 时间线已锚定` : '时间线已锚定'}</h1>
      <p className={styles.desc}>
        本关的全部目标均已达成。这条时间线暂时稳住了 —— 但熵增不会停止。
      </p>

      {error !== null && (
        <p className={styles.error} role="alert">
          无法进入关卡：{error}
        </p>
      )}

      <div className={styles.actions}>
        {nextLevelId !== null && (
          <button
            className={styles.primary}
            type="button"
            onClick={() => void handleStart(nextLevelId)}
            disabled={busy}
          >
            进入下一关 {nextLevelId}
          </button>
        )}
        {level !== null && (
          <button
            className={styles.secondary}
            type="button"
            onClick={() => void handleStart(level.id)}
            disabled={busy}
          >
            重玩本关
          </button>
        )}
        <button className={styles.secondary} type="button" onClick={goMenu} disabled={busy}>
          返回菜单
        </button>
      </div>
    </section>
  )
}

/**
 * 找同章内的下一关 id。
 *
 * ⚠️ 只按 `getChapterLevels()` 给出的顺序推进，不跨章 —— 跨章要等 M4 把第 2–3 章
 * 补上之后，由章节解锁逻辑（M3）决定，M2 不臆造「下一章第一关」的跳转。
 */
function findNextLevelId(levelId: string | null): string | null {
  if (levelId === null) return null

  const level = getLevel(levelId)
  if (level === null) return null

  const siblings = getChapterLevels(level.chapter)
  const index = siblings.findIndex((item) => item.id === level.id)
  if (index < 0 || index >= siblings.length - 1) return null

  return siblings[index + 1].id
}
