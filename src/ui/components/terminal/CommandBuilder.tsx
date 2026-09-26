// 拼接式命令输入（development-refinement.md §9.1、GDD §3.2「命令拼接」）
//
// ⚠️ 已确认决策：**点击拼接，不做拖拽**。点击片段 → 拼进输入行，
// 玩家能亲眼看到完整命令被一段段拼出来，再按执行。
// ⚠️ 仅当 `level.inputMode === 'menu'` 时启用；`'free'` 仍用 M1 的 Terminal。
//
// 本组件是**受控**的（value / onChange 由容器提供），理由有二：
//   1. 输入行状态是会话的一部分，必须存进 sessionStore（切视图不丢），
//      故它不可能只活在组件内部 state 里；
//   2. 组件测试可以直接喂 value 断言「点了某个片段之后输入行变成什么」，
//      完全不必启动沙箱或 mock 执行层。
//
// ⚠️ 所有拼接语义都在纯函数 `game/command/fragments.ts` 里（含「替换槽位」
// 与「换命令时重置草稿」），本组件只负责渲染按钮 + 转发点击。
// 这样的分工让「先点任意片段、再点任意片段都不会拼出语法非法的命令」
// 这条要求可以被纯函数单测穷举覆盖，而不必渲染 React。

import type { KeyboardEvent } from 'react'
import {
  applyFragment,
  isFragmentEnabled,
  renderDraft,
  type Draft,
  type Fragment,
} from '../../../game/command/fragments'
import styles from './CommandBuilder.module.css'

export interface CommandBuilderProps {
  /** 当前关卡可用的命令片段 */
  fragments: Fragment[]
  /** 拼接草稿（受控）：由容器持有，保证切视图不丢 */
  draft: Draft
  /** 草稿变化回调 */
  onChange: (draft: Draft) => void
  /** 执行当前拼出的命令 */
  onRun: (command: string) => void
  /** 是否正在执行 */
  busy: boolean
}

export function CommandBuilder({ fragments, draft, onChange, onRun, busy }: CommandBuilderProps) {
  const command = renderDraft(draft)
  // 片段拼出来的部分（只读展示）；玩家手写的后缀另算，见下方输入框
  const built = renderDraft({ slots: draft.slots })

  function handleFragment(fragment: Fragment) {
    onChange(applyFragment(draft, fragment, fragments))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (command.trim().length > 0) onRun(command)
  }

  // 按命令分组渲染：同一条命令的片段聚在一起，玩家一眼能看出拼到哪一步
  const groups: { command: string; items: Fragment[] }[] = []
  for (const fragment of fragments) {
    const group = groups.find((item) => item.command === fragment.command)
    if (group) group.items.push(fragment)
    else groups.push({ command: fragment.command, items: [fragment] })
  }

  return (
    <div className={styles.builder} data-testid="command-builder">
      <div className={styles.fragments} role="group" aria-label="命令片段">
        {groups.map((group) => (
          <div key={group.command} className={styles.group} aria-label={group.command}>
            {group.items.map((fragment) => {
              // ⚠️ 不可点的片段置灰而非隐藏：隐藏会让按钮位置乱跳，
              // 置灰则让玩家看得出「这一步还没轮到它」。
              const enabled = isFragmentEnabled(draft, fragment, fragments)
              return (
                <button
                  key={fragment.id}
                  className={styles.fragment}
                  type="button"
                  onClick={() => handleFragment(fragment)}
                  disabled={!enabled}
                  data-command={fragment.command}
                  data-slot={fragment.slot}
                  aria-label={`拼接命令片段：${fragment.label}`}
                >
                  {fragment.label}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className={styles.line}>
        <label className={styles.prompt} htmlFor="gtp-builder-input">
          $
        </label>
        {/*
          ⚠️ 输入行 = 「片段拼出的部分（只读）」+「玩家手写的后缀（可编辑）」两段。
          为什么不让整行都可编辑：片段部分必须与槽位状态严格对应，否则玩家手改文本后
          替换语义就失效了（改出来的字串再也对不上任何片段）。
          为什么必须留一段可编辑：拼接只给到 `-m` 为止，引号里的提交信息
          （`git commit -m "第一次快照"`）**只能靠玩家自己敲** ——
          早期版本把整行设为 readOnly，导致 1-1 根本无法通关（浏览器实测抓出）。
        */}
        {built.length > 0 && <span className={styles.built}>{built}</span>}
        <input
          id="gtp-builder-input"
          className={styles.suffix}
          value={draft.suffix ?? ''}
          onChange={(event) => onChange({ ...draft, suffix: event.target.value })}
          onKeyDown={handleKeyDown}
          placeholder={built.length > 0 ? '接着补完这条命令…' : '点击上方片段开始拼命令'}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          // 文案要说清「这里补的是命令里没法点出来的那部分」（如 `-m` 后的提交信息），
          // 而不是笼统的「命令输入补充」—— 后者对屏幕阅读器毫无信息量。
          aria-label="补充命令参数，例如提交信息"
        />
        {/*
          用 `<output>` 而非 `<span>`：它是对「计算结果」的语义化标签，
          配 `aria-live="polite"` 后，每次点击片段拼出的新命令都会被朗读 ——
          这对「拼接式输入」这个核心交互是实打实的无障碍改进（盲操作玩家无法
          从视觉上确认自己拼出了什么）。
        */}
        <output
          className={styles.preview}
          aria-label="拼接的完整命令"
          aria-live="polite"
          data-testid="command-preview"
        >
          {command || '（空）'}
        </output>
        <button
          className={styles.run}
          type="button"
          onClick={() => onRun(command)}
          disabled={busy || command.trim().length === 0}
          aria-label="执行拼接的命令"
        >
          {busy ? '执行中' : '执行'}
        </button>
      </div>

      <p className={styles.tip}>
        依次点击片段拼出命令；带引号的提交信息请自己敲进输入框，看清整条命令后再执行。
      </p>
    </div>
  )
}
