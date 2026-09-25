// 根组件：视图状态机调度（development-refinement.md §3 `app/routes.ts`、§5）
//
// 本应用不使用 react-router（§1 明确决策）：`viewStore.view` 即路由。
// M1 只让 `boot` 与 `level` 真正可用，其余视图按 §5 给出极简占位，M2 再填充。
//
// ⚠️ boot 的职责（§5）：初始化 LightningFS 沙箱 → 加载持久化进度 → 决定进入 intro 还是 menu。
// M1 只做第一步；「加载持久化进度」属 M5（见下方 TODO）。
// ⚠️ 初始化不可放进 React 的 effect：StrictMode 下 effect 会跑两遍，
// 而 `sandbox.reset()` 会清空整个虚拟根 —— 重复执行会把玩家刚建立的仓库抹掉。
// 故初始化由入口 `main.tsx` 在挂载前完成一次，App 只做分流展示。

import { useEffect, useState } from 'react'
import { useViewStore } from '../store/viewStore'
import { useSessionStore } from '../store/sessionStore'
import { LevelScreen } from './LevelScreen'
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
  const goMenu = useViewStore((state) => state.goMenu)
  const goIntro = useViewStore((state) => state.goIntro)
  const resetSession = useSessionStore((state) => state.resetSession)

  const [booted, setBooted] = useState(false)

  useEffect(() => {
    if (booted) return
    setBooted(true)

    // TODO(M5, §10)：此处应先读取 `gtp:progress:v1`（src/persistence/progress.ts），
    // 有进度则 goMenu()，无进度则 goIntro()。persistence 属 M5，M1 统一走 intro。
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

      case 'level':
        return <LevelScreen />

      case 'intro':
        return (
          <ViewPlaceholder
            view="intro"
            description="开场叙事属 M2。现在可以直接进入关卡，验证命令执行链路。"
            actionLabel="进入关卡"
            onAction={goMenu}
          />
        )

      case 'menu':
        return (
          <ViewPlaceholder
            view="menu"
            description="主菜单与章节选择属 M2。M1 的沙箱仓库已就绪，可进入关卡自由演练。"
            actionLabel="进入关卡"
            onAction={() => {
              // 退出上一关的会话（历史/输入复位），避免跨关卡串数据
              resetSession()
              useViewStore.getState().goLevel('m1-sandbox')
            }}
          />
        )

      case 'levelComplete':
      case 'gameComplete':
      case 'chapter':
        return <ViewPlaceholder view={view} description="该视图属 M2–M3，M1 仅打通可视化闭环。" />
    }
  }
}
