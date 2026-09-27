// 关卡数据校验（development-refinement.md §11、§4.1）—— **新增**
//
// 价值：关卡数据是**手写的字面量**，`Level` 的类型标注只保证形状、不保证取值有意义。
// 「id 拼错」「用了尚未实现的 target 类型」「关联笔记的小节根本不存在」这类问题
// 只在运行时才暴露，且往往要玩家进关才炸。本文件把它们前移到测试期。
//
// ⚠️ 本文件不需要 LightningFS 实例 —— 校验的是**纯数据**（关卡定义 + 笔记文件），
//    不执行任何 git 操作。因此比 executor/targetState 那两个文件快得多。
//
// ⚠️ 两条通用性质值得特别说明（它们不是「某个关卡的特例」，而是**所有关卡**都应满足）：
//    1. **开局不得即达标**：`targets` 全部满足 => 玩家一条命令不敲就过关。
//       引擎里 `reset()` 总会 `git init`，所以「`.git` 存在」这类目标会开局即真 ——
//       1-1 最初就是这么写的，实测发现后已改（见 ch1.ts 注释）。此处用通用断言兜底。
//    2. **开局不得有多项已达标**：哪怕没到「直接过关」，进关就亮着若干勾也会让玩家
//       误以为进度已有。1-3 最初含 `file` content 目标，正是因此被移除。

// ⚠️ 笔记内容用 Vite 的 `?raw` 导入读取，而不是 Node 的 `node:fs`：
//   本项目的 `tsconfig.json` 把 `types` 限定为 `["vitest/globals", "@testing-library/jest-dom"]`，
//   不含 `@types/node`，故 `node:fs` / `__dirname` 会直接报 TS2307 / TS2304。
//   而 `vite/client`（经 `src/vite-env.d.ts` 引入）已为 `?raw` 提供类型声明，
//   测试与构建走的也是同一套解析 —— 比在测试里另开一条 Node 读取通道更贴合项目约定。
import gitBasicsRaw from '../../docs/notes/git-basics.md?raw'
import gitBasicOperationsRaw from '../../docs/notes/git-basic-operations.md?raw'
import gitBranchesRaw from '../../docs/notes/git-branches.md?raw'
import { describe, expect, it } from 'vitest'
import {
  CHAPTERS,
  getAllLevels,
  getChapterLevels,
  getChapterMeta,
  getFirstLevelOfChapter,
  getLevel,
} from '../levels/chapters'
import { CHAPTER_1_LEVELS } from '../levels/chapters/ch1'
import { CHAPTER_2_LEVELS } from '../levels/chapters/ch2'
import { CHAPTER_3_LEVELS } from '../levels/chapters/ch3'
import {
  IMPLEMENTED_TARGET_TYPES,
  UNIMPLEMENTED_TARGET_TYPES,
  assertValidLevel,
  isLevel,
  validateLevel,
} from '../levels/schema'
import { reset } from '../engine/sandbox'
import { configureFs, type FsIdb } from '../engine/fs'
import { evaluateTargets } from '../game/validate/targetState'
import { execute } from '../game/command/executor'
import { LOG_PAGE_THIRD, UNIVERSE_BASE } from '../levels/presets'
import * as LightningFsNS from '@isomorphic-git/lightning-fs'
import type { ChapterId, Level } from '../game/types'

const MemoryBackend = (LightningFsNS as unknown as { MemoryBackend: new () => FsIdb }).MemoryBackend

/** 已登记的笔记正文（新增笔记时在此补一行 `?raw` 导入） */
const NOTES: Record<string, string> = {
  'git-basics': gitBasicsRaw,
  'git-basic-operations': gitBasicOperationsRaw,
  'git-branches': gitBranchesRaw,
}

// ─────────────────────────────────────────────────────────────────────────────
// relatedKnowledge → 笔记小节的 slug 映射表
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️⚠️ **为什么必须显式登记，而不能机械推导**：
// 笔记小节标题到 slug 的转写存在**两套规则**，靠一条通用算法无法同时覆盖：
//
//   规则 A（取英文括注）：`### 本地仓库 (Local Repository)` → `local-repository`
//       —— 三大核心区域下的四个小节都带英文括注，slug 取自括注。
//   规则 B（拼音/意译）：`## 对象模型` → `object-model`
//       —— 纯中文标题，没有括注可提取，只能用**约定好的意译**。
//
// 若试图用一条机械规则统一，规则 B 只能退化成拼音（`dui-xiang-mo-xing`）或整体
// 音译，与 ch1.ts 里已核定的 id 不符；而规则 A 若改成音译，`local-repository`
// 又会变成 `ben-di-cang-ku`。两者无法调和，故**显式登记**：
// 这张表就是「笔记小节 ↔ slug」的事实来源，新增小节时在此补一行。
//
// 键为笔记内**逐字**的小节标题（含 `#` 前缀与可能的英文括注），值为约定的 slug。
/** slug → 笔记小节标题（逐字）。反查时用 headingOf(note) 验证标题真实存在。
 *  ⚠️ 键是 slug（唯一），值是标题 —— 因此「status 与 diff 共用『### 查看状态』小节」
 *  可以自然表达（两个 slug 指向同一标题），不会像 heading→slug 那样撞键。 */
