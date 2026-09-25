// 虚拟文件树（development-refinement.md §9.1 FileTree / 状态树）
//
// 纯展示组件：数据由 `useFileTree()` 提供（经 executor 读取），
// 此处只负责渲染目录层级与条目的 git 状态标注。

import type { FileTreeNode, GitFileState } from './useFileTree'
import styles from './FileTree.module.css'

/** git 状态 → 显示用的单字符标记与中文说明（对齐 `git status -s` 的两列写法） */
const STATE_MARK: Record<GitFileState, { mark: string; label: string }> = {
  staged: { mark: 'A', label: '已暂存' },
  modified: { mark: 'M', label: '已修改（未暂存）' },
  untracked: { mark: '?', label: '未追踪' },
}

/** 渲染节点的状态标记；未入库或无改动的文件不显示标记 */
function StateMarks({ states }: { states: GitFileState[] }) {
  if (states.length === 0) return null
  return (
    <span className={styles.marks}>
      {states.map((state) => (
        <span key={state} className={styles.mark} data-state={state} title={STATE_MARK[state].label}>
          {STATE_MARK[state].mark}
        </span>
      ))}
    </span>
  )
}

function TreeNode({ node }: { node: FileTreeNode }) {
  if (node.isDir) {
    return (
      <li className={styles.node}>
        <span className={styles.dir}>
          <span className={styles.dirIcon} aria-hidden="true">
            ▸
          </span>
          {node.name}
        </span>
        {node.children.length > 0 && (
          <ul className={styles.children}>
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li className={styles.node}>
      <span className={styles.file}>
        {node.name}
        <StateMarks states={node.states} />
      </span>
    </li>
  )
}

export interface FileTreeProps {
  nodes: FileTreeNode[]
  /** 当前分支名 */
  branch: string | null
  /** 是否正在读取 */
  loading: boolean
}

export function FileTree({ nodes, branch, loading }: FileTreeProps) {
  const fileCount = countFiles(nodes)

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.title}>工作区</h2>
        <span className={styles.meta}>
          {branch ?? 'main'} · {fileCount} 个文件
        </span>
      </header>

      <div className={styles.body}>
        {nodes.length === 0 && (
          <p className={styles.empty}>
            工作区暂无改动。
            <br />
            用 <code>git add</code> 暂存文件后，条目会连同状态标记出现在这里。
          </p>
        )}
        {nodes.length > 0 && (
          <ul className={styles.tree}>
            {nodes.map((node) => (
              <TreeNode key={node.path} node={node} />
            ))}
          </ul>
        )}
      </div>

      {loading && <p className={styles.loading}>读取中…</p>}
    </section>
  )
}

/** 统计文件（非目录）节点数量 */
function countFiles(nodes: FileTreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    count += node.isDir ? countFiles(node.children) : 1
  }
  return count
}
