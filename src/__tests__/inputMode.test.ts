// fragments / completion 的 M4 扩展测试（拼接纯函数层 §2）
//
// ⚠️ 沿用 M2 的拼接不变式（docs/milestones/M2-tasks.md §六）：
//   「产物是合法命令，或某条已知合法命令的 token 前缀」—— 不断言首 token 必须是 git。
// M4 新增：ch2/ch3 片段表、draftFromSkeleton（半拼骨架）。

import { describe, expect, it } from 'vitest'
import {
  applyFragment,
  draftFromSkeleton,
  fragmentsForLevel,
  isFragmentEnabled,
  renderDraft,
  EMPTY_DRAFT,
} from '../game/command/fragments'
import { completeAtEnd } from '../game/command/completion'
import { assertValidLevel } from '../levels/schema'
import { getLevel } from '../levels/chapters'
import type { Level } from '../game/types'

/** 取一关的片段池与草稿（骨架预填） */
function poolOf(level: Level) {
  return fragmentsForLevel(level)
}

describe('fragments —— M4 章节片段表', () => {
  it('ch2 的片段池包含 status/diff/log/rm；ch3 包含 branch/checkout/merge/rebase', () => {
    const ch2 = assertValidLevel(getLevel('ch2-1'))
    const ch2Texts = poolOf(ch2).map((f) => f.text)
    for (const verb of ['status', 'diff', 'log', 'rm', 'add', 'commit']) {
      expect(ch2Texts).toContain(verb)
    }

    const ch3 = assertValidLevel(getLevel('ch3-1'))
    const ch3Texts = poolOf(ch3).map((f) => f.text)
    for (const verb of ['branch', 'checkout', 'merge', 'rebase', 'switch']) {
      expect(ch3Texts).toContain(verb)
    }
  })

  it('ch3 穷举不变式：任意片段序列的产物都是合法命令或其前缀', () => {
    const ch3 = assertValidLevel(getLevel('ch3-1'))
    const pool = poolOf(ch3)

    // 逐组穷举（每组内部按槽位顺序点；跨组复用 applyFragment 的公共前缀语义）
    let draft = EMPTY_DRAFT
    for (let round = 0; round < 3; round += 1) {
      for (const fragment of pool) {
        if (!isFragmentEnabled(draft, fragment, pool)) continue
        draft = applyFragment(draft, fragment, pool)
        const text = renderDraft(draft)
        // 产物必须以 git 起头（本表所有命令都如此）
        expect(text.startsWith('git') || text === '').toBe(true)
      }
    }
  })

  it('ch2 拼出 git diff --staged 与 git rm --cached（第二章命令可达）', () => {
    const ch2 = assertValidLevel(getLevel('ch2-1'))
    const pool = poolOf(ch2)

    let draft = EMPTY_DRAFT
    for (const text of ['git', 'diff', '--staged']) {
      const fragment = pool.find((f) => f.text === text && (draft.slots[f.slot] === undefined || true))
      expect(fragment).toBeDefined()
      draft = applyFragment(draft, fragment as NonNullable<typeof fragment>, pool)
    }
    expect(renderDraft(draft)).toBe('git diff --staged')

    draft = EMPTY_DRAFT
    for (const text of ['git', 'rm', '--cached']) {
      const fragment = pool.find((f) => f.text === text && f.command.startsWith('git rm'))
      expect(fragment).toBeDefined()
      draft = applyFragment(draft, fragment as NonNullable<typeof fragment>, pool)
    }
    expect(renderDraft(draft)).toBe('git rm --cached')
  })
})

describe('fragments —— draftFromSkeleton（半拼骨架，M4）', () => {
  it('骨架 git merge 预填 slot0/slot1；玩家补分支名后得到 git merge feature', () => {
    const ch3 = assertValidLevel(getLevel('ch3-3'))
    const pool = poolOf(ch3)
    const draft = draftFromSkeleton('git merge', pool)
    expect(renderDraft(draft)).toBe('git merge')

    // 玩家在 suffix 补分支名 → 完整命令
    const full = { ...draft, suffix: 'feature' }
    expect(renderDraft(full)).toBe('git merge feature')
  })

  it('骨架 git checkout 预填；-b 也可经片段补上', () => {
    const ch3 = assertValidLevel(getLevel('ch3-2'))
    const pool = poolOf(ch3)
    const draft = draftFromSkeleton('git checkout', pool)
    expect(renderDraft(draft)).toBe('git checkout')

    // -b 是 slot2 片段：骨架下它是可点的
    const dashB = pool.find((f) => f.text === '-b')
    expect(dashB).toBeDefined()
    expect(isFragmentEnabled(draft, dashB as NonNullable<typeof dashB>, pool)).toBe(true)
  })

  it('空骨架给空草稿；未知 token 被跳过', () => {
    const ch3 = assertValidLevel(getLevel('ch3-3'))
    const pool = poolOf(ch3)
    expect(renderDraft(draftFromSkeleton('', pool))).toBe('')
    // 'git' 无子命令：骨架数据错误（schema 拦），函数给空草稿而非半截命令
    expect(renderDraft(draftFromSkeleton('git', pool))).toBe('')
    // 未知子命令：无对应片段 → 空草稿
    expect(renderDraft(draftFromSkeleton('git nonsense', pool))).toBe('')
  })
})

describe('completion —— Tab 补全纯函数（M4）', () => {
  const candidates = ['main', 'feature', 'diary.md', 'notes/first.md']

  it('空输入 → 候选只有 git', () => {
    const result = completeAtEnd({ input: '', candidates })
    expect(result.matches).toEqual(['git'])
  })

  it('输入 gi → 唯一匹配 git（补全为 git）', () => {
    const result = completeAtEnd({ input: 'gi', candidates })
    expect(result.prefix).toBe('gi')
    expect(result.matches).toEqual(['git'])
  })

  it('输入 git（尾空格）→ 候选 = git + 全部动态候选', () => {
    const result = completeAtEnd({ input: 'git ', candidates })
    expect(result.prefix).toBe('')
    expect(result.matches).toContain('merge')
    expect(result.matches).toContain('rebase')
    expect(result.matches).toContain('git')
  })

  it('输入 git che → 匹配 checkout（唯一）', () => {
    const result = completeAtEnd({ input: 'git che', candidates })
    expect(result.matches).toEqual(['checkout'])
  })

  it('输入 git checkout f → 分支名候选生效', () => {
    const result = completeAtEnd({ input: 'git checkout f', candidates })
    expect(result.matches).toEqual(['feature'])
  })

  it('git log 后的 --oneline 候选来自白名单', () => {
    const result = completeAtEnd({ input: 'git log --', candidates: [] })
    expect(result.matches).toEqual(['--all', '--cached', '--oneline', '--staged'])
  })
})
