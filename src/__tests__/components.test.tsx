// 组件测试（development-refinement.md §11.2）—— **真实用例**
//
// 覆盖范围（§11.2）：Terminal 输入/历史、GoalPanel 打勾、拼接式输入的片段追加。
//
// ─── 两条纪律 ────────────────────────────────────────────────────────────────
//
// 1. **断言语义化标记，不靠 className**：样式类名是 CSS Module 的哈希（`_fragment_0411c3`），
//    随构建变化；用它做断言等于把测试绑死在样式实现上。故一律走
//    `aria-label` / `data-*` / 可见中文文案 —— 它们同时也是无障碍与端到端测试的接口。
//
// 2. **拼接逻辑直接测纯函数层**（`game/command/fragments.ts`），不必渲染 React：
//    槽位替换、命令切换、可点判定这些规则都在纯函数里（组件只转发点击），
//    穷举覆盖因此变得可行。渲染层只测「点一下，输入行确实跟着变」这一件事。
//
// ⚠️ Terminal 用例会经 executor 真正跑 git，故需要真实 LightningFS 内存实例
//    （模式照 `executor.test.ts`：`configureFs({ name, backend: new MemoryBackend() })`，
//    每个用例唯一实例名）。GoalPanel / fragments 是不碰 fs 的纯展示与纯函数，
//    无需沙箱。

import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as LightningFsNS from '@isomorphic-git/lightning-fs'
import { configureFs, fsp, type FsIdb } from '../engine/fs'
import { reset } from '../engine/sandbox'
import {
  COMMON_FRAGMENTS,
  EMPTY_DRAFT,
  applyFragment,
  fragmentsForLevel,
  isFragmentEnabled,
  renderDraft,
  type Draft,
  type Fragment,
} from '../game/command/fragments'
import { CommandBuilder } from '../ui/components/terminal/CommandBuilder'
import { Terminal } from '../ui/components/terminal/Terminal'
import { GoalPanel } from '../ui/components/goalPanel/GoalPanel'
import { ChapterScreen } from '../ui/components/chapter/ChapterScreen'
import { LevelScreen } from '../ui/components/level/LevelScreen'
import { useSessionStore } from '../store/sessionStore'
import { useProgressStore } from '../store/progressStore'
import { useViewStore } from '../store/viewStore'
import { HintsPanel } from '../ui/components/level/HintsPanel'
import { LevelComplete } from '../ui/components/level/LevelComplete'
import { MenuScreen } from '../ui/components/menu/MenuScreen'
import { getUnlockedHints } from '../game/validate/stepHints'
import { CHAPTER_1_LEVELS } from '../levels/chapters/ch1'
import type { TargetResult } from '../game/validate/targetState'
import type { Level, TargetCondition } from '../game/types'

const MemoryBackend = (LightningFsNS as unknown as { MemoryBackend: new () => FsIdb }).MemoryBackend

let caseIndex = 0

/** 建一个干净的内存沙箱并重建空仓库（`reset` 内部会 `git init`） */
async function freshSandbox(): Promise<void> {
  caseIndex += 1
  configureFs({ name: `comp-${Date.now()}-${caseIndex}`, backend: new MemoryBackend() })
  const result = await reset({})
  if (!result.ok) throw new Error(`沙箱初始化失败：${result.error.toString()}`)
}

/** 复位会话 store，避免用例之间通过 zustand 单例串味 */
function resetSession(): void {
  useSessionStore.setState({
    level: null,
    history: [],
    draft: EMPTY_DRAFT,
    nextEntryId: 1,
    targetState: null,
  })
}

afterEach(() => {
  // M3：进度库也是全局单例，防止用例间串味
  useProgressStore.setState({ levelRecords: {}, achievements: [] })
  // testing-library 在 vitest 下不会自动清理（未开 globals 自动 cleanup 时），显式清理更稳
  cleanup()
  // 视图状态也是全局单例：章节页用例会写入 view：'chapter'，不复位会泄漏给后续用例
  useViewStore.setState({ view: 'boot', chapterId: null, levelId: null })
})

// ─────────────────────────────────────────────────────────────────────────────
// 拼接逻辑的纯函数层
// ─────────────────────────────────────────────────────────────────────────────

/** 取某条命令的某槽位片段（测试里的定位辅助，避免手写 id） */
function frag(command: string, slot: number, pool: readonly Fragment[] = COMMON_FRAGMENTS): Fragment {
  const found = pool.find((item) => item.command === command && item.slot === slot)
  if (!found) throw new Error(`片段不存在：${command} slot ${slot}`)
  return found
}

/** 依次点击若干片段，返回最终草稿 */
function clickAll(fragments: Fragment[], pool: readonly Fragment[] = COMMON_FRAGMENTS): Draft {
  return fragments.reduce<Draft>((draft, item) => applyFragment(draft, item, pool), EMPTY_DRAFT)
}

