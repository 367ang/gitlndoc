// 开场叙事页（development-refinement.md §5 `intro` 视图；M6 真实化）
//
// M1~M5 期间本视图是「M1 占位」（ViewPlaceholder）。M6 全游戏收官，
// 补上 GDD §2 的世界观开场：时间线管理局 / 熵增撕裂的时间线 / 修复即游玩。
//
// ⚠️ 保留既有决策：进入关卡统一由 `startLevel()` 在**点击回调**里 reset 沙箱，
// 本页只有「进入时间线检修台」一个出口（goMenu），不做任何沙箱操作。

import { useViewStore } from '../../../store/viewStore'
import styles from './IntroScreen.module.css'

/** 开场叙事的三段文案（GDD §2 世界观的直接转述，保持简短 —— §14 精简约束） */
const VERSES: { title: string; body: string }[] = [
  {
    title: '时间线管理局',
    body: '你是管理局的旅人 —— 穿行于无数平行宇宙之间，维护每一条时间线的完整与秩序。',
  },
  {
    title: '熵增撕裂了它们',
    body: '一场事故让档案库崩坏：观测记录散落、历史被改写、坐标失去名字。每个宇宙都在等待修复。',
  },
  {
    title: 'Git 是唯一的锚',
    body: '修复时间线的工具只有一件：真实的 Git 命令。每一次归档、每一次合并、每一个标签，都是把碎裂的历史重新锚定。',
  },
]

export function IntroScreen() {
  const goMenu = useViewStore((state) => state.goMenu)

  return (
    <section className={styles.screen}>
      <p className={styles.kicker}>PROLOGUE</p>
      <h1 className={styles.title}>Git 时间旅行者</h1>

      <ol className={styles.verses}>
        {VERSES.map((verse, index) => (
          <li key={verse.title} className={styles.verse}>
            <span className={styles.verseIndex}>{index + 1}</span>
            <div>
              <h2 className={styles.verseTitle}>{verse.title}</h2>
              <p className={styles.verseBody}>{verse.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <button className={styles.action} type="button" onClick={goMenu}>
        进入时间线检修台
      </button>
    </section>
  )
}