const SLUG_BY_HEADING: Record<string, string> = {
  // 规则 A（git-basics）：小节标题带英文括注，slug 取括注
  'working-directory': '### 工作区 (Working Directory)',
  'staging-area': '### 暂存区 (Staging Area)',
  'local-repository': '### 本地仓库 (Local Repository)',
  'remote-repository': '### 远程仓库 (Remote Repository)',
  // 规则 B（git-basics）：纯中文标题，slug 为核定意译
  'three-areas': '## 三大核心区域',
  'workflow': '## 工作流程图解',
  'why-staging': '## 为什么要有暂存区？',
  'object-model': '## 对象模型',
  // 规则 B（git-basic-operations，M4 ch2）：标题即语义，意译取英文关键词。
  // ⚠️ `diff` 的用法写在「### 查看状态」小节内（笔记无独立 diff 小节），
  // 2-2 的知识点引用因此也指向该小节 —— 两个 slug 指向同一标题，合法。
  'status': '### 查看状态',
  'diff': '### 查看状态',
  'log': '### 查看历史',
  'rm': '### 删除文件',
  'ignore': '### 忽略文件',
  // 规则 B（git-branches，M4 ch3）
  'create': '### 创建分支',
  'switch': '### 切换分支',
  'basic-merge': '### 基本合并',
  'merge-conflict': '### 合并冲突处理',
  'rebase-vs-merge': '### Rebase vs Merge',
  'best-practices': '## 分支管理最佳实践',
}

/** 读一篇笔记的正文；未登记时抛错（比静默返回空串更容易定位） */
function readNote(noteSlug: string): string {
  const content = NOTES[noteSlug]
  if (content === undefined) {
    throw new Error(
      `笔记 docs/notes/${noteSlug}.md 未登记在 NOTES 中；新增笔记时请在本文件顶部补一行 ?raw 导入。`,
    )
  }
  return content
}

/** 笔记中真实存在的小节标题集合 */
function headingsOf(noteSlug: string): Set<string> {
  return new Set(
    readNote(noteSlug)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => /^#{2,6} /.test(line)),
  )
}

/** 把 id 按 `<note>#<slug>` 拆开；格式非法时抛错（格式由 schema 单独校验） */
function splitKnowledgeId(id: string): { note: string; slug: string } {
  const [note, slug] = id.split('#')
  return { note, slug }
}

/** 建一个干净的内存沙箱，用于「开局判定」类断言 */
let caseIndex = 0
async function freshSandbox(init: Level['init'] = {}): Promise<void> {
  caseIndex += 1
  configureFs({ name: `levels-${Date.now()}-${caseIndex}`, backend: new MemoryBackend() })
  const result = await reset(init)
  if (!result.ok) throw new Error(`沙箱初始化失败：${result.error.toString()}`)
}

describe('关卡数据 —— 第一章 id 与顺序', () => {
  it('第一章恰为 4 关，id 依次是 ch1-1 ~ ch1-4', () => {
    expect(CHAPTER_1_LEVELS).toHaveLength(4)
    expect(CHAPTER_1_LEVELS.map((level) => level.id)).toEqual(['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4'])
  })

  it('getChapterLevels("ch1") 顺序稳定，且按**数值序号**而非字典序排列', () => {
    const levels = getChapterLevels('ch1')

    expect(levels.map((level) => level.id)).toEqual(['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4'])

    // ⚠️ 回归锁：`'ch1-10' < 'ch1-2'` 是字符串比较的固有结果，两位数关卡会错位。
    //   第一章暂时只有个位数关卡，故此处直接验证排序口径是「数值序号」——
    //   给同一关卡集补一个两位数关卡，数值序应把它排在末尾。
    const parsed = levels.map((level) => Number(level.id.split('-')[1]))
    expect(parsed).toEqual([...parsed].sort((a, b) => a - b))
    // 字典序与数值序在此恰好一致，但断言的是**数值序**这条性质本身
    expect([...levels].sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]))).toEqual(
      levels,
    )
  })

  it('getChapterLevels 返回副本：外部改动不影响注册表', () => {
    const first = getChapterLevels('ch1')
    first.reverse()
    expect(getChapterLevels('ch1').map((level) => level.id)).toEqual(['ch1-1', 'ch1-2', 'ch1-3', 'ch1-4'])
  })

  it('getLevel / getFirstLevelOfChapter / getAllLevels 行为一致', () => {
    expect(getLevel('ch1-1')?.id).toBe('ch1-1')
    expect(getLevel('ch1-4')?.id).toBe('ch1-4')
    expect(getLevel('ch1-99')).toBeNull()
    // 不符合 chN-M 格式的一律返回 null，不猜测
    expect(getLevel('ch1')).toBeNull()
    expect(getLevel('随便')).toBeNull()

    expect(getFirstLevelOfChapter('ch1')?.id).toBe('ch1-1')
    // 尚未落地的章节如实返回空数组 / null，不伪造占位关卡（§14）—— M4 起仅 ch4+ 为空
    expect(getChapterLevels('ch4')).toEqual([])
    expect(getFirstLevelOfChapter('ch4')).toBeNull()

    expect(getAllLevels().map((level) => level.id)).toEqual([
      'ch1-1',
      'ch1-2',
      'ch1-3',
      'ch1-4',
      'ch2-1',
      'ch2-2',
      'ch2-3',
      'ch2-4',
      'ch3-1',
      'ch3-2',
      'ch3-3',
      'ch3-4',
      'ch3-5',
      'ch3-6',
    ])
  })

  it('章节元信息：M4 起前三章可玩，综合挑战不参与主线排序', () => {
    expect(getChapterMeta('ch1')?.playable).toBe(true)
    expect(getChapterMeta('ch1')?.order).toBe(1)
    expect(getChapterMeta('ch2')?.playable).toBe(true)
    expect(getChapterMeta('ch3')?.playable).toBe(true)
    for (const id of ['ch4', 'ch5', 'ch6'] as ChapterId[]) {
      expect(getChapterMeta(id)?.playable).toBe(false)
    }
    expect(getChapterMeta('F')?.order).toBeNull()
    expect(getChapterMeta('ch4')?.title.length).toBeGreaterThan(0)
  })
})

