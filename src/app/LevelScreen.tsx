// 关卡主界面容器（development-refinement.md §9.1 关卡主界面布局）
//
// M1 的「极简可用版」：左列 = 终端（历史 + 输入），右列 = 工作区文件树 + 提交历史。
// §9.1 的完整布局（GoalPanel / GitGraph / BranchPanel / Hints）属 M2–M4，此处不实现。
//
// ⚠️ 本组件的定位是**容器**：只负责组装与刷新编排，不含业务逻辑，
// 命令执行仍然只发生在 `Terminal`（经 executor）。
//
// ⚠️ 关于关卡数据：`sandbox.reset(level.init)` 的调用点在**进入关卡**时，
// 而 M1 的关卡数据（`levels/`）属 M2，`sessionStore.level` 目前恒为 null。
// 因此 M1 以「自由沙箱」形态呈现：玩家在空沙箱中自行 init → add → commit，
// 即可验证「命令 → 仓库 → 可视化」闭环（M1 验收项 5.3）。

import { useCallback, useState } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { CommandHistory } from '../ui/components/history/CommandHistory'
import { CommitPanel } from '../ui/components/gitGraph/CommitPanel'
import { FileTree } from '../ui/components/fileTree/FileTree'
import { Terminal } from '../ui/components/terminal/Terminal'
import { useFileTree } from '../ui/components/fileTree/useFileTree'
import { useCommitHistory } from '../ui/hooks/useCommitHistory'
import styles from './LevelScreen.module.css'

export function LevelScreen() {
  const level = useSessionStore((state) => state.level)
  const history = useSessionStore((state) => state.history)

  // 「流水号」：每条命令执行后自增，驱动文件树与提交历史重新读取（§9.1 的刷新触发）
  const [version, setVersion] = useState(0)
  const tree = useFileTree(version)
  const commits = useCommitHistory()

  const handleExecuted = useCallback(() => setVersion((value) => value + 1), [])

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{level ? level.title : '自由沙箱'}</h1>
          <p className={styles.objective}>
            {level
              ? level.objective
              : '时间线检修模式：用 git init → git add → git commit 修复这条时间线。'}
          </p>
        </div>
        <span className={styles.mode}>{level ? `M1 · ${level.id}` : 'M1 · 演示'}</span>
      </header>

      <div className={styles.columns}>
        <section className={styles.console}>
          <h2 className={styles.panelTitle}>终端</h2>
          <CommandHistory history={history} />
          <Terminal onExecuted={handleExecuted} />
        </section>

        <aside className={styles.side}>
          <FileTree nodes={tree.tree} branch={tree.branch} loading={tree.loading} />
          <CommitPanel commits={commits} />
        </aside>
      </div>
    </main>
  )
}
