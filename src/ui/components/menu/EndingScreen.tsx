// 结局页（development-refinement.md §5 `gameComplete` 视图；M6 真实化）
//
// M1~M5 期间本视图是占位。M6 终章落地，补上 GDD §2 的收官叙事：
// 全部主线通关后，菜单页的「进入结局」入口会切到本视图。
//
// ⚠️ 本页是**奖励视图**而非新的游玩入口：展示最终统计（总得分 / 星级 / 成就数）
// 与一段收官叙事；「重新开始」只回菜单，不重置进度（重置属 M7 的设置范围）。

import { getAllLevels } from '../../../levels/chapters'
import { ACHIEVEMENTS } from '../../../game/scoring/achievements'
import { useProgressStore } from '../../../store/progressStore'
import { useViewStore } from '../../../store/viewStore'
import { starText } from './MenuScreen'
import styles from './EndingScreen.module.css'

export function EndingScreen() {
  const goMenu = useViewStore((state) => state.goMenu)
  const levelRecords = useProgressStore((state) => state.levelRecords)
  const achievements = useProgressStore((state) => state.achievements)

  const allLevels = getAllLevels()
  const totalScore = allLevels.reduce((sum, level) => sum + (levelRecords[level.id]?.score ?? 0), 0)
  const totalStars = allLevels.reduce((sum, level) => sum + (levelRecords[level.id]?.stars ?? 0), 0)
  const maxStars = allLevels.length * 3

  return (
    <section className={styles.screen}>
      <p className={styles.kicker}>EPILOGUE</p>
      <h1 className={styles.title}>大统一</h1>

      <p className={styles.narrative}>
        最后一条时间线稳住了。散落的观测各归其位，被改写的历史找到了自己的名字，
        每一个关键坐标都有锚点可循。管理局的档案库里，你的名字被写进了修复者名录 ——
        而你知道，真正修复这些时间线的，是你一路敲下的每一条真实命令。
      </p>

      <div className={styles.stats} data-testid="ending-stats">
        <span className={styles.stat}>
          总得分 <strong data-testid="ending-score">{totalScore}</strong>
        </span>
        <span className={styles.stat}>
          星级 <strong data-testid="ending-stars">{starText(Math.round((totalStars / maxStars) * 3))}</strong>（{totalStars}/{maxStars}）
        </span>
        <span className={styles.stat}>
          成就 <strong data-testid="ending-achievements">{achievements.length}</strong>/{ACHIEVEMENTS.length}
        </span>
      </div>

      <button className={styles.action} type="button" onClick={goMenu}>
        返回检修台
      </button>
    </section>
  )
}