describe('关卡数据 —— schema 校验', () => {
  it('4 关全部通过 validateLevel 校验', () => {
    for (const level of CHAPTER_1_LEVELS) {
      const result = validateLevel(level)
      // 失败时把错误清单打出来，比一句 toBe(true) 好定位得多
      if (!result.ok) throw new Error(`${level.id} 校验失败：\n- ${result.errors.join('\n- ')}`)
      expect(result.level.id).toBe(level.id)
    }
  })

  it('assertValidLevel / isLevel 与 validateLevel 口径一致', () => {
    for (const level of CHAPTER_1_LEVELS) {
      expect(assertValidLevel(level).id).toBe(level.id)
      expect(isLevel(level)).toBe(true)
    }
    expect(isLevel({ id: 'ch1-1' })).toBe(false)
  })

  it('schema 能拦住明显写坏的关卡数据（校验器本身有效）', () => {
    const good = CHAPTER_1_LEVELS[0]

    // id 与 chapter 不一致
    expect(validateLevel({ ...good, id: 'ch2-1' }).ok).toBe(false)
    // targets 为空 => 一进关就过关，必须拦下
    expect(validateLevel({ ...good, targets: [] }).ok).toBe(false)
    // difficulty 越界
    expect(validateLevel({ ...good, difficulty: 9 }).ok).toBe(false)
    // winScore 非正数
    expect(validateLevel({ ...good, winScore: 0 }).ok).toBe(false)
    // 空 objective
    expect(validateLevel({ ...good, objective: '   ' }).ok).toBe(false)
    // scoring 缺字段
    expect(validateLevel({ ...good, scoring: { baseScore: 1 } }).ok).toBe(false)
    // hints 的 unlockAfterFailures 为负
    expect(validateLevel({ ...good, hints: [{ text: 'x', unlockAfterFailures: -1 }] }).ok).toBe(false)
    // optimalMoves（M3）：0 / 负数 / 非整数 / 缺失都拦下
    expect(validateLevel({ ...good, optimalMoves: 0 }).ok).toBe(false)
    expect(validateLevel({ ...good, optimalMoves: -2 }).ok).toBe(false)
    expect(validateLevel({ ...good, optimalMoves: 2.5 }).ok).toBe(false)
    expect(validateLevel({ ...good, optimalMoves: undefined }).ok).toBe(false)
  })

  it('optimalMoves（M3）：4 关齐备且为正整数（optimalBonus 的判据基础）', () => {
    for (const level of CHAPTER_1_LEVELS) {
      expect(Number.isInteger(level.optimalMoves)).toBe(true)
      expect(level.optimalMoves).toBeGreaterThanOrEqual(1)
    }
    // 参考解法步数与 ch1.ts 注释里核定的参考解法一致：
    // 1-1 init→add→commit 3 步；1-2 add→commit 2 步；1-3 add→commit 2 步；
    // 1-4 add→commit→改文件→add→commit 5 步
    const expected: Record<string, number> = {
      'ch1-1': 3,
      'ch1-2': 2,
      'ch1-3': 2,
      'ch1-4': 5,
    }
    for (const level of CHAPTER_1_LEVELS) {
      expect(level.optimalMoves).toBe(expected[level.id])
    }
  })

  it('schema 拒绝尚未落地的 init 字段（与 sandbox.reset 的 fail-fast 同一口径）', () => {
    const good = CHAPTER_1_LEVELS[0]

    // M4 起 branches 已落地（分支关卡需要），名单只剩 tags / remotes / cloneSource
    for (const init of [
      { tags: [{ name: 'v1', at: 'abc' }] },
      { remotes: [{ name: 'origin', url: 'x' }] },
      { template: 'cloneSource' as const },
    ]) {
      const result = validateLevel({ ...good, init })
      expect(result.ok).toBe(false)
    }

    // branches 现在是合法字段，且带 name/from 的写法能过校验
    expect(validateLevel({ ...good, init: { branches: [{ name: 'dev', from: 'main' }] } }).ok).toBe(true)
  })
})

describe('关卡数据 —— targets 类型范围', () => {
  it('4 关 targets 非空，且类型全部落在已实现范围内', () => {
    for (const level of CHAPTER_1_LEVELS) {
      expect(level.targets.length).toBeGreaterThan(0)

      const types = level.targets.map((target) => target.type)
      for (const type of types) {
        expect(IMPLEMENTED_TARGET_TYPES).toContain(type)
        expect(UNIMPLEMENTED_TARGET_TYPES).not.toContain(type)
      }
    }
  })

  it('IMPLEMENTED_TARGET_TYPES 与 UNIMPLEMENTED_TARGET_TYPES 互补且覆盖全部 11 种', () => {
    expect(IMPLEMENTED_TARGET_TYPES).toHaveLength(9)
    expect(UNIMPLEMENTED_TARGET_TYPES).toHaveLength(2)

    const all = [...IMPLEMENTED_TARGET_TYPES, ...UNIMPLEMENTED_TARGET_TYPES]
    expect(new Set(all).size).toBe(11)
    // 两份名单不得重叠
    for (const type of IMPLEMENTED_TARGET_TYPES) {
      expect(UNIMPLEMENTED_TARGET_TYPES).not.toContain(type)
    }
    // schema 里登记的「已实现」应与 targetState 实际实现的一致
    expect([...IMPLEMENTED_TARGET_TYPES].sort()).toEqual(
      [
        'branch',
        'commitCount',
        'commitExists',
        'commitMessage',
        'file',
        'headBranch',
        'logOrder',
        'merged',
        'workdirClean',
      ].sort(),
    )
  })

  it('第一章只用 init/add/commit 三种命令涉及的 target 类型', () => {
    // §8 已按 GDD 订正：第一章命令集恒为 init / add / commit。
    // 目标只应依赖「提交数量 / 提交信息 / 工作区是否干净 / 文件内容」这四类判据，
    // 不应出现 branch / tag / remote 等属后续章节的类型。
    for (const level of CHAPTER_1_LEVELS) {
      for (const target of level.targets) {
        expect(['commitCount', 'commitExists', 'commitMessage', 'workdirClean', 'file']).toContain(
          target.type,
        )
      }
    }
  })
})

