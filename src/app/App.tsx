// 根组件：视图状态机调度（development-refinement.md §3 `app/routes.ts`、§5）
//
// 本应用不使用 react-router（§1 明确决策）：`viewStore.view` 即路由。
//
// ⚠️ boot 的职责（§5）：初始化 LightningFS 沙箱 → 加载持久化进度 → 决定进入 intro 还是 menu。
// M2 只做第一步 + 分流；「加载持久化进度」属 M5（见下方 TODO）。
// ⚠️ 初始化不可放进 React 的 effect：StrictMode 下 effect 会跑两遍，
// 而 `sandbox.reset()` 会清空整个虚拟根 —— 重复执行会把玩家刚建立的仓库抹掉。
// 故 boot 的初始化由入口 `main.tsx` 在挂载前完成一次，App 只做分流展示；
// 「进入关卡」的重置由 `app/startLevel.ts` 在**点击回调**里完成，同样不经 effect。

import { useEffect, useState } from 'react'
import { useViewStore } from '../store/viewStore'
import { MenuScreen } from '../ui/components/menu/MenuScreen'
import { ChapterScreen } from '../ui/components/chapter/ChapterScreen'
import { LevelScreen } from '../ui/components/level/LevelScreen'
import { LevelComplete } from '../ui/components/level/LevelComplete'
import { ViewPlaceholder } from './ViewPlaceholder'
import styles from './App.module.css'

export interface AppProps {
  /**
   * boot 阶段的沙箱初始化结果。
   * `null` 表示初始化成功；字符串为失败原因（失败同样要能进菜单，不能白屏）。
   */
  bootError: string | null
}

export function App({ bootError }: AppProps) {
  const view = useViewStore((state) => state.view)
  const chapterId = useViewStore((state) => state.chapterId)
  const goMenu = useViewStore((state) => state.goMenu)
  const goIntro = useViewStore((state) => state.goIntro)

  const [booted, setBooted] = useState(false)

  useEffect(() => {
    if (booted) return
    setBooted(true)

    // TODO(M5, §10)：此处应先读取 `gtp:progress:v1`（src/persistence/progress.ts），
    // 有进度则 goMenu()，无进度则 goIntro()。persistence 属 M5，当前统一走 intro。
    goIntro()
  }, [booted, goIntro])

  return (
    <div className={styles.app}>
      {bootError !== null && (
        <p className={styles.bootError} role="alert">
          沙箱初始化失败：{bootError}
        </p>
      )}

      {renderView()}
    </div>
  )

  function renderView() {
    switch (view) {
      case 'boot':
        return <p className={styles.boot}>正在校准时间线…</p>

      case 'intro':
        return (
          <ViewPlaceholder
            view="intro"
            description="每个章节都是一条被熵增撕裂的时间线。用真实的 Git 命令把它重新锚定。"
            actionLabel="进入时间线检修台"
            onAction={goMenu}
          />
        )

      case 'menu':
        return <MenuScreen />

      case 'chapter':
        // `chapterId` 为 null 只会出现在直接深链到 chapter 视图这种不可能的状态
        // （`goChapter()` 是唯一入口且必带 chapterId）。此时退回菜单，不猜章节。
        return chapterId === null ? <MenuScreen /> : <ChapterScreen chapterId={chapterId} />

      case 'level':
        return <LevelScreen />

      case 'levelComplete':
        return <LevelComplete />

      case 'gameComplete':
        return (
          <ViewPlaceholder
            view="gameComplete"
            description="终章与结局叙事属 M6。当前第一章已可完整通关。"
            actionLabel="返回菜单"
            onAction={goMenu}
          />
        )
    }
  }
}
