// 虚拟文件树 + 内嵌文件编辑器（development-refinement.md §9.1 FileTree / 状态树；M4）
//
// 树渲染为纯展示（数据由 `useFileTree()` 经 executor 提供）。
// M4 增补：点击文件节点 → 打开编辑面板（textarea）→ 保存写入工作区（game/editor.ts）。
// 编辑能力是 2-2（改日记）/ 2-4（建 .gitignore）/ 3-4（解决冲突）与 1-4（M3 遗留）
// 的共同依赖 —— 没有它，玩家无法制造「新的改动」。
//
// ⚠️ 保存只发生在「保存」按钮的**点击回调**里（StrictMode 双跑教训：
// 放 effect 会反复覆写玩家内容）。

import { useCallback, useEffect, useState } from 'react'
import { readWorkdirFile, writeWorkdirFile } from '../../../game/editor'
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

function TreeNode({ node, onOpen }: { node: FileTreeNode; onOpen?: (path: string) => void }) {
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
              <TreeNode key={child.path} node={child} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li className={styles.node}>
      <button
        type="button"
        className={styles.file}
        onClick={onOpen ? () => onOpen(node.path) : undefined}
        disabled={onOpen === undefined}
        title="点击编辑该文件"
        aria-label={`编辑文件 ${node.path}`}
      >
        {node.name}
        <StateMarks states={node.states} />
      </button>
    </li>
  )
}

/** 编辑面板（打开中的文件 + textarea + 保存/取消） */
function EditorPanel({
  path,
  onClose,
  onSaved,
}: {
  path: string
  onClose: () => void
  onSaved: (path: string) => void
}) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const text = await readWorkdirFile(path)
      if (cancelled) return
      setContent(text ?? '')
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  const handleSave = useCallback(async () => {
    const result = await writeWorkdirFile(path, content)
    if (result.ok) {
      onSaved(path)
    } else {
      setError(result.error)
    }
  }, [path, content, onSaved])

  return (
    <div className={styles.editor} data-testid="file-editor" role="dialog" aria-label={`编辑 ${path}`}>
      <div className={styles.editorHead}>
        <span className={styles.editorPath}>{path}</span>
        <button type="button" className={styles.editorButton} onClick={onClose} aria-label="关闭编辑器">
          关闭
        </button>
      </div>
      {loading ? (
        <p className={styles.loading}>读取中…</p>
      ) : (
        <textarea
          className={styles.editorArea}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          aria-label={`文件 ${path} 的内容`}
          rows={8}
        />
      )}
      {error !== null && (
        <p className={styles.editorError} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.editorSave}
        onClick={() => void handleSave()}
        disabled={loading}
        aria-label={`保存 ${path}`}
      >
        保存
      </button>
    </div>
  )
}

export interface FileTreeProps {
  nodes: FileTreeNode[]
  /** 当前分支名 */
  branch: string | null
  /** 是否正在读取 */
  loading: boolean
  /** 文件保存后的回调（容器借此刷新 version 与目标检测） */
  onFileSaved?: (path: string) => void
}

export function FileTree({ nodes, branch, loading, onFileSaved }: FileTreeProps) {
  const fileCount = countFiles(nodes)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newPath, setNewPath] = useState('')

  /**
   * 「新建文件」入口（M4 实测补缺）：FileTree 只显示 status 有变化的文件，
   * 工作区干净时玩家没有任何编辑入口 —— 而制造新改动正是核心玩法
   * （1-4 第二环 / 2-2 / 2-4 .gitignore）。新建 = 空文件写入工作区。
   */
  const handleCreate = useCallback(async () => {
    const path = newPath.trim()
    if (path.length === 0) return
    const result = await writeWorkdirFile(path, '')
    if (result.ok) {
      setCreating(false)
      setNewPath('')
      setEditingPath(path)
      onFileSaved?.(path)
    }
  }, [newPath, onFileSaved])

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
              <TreeNode key={node.path} node={node} onOpen={onFileSaved ? setEditingPath : undefined} />
            ))}
          </ul>
        )}
      </div>

      {onFileSaved && (
        <div className={styles.createRow}>
          {creating ? (
            <>
              <input
                className={styles.createInput}
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreate()
                }}
                placeholder="新文件路径，如 notes/draft.md"
                aria-label="新建文件的路径"
                autoFocus
              />
              <button type="button" className={styles.createButton} onClick={() => void handleCreate()} aria-label="创建并打开">
                创建并打开
              </button>
              <button type="button" className={styles.cancelButton} onClick={() => setCreating(false)} aria-label="取消新建">
                取消
              </button>
            </>
          ) : (
            <button type="button" className={styles.createButton} onClick={() => setCreating(true)} aria-label="新建文件">
              ＋ 新建文件
            </button>
          )}
        </div>
      )}

      {editingPath !== null && (
        <EditorPanel
          path={editingPath}
          onClose={() => setEditingPath(null)}
          onSaved={(path) => {
            setEditingPath(null)
            onFileSaved?.(path)
          }}
        />
      )}

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
