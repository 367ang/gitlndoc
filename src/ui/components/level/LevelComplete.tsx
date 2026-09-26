// 关卡结算页（development-refinement.md §5 `levelComplete` 视图）
//
// M3 增补（保留 M2 的「下一关 / 重玩本关 / 返回菜单」三个出口）：
//   - 得分与星级：由 `game/scoring/score.ts` 的 evaluateScore 在**挂载时**结算一次
//     （命令历史与会话状态在过关瞬间定格，此后不再变化，无须响应式重算）；
//   - 落库：`progressStore.setLevelRecord`（防重复结算 —— 重玩后再进结算页会重算覆盖）；
//   - 成就：evaluateAchievements 判定后逐个 unlockAchievement，新增的成就展示为「新解锁」。
//
// ⚠️ 结算只做一次：用 useState 存结果而非每次渲染重算 —— StrictMode 下 effect
//    会双跑，把「一次性落库」放进渲染路径会造成重复写入；effect 内部用
//    `settledRef` 兜底，双跑只结算一次。
//
// ⚠️ 「下一关」与「重玩本关」都会重新走 `startLevel()`，即**重新 reset 沙箱** ——
//    这是必须的：不 reset 就会带着上一关残留的工作区进入下一关。
//    两次调用都发生在**点击回调**里，不在 effect 中（原因见 `startLevel.ts`）。

import { useEffect, useRef, useState } from 'react'
import { getChapterLevels, getLevel } from '../../../levels/chapters'
import { startLevel } from '../../../app/startLevel'
import { useSessionStore } from '../../../store/sessionStore'
import { useProgressStore } from '../../../store/progressStore'
import { useViewStore } from '../../../store/viewStore'
import { evaluateScore, type ScoreResult } from '../../../game/scoring/score'
import { evaluateAchievements, achievementById } from '../../../game/scoring/achievements'
import type { Achievement } from '../../../game/scoring/achievements'
import styles from './LevelComplete.module.css'

/** 星级显示：实心/空心星（★☆），0 星显示「—」 */
function starText(stars: number): string {
  if (stars <= 0) return '—'
  return '★'.repeat(stars) + '☆'.repeat(3 - stars)
}

export function LevelComplete() {
  const level = useSessionStore((state) => state.level)
  const history = useSessionStore((state) => state.history)
  const targetState = useSessionStore((state) => state.targetState)
  const goMenu = useViewStore((state) => state.goMenu)
  const setLevelRecord = useProgressStore((state) => state.setLevelRecord)
  const unlockAchievement = useProgressStore((state) => state.unlockAchievement)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** 一次性结算结果；null 表示尚未完成（首帧） */
  const [score, setScore] = useState<ScoreResult | null>(null)
  /** 本次结算新解锁的成就（已解锁过的不重复展示） */
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([])

  // ⚠️ StrictMode 双跑兜底：结算副作用只执行一次
  const settledRef = useRef(false)

  useEffect(() => {
    if (settledRef.current) return
    if (level === null || targetState === null) return
    settledRef.current = true

    const { hintsUsed, firstAttempt } = useSessionStore.getState().settlement
    const result = evaluateScore(level, history, {
      hintsUsed,
      targetsMet: targetState.satisfied,
      firstAttempt,
    })
    setScore(result)

    // 落库：星级用 0 兜底（ScoreResult.stars 已含 0~3 全域）
    setLevelRecord(level.id, { score: result.score, stars: result.stars, cleared: true })

    // 成就判定：取结算后的本章记录（含刚写入的本关），判「完美篇章」
    const progress = useProgressStore.getState()
    const chapterStars: Record<string, number> = {}
    for (const sibling of getChapterLevels(level.chapter)) {
      const record = progress.levelRecords[sibling.id]
      if (record !== undefined) chapterStars[sibling.id] = record.stars
    }
    const earned = evaluateAchievements(
      {
        cleared: true,
        firstAttempt,
        hintsUsed,
        undoCount: history.filter((entry) => entry.ok && entry.undoable).length,
        chapter: level.chapter,
        chapterStars,
        chapterLevelCount: getChapterLevels(level.chapter).length,
      },
      progress.achievements,
    )
    for (const id of earned) unlockAchievement(id)
    setNewAchievements(
      earned
        .map((id) => achievementById(id))
        .filter((item): item is Achievement => item !== null),
    )
  }, [level, history, targetState, setLevelRecord, unlockAchievement])

  /** 同章内的下一关；已是最后一关则为 null（跨章推进属 M4） */
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

      {score !== null && (
        <div className={styles.scoreCard} data-testid="score-card">
          <p className={styles.stars} aria-label={`星级 ${score.stars} 星`}>
            {starText(score.stars)}
          </p>
          <p className={styles.score} data-testid="final-score">
            {score.score} 分
          </p>
          <ul className={styles.breakdown}>
            <li>基础分 +{score.breakdown.base}</li>
            {score.breakdown.optimalBonus > 0 && <li>最优序列 +{score.breakdown.optimalBonus}</li>}
            {score.breakdown.flawlessBonus > 0 && <li>一次通过 +{score.breakdown.flawlessBonus}</li>}
            {score.breakdown.probeBonus > 0 && <li>探查加分 +{score.breakdown.probeBonus}</li>}
            {score.breakdown.undoPenalty > 0 && <li className={styles.penalty}>撤销 −{score.breakdown.undoPenalty}</li>}
            {score.breakdown.redoPenalty > 0 && <li className={styles.penalty}>重复归档 −{score.breakdown.redoPenalty}</li>}
            {score.breakdown.hintPenalty > 0 && <li className={styles.penalty}>提示 −{score.breakdown.hintPenalty}</li>}
          </ul>
        </div>
      )}

      {newAchievements.length > 0 && (
        <div className={styles.achievementCard} data-testid="new-achievements">
          <p className={styles.achievementTitle}>新解锁成就</p>
          <ul className={styles.achievementList}>
            {newAchievements.map((achievement) => (
              <li key={achievement.id}>
                <strong>{achievement.title}</strong>
                <span>{achievement.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
 * 补上之后，由章节解锁逻辑决定，本页不臆造「下一章第一关」的跳转。
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