describe('拼接式输入 —— 片段追加与槽位语义（纯函数）', () => {
  it('空草稿渲染为空串，EMPTY_DRAFT 可复用而不被改写', () => {
    expect(renderDraft(EMPTY_DRAFT)).toBe('')
    clickAll([frag('git init', 0)])
    // 纯函数不得就地改写入参（否则 store 里那份共享草稿会被悄悄污染）
    expect(EMPTY_DRAFT.slots).toEqual([])
    expect(renderDraft(EMPTY_DRAFT)).toBe('')
  })

  it('按槽位顺序拼接，未填槽位不产生多余空格', () => {
    // 先点子命令、再补起始词：乱序点击也应得到正确顺序（槽位决定次序，不由点击序决定）
    expect(renderDraft(clickAll([frag('git init', 1), frag('git init', 0)]))).toBe('git init')
    expect(renderDraft(clickAll([frag('git add', 2), frag('git add', 1), frag('git add', 0)]))).toBe('git add .')
  })

  it('同槽位后点者顶掉先点者（`.` 与具体路径互斥）', () => {
    // slot 2 有两个互斥选项：`.`（全部文件）与具体路径。定位时必须按 `text` 区分，
    // 只按 `command` + `slot` 会取到先出现的 `.`。
    const pool = fragmentsForLevel(CHAPTER_1_LEVELS[0])
    const dot = pool.find((item) => item.command === 'git add' && item.slot === 2 && item.text === '.')!
    const path = pool.find((item) => item.command === 'git add' && item.slot === 2 && item.text !== '.')!
    expect(path.text).toBe('README.md')

    const withDot = clickAll([frag('git add', 0), frag('git add', 1), dot], pool)
    expect(renderDraft(withDot)).toBe('git add .')

    // 同一个 slot 2：后点的路径顶掉先点的 `.`
    expect(renderDraft(applyFragment(withDot, path, pool))).toBe('git add README.md')
    // 反向也成立：再点回 `.` 则路径被顶掉
    const withPath = applyFragment(withDot, path, pool)
    expect(renderDraft(applyFragment(withPath, dot, pool))).toBe('git add .')
  })

  it('换命令时保留公共前缀 git，丢弃旧命令的其它槽位', () => {
    const withInit = clickAll([frag('git init', 0), frag('git init', 1)])
    expect(renderDraft(withInit)).toBe('git init')

    // 改点 commit 的子命令 → 起始词沿用，init 被丢弃
    const switched = applyFragment(withInit, frag('git commit', 1))
    expect(renderDraft(switched)).toBe('git commit')
    // 顺序反过来（先 commit 再 init）同样成立
    const backAgain = applyFragment(switched, frag('git init', 1))
    expect(renderDraft(backAgain)).toBe('git init')
  })

  it('⚠️ 任意点击序列都不得产生重复子命令 token（回归锁：曾有 `git add add .`）', () => {
    // ⚠️ 这是实测过的真实缺陷：早期把 slot 0 写成 `"git add"`（已含子命令）、
    //   slot 1 又写成 `"add"`，两者叠加直接拼出 `git add add .`。
    //   而玩家最自然的操作恰恰是「先点子命令按钮、再点动词按钮」，必然撞上。
    //   现行设计为「起始词只承载 git，子命令独立成段」，本用例用穷举把这条性质锁住。
    const pool = fragmentsForLevel(CHAPTER_1_LEVELS[0])

    const walk = (draft: Draft, depth: number, visit: (text: string) => void): void => {
      visit(renderDraft(draft))
      if (depth === 0) return
      for (const item of pool) {
        if (isFragmentEnabled(draft, item, pool)) walk(applyFragment(draft, item, pool), depth - 1, visit)
      }
    }

    const texts: string[] = []
    walk(EMPTY_DRAFT, 4, (text) => {
      if (text.length > 0) texts.push(text)
    })
    expect(texts.length).toBeGreaterThan(0)

    for (const text of texts) {
      const tokens = text.split(' ')
      // 相邻重复 token（`add add` / `commit commit`）
      for (let i = 1; i < tokens.length; i += 1) {
        expect(tokens[i], `产物 "${text}" 出现重复 token`).not.toBe(tokens[i - 1])
      }
      // `git` 只能出现在开头，且最多一次
      expect(tokens.filter((token) => token === 'git')).toHaveLength(1)
      expect(tokens[0]).toBe('git')
      // 子命令（init/add/commit）最多出现一次
      for (const sub of ['init', 'add', 'commit']) {
        expect(tokens.filter((token) => token === sub).length, `产物 "${text}" 含多个 ${sub}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('⚠️ 产物要么是合法命令，要么是某条已知合法命令的 token 前缀', () => {
    // ⚠️ 判据说明（作者踩过的坑）：**不要**断言「首 token 必须是 git」。
    //   合法序列可以从 slot 1 起步（玩家先点 `add` 再补 `git`，中间态就是 `add`），
    //   那是正常的拼接过场态、不是错误。正确的不变式是「产物已是合法命令，
    //   或它是某条合法命令的前缀」—— 这样 `/` 中间态被允许，而 `git add add` 被拒绝。
    const pool = fragmentsForLevel(CHAPTER_1_LEVELS[0])

    // 合法命令全集：第一章（init/add/commit）+ 本关可拼的路径
    const legal = new Set<string>()
    for (const command of ['git init', 'git add', 'git commit']) legal.add(command)
    for (const item of pool) {
      if (item.command === 'git add' && item.slot === 2) legal.add(`git add ${item.text}`)
      if (item.command === 'git commit' && item.slot === 2) legal.add(`git commit ${item.text}`)
    }
    // 允许的中间态：任一合法命令的 token 前缀
    const prefixes = new Set<string>()
    for (const command of legal) {
      const tokens = command.split(' ')
      for (let i = 1; i <= tokens.length; i += 1) prefixes.add(tokens.slice(0, i).join(' '))
    }

    const walk = (draft: Draft, depth: number, visit: (text: string) => void): void => {
      visit(renderDraft(draft))
      if (depth === 0) return
      for (const item of pool) {
        if (isFragmentEnabled(draft, item, pool)) walk(applyFragment(draft, item, pool), depth - 1, visit)
      }
    }

    const texts = new Set<string>()
    walk(EMPTY_DRAFT, 4, (text) => {
      if (text.length > 0) texts.add(text)
    })

    for (const text of texts) {
      expect(
        prefixes.has(text),
        `产物 "${text}" 既不是合法命令，也不是任何已知合法命令的 token 前缀`,
      ).toBe(true)
    }

    // 第一章每条目标命令都要有一条可达的点击序列（否则玩家根本拼不出来）
    const reachable = new Set(texts)
    for (const command of ['git init', 'git add', 'git add .', 'git add README.md', 'git commit', 'git commit -m']) {
      expect(reachable.has(command), `无法通过点击拼出 "${command}"`).toBe(true)
    }
  })

  it('isFragmentEnabled：较低槽位未填时不放行（防 `git .` 这类跳步）', () => {
    const pool = fragmentsForLevel(CHAPTER_1_LEVELS[0])

    // 空草稿：只有 slot 0 的起始词可点，槽位 1/2 全部置灰
    expect(isFragmentEnabled(EMPTY_DRAFT, frag('git init', 0, pool), pool)).toBe(true)
    expect(isFragmentEnabled(EMPTY_DRAFT, frag('git init', 1, pool), pool)).toBe(false)
    expect(isFragmentEnabled(EMPTY_DRAFT, frag('git add', 2, pool), pool)).toBe(false)

    // 只填了 slot 0：slot 1 可点，但 slot 2（`.`）仍不可点 —— 否则拼出 `git .`
    const onlyGit = applyFragment(EMPTY_DRAFT, frag('git add', 0, pool), pool)
    expect(isFragmentEnabled(onlyGit, frag('git add', 1, pool), pool)).toBe(true)
    expect(isFragmentEnabled(onlyGit, frag('git add', 2, pool), pool)).toBe(false)

    // 填满 slot 0、1 后 slot 2 才放行
    const ready = applyFragment(onlyGit, frag('git add', 1, pool), pool)
    expect(isFragmentEnabled(ready, frag('git add', 2, pool), pool)).toBe(true)
  })

  it('⚠️ 路径片段来自 init.files（只从 targets 推导会让路径按钮全空）', () => {
    // 第一章 4 关全用 `commitCount` + `workdirClean` 作目标（`file` 条件会「开局即达标」，
    // 作者已刻意避开），因此**若只从 `targets` 推导路径，第一章会一个路径按钮都没有**，
    // 玩家拼不出 `git add README.md`。路径必须同时取自 `init.files` 的键。
    for (const level of CHAPTER_1_LEVELS) {
      const paths = fragmentsForLevel(level)
        .filter((item) => item.command === 'git add' && item.slot === 2 && item.text !== '.')
        .map((item) => item.text)

      const expected = Object.keys(level.init.files ?? {})
      expect(expected.length).toBeGreaterThan(0)
      expect(paths).toEqual([...expected].sort())
    }
  })

  it('fragmentsForLevel 输出稳定：同一关卡两次调用结果一致', () => {
    const level = CHAPTER_1_LEVELS[0]
    expect(fragmentsForLevel(level)).toEqual(fragmentsForLevel(level))
    // 每个片段的 id 唯一（React 的 key 与 aria-label 都依赖它，重复会让玩家与测试都分不清）
    const ids = fragmentsForLevel(level).map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GoalPanel
// ─────────────────────────────────────────────────────────────────────────────

/** 造一条 TargetResult（只填 GoalPanel 用得到的字段） */
function result(target: TargetCondition, ok: boolean, implemented = true): TargetResult {
  return { target, ok, implemented, detail: `说明-${target.type}` }
}

describe('components —— GoalPanel 打勾', () => {
  it('已达成显示打勾、未达成显示未勾选，并逐项给出可见中文状态', () => {
    render(
      <GoalPanel
        items={[
          result({ type: 'commitCount', op: 'gte', value: 1 }, true),
          result({ type: 'workdirClean', value: true }, false),
        ]}
        checking={false}
        missingHint="还差一点"
      />,
    )

    const panel = screen.getByLabelText('目标')
    const items = panel.querySelectorAll('li')

    expect(items).toHaveLength(2)
    expect(items[0].getAttribute('data-state')).toBe('done')
    expect(items[0].textContent).toContain('已达成')
    expect(items[0].textContent).toContain('✓')

    expect(items[1].getAttribute('data-state')).toBe('pending')
    expect(items[1].textContent).toContain('未达成')
    expect(items[1].textContent).toContain('✗')

    // 进度按「已达成 / 总数」显示
    expect(screen.getByTestId('goal-progress').textContent).toBe('1/2')
  })

  it('未实现的类型画成「尚未支持」而非玩家的红叉（§14 不冤枉玩家）', () => {
    render(
      <GoalPanel
        items={[result({ type: 'tag', name: 'v1.0', exists: true }, false, false)]}
        checking={false}
        missingHint="x"
      />,
    )

    const item = screen.getByLabelText('目标').querySelector('li')!
    expect(item.getAttribute('data-state')).toBe('unsupported')
    expect(item.textContent).toContain('尚未支持')
    // 不得显示成「未达成」——那是玩家的错，而这里不是
    expect(item.textContent).not.toContain('未达成')
  })

  it('全部达成时给出完成语；未达成时显示抽象引导语（不含具体命令）', () => {
    const done = [result({ type: 'commitCount', op: 'gte', value: 1 }, true)]
    const { unmount } = render(<GoalPanel items={done} checking={false} missingHint="引导语" />)
    expect(screen.getByLabelText('目标').textContent).toContain('全部目标已达成')
    unmount()

    render(
      <GoalPanel
        items={[result({ type: 'commitCount', op: 'gte', value: 1 }, false)]}
        checking={false}
        missingHint="引导语"
      />,
    )
    const text = screen.getByLabelText('目标').textContent ?? ''
    expect(text).toContain('还差什么')
    expect(text).toContain('引导语')
    // §9.1：未达标时不给具体命令
    expect(text).not.toContain('git ')
  })

  it('检测中显示占位文案，不把已成立的目标误画成未达成', () => {
    render(
      <GoalPanel
        items={[result({ type: 'commitCount', op: 'gte', value: 1 }, true)]}
        checking
        missingHint="引导语"
      />,
    )

    const text = screen.getByLabelText('目标').textContent ?? ''
    expect(text).toContain('正在检测目标状态')
    // 检测中不渲染「还差什么」与完成语
    expect(text).not.toContain('还差什么')
    expect(text).not.toContain('全部目标已达成')
    // 但已成立的项目仍如实显示打勾
    expect(text).toContain('已达成')
  })

  it('目标清单为空时给出说明，且不显示完成语（避免「空清单 = 已过关」的误读）', () => {
    render(<GoalPanel items={[]} checking={false} missingHint="引导语" />)

    const text = screen.getByLabelText('目标').textContent ?? ''
    expect(text).toContain('没有可检测的目标')
    expect(text).not.toContain('全部目标已达成')
    expect(screen.getByTestId('goal-progress').textContent).toBe('0/0')
  })

  it('目标状态随 props 变化实时刷新（打勾数同步更新）', () => {
    const pending = [result({ type: 'commitCount', op: 'gte', value: 1 }, false)]
    const { rerender } = render(<GoalPanel items={pending} checking={false} missingHint="x" />)
    expect(screen.getByTestId('goal-progress').textContent).toBe('0/1')

    const done = [result({ type: 'commitCount', op: 'gte', value: 1 }, true)]
    rerender(<GoalPanel items={done} checking={false} missingHint="x" />)
    expect(screen.getByTestId('goal-progress').textContent).toBe('1/1')
    expect(screen.getByLabelText('目标').querySelector('li')!.getAttribute('data-state')).toBe('done')
  })
})
// ─────────────────────────────────────────────────────────────────────────────
// CommandBuilder（渲染层）
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ 输入行由**两段**组成（见组件内注释）：片段拼出的只读前缀 + 玩家手写的可编辑后缀。
//   因此断言要分清「片段拼出了什么」与「完整命令是什么」：
//     - 片段部分：`[data-testid="command-preview"]` 的文本（= `renderDraft(draft)`）
//     - 手写部分：`#gtp-builder-input`（受控于 `draft.suffix`）
//   这个设计是被浏览器实测逼出来的：整行只读会让玩家无法补提交信息，1-1 直接卡死。

/** 受控组件的测试壳：内部持有草稿，模拟 LevelScreen 的接线 */
function BuilderHarness({ level, onRun = () => {} }: { level: Level; onRun?: (command: string) => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  return (
    <CommandBuilder
      fragments={fragmentsForLevel(level)}
      draft={draft}
      onChange={setDraft}
      onRun={onRun}
      busy={false}
    />
  )
}

/** 按 `data-command` + `data-slot` 精确定位片段按钮 */
function fragmentButton(command: string, slot: number): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button[data-command="${command}"][data-slot="${slot}"]`,
  )
  if (!button) throw new Error(`找不到片段按钮：${command} slot ${slot}`)
  return button
}

/** 片段拼出的完整命令（预览区文本；空草稿时组件显示占位符「（空）」） */
function previewText(): string {
  return screen.getByTestId('command-preview').textContent ?? ''
}

/** 玩家手写的后缀输入框 */
function suffixInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('#gtp-builder-input')
  if (!input) throw new Error('找不到后缀输入框 #gtp-builder-input')
  return input
}

describe('components —— CommandBuilder 拼接式输入', () => {
  const level = CHAPTER_1_LEVELS[0]

  it('渲染片段按钮与拼接输入行，语义化标记齐备', () => {
    render(<BuilderHarness level={level} />)

    expect(screen.getByTestId('command-builder')).toBeTruthy()

    // 片段按钮：aria-label / data-command / data-slot 三件套
    const gitAddSub = fragmentButton('git add', 1)
    expect(gitAddSub.getAttribute('aria-label')).toBe('拼接命令片段：add')
    expect(gitAddSub.getAttribute('data-slot')).toBe('1')

    // 完整命令预览区带 aria-label，供无障碍与测试共用
    expect(screen.getByLabelText('拼接的完整命令')).toBe(screen.getByTestId('command-preview'))

    // 空草稿：预览显示占位符，执行按钮禁用
    expect(previewText()).toBe('（空）')
    expect((screen.getByLabelText('执行拼接的命令') as HTMLButtonElement).disabled).toBe(true)
  })

  it('点击片段后预览区追加出完整命令，位置不可跳动的按钮保持存在', () => {
    render(<BuilderHarness level={level} />)

    fireEvent.click(fragmentButton('git add', 0))
    expect(previewText()).toBe('git')

    fireEvent.click(fragmentButton('git add', 1))
    expect(previewText()).toBe('git add')

    fireEvent.click(fragmentButton('git add', 2))
    expect(previewText()).toBe('git add .')

    // 拼接完成后执行按钮可用
    expect((screen.getByLabelText('执行拼接的命令') as HTMLButtonElement).disabled).toBe(false)
  })

  it('不可点的片段带 disabled，且置灰而非隐藏（按钮位置不跳动）', () => {
    render(<BuilderHarness level={level} />)

    // 初始只有 slot 0 可点
    expect(fragmentButton('git add', 0).disabled).toBe(false)
    expect(fragmentButton('git add', 1).disabled).toBe(true)
    expect(fragmentButton('git add', 2).disabled).toBe(true)

    // 点过起始词后，子命令解禁，但参数仍不可点
    fireEvent.click(fragmentButton('git add', 0))
    expect(fragmentButton('git add', 1).disabled).toBe(false)
    expect(fragmentButton('git add', 2).disabled).toBe(true)

    // 按钮始终存在于 DOM（不是条件渲染）
    expect(document.querySelectorAll('button[data-command]').length).toBeGreaterThan(5)
  })

  it('手写后缀接在片段之后，完整命令 = 片段 + 后缀', () => {
    render(<BuilderHarness level={level} />)

    fireEvent.click(fragmentButton('git commit', 0))
    fireEvent.click(fragmentButton('git commit', 1))
    fireEvent.click(fragmentButton('git commit', 2))
    expect(previewText()).toBe('git commit -m')

    // ⚠️ 拼接只给到 `-m` 为止：引号里的提交信息必须玩家自己敲，
    //   否则 1-1 永远拼不出带消息的 commit（浏览器实测抓出的缺陷）。
    fireEvent.change(suffixInput(), { target: { value: '"初始化时间线"' } })
    expect(previewText()).toBe('git commit -m "初始化时间线"')
    expect(suffixInput().value).toBe('"初始化时间线"')
  })

  it('后缀输入框必须**可编辑**（readOnly 回归锁）', () => {
    // ⚠️⚠️ 为什么必须显式断言 `readOnly`，而不能只靠上面的 `fireEvent.change`：
    //   jsdom 的 `fireEvent.change` **不受 `readOnly` 限制**，照样能改值 ——
    //   所以「用 change 改成功」并不能证明玩家真能键盘输入。
    //   曾经的真实缺陷：拼接输入行被整体设为 readOnly，导致拼接只到 `-m` 为止后
    //   玩家**无法敲入提交信息**，1-1 直接卡死无法通关；而当时组件测试全绿。
    //   该缺陷只在真实浏览器（真实键盘）暴露 —— 见 M2-tasks-DONE「实测环境事实」。
    //   故此处直接锁 `readOnly`/`disabled` 属性本身，补上 jsdom 抓不到的那一环。
    render(<BuilderHarness level={level} onRun={() => {}} />)

    fireEvent.click(fragmentButton('git commit', 0))
    fireEvent.click(fragmentButton('git commit', 1))
    fireEvent.click(fragmentButton('git commit', 2))
    expect(previewText()).toBe('git commit -m')

    const input = suffixInput()
    expect(input.readOnly).toBe(false)
    expect(input.disabled).toBe(false)
    // 注：此处「执行」按钮**是启用**的 —— 因为 `git commit -m` 已是非空文本，
    //   执行它会由语法层回「-m 后面需要跟上提交信息」。这是刻意的：
    //   按钮的启用条件只判「非空」，不在按钮上重复语法校验（否则两处规则会漂移）。
    expect(screen.getByLabelText('执行拼接的命令')).toBeEnabled()
  })

  it('点击执行按钮把「片段 + 手写后缀」的完整命令交给 onRun', () => {
    const ran: string[] = []
    render(<BuilderHarness level={level} onRun={(command) => ran.push(command)} />)

    fireEvent.click(fragmentButton('git commit', 0))
    fireEvent.click(fragmentButton('git commit', 1))
    fireEvent.click(fragmentButton('git commit', 2))
    fireEvent.change(suffixInput(), { target: { value: '"第一次快照"' } })
    fireEvent.click(screen.getByLabelText('执行拼接的命令'))

    expect(ran).toEqual(['git commit -m "第一次快照"'])
  })

  it('在输入行按回车也执行，且命令为空时不触发', () => {
    const ran: string[] = []
    render(<BuilderHarness level={level} onRun={(command) => ran.push(command)} />)

    // 空命令：回车无反应
    fireEvent.keyDown(suffixInput(), { key: 'Enter' })
    expect(ran).toEqual([])

    fireEvent.click(fragmentButton('git add', 0))
    fireEvent.click(fragmentButton('git add', 1))
    fireEvent.keyDown(suffixInput(), { key: 'Enter' })
    expect(ran).toEqual(['git add'])
  })

  it('换命令时预览整体切换，不残留上一条命令的参数', () => {
    render(<BuilderHarness level={level} />)

    fireEvent.click(fragmentButton('git add', 0))
    fireEvent.click(fragmentButton('git add', 1))
    fireEvent.click(fragmentButton('git add', 2))
    expect(previewText()).toBe('git add .')

    // 改点 commit：公共前缀 git 保留，`add .` 整段丢弃
    fireEvent.click(fragmentButton('git commit', 1))
    expect(previewText()).toBe('git commit')

    fireEvent.click(fragmentButton('git commit', 2))
    expect(previewText()).toBe('git commit -m')
  })

  it('换命令时丢弃上一条命令的手写后缀（避免把 add 的路径留在 commit 后面）', () => {
    render(<BuilderHarness level={level} />)

    fireEvent.click(fragmentButton('git add', 0))
    fireEvent.click(fragmentButton('git add', 1))
    fireEvent.change(suffixInput(), { target: { value: 'notes/x.md' } })
    expect(previewText()).toBe('git add notes/x.md')

    // 换到 commit：后缀属旧命令的上下文，必须一并丢弃
    fireEvent.click(fragmentButton('git commit', 1))
    expect(previewText()).toBe('git commit')
    expect(suffixInput().value).toBe('')
  })

  it('busy 时禁用执行按钮并显示「执行中」', () => {
    render(
      <CommandBuilder
        fragments={fragmentsForLevel(level)}
        draft={applyFragment(
          applyFragment(EMPTY_DRAFT, frag('git init', 0), fragmentsForLevel(level)),
          frag('git init', 1),
          fragmentsForLevel(level),
        )}
        onChange={() => {}}
        onRun={() => {}}
        busy
      />,
    )

    const run = screen.getByLabelText('执行拼接的命令') as HTMLButtonElement
    expect(run.disabled).toBe(true)
    expect(run.textContent).toBe('执行中')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Terminal（自由输入 + 历史）
// ─────────────────────────────────────────────────────────────────────────────

describe('components —— Terminal 输入与历史', () => {
  beforeEach(async () => {
    await freshSandbox()
    resetSession()
  })

  it('输入回车后执行命令，并追加到会话历史', async () => {
    const executed: boolean[] = []
    render(<Terminal onExecuted={(ok) => executed.push(ok)} />)

    const input = screen.getByLabelText('命令输入') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'git init' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(useSessionStore.getState().history).toHaveLength(1))

    const [entry] = useSessionStore.getState().history
    expect(entry.input).toBe('git init')
    expect(entry.tokens).toEqual(['git', 'init'])
    expect(entry.ok).toBe(true)
    // id / ts 由 store 统一补全
    expect(entry.id).toBe('cmd-1')
    expect(entry.ts).toBeGreaterThan(0)

    // 回调把执行结果告知容器（驱动刷新与失败计数）
    await waitFor(() => expect(executed).toEqual([true]))
    // 提交后输入行清空，便于连续输入
    expect(input.value).toBe('')
  })

  it('命令执行失败：历史里记为 ok:false 并带上 error 文案', async () => {
    const executed: boolean[] = []
    render(<Terminal onExecuted={(ok) => executed.push(ok)} />)

    const input = screen.getByLabelText('命令输入') as HTMLInputElement
    // `git merge` 属 M4/M5，当前版本明确回「尚不支持」
    fireEvent.change(input, { target: { value: 'git merge dev' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(useSessionStore.getState().history).toHaveLength(1))

    const [entry] = useSessionStore.getState().history
    expect(entry.ok).toBe(false)
    expect(entry.error).toContain('在当前版本中尚不支持')
    expect(entry.output).toEqual([])
    await waitFor(() => expect(executed).toEqual([false]))
  })

  it('空输入与纯空白不执行、不产生历史', async () => {
    const executed: boolean[] = []
    render(<Terminal onExecuted={(ok) => executed.push(ok)} />)

    const input = screen.getByLabelText('命令输入') as HTMLInputElement
    expect((screen.getByText('执行') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.submit(input.closest('form')!)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input.closest('form')!)

    // 给异步执行留出机会，确认确实什么都没发生
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(useSessionStore.getState().history).toEqual([])
    expect(executed).toEqual([])
  })

  it('方向键上下翻历史命令，回到末端时恢复原先的草稿', async () => {
    render(<Terminal onExecuted={() => {}} />)

    const input = screen.getByLabelText('命令输入') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'git init' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(useSessionStore.getState().history).toHaveLength(1))

    fireEvent.change(input, { target: { value: 'git status' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(useSessionStore.getState().history).toHaveLength(2))

    // 先写一段半截草稿，按 ↑ 浏览历史后按 ↓ 应把它还原
    fireEvent.change(input, { target: { value: '半截命令' } })

    // ↑：最近一条
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('git status')
    // 再 ↑：更早的一条
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('git init')

    // ↓：回到较新的一条
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.value).toBe('git status')
    // ↓：越过末尾，恢复浏览前的草稿
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.value).toBe('半截命令')
  })

  it('没有历史时按方向键不报错、不改动输入', async () => {
    render(<Terminal onExecuted={() => {}} />)
    const input = screen.getByLabelText('命令输入') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'git init' } })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('git init')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.value).toBe('git init')
  })

  it('执行的命令真正落到仓库：git init 之后 `.git` 存在', async () => {
    // 组件 → executor → gitApi → LightningFS 的端到端确认（不只断言「历史里有一条」）
    render(<Terminal onExecuted={() => {}} />)

    const input = screen.getByLabelText('命令输入') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'git init' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(useSessionStore.getState().history).toHaveLength(1))

    expect((await fsp.stat('/repo/.git')).isDirectory()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 导航出口（视图可达性）
// ─────────────────────────────────────────────────────────────────────────────

describe('components —— 导航出口', () => {
  it('章节详情页有「返回菜单」出口，点击后视图回到 menu（导航死角回归锁）', () => {
    // ⚠️ 回归背景：本项目刻意不用 react-router（§1 决策），浏览器后退键会直接离开
    //    应用而非回到菜单 —— 因此每个非 menu 视图都必须自带返回入口。
    //    「章节详情」曾是唯一的导航死角（玩家进去后出不来），人工验收发现后补上本按钮。
    //    此用例锁住「出口必须存在且有效」，防止后续重构再丢。
    useViewStore.setState({ view: 'chapter', chapterId: 'ch1', levelId: null })

    render(<ChapterScreen chapterId="ch1" />)

    const back = screen.getByLabelText('返回主菜单')
    fireEvent.click(back)

    expect(useViewStore.getState().view).toBe('menu')
    // goMenu 的既有契约：离开章节页时清掉章节上下文
    expect(useViewStore.getState().chapterId).toBeNull()
  })

  it('章节详情页同时仍可正常进入关卡（出口不干扰既有功能）', async () => {
    useViewStore.setState({ view: 'chapter', chapterId: 'ch1', levelId: null })
    await freshSandbox()

    render(<ChapterScreen chapterId="ch1" />)

    fireEvent.click(screen.getByLabelText(`开始关卡 ch1-1 ${CHAPTER_1_LEVELS[0]!.title}`))
    // startLevel 成功后视图切到 level，且会话挂上真实关卡
    await waitFor(() => expect(useViewStore.getState().view).toBe('level'))
    expect(useSessionStore.getState().level?.id).toBe('ch1-1')
  })

  it('关卡页有「返回章节」出口，点击后回到该章的关卡列表（层级导航回归锁）', async () => {
    // ⚠️ 背景：进关后原本只有「返回菜单」（跳两级），用户人工验收指出缺
    //    「返回章节」（回 chN 关卡列表）这一层。goChapter 会带上 level.chapter，
    //    因此从 ch1-3 返回应落在 ch1 的列表，而不是被丢回菜单顶层。
    await freshSandbox()
    const level = CHAPTER_1_LEVELS[2]! // ch1-3
    useSessionStore.setState({ level, history: [], draft: EMPTY_DRAFT, targetState: null })
    useViewStore.setState({ view: 'level', chapterId: 'ch1', levelId: level.id })

    render(<LevelScreen />)

    fireEvent.click(screen.getByLabelText('返回章节关卡列表'))

    expect(useViewStore.getState().view).toBe('chapter')
    // goChapter 的既有契约：视图指向被返回的章节
    expect(useViewStore.getState().chapterId).toBe('ch1')
  })

  it('关卡页保留「返回菜单」出口（两级出口并存）', async () => {
    await freshSandbox()
    useSessionStore.setState({ level: CHAPTER_1_LEVELS[0]!, history: [], draft: EMPTY_DRAFT, targetState: null })
    useViewStore.setState({ view: 'level', chapterId: 'ch1', levelId: 'ch1-1' })

    render(<LevelScreen />)

    // 两级出口同时可见，且各自独立有效
    expect(screen.getByLabelText('返回章节关卡列表')).toBeTruthy()
    fireEvent.click(screen.getByText('返回菜单'))

    expect(useViewStore.getState().view).toBe('menu')
    expect(useViewStore.getState().chapterId).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// M3：计分 / 星级 / 成就的 UI 接线
// ─────────────────────────────────────────────────────────────────────────────

describe('components —— HintsPanel（M3 分步提示与计数）', () => {
  function makeHints() {
    return [
      { text: '方向提示：先想想档案库怎么建立。', unlockAfterFailures: 0 },
      { text: '命令提示：git init 是起点。', unlockAfterFailures: 1 },
      { text: '完整答案：git init → git add . → git commit -m "初始化"', unlockAfterFailures: 3 },
    ]
  }

  it('0 次失败时只显示 unlockAfterFailures=0 的层级；未解锁条目不出现（不暗示刷提示）', () => {
    const hints = getUnlockedHints(makeHints(), 0)
    render(<HintsPanel hints={hints} defaultOpen onHintUsed={() => {}} />)

    expect(screen.getByText(/方向提示/)).toBeTruthy()
    expect(screen.queryByText(/命令提示/)).toBeNull()
    expect(screen.queryByText(/完整答案/)).toBeNull()
  })

  it('失败达到阈值后对应层级解锁；每次新解锁恰好触发一次 onHintUsed', () => {
    const onHintUsed = vi.fn()
    const { rerender } = render(
      <HintsPanel hints={getUnlockedHints(makeHints(), 0)} onHintUsed={onHintUsed} />,
    )
    // 默认收起：解锁但未查看不计分（「查看即计数」语义）
    expect(onHintUsed).toHaveBeenCalledTimes(0)

    // 失败 1 次 → 层级 2 解锁（面板仍收起）→ 仍不计
    rerender(<HintsPanel hints={getUnlockedHints(makeHints(), 1)} onHintUsed={onHintUsed} />)
    expect(onHintUsed).toHaveBeenCalledTimes(0)

    // 玩家点击「提示」按钮展开 → 看到层级 1、2，一并计数（看过多少层记多少）
    fireEvent.click(screen.getByRole('button', { name: /提示（已解锁 2 条/ }))
    expect(screen.getByText(/命令提示/)).toBeTruthy()
    expect(onHintUsed).toHaveBeenNthCalledWith(1, 1)
    expect(onHintUsed).toHaveBeenNthCalledWith(2, 2)

    // 同层级反复渲染（version 刷新）不重复计数
    rerender(<HintsPanel hints={getUnlockedHints(makeHints(), 1)} onHintUsed={onHintUsed} />)
    expect(onHintUsed).toHaveBeenCalledTimes(2)

    // 失败 3 次 → 层级 3（完整答案）解锁，面板已展开 → 记第 3 条
    rerender(<HintsPanel hints={getUnlockedHints(makeHints(), 3)} onHintUsed={onHintUsed} />)
    expect(screen.getByText(/完整答案/)).toBeTruthy()
    expect(onHintUsed).toHaveBeenNthCalledWith(3, 3)
  })

  it('尚无解锁提示时不渲染面板（无「提示」入口空转，也不暴露未解锁数量）', () => {
    render(<HintsPanel hints={getUnlockedHints([], 5)} onHintUsed={() => {}} />)
    expect(screen.queryByTestId('hints-panel')).toBeNull()
  })
})

describe('components —— LevelComplete（M3 结算）', () => {
  beforeEach(() => {
    useProgressStore.setState({ levelRecords: {}, achievements: [] })
  })

  function settleLevel1() {
    // 造一个「干净过关」的会话：2 条命令全成功、无提示、首次尝试
    const level = CHAPTER_1_LEVELS[0]!
    useSessionStore.setState({
      level,
      history: [
        { id: 'a', input: 'git add .', tokens: ['git', 'add', '.'], ok: true, output: [], ts: 1, undoable: false },
        { id: 'b', input: 'git commit -m "初始化"', tokens: ['git', 'commit', '-m', '初始化'], ok: true, output: [], ts: 2, undoable: false },
      ],
      draft: EMPTY_DRAFT,
      targetState: {
        satisfied: true,
        remaining: 0,
        results: level.targets.map((target) => ({
          target,
          ok: true,
          implemented: true,
          detail: '已达成（测试桩）',
        })),
      },
      settlement: { hintsUsed: 0, firstAttempt: true, hintCountedLevel: 0 },
    })
    useViewStore.setState({ view: 'levelComplete', chapterId: null, levelId: level.id })
    return level
  }

  it('结算页渲染得分与星级，并把记录写入 progressStore（3 星：满分路径）', async () => {
    const level = settleLevel1()
    render(<LevelComplete />)

    // 100 + 20（最优 2≤3）+ 25（一次通过）= 145 ≥ 95（0.95·baseScore）→ 3 星
    await waitFor(() => expect(useProgressStore.getState().levelRecords[level.id]).toBeTruthy())
    const record = useProgressStore.getState().levelRecords[level.id]!
    expect(record.cleared).toBe(true)
    expect(record.score).toBe(145)
    expect(record.stars).toBe(3)
    // UI 上可见最终得分
    expect(screen.getByTestId('final-score').textContent).toContain('145')
  })

  it('结算触发成就解锁（无提示 + 首次尝试 + 首次通关 → 4 个）并展示「新解锁」', async () => {
    settleLevel1()
    render(<LevelComplete />)

    await waitFor(() => {
      // no-undo / first-try / no-hint / first-clear —— 完美篇章需全章通关，不在内
      expect(useProgressStore.getState().achievements.sort()).toEqual(
        ['first-clear', 'first-try', 'no-hint', 'no-undo'],
      )
    })
    expect(screen.getByTestId('new-achievements')).toBeTruthy()
  })

  it('重复结算不重复写库（StrictMode 双跑回归锁）：落库值稳定', async () => {
    const level = settleLevel1()
    // 预置一条旧记录（模拟重玩后再次过关的覆盖路径）
    useProgressStore.setState({
      levelRecords: { [level.id]: { score: 50, stars: 1, cleared: true } },
      achievements: ['no-undo', 'first-try', 'no-hint', 'first-clear'],
    })
    render(<LevelComplete />)

    await waitFor(() => expect(useProgressStore.getState().levelRecords[level.id]!.score).toBe(145))
    // 已解锁的成就不重复出现在「新解锁」列表
    expect(screen.queryByTestId('new-achievements')).toBeNull()
  })
})

describe('components —— MenuScreen（M3 汇总与成就入口）', () => {
  it('汇总条显示总得分 / 通关数 / 星级；成就面板默认收起', () => {
    useProgressStore.setState({
      levelRecords: {
        'ch1-1': { score: 145, stars: 3, cleared: true },
        'ch1-2': { score: 70, stars: 1, cleared: true },
      },
      achievements: ['no-undo'],
    })
    render(<MenuScreen />)

    expect(screen.getByTestId('total-score').textContent).toBe('215') // 145 + 70
    expect(screen.getByTestId('achievement-toggle').textContent).toContain('1/5')
    expect(screen.queryByTestId('achievement-list')).toBeNull()
  })

  it('点击成就按钮展开列表，已解锁与未解锁状态可区分', () => {
    useProgressStore.setState({
      levelRecords: {},
      achievements: ['no-undo'],
    })
    render(<MenuScreen />)

    fireEvent.click(screen.getByTestId('achievement-toggle'))
    const list = screen.getByTestId('achievement-list')
    expect(list).toBeTruthy()
    const items = list.querySelectorAll('li')
    expect(items).toHaveLength(5)
    expect(items[0]!.dataset.unlocked).toBe('true')
    expect(items[1]!.dataset.unlocked).toBe('false')
  })
})