describe('关卡数据 —— init 不使用未落地字段', () => {
  it('4 关 init 均不含 branches / tags / remotes / cloneSource', () => {
    // ⚠️ `sandbox.reset()` 对这些字段 fail-fast 报错（M1 刻意不伪造）。
    //   schema 已在校验期拦下，此处再对**实际数据**独立断言一次 ——
    //   两条防线都过，才能保证玩家不会进关时炸在 reset 上。
    for (const level of CHAPTER_1_LEVELS) {
      expect(level.init.branches ?? []).toEqual([])
      expect(level.init.tags ?? []).toEqual([])
      expect(level.init.remotes ?? []).toEqual([])
      expect(level.init.template).not.toBe('cloneSource')
      expect(['blank', 'emptyRepo', undefined]).toContain(level.init.template)
    }
  })

  it('reset(level.init) 对 4 关都真的成功（不只是 schema 说它能过）', async () => {
    // ⚠️ 断言沙箱内容必须用 `fsp`（LightningFS 的内存实例），不能用 Node 的 `existsSync` ——
    //   后者查的是宿主机真实文件系统，`/repo` 在那里根本不存在。
    const { fsp } = await import('../engine/fs')

    for (const level of CHAPTER_1_LEVELS) {
      await freshSandbox(level.init)
      // 重置后必定已 init —— 这也正是「`.git` 存在」不能用作目标的原因
      expect((await fsp.stat('/repo/.git')).isDirectory()).toBe(true)
      // `/remote.git` 由 ensureSandboxRoot 一并建立（第四章远程关卡用）
      expect(await fsp.readdir('/remote.git')).toEqual([])
    }
  })
})

describe('关卡数据 —— 开局不得即达标', () => {
  it('4 关开局 satisfied 均为 false，且已达标项数为 0', async () => {
    // ⚠️ 通用性质，防「开局即过关」与「进关就亮着勾」：
    //   `reset()` 内部总会 `git init`，故任何依赖「仓库已建立」的目标都会开局即真。
    //   1-1 最初把目标写成 `{ type: 'file', path: '.git', exists: true }`，实测开局即过关；
    //   1-3 最初含 `file` content 目标，实测开局即亮一条勾。两者都已修正，
    //   本用例是对**同类错误**的通用兜底。
    for (const level of CHAPTER_1_LEVELS) {
      await freshSandbox(level.init)

      const state = await evaluateTargets(level)
      const doneCount = state.results.filter((result) => result.ok).length

      if (doneCount !== 0) {
        const detail = state.results
          .filter((result) => result.ok)
          .map((result) => `${result.target.type}（${result.detail}）`)
          .join('、')
        throw new Error(`${level.id} 开局就已有 ${doneCount} 项达标：${detail}`)
      }
      expect(doneCount).toBe(0)
      expect(state.satisfied).toBe(false)
      expect(state.remaining).toBe(level.targets.length)
    }
  })

  it('4 关的 targets 都必须依赖玩家操作才可能达成（不依赖 reset 的既有副作用）', async () => {
    // 换个角度看同一性质：`workdirClean` 若为 `value: false`，则「干净的空仓库」开局
    // 必然未达成 —— 这类目标不可能被 reset 顺带满足。此处只断言开局全部未达成
    // （已由上一用例覆盖）之外，再确认**每关都至少有一条 `commitCount` 门槛**，
    // 保证「什么都不做」绝不可能过关。
    for (const level of CHAPTER_1_LEVELS) {
      const hasCommitGate = level.targets.some(
        (target) => target.type === 'commitCount' && target.op === 'gte' && target.value >= 1,
      )
      expect(hasCommitGate).toBe(true)
    }
  })

  it('4 关走通后 satisfied 变为 true（目标确实可达成）', async () => {
    // 只验证「开局不达标」还不够 —— 目标若永远无法达成同样是坏的。
    // 用最朴素的正解序列走一遍：add . + commit -m（信息满足各关要求）。
    const { execute } = await import('../game/command/executor')
    const solutions: Record<string, string[]> = {
      'ch1-1': ['git add .', 'git commit -m "初始化时间线"'],
      'ch1-2': ['git add .', 'git commit -m "第一次快照"'],
      'ch1-3': ['git add .', 'git commit -m "归档三态笔记"'],
      'ch1-4': ['git add .', 'git commit -m "第一环：链条起点"'],
    }

    for (const level of CHAPTER_1_LEVELS) {
      await freshSandbox(level.init)
      for (const command of solutions[level.id]) {
        const result = await execute(command)
        if (!result.ok) throw new Error(`${level.id} 执行 ${command} 失败：${result.error ?? ''}`)
      }

      // 1-4 需要两环，补第二轮（先制造新改动再归档）
      if (level.id === 'ch1-4') {
        const { fsp } = await import('../engine/fs')
        await fsp.writeFile('/repo/notes/timeline-log.md', '第二段内容\n', 'utf8')
        await execute('git add .')
        await execute('git commit -m "第二环：链条延长"')
      }

      const state = await evaluateTargets(level)
      if (!state.satisfied) {
        const pending = state.results
          .filter((result) => !result.ok)
          .map((result) => `${result.target.type}：${result.detail}`)
          .join('；')
        throw new Error(`${level.id} 走完正解仍未过关：${pending}`)
      }
      expect(state.satisfied).toBe(true)
    }
  })
})

