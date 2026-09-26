// 主菜单（development-refinement.md §5 `menu` 视图、§3 `ui/components/menu/`）
//
// M3 增补：总得分 / 星级汇总 + 成就查看入口（§9.1 顶栏「时空能量/得分 + 成就入口」
// 的菜单页落点）。成就列表默认收起，点「成就」按钮展开 —— 保持菜单首屏聚焦章节选择。
//
// M2 的最小可用行为保留：列出全部章节，点击进入章节介绍页；
// 已解锁的章节里可以直接跳到某一关（关卡解锁 / 进度持久化仍属 M4/M5）。
//
// ⚠️ 本组件**不调用 `sandbox.reset()`**：进关卡的重置统一由 `startLevel()`
// 在章节页/关卡列表的**点击回调**里完成，避免菜单一渲染就把沙箱清空
// （StrictMode 下 effect 双跑尤其危险，详见 `startLevel.ts` 顶部注释）。

import { useState } from 'react'
import { CHAPTERS, getChapterLevels, getAllLevels } from '../../../levels/chapters'
import { startLevel } from '../../../app/startLevel'
import { useProgressStore } from '../../../store/progressStore'
import { useViewStore } from '../../../store/viewStore'
import { ACHIEVEMENTS } from '../../../game/scoring/achievements'
import styles from './MenuScreen.module.css'

/** 星级显示：★ 实心 / ☆ 空心；0 星显示「—」 */
export function starText(stars: number): string {
  if (stars <= 0) return '—'
  return '★'.repeat(stars) + '☆'.repeat(3 - stars)
}

export function MenuScreen() {
  const goChapter = useViewStore((state) => state.goChapter)
  const levelRecords = useProgressStore((state) => state.levelRecords)
  const achievements = useProgressStore((state) => state.achievements)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [showAchievements, setShowAchievements] = useState(false)

  // 汇总：全部已注册关卡（M3 阶段只有 ch1 的 4 关）逐关取记录
  const allLevels = getAllLevels()
  const totalScore = allLevels.reduce((sum, level) => sum + (levelRecords[level.id]?.score ?? 0), 0)
  const clearedCount = allLevels.filter((level) => levelRecords[level.id]?.cleared === true).length
  const totalStars = allLevels.reduce((sum, level) => sum + (levelRecords[level.id]?.stars ?? 0), 0)
  const maxStars = allLevels.length * 3

  async function handleStart(levelId: string) {
    setError(null)
    setStarting(levelId)
    const result = await startLevel(levelId)
    setStarting(null)
    if (!result.ok) setError(result.error)
  }

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <p className={styles.kicker}>Git 时间旅行者</p>
        <h1 className={styles.title}>时间线检修台</h1>
        <p className={styles.desc}>
          每条时间线都被熵增撕裂。选择一章进入，用真实的 Git 命令把它重新锚定。
        </p>

        {/* M3 汇总条：总得分 / 通关数 / 星级 / 成就入口 */}
        <div className={styles.summary} data-testid="progress-summary">
          <span className={styles.summaryItem}>
            总得分 <strong data-testid="total-score">{totalScore}</strong>
          </span>
          <span className={styles.summaryItem}>
            通关 <strong>{clearedCount}</strong>/{allLevels.length}
          </span>
          <span className={styles.summaryItem}>
            星级 <strong>{totalStars}</strong>/{maxStars}
          </span>
          <button
            className={styles.achievementToggle}
            type="button"
            onClick={() => setShowAchievements((value) => !value)}
            aria-expanded={showAchievements}
            data-testid="achievement-toggle"
          >
            成就 {achievements.length}/{ACHIEVEMENTS.length}
            <span aria-hidden="true">{showAchievements ? ' ▾' : ' ▸'}</span>
          </button>
        </div>

        {showAchievements && (
          <ul className={styles.achievementList} data-testid="achievement-list">
            {ACHIEVEMENTS.map((achievement) => {
              const unlocked = achievements.includes(achievement.id)
              return (
                <li key={achievement.id} className={styles.achievement} data-unlocked={unlocked}>
                  <strong className={styles.achievementTitle}>{achievement.title}</strong>
                  <span className={styles.achievementDesc}>{achievement.description}</span>
                </li>
              )
            })}
          </ul>
        )}
      </header>

      {error !== null && (
        <p className={styles.error} role="alert">
          无法进入关卡：{error}
        </p>
      )}

      <ul className={styles.chapters}>
        {CHAPTERS.length === 0 && <li className={styles.empty}>尚无可用的章节数据。</li>}

        {CHAPTERS.map((chapter) => {
          const levels = getChapterLevels(chapter.id)
          const first = levels[0]
          // 章节小计：已通关数与总星（M3 展示，无记录时显示 —）
          const chapterStars = levels.reduce((sum, level) => sum + (levelRecords[level.id]?.stars ?? 0), 0)
          const chapterCleared = levels.filter((level) => levelRecords[level.id]?.cleared === true).length

          return (
            <li key={chapter.id} className={styles.chapter} data-playable={chapter.playable}>
              <div className={styles.chapterText}>
                <h2 className={styles.chapterTitle}>
                  <span className={styles.chapterId}>{chapter.id}</span>
                  {chapter.title}
                </h2>
                <p className={styles.chapterDesc}>{chapter.subtitle}</p>
                <p className={styles.chapterMeta}>
                  {/* 未实现的章节（M4–M6）如实说明，不让玩家点进去发现是空的（§14 不伪造） */}
                  {chapter.playable
                    ? `${levels.length} 个关卡 · 通关 ${chapterCleared}/${levels.length} · 星 ${chapterStars}/${levels.length * 3}`
                    : '尚未开放 · 后续里程碑'}
                </p>
              </div>

              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={() => goChapter(chapter.id)}
                  aria-label={`查看章节 ${chapter.id} ${chapter.title}`}
                >
                  章节详情
                </button>
                {first !== undefined && (
                  <button
                    className={styles.primary}
                    type="button"
                    onClick={() => void handleStart(first.id)}
                    disabled={starting !== null}
                    aria-label={`直接开始 ${first.id} ${first.title}`}
                  >
                    {starting === first.id ? '校准中…' : `开始 ${first.id}`}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
