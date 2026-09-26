// 命令行输入区（development-refinement.md §9.1 Terminal）
//
// 本组件是 UI 层**唯一**执行命令的入口：一律经 `executor.executeToEntry()`，
// 不直接调用 `gitApi`、也不触碰 `fs`（§2 分层职责）。
// §9.1 要求的「历史上下翻」按最小版实现（方向键在已提交的输入间移动）。

import { useRef, useState } from 'react'
import { executeToEntry } from '../../../game/command/executor'
import { useSessionStore } from '../../../store/sessionStore'
import styles from './Terminal.module.css'

// ⚠️ 输入行状态刻意用**组件内 useState**，而不是 sessionStore：
// 本组件只服务 `inputMode === 'free'` 的关卡（第 5 章起），与拼接模式的
// `sessionStore.draft` 是两套不同的输入模型。把二者塞进同一字段只会让
// 「切视图不丢输入」这个诉求在两种模式间互相污染；而自由输入框的内容
// 本来就该随组件卸载而丢弃。

export interface TerminalProps {
  /**
   * 每条命令执行完毕后的回调（LevelScreen 借此自增「流水号」以刷新文件树与目标面板）。
   * @param ok 该命令是否执行成功 —— 失败要与「目标未达成」区分开，供分步提示计数。
   */
  onExecuted: (ok: boolean) => void
}

export function Terminal({ onExecuted }: TerminalProps) {
  const [input, setInput] = useState('')
  const appendEntry = useSessionStore((state) => state.appendEntry)
  const history = useSessionStore((state) => state.history)

  const [busy, setBusy] = useState(false)
  // 历史浏览的下标：null 表示「不在浏览历史中」（正在编辑新命令）
  const [cursor, setCursor] = useState<number | null>(null)
  // 进入历史浏览前的草稿，按 ↓ 回到末尾时恢复
  const draft = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)

  /** 已执行过的非空命令，供上下翻使用 */
  const pastCommands = history.map((entry) => entry.input)

  async function submit() {
    const command = input.trim()
    if (busy) return
    if (command.length === 0) return

    setBusy(true)
    setInput('')
    setCursor(null)
    draft.current = ''

    let ok = false
    try {
      const entry = await executeToEntry(command)
      ok = entry.ok
      appendEntry(entry)
    } catch (error) {
      // 执行层的未捕获 rejection 也归一为一条历史记录，玩家不会「按了回车却什么都没发生」
      appendEntry({
        input: command,
        tokens: command.split(/\s+/),
        ok: false,
        output: [],
        error: `命令执行失败：${error instanceof Error ? error.message : String(error)}`,
        undoable: false,
      })
      console.error('[Terminal] 命令执行抛出异常', error)
    } finally {
      setBusy(false)
      onExecuted(ok)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowUp') {
      if (pastCommands.length === 0) return
      event.preventDefault()
      const next = cursor === null ? pastCommands.length - 1 : Math.max(0, cursor - 1)
      if (cursor === null) draft.current = input
      setCursor(next)
      setInput(pastCommands[next])
      return
    }

    if (event.key === 'ArrowDown') {
      if (cursor === null) return
      event.preventDefault()
      if (cursor >= pastCommands.length - 1) {
        setCursor(null)
        setInput(draft.current)
        return
      }
      const next = cursor + 1
      setCursor(next)
      setInput(pastCommands[next])
    }
  }

  return (
    <form
      className={styles.bar}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className={styles.prompt} htmlFor="gtp-terminal-input">
        $
      </label>
      <input
        id="gtp-terminal-input"
        ref={inputRef}
        className={styles.input}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="git init"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoFocus
        aria-label="命令输入"
      />
      <button className={styles.run} type="submit" disabled={busy || input.trim().length === 0}>
        {busy ? '执行中' : '执行'}
      </button>
    </form>
  )
}