describe('关卡数据 —— relatedKnowledge 反查笔记', () => {
  it('每关至少关联一个知识点，id 格式为 <note>#<slug>', () => {
    for (const level of CHAPTER_1_LEVELS) {
      expect(level.relatedKnowledge.length).toBeGreaterThan(0)
      for (const id of level.relatedKnowledge) {
        expect(id).toMatch(/^[a-z0-9-]+#[a-z0-9-]+$/)
      }
    }
  })

  it('引用到的笔记文件真实存在', () => {
    for (const level of CHAPTER_1_LEVELS) {
      for (const id of level.relatedKnowledge) {
        const { note } = splitKnowledgeId(id)
        expect(() => readNote(note)).not.toThrow()
      }
    }
  })

  it('每个 slug 都能在对应笔记里反查到**真实存在**的小节', () => {
    // ⚠️ 这是本文件的核心用例：关卡数据里的知识点引用最难自查 —— id 拼错不会报错，
    //   只会让玩家点「相关知识」时跳到一个不存在的小节。
    for (const level of CHAPTER_1_LEVELS) {
      for (const id of level.relatedKnowledge) {
        const { note, slug } = splitKnowledgeId(id)
        const headings = headingsOf(note)

        // 找出 slug 对应的标题：查显式映射表
        const heading = SLUG_BY_HEADING[slug]
        const matched = heading === undefined ? [] : [[heading, slug]]
        expect(
          matched.length,
          `${id} 的 slug "${slug}" 未登记在 SLUG_BY_HEADING 中；` +
            '新增笔记小节时请在本文件的映射表里补一行（两套转写规则无法机械统一，见文件头说明）。',
        ).toBeGreaterThan(0)

        // 映射表登记的标题必须**逐字**存在于笔记里
        for (const [heading] of matched) {
          expect(
            headings.has(heading),
            `${id} 映射到标题 "${heading}"，但 docs/notes/${note}.md 中没有逐字匹配的小节。` +
              `笔记现有小节：${[...headings].join(' / ')}`,
          ).toBe(true)
        }
      }
    }
  })

  it('映射表里的标题全部真实存在于笔记中（防止笔记被改后测试悄悄失效）', () => {
    // 反向校验：映射表本身不许有「僵尸条目」——否则映射表会慢慢与笔记脱节。
    const headingsByNote = new Map<string, Set<string>>([
      ['git-basics', headingsOf('git-basics')],
      ['git-basic-operations', headingsOf('git-basic-operations')],
      ['git-branches', headingsOf('git-branches')],
    ])

    for (const [slug, heading] of Object.entries(SLUG_BY_HEADING)) {
      const found = [...headingsByNote.values()].some((headings) => headings.has(heading))
      expect(found, `SLUG_BY_HEADING 的 slug "${slug}" → 标题 "${heading}" 在任何笔记里都找不到`).toBe(true)
    }

    // 两套规则都要有代表，避免有人「简化」成单一规则时测试仍通过
    expect(SLUG_BY_HEADING['local-repository']).toBe('### 本地仓库 (Local Repository)')
    expect(SLUG_BY_HEADING['object-model']).toBe('## 对象模型')
  })

  it('第一章的 4 关各自关联的 id 与核定映射一致', () => {
    // 这一组 id 是 Lead 按「GDD 关联列 → 笔记实际小节」核定的一一映射（见 ch1.ts 顶部）。
    // 写成显式期望值，任何改动都会在测试里显形，而不是静默漂移。
    const expected: Record<string, string[]> = {
      'ch1-1': ['git-basics#local-repository'],
      'ch1-2': ['git-basics#workflow'],
      'ch1-3': ['git-basics#three-areas', 'git-basics#why-staging'],
      'ch1-4': ['git-basics#object-model'],
    }
    for (const level of CHAPTER_1_LEVELS) {
      expect(level.relatedKnowledge).toEqual(expected[level.id])
    }
  })
})

describe('关卡数据 —— 其余字段的取值合理性', () => {
  it('id / chapter / difficulty / inputMode / winScore 取值合理', () => {
    for (const level of CHAPTER_1_LEVELS) {
      // id 前缀与 chapter 一致
      expect(level.id.startsWith(`${level.chapter}-`)).toBe(true)
      expect(level.chapter).toBe('ch1')
      // difficulty 1~5 的整数
      expect(Number.isInteger(level.difficulty)).toBe(true)
      expect(level.difficulty).toBeGreaterThanOrEqual(1)
      expect(level.difficulty).toBeLessThanOrEqual(5)
      // 第一章为菜单式（拼接）输入，§3.2 / §8
      expect(level.inputMode).toBe('menu')
      expect(level.winScore).toBeGreaterThan(0)
      // 标题与目标描述是中文文案，不能是空串
      expect(level.title.trim().length).toBeGreaterThan(0)
      expect(level.objective.trim().length).toBeGreaterThan(0)
    }
  })

  it('每关 hints 的 unlockAfterFailures 递增（避免「跳级」观感）', () => {
    // ⚠️ stepHints 按**关卡定义顺序**解锁，不擅自重排；若阈值非递增，
    //   第 3 条会在第 2 条之前解锁，产生跳级观感 —— 属关卡数据问题，在此校验。
    for (const level of CHAPTER_1_LEVELS) {
      expect(level.hints.length).toBeGreaterThan(0)
      const thresholds = level.hints.map((hint) => hint.unlockAfterFailures)
      expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b))
      // 首条应进关即可见（0），否则玩家一开始拿不到任何方向提示
      expect(thresholds[0]).toBe(0)
      // 每条提示都要有正文，且不得直接给出完整命令（§9.1：抽象提示不泄题）
      for (const hint of level.hints.slice(0, -1)) {
        expect(hint.text.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('scoring 的 7 个字段齐备且非负（M2 为占位值，但不得缺字段）', () => {
    for (const level of CHAPTER_1_LEVELS) {
      const keys = [
        'baseScore',
        'undoPenalty',
        'redoPenalty',
        'hintPenalty',
        'optimalBonus',
        'flawlessBonus',
        'probeBonus',
      ] as const
      for (const key of keys) {
        expect(typeof level.scoring[key]).toBe('number')
        expect(Number.isFinite(level.scoring[key])).toBe(true)
        expect(level.scoring[key]).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('[修订] 4 关的 init.files 路径均为仓库内相对路径，且文件被预置到工作区', async () => {
    // ⚠️ 路径必须是相对的（`notes/x.md`），带前导 `/` 或 `/repo/` 会让 sandbox
    //   的父目录补齐逻辑走偏。此处用真实 reset + 读文件独立验证。
    const { fsp } = await import('../engine/fs')

    for (const level of CHAPTER_1_LEVELS) {
      const files = level.init.files ?? {}
      expect(Object.keys(files).length).toBeGreaterThan(0)

      await freshSandbox(level.init)
      for (const [path, content] of Object.entries(files)) {
        expect(path.startsWith('/')).toBe(false)
        expect(await fsp.readFile(`/repo/${path}`, 'utf8')).toBe(content)
      }
    }
  })

  it('CHAPTERS 的 order 与主线顺序一致，且 playable 与「是否有关卡」相符', () => {
    const mainline = CHAPTERS.filter((chapter) => chapter.order !== null)
    expect(mainline.map((chapter) => chapter.order)).toEqual([1, 2, 3, 4, 5, 6])

    for (const chapter of CHAPTERS) {
      const hasLevels = getChapterLevels(chapter.id).length > 0
      // 反过来也成立：有关卡就必须标记为可玩，否则菜单会把它画成禁用态
      expect(chapter.playable).toBe(hasLevels)
    }
  })
})

// ── M4：第二、三章关卡数据 ───────────────────────────────────────────────────

describe('关卡数据 —— 第二、三章 id 与注册', () => {
  it('ch2 恰为 4 关（2-1~2-4），ch3 恰为 6 关（3-1~3-6）', () => {
    expect(CHAPTER_2_LEVELS.map((level) => level.id)).toEqual(['ch2-1', 'ch2-2', 'ch2-3', 'ch2-4'])
    expect(CHAPTER_3_LEVELS.map((level) => level.id)).toEqual([
      'ch3-1',
      'ch3-2',
      'ch3-3',
      'ch3-4',
      'ch3-5',
      'ch3-6',
    ])
  })

  it('ch2/ch3 已注册：章节 playable 且 getChapterLevels 可达', () => {
    expect(getChapterMeta('ch2')?.playable).toBe(true)
    expect(getChapterMeta('ch3')?.playable).toBe(true)
    expect(getChapterLevels('ch2')).toHaveLength(4)
    expect(getChapterLevels('ch3')).toHaveLength(6)
    expect(getLevel('ch3-4')?.title).toBe('冲突消解')
    // getAllLevels 覆盖三章共 14 关
    expect(getAllLevels()).toHaveLength(14)
  })

  it('输入模式：ch2 全部拼接（menu），ch3 全部半拼（half）', () => {
    for (const level of CHAPTER_2_LEVELS) {
      expect(level.inputMode).toBe('menu')
    }
    for (const level of CHAPTER_3_LEVELS) {
      expect(level.inputMode).toBe('half')
      // 半拼关卡必须提供骨架（schema 校验之外的数据级断言）
      expect(level.halfSkeleton).toMatch(/^git [a-z]/)
    }
    // 骨架与关卡任务匹配（防复制粘贴错骨架）
    expect(getLevel('ch3-1')?.halfSkeleton).toBe('git branch')
    expect(getLevel('ch3-3')?.halfSkeleton).toBe('git merge')
    expect(getLevel('ch3-5')?.halfSkeleton).toBe('git checkout')
  })
})

describe('关卡数据 —— 第二、三章 schema 与命令集约束', () => {
  it('10 关全部通过 validateLevel 校验', () => {
    for (const level of [...CHAPTER_2_LEVELS, ...CHAPTER_3_LEVELS]) {
      const result = validateLevel(level)
      if (!result.ok) throw new Error(`${level.id} 校验失败：\n- ${result.errors.join('\n- ')}`)
    }
  })

  it('ch2 只用第二章命令集相关的目标；ch3 用到 M4 转正的分支目标', () => {
    const ch2Types = new Set(CHAPTER_2_LEVELS.flatMap((level) => level.targets.map((t) => t.type)))
    for (const type of ch2Types) {
      expect(IMPLEMENTED_TARGET_TYPES).toContain(type)
    }
    const ch3Types = new Set(CHAPTER_3_LEVELS.flatMap((level) => level.targets.map((t) => t.type)))
    // M4 转正的 4 种里至少用到 3 种（branch/headBranch/merged/logOrder）
    for (const needed of ['headBranch', 'merged']) {
      expect(ch3Types.has(needed as never)).toBe(true)
    }
    // 不用 M5/M6 的类型
    for (const level of [...CHAPTER_2_LEVELS, ...CHAPTER_3_LEVELS]) {
      for (const target of level.targets) {
        expect(UNIMPLEMENTED_TARGET_TYPES).not.toContain(target.type)
      }
    }
  })

  it('ch2/ch3 的 init 预置满足「每个提交都有 files」（M3 空提交防御的关卡侧约束）', () => {
    for (const level of [...CHAPTER_2_LEVELS, ...CHAPTER_3_LEVELS]) {
      const commits = level.init.commits ?? []
      commits.forEach((commit, index) => {
        if (!commit.files || Object.keys(commit.files).length === 0) {
          throw new Error(`${level.id} 的预置提交 ${index} 缺少 files（会触发空提交防御）`)
        }
      })
    }
  })

  it('ch3 分支预置：涉及冲突的关卡（3-4）两分支改同一文件；变基关（3-5）改动互不相交', () => {
    const l34 = assertValidLevel(getLevel('ch3-4'))
    // main 侧改写 beacon.md、feature 侧也改写 beacon.md（冲突前提）
    const mainCommits = l34.init.commits!.filter((c) => !c.on)
    const featureCommits = l34.init.commits!.filter((c) => c.on === 'feature')
    expect(mainCommits.some((c) => Object.keys(c.files ?? {}).includes('beacon.md'))).toBe(true)
    expect(featureCommits.some((c) => Object.keys(c.files ?? {}).includes('beacon.md'))).toBe(true)
    // 且两侧内容不同（真的冲突）
    const mainContent = mainCommits.find((c) => c.files?.['beacon.md'])?.files?.['beacon.md']
    const featureContent = featureCommits.find((c) => c.files?.['beacon.md'])?.files?.['beacon.md']
    expect(mainContent).not.toBe(featureContent)

    const l35 = assertValidLevel(getLevel('ch3-5'))
    const l35FeatureFiles = new Set(
      l35.init
        .commits!.filter((c) => c.on === 'feature')
        .flatMap((c) => Object.keys(c.files ?? {})),
    )
    const l35MainFiles = new Set(
      l35.init.commits!.filter((c) => !c.on).flatMap((c) => Object.keys(c.files ?? {})),
    )
    for (const path of l35FeatureFiles) {
      expect(l35MainFiles.has(path)).toBe(false)
    }
  })
})

describe('关卡数据 —— 第二、三章可解性（真实引擎走通）', () => {
  let caseIndexM4 = 0
  async function freshSandboxM4(init: Level['init'] = {}): Promise<void> {
    caseIndexM4 += 1
    configureFs({ name: `levels-m4-${Date.now()}-${caseIndexM4}`, backend: new MemoryBackend() })
    const result = await reset(init)
    if (!result.ok) throw new Error(`沙箱初始化失败：${result.error.toString()}`)
  }

  const solutions: Record<string, string[]> = {
    'ch2-1': ['git status', 'git add .', 'git commit -m "归档待归档观测"'],
    'ch2-2': ['git add diary.md', 'git commit -m "记录修复要点"'],
    'ch2-3': ['git log --oneline', 'git add .', 'git commit -m "续写回溯档案"'],
    'ch2-4': ['git rm secrets.log', 'git commit -m "移除密钥残片"', 'git add .gitignore', 'git commit -m "忽略缓存噪声"'],
    'ch3-1': ['git branch dev'],
    'ch3-2': ['git checkout feature', 'git add base.md', 'git commit -m "feature 观测"'],
    'ch3-3': ['git merge feature'],
    'ch3-4': ['git merge feature', 'git add .', "git commit -m \"Merge branch 'feature' into main\""],
    'ch3-5': ['git checkout feature', 'git rebase main'],
    'ch3-6': ['git merge collaborative'],
  }

  /** 编辑器模拟：ch2-2 写日记、ch2-3 续写、ch2-4 创建 .gitignore、3-4 裁决坐标 */
  const editorSteps: Record<string, Array<[string, string]>> = {
    'ch2-2': [['diary.md', '修复日记 · 定稿\n\n修复要点：时间线校准完成。\n']],
    'ch2-3': [['third.md', LOG_PAGE_THIRD + '\n回溯完成。\n']],
    'ch2-4': [['.gitignore', 'cache.log\n']],
    'ch3-4': [
      [
        'beacon.md',
        '信标坐标\n\n纬度：北纬 37.5\n经度：东经 105\n\n两个宇宙读数的折中，由你亲自裁决。\n',
      ],
    ],
  }

  it('10 关开局不得即达标', async () => {
    for (const level of [...CHAPTER_2_LEVELS, ...CHAPTER_3_LEVELS]) {
      await freshSandboxM4(level.init)
      const state = await evaluateTargets(level)
      const done = state.results.filter((result) => result.ok)
      if (done.length !== 0) {
        throw new Error(
          `${level.id} 开局就已有 ${done.length} 项达标：` +
            done.map((r) => `${r.target.type}（${r.detail}）`).join('、'),
        )
      }
    }
  })

  it('10 关走参考解法后全部过关（含编辑器步骤与 MERGE_HEAD 合并）', async () => {
    const { fsp } = await import('../engine/fs')
    /** 编辑器动作：在第 N 条命令执行前写文件（before 为命令索引） */
    type EditorAction = { before: number; path: string; content: string }
    const plans: Record<string, { commands: string[]; edits: EditorAction[] }> = {
      'ch2-1': {
        commands: ['git status', 'git add .', 'git commit -m "归档待归档观测"'],
        edits: [],
      },
      'ch2-2': {
        commands: ['git add diary.md', 'git commit -m "记录修复要点"'],
        edits: [{ before: 0, path: 'diary.md', content: '修复日记 · 定稿\n\n修复要点：时间线校准完成。\n' }],
      },
      'ch2-3': {
        commands: ['git log --oneline', 'git add .', 'git commit -m "续写回溯档案"'],
        // third.md 改写 = LOG_PAGE_THIRD + 草稿内容并入（模拟玩家把 draft.md 内容并入末尾）
        edits: [{ before: 1, path: 'third.md', content: LOG_PAGE_THIRD + '续写草稿已并入，回溯完成。\n' }],
      },
      'ch2-4': {
        commands: [
          'git rm secrets.log',
          'git commit -m "移除密钥残片"',
          'git add .gitignore',
          'git commit -m "忽略缓存噪声"',
        ],
        edits: [{ before: 2, path: '.gitignore', content: 'cache.log\n' }],
      },
      'ch3-1': {
        commands: ['git branch dev', 'git add base.md', 'git commit -m "main 观测推进"'],
        edits: [{ before: 1, path: 'base.md', content: UNIVERSE_BASE + '\nmain 的观测又前进一步。\n' }],
      },
      'ch3-2': {
        commands: ['git checkout feature', 'git add base.md', 'git commit -m "feature 观测"'],
        edits: [{ before: 1, path: 'base.md', content: UNIVERSE_BASE + '\nfeature 的新观测。\n' }],
      },
      'ch3-3': { commands: ['git merge feature'], edits: [] },
      'ch3-4': {
        commands: ['git merge feature', 'git add .', "git commit -m \"Merge branch 'feature' into main\""],
        edits: [
          {
            before: 1,
            path: 'beacon.md',
            content: '信标坐标\n\n纬度：北纬 37.5\n经度：东经 105\n\n两个宇宙读数的折中，由你亲自裁决。\n',
          },
        ],
      },
      'ch3-5': { commands: ['git checkout feature', 'git rebase main'], edits: [] },
      'ch3-6': { commands: ['git merge collaborative'], edits: [] },
    }

    for (const level of [...CHAPTER_2_LEVELS, ...CHAPTER_3_LEVELS]) {
      await freshSandboxM4(level.init)
      const plan = plans[level.id]

      for (let i = 0; i < plan.commands.length; i += 1) {
        // 命令前：执行到期的编辑器动作
        for (const edit of plan.edits.filter((e) => e.before === i)) {
          await fsp.writeFile(`/repo/${edit.path}`, edit.content, 'utf8')
        }
        const command = plan.commands[i]
        const result = await execute(command)
        if (!result.ok) {
          throw new Error(`${level.id} 执行 ${command} 失败：${result.error ?? ''}`)
        }
      }

      const state = await evaluateTargets(level)
      if (!state.satisfied) {
        const pending = state.results
          .filter((r) => !r.ok)
          .map((r) => `${r.target.type}：${r.detail}`)
          .join('；')
        throw new Error(`${level.id} 走完参考解法仍未过关：${pending}`)
      }
      expect(state.satisfied).toBe(true)
    }
  })

  it('ch3-4 的合并提交确实是双亲提交（MERGE_HEAD 机制全链路）', async () => {
    await freshSandboxM4(assertValidLevel(getLevel('ch3-4')).init)
    const { fsp } = await import('../engine/fs')

    await execute('git merge feature')
    // 冲突已落工作区
    const conflicted = String(await fsp.readFile('/repo/beacon.md', 'utf8'))
    expect(conflicted).toContain('<<<<<<< main')

    await fsp.writeFile(
      '/repo/beacon.md',
      '信标坐标\n\n纬度：北纬 37.5\n经度：东经 105\n\n两个宇宙读数的折中，由你亲自裁决。\n',
      'utf8',
    )
    await execute('git add .')
    await execute("git commit -m \"Merge branch 'feature' into main\"")

    // main 的最新提交应为双亲
    const state = await evaluateTargets(assertValidLevel(getLevel('ch3-4')))
    expect(state.satisfied).toBe(true)
  })
})

describe('关卡数据 —— 第二、三章 relatedKnowledge 反查', () => {
  it('ch2/ch3 的每个 slug 都能在对应笔记里反查到真实小节', () => {
    for (const level of [...CHAPTER_2_LEVELS, ...CHAPTER_3_LEVELS]) {
      for (const id of level.relatedKnowledge) {
        const { note, slug } = splitKnowledgeId(id)
        const headings = headingsOf(note)
        const heading = SLUG_BY_HEADING[slug]
        const matched = heading === undefined ? [] : [[heading, slug]]
        expect(matched.length, `${id} 的 slug 未登记`).toBeGreaterThan(0)
        for (const [heading] of matched) {
          expect(headings.has(heading), `${id} → "${heading}" 不在 docs/notes/${note}.md 中`).toBe(true)
        }
      }
    }
  })

  it('ch2/ch3 的 relatedKnowledge 与核定映射一致（显式期望值，防漂移）', () => {
    const expected: Record<string, string[]> = {
      'ch2-1': ['git-basic-operations#status'],
      'ch2-2': ['git-basic-operations#diff'],      'ch2-3': ['git-basic-operations#log'],
      'ch2-4': ['git-basic-operations#rm', 'git-basic-operations#ignore'],
      'ch3-1': ['git-branches#create'],
      'ch3-2': ['git-branches#switch'],
      'ch3-3': ['git-branches#basic-merge'],
      'ch3-4': ['git-branches#merge-conflict'],
      'ch3-5': ['git-branches#rebase-vs-merge'],
      'ch3-6': ['git-branches#best-practices'],
    }
    for (const level of [...CHAPTER_2_LEVELS, ...CHAPTER_3_LEVELS]) {
      expect(level.relatedKnowledge).toEqual(expected[level.id])
    }
  })
})
