// 关卡主界面容器（development-refinement.md §9.1 关卡主界面布局）
//
// M1 时本文件临时放在 `src/app/`；M2 起按 §3 的目录规划迁移到 `src/ui/components/level/`。
//
// 布局严格对齐 §9.1（M2 为简化版，但**结构**一致，便于 M4 增补 GitGraph/BranchPanel/Hints）：
//   ┌ 顶部栏：章节/关卡名 · 目标摘要 · 得分 · 星级 · 暂停 ────────────────┐
//   ├ GoalPanel（目标与检测）      │ FileTree（工作区状态树）             │
//   │ Terminal（命令输入 + 历史）  │ GitGraph 提交图（M2 用 CommitPanel） │
//   └──────────────────────────────┴──────────────────────────────────────┘
// 得分 / 星级 / 暂停按钮在 M2 **不实现**（计分与星级属 M3，见 M2-tasks-TODO
// 「已确认的决策」第 2 条）；此处只保留它们在 §9.1 中的位置标注，避免 M3 重新排版。
//
// ⚠️ 本组件的定位是**容器**：只负责组装与刷新编排，不含业务逻辑 ——
// 命令执行只发生在 Terminal / CommandBuilder（经 executor），
// 目标判定只在 `game/validate/targetState`（经 `useTargetState`）。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { executeToEntry } from '../../../game/command/executor'
import { fragmentsForLevel } from '../../../game/command/fragments'
import { stillMissingHint } from '../../../game/validate/stillMissingHint'
import { getChapterMeta } from '../../../levels/chapters'
import { useSessionStore } from '../../../store/sessionStore'
import { useViewStore } from '../../../store/viewStore'
import { CommandHistory } from '../history/CommandHistory'
import { CommitPanel } from '../gitGraph/CommitPanel'
import { FileTree } from '../fileTree/FileTree'
import { GoalPanel } from '../goalPanel/GoalPanel'
import { CommandBuilder } from '../terminal/CommandBuilder'
import { Terminal } from '../terminal/Terminal'
import { useFileTree } from '../fileTree/useFileTree'
import { useCommitHistory } from '../../hooks/useCommitHistory'
import { useTargetState } from '../../hooks/useTargetState'
import styles from './LevelScreen.module.css'

export function LevelScreen() {
  const level = useSessionStore((state) => state.level)
  const history = useSessionStore((state) => state.history)
  const draft = useSessionStore((state) => state.draft)
  const setDraft = useSessionStore((state) => state.setDraft)
  const resetDraft = useSessionStore((state) => state.resetDraft)
  const appendEntry = useSessionStore((state) => state.appendEntry)
  const goMenu = useViewStore((state) => state.goMenu)
  const goChapter = useViewStore((state) => state.goChapter)
  const goLevelComplete = useViewStore((state) => state.goLevelComplete)

  // 「流水号」：每条命令执行后自增，驱动文件树、提交历史与目标检测重新读取（§9.1 的刷新触发）
  const [version, setVersion] = useState(0)
  // 失败次数（执行失败 ≠ 目标未达成）：供 GoalPanel 逐级给出更具体的抽象引导
  const [failures, setFailures] = useState(0)

  const tree = useFileTree(version)
  const commits = useCommitHistory()
  const targets = useTargetState(version)

  const isMenuMode = level?.inputMode === 'menu'

  // 命令片段清单只由关卡决定（随关卡变化而变化），故用 level 派生而非存进 store
  const fragments = useMemo(() => (level === null || !isMenuMode ? [] : fragmentsForLevel(level)), [
    level,
    isMenuMode,
  ])

  // 换关时复位失败计数（否则新关卡一进来就带着上一关的提示级别）
  useEffect(() => {
    setFailures(0)
  }, [level])

  const handleExecuted = useCallback((ok: boolean) => {
    setVersion((value) => value + 1)
    if (!ok) setFailures((value) => value + 1)
  }, [])

  // 过关判定：全部 targets 满足 → 切 levelComplete（§9.1、M2 只做判定不做计分）
  useEffect(() => {
    if (targets.state?.satisfied === true) goLevelComplete()
  }, [targets.state, goLevelComplete])

  async function runCommand(command: string) {
    if (command.trim().length === 0) return
    await execute(command.trim())
  }

  /** 拼接模式下由本容器负责执行（Terminal 是自成一体的自由输入组件，不便复用其内部逻辑） */
  async function execute(command: string) {
    let ok = false
    try {
      const entry = await executeToEntry(command)
      ok = entry.ok
      appendEntry(entry)
    } catch (error) {
      appendEntry({
        input: command,
        tokens: command.split(/\s+/),
        ok: false,
        output: [],
        error: `命令执行失败：${error instanceof Error ? error.message : String(error)}`,
        undoable: false,
      })
      console.error('[LevelScreen] 命令执行抛出异常', error)
    }

    resetDraft()
    handleExecuted(ok)
  }

  const chapterTitle = level === null ? null : (getChapterMeta(level.chapter)?.title ?? level.chapter)

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{level ? level.title : '自由沙箱'}</h1>
          <p className={styles.objective}>
            {level ? level.objective : '时间线检修模式：在空沙箱中自由演练 Git 命令。'}
          </p>
        </div>

        <div className={styles.status}>
          {level && (
            <span className={styles.chapter}>
              {chapterTitle} · {level.id}
            </span>
          )}
          {/*
            §9.1 的「得分 / 星级 / 暂停」位：M2 明确不做（计分与星级属 M3）。
            此处仅以占位标注保留位置，不渲染任何假的分数。
          */}
          <span className={styles.pending} title="得分与星级属 M3">
            得分 · 星级（M3）
          </span>
          {/*
            两级出口：返回章节（chN 关卡列表）与返回菜单。
            ⚠️ 浏览器后退键在本应用里会直接离开页面（刻意不用 react-router，§1），
            故每级导航都必须有显式按钮。返回章节仅在真实关卡下出现
            （自由沙箱没有所属章节）；中途返回不重置会话 ——
            再进任意一关时 startLevel 会整体重建（reset 沙箱 + 复位会话）。
          */}
          {level && (
            <button
              className={styles.quit}
              type="button"
              onClick={() => goChapter(level.chapter)}
              aria-label="返回章节关卡列表"
            >
              返回章节
            </button>
          )}
          <button className={styles.quit} type="button" onClick={goMenu}>
            返回菜单
          </button>
        </div>
      </header>

      <div className={styles.columns}>
        <section className={styles.console}>
          <GoalPanel
            items={targets.state?.results ?? []}
            checking={targets.checking}
            missingHint={stillMissingHint(failures)}
          />

          <div className={styles.terminalBlock}>
            <h2 className={styles.panelTitle}>终端</h2>
            <CommandHistory history={history} />
            {isMenuMode ? (
              <CommandBuilder
                fragments={fragments}
                draft={draft}
                onChange={setDraft}
                onRun={(command) => void runCommand(command)}
                busy={false}
              />
            ) : (
              <Terminal onExecuted={handleExecuted} />
            )}
          </div>
        </section>

        <aside className={styles.side}>
          <FileTree nodes={tree.tree} branch={tree.branch} loading={tree.loading} />
          <CommitPanel commits={commits} />
        </aside>
      </div>
    </main>
  )
}
