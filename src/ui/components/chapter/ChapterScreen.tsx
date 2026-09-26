// 章节介绍页（development-refinement.md §5 `chapter` 视图、§3 `ui/components/chapter/`）
//
// M2 的**最小可用**实现：列出该章的关卡，点「开始」即进入。
// 章节叙事文本、笔记引用卡属 M4+，此处不臆造。
//
// ⚠️ 进入关卡是**点击事件**里调 `startLevel()`（内部先 reset 沙箱再切视图），
// 不放 useEffect —— 原因见 `startLevel.ts` 顶部注释（StrictMode 双跑会清空仓库）。

import { useState } from 'react'
import { getChapterLevels, getChapterMeta } from '../../../levels/chapters'
import { startLevel } from '../../../app/startLevel'
import { useViewStore } from '../../../store/viewStore'
import type { ChapterId } from '../../../game/types'
import styles from './ChapterScreen.module.css'

export interface ChapterScreenProps {
  chapterId: ChapterId
}

export function ChapterScreen({ chapterId }: ChapterScreenProps) {
  const meta = getChapterMeta(chapterId)
  const levels = getChapterLevels(chapterId)
  // ⚠️ 本页必须有出口：本项目刻意不用 react-router（§1 决策），浏览器后退键会
  //    直接离开应用，而非回到菜单。故每个非 menu 视图都要自带返回入口。
  //    先前遗漏此处，「章节详情」一度成为导航死角（进去后出不来）。
  const goMenu = useViewStore((state) => state.goMenu)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

  async function handleStart(levelId: string) {
    setError(null)
    setStarting(levelId)
    const result = await startLevel(levelId)
    setStarting(null)
    if (!result.ok) setError(result.error)
    // 成功时视图已切走，本组件随之卸载，无需清理 state
  }

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <button className={styles.back} type="button" onClick={goMenu} aria-label="返回主菜单">
            ← 返回菜单
          </button>
          <p className={styles.kicker}>章节 {chapterId}</p>
        </div>
        <h1 className={styles.title}>{meta?.title ?? chapterId}</h1>
        {meta !== null && <p className={styles.desc}>{meta.subtitle}</p>}
      </header>

      {error !== null && (
        <p className={styles.error} role="alert">
          无法进入关卡：{error}
        </p>
      )}

      <ol className={styles.levels}>
        {levels.length === 0 && <li className={styles.empty}>本章关卡数据尚未提供。</li>}

        {levels.map((level) => (
          <li key={level.id} className={styles.level}>
            <div className={styles.levelText}>
              <h2 className={styles.levelTitle}>
                <span className={styles.levelId}>{level.id}</span>
                {level.title}
              </h2>
              <p className={styles.objective}>{level.objective}</p>
              <p className={styles.meta}>
                难度 {'★'.repeat(level.difficulty)}
                {'☆'.repeat(5 - level.difficulty)} ·{' '}
                {level.inputMode === 'menu' ? '拼接输入' : level.inputMode === 'half' ? '半拼输入' : '自由输入'}
              </p>
            </div>
            <button
              className={styles.start}
              type="button"
              onClick={() => void handleStart(level.id)}
              disabled={starting !== null}
              aria-label={`开始关卡 ${level.id} ${level.title}`}
            >
              {starting === level.id ? '校准中…' : '开始'}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
