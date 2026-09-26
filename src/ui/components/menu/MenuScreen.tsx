// 主菜单（development-refinement.md §5 `menu` 视图、§3 `ui/components/menu/`）
//
// M2 的**最小可用**实现：列出全部章节，点击进入章节介绍页；
// 已解锁的章节里可以直接跳到某一关（M2 不做关卡解锁/进度持久化 ——
// 进度与成就是 M3/M5 的事，见 M2-tasks-TODO「已确认的决策」第 2 条）。
//
// ⚠️ 本组件**不调用 `sandbox.reset()`**：进关卡的重置统一由 `startLevel()`
// 在章节页/关卡列表的**点击回调**里完成，避免菜单一渲染就把沙箱清空
// （StrictMode 下 effect 双跑尤其危险，详见 `startLevel.ts` 顶部注释）。

import { useState } from 'react'
import { CHAPTERS, getChapterLevels } from '../../../levels/chapters'
import { startLevel } from '../../../app/startLevel'
import { useViewStore } from '../../../store/viewStore'
import styles from './MenuScreen.module.css'

export function MenuScreen() {
  const goChapter = useViewStore((state) => state.goChapter)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

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
                  {chapter.playable ? `${levels.length} 个关卡` : '尚未开放 · 后续里程碑'}
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
