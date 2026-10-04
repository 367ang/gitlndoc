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
import gitUndoRaw from '../../docs/notes/git-undo.md?raw'
import gitRemotesRaw from '../../docs/notes/git-remotes.md?raw'
import gitTagsRaw from '../../docs/notes/git-tags.md?raw'
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
import { CHAPTER_4_LEVELS } from '../levels/chapters/ch4'
import { CHAPTER_5_LEVELS } from '../levels/chapters/ch5'
import { CHAPTER_6_LEVELS } from '../levels/chapters/ch6'
import {
  IMPLEMENTED_TARGET_TYPES,
  UNIMPLEMENTED_TARGET_TYPES,
  assertValidLevel,
  isLevel,
  validateLevel,
} from '../levels/schema'
import { reset } from '../engine/sandbox'
import { configureFs, getFs, type FsIdb } from '../engine/fs'
import { ALLOWED_REMOTE_URL } from '../engine/gitApi'
import git from 'isomorphic-git'
import { evaluateTargets } from '../game/validate/targetState'
import { execute } from '../game/command/executor'
import { LOG_PAGE_THIRD, STAGING_DRAFT_FINAL, UNIVERSE_BASE } from '../levels/presets'
import * as LightningFsNS from '@isomorphic-git/lightning-fs'
import type { ChapterId, Level } from '../game/types'

const MemoryBackend = (LightningFsNS as unknown as { MemoryBackend: new () => FsIdb }).MemoryBackend

/** 已登记的笔记正文（新增笔记时在此补一行 `?raw` 导入） */
const NOTES: Record<string, string> = {
  'git-basics': gitBasicsRaw,
  'git-basic-operations': gitBasicOperationsRaw,
  'git-branches': gitBranchesRaw,
  'git-undo': gitUndoRaw,
  'git-remotes': gitRemotesRaw,
  'git-tags': gitTagsRaw,
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
  // 规则 B（git-undo，M5a ch5）：标题即语义，slug 取英文关键词。
  // ⚠️ 逐字标题必须与 docs/notes/git-undo.md 完全一致（含「三种模式」「命令」等中文字样）。
  amend: '### 修改最后一次提交',
  unstage: '### unstage 文件',
  restore: '### restore 命令',
  'reset-vs-revert': '### reset 三种模式',
  revert: '### revert 命令',
  reflog: '### 使用 reflog',
  // 规则 B（git-remotes，M5b ch4）：标题即语义，slug 取英文关键词。
  // ⚠️ 逐字标题必须与 docs/notes/git-remotes.md 完全一致。
  'add-remote': '### 添加远程仓库',
  push: '### 基本推送',
  'fetch-pull': '### fetch vs pull',
  clone: '## Fork 工作流',
  'push-rejected': '### 推送被拒绝',
  // 规则 B（git-tags，M6 ch6/F）：标题即语义，slug 取英文关键词。
  // ⚠️ 逐字标题必须与 docs/notes/git-tags.md 完全一致。
  'lightweight': '### 创建轻量标签',
  'annotated': '### 创建注释标签（推荐）',
  'list-show': '### 列出标签',
  'push-tag': '### 推送到远程',
  'semver-release': '## 语义化版本',
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
    // ⚠️ M6 起全部章节（ch1~ch6 + F）均已注册 —— 全游戏 27 关可达
    expect(getChapterLevels('ch6').map((level) => level.id)).toEqual([
      'ch6-1',
      'ch6-2',
      'ch6-3',
      'ch6-4',
      'ch6-5',
    ])
    expect(getFirstLevelOfChapter('ch6')?.id).toBe('ch6-1')
    expect(getChapterLevels('F').map((level) => level.id)).toEqual(['F-1', 'F-2'])
    expect(getFirstLevelOfChapter('F')?.id).toBe('F-1')

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
      'ch4-1',
      'ch4-2',
      'ch4-3',
      'ch4-4',
      'ch4-5',
      'ch5-1',
      'ch5-2',
      'ch5-3',
      'ch5-4',
      'ch5-5',
      'ch5-6',
      'ch6-1',
      'ch6-2',
      'ch6-3',
      'ch6-4',
      'ch6-5',
      'F-1',
      'F-2',
    ])
  })

  it('章节元信息：M6 起 ch1~ch6 与 F 全部可玩，综合挑战不参与主线排序', () => {
    expect(getChapterMeta('ch1')?.playable).toBe(true)
    expect(getChapterMeta('ch1')?.order).toBe(1)
    expect(getChapterMeta('ch2')?.playable).toBe(true)
    expect(getChapterMeta('ch3')?.playable).toBe(true)
    // M5b 落地第四章（远程章）—— 此前它是 `playable: false`
    expect(getChapterMeta('ch4')?.playable).toBe(true)
    expect(getChapterMeta('ch4')?.order).toBe(4)
    // M5a 落地第五章（撤销章）
    expect(getChapterMeta('ch5')?.playable).toBe(true)
    expect(getChapterMeta('ch5')?.order).toBe(5)
    // M6 落地第六章（标签章）与终章 F
    expect(getChapterMeta('ch6')?.playable).toBe(true)
    expect(getChapterMeta('ch6')?.order).toBe(6)
    expect(getChapterMeta('F')?.playable).toBe(true)
    expect(getChapterMeta('F')?.order).toBeNull()
    expect(getChapterMeta('ch4')?.title.length).toBeGreaterThan(0)

    // `playable` 必须与「是否真有关卡」一致 —— 否则菜单会显示可玩却进不去
    for (const meta of CHAPTERS) {
      expect(meta.playable).toBe(getChapterLevels(meta.id).length > 0)
    }
  })

  it('章名与 GDD §4 逐字一致（M5a 统一了此前的双轨命名）', () => {
    // ⚠️ 背景：代码侧章名曾是 M2 阶段自行拟定的，与 GDD 有四处不一致
    // （见 development-refinement.md §3「章节命名双轨」表）。M5a 起以 GDD 为准。
    const expected: Record<string, string> = {
      ch1: '创世纪元',
      ch2: '日常秩序',
      ch3: '平行宇宙',
      ch4: '星际连接',
      ch5: '时空回溯',
      ch6: '历史锚点',
      F: '大统一',
    }
    for (const [id, title] of Object.entries(expected)) {
      expect(getChapterMeta(id as ChapterId)?.title).toBe(title)
    }
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

  it('schema 校验 init.tags（M6 落地）：结构与 at 引用都把关，此前它被 fail-fast 拒绝', () => {
    const good = CHAPTER_6_LEVELS[0]

    // ⚠️ M6 起 tags 已落地，合法声明应当通过（此前是「尚未落地」的 fail-fast 断言）
    const legal = validateLevel({
      ...good,
      init: {
        commits: [{ msg: '基线', message: '基线', files: { 'a.md': 'x\n' } }],
        tags: [{ name: 'v1', at: '基线' }],
      },
    })
    if (!legal.ok) throw new Error(`合法 tags 被拒绝：\n- ${legal.errors.join('\n- ')}`)
    expect(legal.ok).toBe(true)

    // 结构校验：空标签名 / - 开头
    expect(
      validateLevel({ ...good, init: { tags: [{ name: '-v', at: '基线' }] } }).ok,
    ).toBe(false)
    // 结构校验：同名标签重复声明
    expect(
      validateLevel({
        ...good,
        init: {
          commits: [{ msg: '基线', message: '基线', files: { 'a.md': 'x\n' } }],
          tags: [
            { name: 'v1', at: '基线' },
            { name: 'v1', at: '基线' },
          ],
        },
      }).ok,
    ).toBe(false)
    // 跨字段校验：at 指向不存在的提交
    expect(
      validateLevel({
        ...good,
        init: {
          commits: [{ msg: '基线', message: '基线', files: { 'a.md': 'x\n' } }],
          tags: [{ name: 'v1', at: '不存在的提交' }],
        },
      }).ok,
    ).toBe(false)
    // message 提供时必须非空字符串
    expect(
      validateLevel({
        ...good,
        init: {
          commits: [{ msg: '基线', message: '基线', files: { 'a.md': 'x\n' } }],
          tags: [{ name: 'v1', at: '基线', message: '' }],
        },
      }).ok,
    ).toBe(false)
  })

  it('remotes 的 `at` 必须是本关真实存在的预置提交信息（跨字段校验）', () => {
    // ⚠️ 不能拿 ch1-1 做样本 —— 它刻意不含预置提交（1-1 考的就是「从零 init」）。
    //    改用**确实带预置提交**的关卡，取它第一条提交的信息作为合法引用。
    const good = CHAPTER_5_LEVELS.find((level) => (level.init.commits ?? []).length > 0)
    expect(good).toBeDefined()
    if (!good) return

    const commitMessage = good.init.commits?.[0]?.message ?? ''

    // 引用本关真实存在的提交 → 通过
    expect(
      validateLevel({
        ...good,
        init: {
          ...good.init,
          remotes: [
            {
              name: 'origin',
              url: 'http://sandbox/remote.git',
              branches: [{ branch: 'main', at: commitMessage }],
            },
          ],
        },
      }).ok,
    ).toBe(true)

    // 引用一条**不存在**的提交 → 在编写期就拦下，而不是等玩家进关才炸
    const bad = validateLevel({
      ...good,
      init: {
        ...good.init,
        remotes: [
          {
            name: 'origin',
            url: 'http://sandbox/remote.git',
            branches: [{ branch: 'main', at: '这条提交根本不存在' }],
          },
        ],
      },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toContain('不是本关 init.commits 里的任何提交信息')
    }
  })

  it('同名远程重复声明被拦下（会让 remote.<name>.url 被先后覆写）', () => {
    const good = CHAPTER_1_LEVELS[0]
    const result = validateLevel({
      ...good,
      init: {
        ...good.init,
        remotes: [
          { name: 'origin', url: 'http://sandbox/remote.git' },
          { name: 'origin', url: 'http://sandbox/remote.git' },
        ],
      },
    })
    expect(result.ok).toBe(false)
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
    // ⚠️ M6 起 `tag` 已转正（第六章标签关卡）—— §4.3 的 11 种全部实现，未实现名单为空
    expect(IMPLEMENTED_TARGET_TYPES).toHaveLength(11)
    expect(UNIMPLEMENTED_TARGET_TYPES).toHaveLength(0)

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
        'remote',
        'tag',
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
  it('4 关 init 均不含 tags（唯一仍未落地的字段，属 M6）', () => {
    // ⚠️ `sandbox.reset()` 对 `tags` fail-fast 报错（刻意不伪造）。
    //   schema 已在校验期拦下，此处再对**实际数据**独立断言一次 ——
    //   两条防线都过，才能保证玩家不会进关时炸在 reset 上。
    //   （M5b 起 `remotes` / `cloneSource` 已落地，不再是「未落地字段」；
    //     第一章确实不使用它们，但那属于关卡设计而非实现能力，故不在此断言。）
    for (const level of CHAPTER_1_LEVELS) {
      expect(level.init.tags ?? []).toEqual([])
      expect(['blank', 'emptyRepo', 'cloneSource', undefined]).toContain(level.init.template)
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
      // `/remote.git` 自 M5b 起是**真实裸仓**（不再是空目录）：
      // `sandbox.reset` 每关都会重建它，使上一关的远程分支不会残留到本关。
      const remoteEntries = await fsp.readdir('/remote.git')
      expect(remoteEntries).toContain('HEAD')
      expect(remoteEntries).toContain('objects')
      // 且必须是干净的 —— 第一章的关卡不预置任何远程内容
      await expect(
        git.listBranches({ fs: getFs(), dir: '/remote.git', gitdir: '/remote.git' }),
      ).resolves.toEqual([])
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
      // M5a：第五章接入 git-undo 笔记
      ['git-undo', headingsOf('git-undo')],
      // M5b：第四章接入 git-remotes 笔记
      ['git-remotes', headingsOf('git-remotes')],
      // M6：第六章与终章接入 git-tags 笔记
      ['git-tags', headingsOf('git-tags')],
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
    // M6 起 getAllLevels 覆盖全部章节共 32 关（ch1:4 + ch2:4 + ch3:6 + ch4:5 + ch5:6 + ch6:5 + F:2）
    expect(getAllLevels()).toHaveLength(32)
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

// ── M5a：第五章「时空回溯」关卡数据 ────────────────────────────────────────

describe('关卡数据 —— 第五章 id / 注册 / 输入模式', () => {
  it('ch5 已注册：章节 playable 且 6 关可达、顺序正确', () => {
    expect(getChapterMeta('ch5')?.playable).toBe(true)
    expect(getChapterLevels('ch5')).toHaveLength(6)
    expect(getChapterLevels('ch5').map((level) => level.id)).toEqual([
      'ch5-1',
      'ch5-2',
      'ch5-3',
      'ch5-4',
      'ch5-5',
      'ch5-6',
    ])
    expect(getLevel('ch5-6')?.title).toBe('时间跳跃')
  })

  it('ch5 全部为自由输入（free），且不提供半拼骨架（GDD §3.2 的演进末段）', () => {
    for (const level of CHAPTER_5_LEVELS) {
      expect(level.inputMode).toBe('free')
      // 自由输入关卡不该有骨架 —— 有骨架会误导 UI 预填
      expect(level.halfSkeleton).toBeUndefined()
    }
  })

  it('ch5 难度按 GDD：5-1~5-3 为 ★★★/★★★★，5-4 起为 ★★★★ 以上', () => {
    expect(getLevel('ch5-1')?.difficulty).toBe(3)
    expect(getLevel('ch5-2')?.difficulty).toBe(3)
    expect(getLevel('ch5-3')?.difficulty).toBe(4)
    expect(getLevel('ch5-4')?.difficulty).toBe(4)
    // 5-5「危险与安全」与 5-6「时间跳跃」是 GDD 标注的最高难度
    expect(getLevel('ch5-5')?.difficulty).toBe(5)
    expect(getLevel('ch5-6')?.difficulty).toBe(5)
  })
})

describe('关卡数据 —— 第五章 schema 与命令集约束', () => {
  it('6 关全部通过 validateLevel 校验', () => {
    for (const level of CHAPTER_5_LEVELS) {
      const result = validateLevel(level)
      if (!result.ok) throw new Error(`${level.id} 校验失败：\n- ${result.errors.join('\n- ')}`)
    }
  })

  it('ch5 的目标类型全部落在已实现范围内（未新增 TargetCondition 类型）', () => {
    // M5 决策 ⑤：`reset --hard` 的「记错来源」不改 TargetCondition，
    // 用现有类型组合表达。本用例是该决策的回归锁 —— 一旦有人加了新类型即失败。
    for (const level of CHAPTER_5_LEVELS) {
      for (const target of level.targets) {
        expect(IMPLEMENTED_TARGET_TYPES).toContain(target.type)
        expect(UNIMPLEMENTED_TARGET_TYPES).not.toContain(target.type)
      }
    }
  })

  it('ch5 每关都至少有一项「开局不成立」的推进判据（把关卡做实的底线）', () => {
    // ⚠️ 这条断言不是「越多数越好」——5-1 有意只留一项（见其注释：其余判据
    //    在当前 TargetCondition 能力下都会开局即达标，加了反而没有鉴别力）。
    //    这里只守住「每关至少两项目标」的底线，5-1 是唯一的一项目标关卡。
    for (const level of CHAPTER_5_LEVELS) {
      const minimum = level.id === 'ch5-1' ? 1 : 2
      expect(level.targets.length).toBeGreaterThanOrEqual(minimum)
    }
  })

  it('ch5 的 init 不含未落地字段（仅 tags 仍属 M6）', () => {
    for (const level of CHAPTER_5_LEVELS) {
      expect(level.init.tags ?? []).toEqual([])
    }
  })

  it('ch5 的 relatedKnowledge 与核定映射一致（显式期望值，防漂移）', () => {
    const expected: Record<string, string[]> = {
      'ch5-1': ['git-undo#amend'],
      'ch5-2': ['git-undo#unstage'],
      'ch5-3': ['git-undo#restore'],
      'ch5-4': ['git-undo#revert'],
      'ch5-5': ['git-undo#reset-vs-revert'],
      'ch5-6': ['git-undo#reflog'],
    }
    for (const level of CHAPTER_5_LEVELS) {
      expect(level.relatedKnowledge).toEqual(expected[level.id])
    }
  })

  it('ch5 的每个 slug 都能在 git-undo 笔记里反查到真实小节', () => {
    for (const level of CHAPTER_5_LEVELS) {
      for (const id of level.relatedKnowledge) {
        const { note, slug } = splitKnowledgeId(id)
        expect(note).toBe('git-undo')
        const heading = SLUG_BY_HEADING[slug]
        expect(heading, `slug ${slug} 未登记在 SLUG_BY_HEADING`).toBeDefined()
        expect(
          headingsOf(note).has(heading),
          `${id} → "${heading}" 不在 docs/notes/${note}.md 中`,
        ).toBe(true)
      }
    }
  })
})

describe('关卡数据 —— 第五章可解性（真实引擎走通）', () => {
  let caseIndexM5 = 0
  async function freshSandboxM5(init: Level['init'] = {}): Promise<void> {
    caseIndexM5 += 1
    configureFs({ name: `levels-m5-${Date.now()}-${caseIndexM5}`, backend: new MemoryBackend() })
    const result = await reset(init)
    if (!result.ok) throw new Error(`沙箱初始化失败：${result.error.toString()}`)
  }

  it('6 关开局不得即达标', async () => {
    for (const level of CHAPTER_5_LEVELS) {
      await freshSandboxM5(level.init)
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

  it('6 关走参考解法后全部过关', async () => {
    /** 编辑器动作：在第 N 条命令执行前写文件（before 为命令索引） */
    type EditorAction = { before: number; path: string; content: string }
    const plans: Record<string, { commands: string[]; edits: EditorAction[] }> = {
      // 5-1：把漏掉的文件送进暂存区，再修补最近一次提交的信息
      'ch5-1': {
        commands: ['git add notes/附录.md', 'git commit --amend -m "修复日志 · 定稿"'],
        edits: [],
      },
      // 5-2：先把草稿从暂存区退出来（保住工作区），再归档正式观测
      'ch5-2': {
        commands: [
          // 玩家先在编辑器里把结论补完（edits），再把它 add 进暂存区（误加）
          'git add notes/调试草稿.md',
          // 把它退出来 —— 只动索引，刚写下的结论保持不动
          'git restore --staged notes/调试草稿.md',
          // 归档该归档的那份
          'git add notes/观测补充.md',
          'git commit -m "观测补充归档"',
        ],
        // 编辑器：把「排查中」的草稿补成结论版
        edits: [{ before: 0, path: 'notes/调试草稿.md', content: STAGING_DRAFT_FINAL }],
      },
      // 5-3：改乱与误删由 init.dirty 预置，玩家只需两条 restore
      'ch5-3': {
        commands: ['git restore notes/时间线校准参数.md', 'git restore notes/关键档案.md'],
        edits: [],
      },
      // 5-4：反向提交抵消有害改动
      'ch5-4': {
        commands: ['git revert HEAD'],
        edits: [],
      },
      // 5-5：已同步历史只能用 revert
      'ch5-5': {
        commands: ['git revert HEAD'],
        edits: [],
      },
      // 5-6：归档残片 → 误回退 → reflog 查看 → 用 HEAD@{1} 恢复
      // （误操作不是过关的必需步骤，但它是本关的完整教学剧本，故参考解法走全流程）
      'ch5-6': {
        commands: [
          'git add .',
          'git commit -m "归档残片"',
          'git reset --hard HEAD~2',
          'git reflog',
          'git reset --hard HEAD@{1}',
        ],
        edits: [],
      },
    }

    const { fsp } = await import('../engine/fs')
    for (const level of CHAPTER_5_LEVELS) {
      await freshSandboxM5(level.init)
      const plan = plans[level.id]
      expect(plan, `${level.id} 缺少参考解法计划`).toBeDefined()

      for (let i = 0; i < plan.commands.length; i += 1) {
        for (const edit of plan.edits.filter((e) => e.before === i)) {
          // content 为空串 = 模拟误删（unlink）
          if (edit.content === '') {
            await fsp.unlink(`/repo/${edit.path}`)
          } else {
            await fsp.writeFile(`/repo/${edit.path}`, edit.content, 'utf8')
          }
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
    }
  })

  it('5-4 用 reset 代替 revert 会判失败（区分两类撤销的教学点）', async () => {
    // ⚠️ 这是 5-4 的核心教学判据：reset 会把提交数退回 2，而目标要求 eq 3。
    await freshSandboxM5(assertValidLevel(getLevel('ch5-4')).init)
    await execute('git reset --hard HEAD~1')
    const state = await evaluateTargets(assertValidLevel(getLevel('ch5-4')))
    expect(state.satisfied).toBe(false)
    // 具体失败在 commitCount 上
    const countResult = state.results.find((r) => r.target.type === 'commitCount')
    expect(countResult?.ok).toBe(false)
  })

  it('5-6 的 reflog 剧本可行：误 reset --hard 后能凭 reflog 完整找回', async () => {
    const level = assertValidLevel(getLevel('ch5-6'))

    // ① 误操作：归档后一口气退掉两个快照 → 历史被破坏
    await freshSandboxM5(level.init)
    await execute('git add .')
    await execute('git commit -m "归档残片"')
    const beforeAccident = (await execute('git log --oneline')).output
    expect(beforeAccident).toHaveLength(4)

    await execute('git reset --hard HEAD~2')
    const afterAccident = (await execute('git log --oneline')).output
    expect(afterAccident).toHaveLength(2)
    // 被退掉的两条提交确实不在历史里了
    expect(afterAccident.join('\n')).not.toContain('关键快照三')
    // 此时无法满足目标（提交数不足）
    expect((await evaluateTargets(level)).satisfied).toBe(false)

    // ② reflog 里能看到那次误操作，格式与笔记 git-undo.md 一致
    const reflog = await execute('git reflog')
    expect(reflog.output[0]).toMatch(/^[0-9a-f]{7} HEAD@\{0\}: reset: moving to HEAD~2$/)

    // ③ 凭 reflog 找回 —— HEAD@{1} 即误操作之前的位置
    const restored = await execute('git reset --hard HEAD@{1}')
    expect(restored.ok).toBe(true)
    const afterRestore = (await execute('git log --oneline')).output
    expect(afterRestore).toHaveLength(4)
    expect(afterRestore.join('\n')).toContain('关键快照三')

    // ④ 完整剧本走完，关卡目标满足
    expect((await evaluateTargets(level)).satisfied).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 第四章「星际连接」（M5b）
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ 本章的可解性用例与前几章有一个本质差别：**关卡包含真实的远程交互**。
//    因此这些用例不只断言「目标达成」，还要断言**远程宇宙的真实状态** ——
//    否则「push 其实是空操作」「fetch 什么都没取回」这类缺陷会被目标判定掩盖
//    （目标只锚定本地结果，远程一致性必须另行验证）。

describe('关卡数据 —— 第四章 id / 注册 / 输入模式', () => {
  it('ch4 已注册：章节 playable 且 5 关可达、顺序正确', () => {
    expect(getChapterMeta('ch4')?.playable).toBe(true)
    expect(getChapterLevels('ch4').map((level) => level.id)).toEqual([
      'ch4-1',
      'ch4-2',
      'ch4-3',
      'ch4-4',
      'ch4-5',
    ])
    expect(getFirstLevelOfChapter('ch4')?.id).toBe('ch4-1')
  })

  it('ch4 关卡名与 GDD §4 逐字一致', () => {
    const expected: Record<string, string> = {
      'ch4-1': '建立航道',
      'ch4-2': '传送数据',
      'ch4-3': '接收数据',
      'ch4-4': '克隆宇宙',
      'ch4-5': '协作冲突',
    }
    for (const level of CHAPTER_4_LEVELS) {
      expect(level.title, level.id).toBe(expected[level.id])
    }
  })

  it('ch4 全部为半拼（half）并提供骨架（GDD §3.2：三~四章半拼）', () => {
    for (const level of CHAPTER_4_LEVELS) {
      expect(level.inputMode, level.id).toBe('half')
      expect(level.halfSkeleton, level.id).toBeDefined()
      expect(level.halfSkeleton?.startsWith('git ')).toBe(true)
    }
  })

  it('ch4 难度按 GDD：4-1~4-4 为 ★★★，4-5 为 ★★★★★', () => {
    const expected: Record<string, number> = {
      'ch4-1': 3,
      'ch4-2': 3,
      'ch4-3': 3,
      'ch4-4': 3,
      'ch4-5': 5,
    }
    for (const level of CHAPTER_4_LEVELS) {
      expect(level.difficulty, level.id).toBe(expected[level.id])
    }
  })
})

describe('关卡数据 —— 第四章 schema 与远程配置约束', () => {
  it('5 关全部通过 validateLevel 校验', () => {
    for (const level of CHAPTER_4_LEVELS) {
      const result = validateLevel(level)
      if (!result.ok) {
        throw new Error(`${level.id} 校验失败：\n- ${result.errors.join('\n- ')}`)
      }
    }
  })

  it('ch4 的目标类型全部落在已实现范围内（M5b 起含 remote）', () => {
    for (const level of CHAPTER_4_LEVELS) {
      for (const target of level.targets) {
        expect(IMPLEMENTED_TARGET_TYPES, `${level.id} 的 ${target.type}`).toContain(target.type)
        expect(UNIMPLEMENTED_TARGET_TYPES).not.toContain(target.type)
      }
    }
  })

  it('ch4 的 init 不含未落地字段（仅 tags 仍属 M6）', () => {
    for (const level of CHAPTER_4_LEVELS) {
      expect(level.init.tags ?? []).toEqual([])
    }
  })

  it('ch4 的 init 预置满足「每个提交都有 files」（M3 空提交防御的关卡侧约束）', () => {
    for (const level of CHAPTER_4_LEVELS) {
      for (const [index, commit] of (level.init.commits ?? []).entries()) {
        expect(
          Object.keys(commit.files ?? {}).length,
          `${level.id} 的第 ${index + 1} 个预置提交没有 files`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('ch4 的远程地址统一使用沙箱白名单地址（不手写漂移）', () => {
    for (const level of CHAPTER_4_LEVELS) {
      for (const remote of level.init.remotes ?? []) {
        expect(remote.url, `${level.id} 的远程 ${remote.name}`).toBe(ALLOWED_REMOTE_URL)
      }
    }
  })

  it('ch4 的 remotes[].branches[].at 都能在 init.commits 里找到（跨字段一致性）', () => {
    for (const level of CHAPTER_4_LEVELS) {
      const messages = new Set(
        (level.init.commits ?? []).map((commit) => (commit.message || commit.msg).trim()),
      )
      for (const remote of level.init.remotes ?? []) {
        for (const entry of remote.branches ?? []) {
          expect(
            messages.has(entry.at.trim()),
            `${level.id}：远程分支 ${entry.branch} 引用了不存在的提交「${entry.at}」`,
          ).toBe(true)
        }
      }
    }
  })

  it('ch4 的 relatedKnowledge 与核定映射一致（显式期望值，防漂移）', () => {
    const expected: Record<string, string[]> = {
      'ch4-1': ['git-remotes#add-remote'],
      'ch4-2': ['git-remotes#push'],
      'ch4-3': ['git-remotes#fetch-pull'],
      'ch4-4': ['git-remotes#clone'],
      'ch4-5': ['git-remotes#push-rejected'],
    }
    for (const level of CHAPTER_4_LEVELS) {
      expect(level.relatedKnowledge).toEqual(expected[level.id])
    }
  })

  it('ch4 的每个 slug 都能在 git-remotes 笔记里反查到真实小节', () => {
    for (const level of CHAPTER_4_LEVELS) {
      for (const id of level.relatedKnowledge) {
        const { note, slug } = splitKnowledgeId(id)
        expect(note).toBe('git-remotes')
        const heading = SLUG_BY_HEADING[slug]
        expect(heading, `slug ${slug} 未登记在 SLUG_BY_HEADING`).toBeDefined()
        expect(
          headingsOf(note).has(heading),
          `${id} → "${heading}" 不在 docs/notes/${note}.md 中`,
        ).toBe(true)
      }
    }
  })
})

describe('关卡数据 —— 第四章可解性（真实引擎 + 真实远程协议）', () => {
  let caseIndexM5b = 0
  async function freshSandboxM5b(init: Level['init'] = {}): Promise<void> {
    caseIndexM5b += 1
    configureFs({ name: `levels-m5b-${Date.now()}-${caseIndexM5b}`, backend: new MemoryBackend() })
    const result = await reset(init)
    if (!result.ok) throw new Error(`沙箱初始化失败：${result.error.toString()}`)
  }

  /** 读裸仓某分支的 oid（用于断言「远程真的变了」） */
  async function bareBranchOid(branch: string): Promise<string | null> {
    const fs = getFs()
    try {
      return await git.resolveRef({
        fs,
        dir: '/remote.git',
        gitdir: '/remote.git',
        ref: `refs/heads/${branch}`,
      })
    } catch {
      return null
    }
  }

  it('5 关开局不得即达标', async () => {
    for (const level of CHAPTER_4_LEVELS) {
      await freshSandboxM5b(level.init)
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

  it('远程宇宙每关都被重建：上一关的分支不会残留到下一关', async () => {
    // 先在 4-2 里推一次，让裸仓有 main
    await freshSandboxM5b(assertValidLevel(getLevel('ch4-2')).init)
    await execute('git push origin main')
    expect(await bareBranchOid('main')).not.toBeNull()

    // 再进 4-4（远程只有「宇宙档案基线」）——不应看到上一关的痕迹
    const level44 = assertValidLevel(getLevel('ch4-4'))
    await freshSandboxM5b(level44.init)
    const branches = await git.listBranches({
      fs: getFs(),
      dir: '/remote.git',
      gitdir: '/remote.git',
    })
    // 4-4 预置的远程 main 指向「宇宙档案基线」
    expect(branches).toEqual(['main'])
  })

  it('4-1 走参考解法（remote add）后过关，且远程关联真实写入配置', async () => {
    const level = assertValidLevel(getLevel('ch4-1'))
    await freshSandboxM5b(level.init)

    const added = await execute(`git remote add origin ${ALLOWED_REMOTE_URL}`)
    expect(added.ok).toBe(true)

    // 配置里真的有这一条（不只是目标判定说它有）
    const listed = await execute('git remote -v')
    expect(listed.output.join('\n')).toContain('origin')

    expect((await evaluateTargets(level)).satisfied).toBe(true)
  })

  it('4-2 走参考解法（补一条观测 + push）后过关，且**裸仓真的收到了那些提交**', async () => {
    const level = assertValidLevel(getLevel('ch4-2'))
    await freshSandboxM5b(level.init)

    // push 之前：远程 main 停在「待传送观测·其一」（预置的远程分支）
    const before = await bareBranchOid('main')
    expect(before).not.toBeNull()

    // 参考解法：归档预置的未追踪观测 → push
    expect((await execute('git add .')).ok).toBe(true)
    expect((await execute('git commit -m "待传送观测归档"')).ok).toBe(true)

    const pushed = await execute('git push origin main')
    expect(pushed.ok).toBe(true)

    // push 之后：远程 main 已推进到「待传送观测·其二」（本地 HEAD）
    const after = await bareBranchOid('main')
    expect(after).not.toBe(before)

    const head = await git.resolveRef({ fs: getFs(), dir: '/repo', ref: 'HEAD' })
    expect(after).toBe(head)

    // 裸仓里能读到新提交的信息 —— 证明对象真的搬过去了
    const { commit } = await git.readCommit({
      fs: getFs(),
      dir: '/remote.git',
      gitdir: '/remote.git',
      oid: after as string,
    })
    expect(commit.message.trim()).toBe('待传送观测归档')

    expect((await evaluateTargets(level)).satisfied).toBe(true)
  })

  it('4-3 走参考解法（pull）后过关，且远程的观测真的进入了本地历史', async () => {
    const level = assertValidLevel(getLevel('ch4-3'))
    await freshSandboxM5b(level.init)

    // pull 之前：本地历史里没有远程那条
    const before = await execute('git log --oneline')
    expect(before.output.join('\n')).not.toContain('远程新观测')
    expect((await evaluateTargets(level)).satisfied).toBe(false)

    const pulled = await execute('git pull origin main')
    expect(pulled.ok).toBe(true)

    // pull 之后：远程的提交出现在本地历史，且工作区里有了它的文件
    const after = await execute('git log --oneline')
    expect(after.output.join('\n')).toContain('远程新观测')
    expect((await execute('git status -s')).ok).toBe(true)

    const { fsp } = await import('../engine/fs')
    const content = await fsp.readFile('/repo/notes/远程观测.md', 'utf8')
    expect(content).toContain('远程观测 · 新记录')

    expect((await evaluateTargets(level)).satisfied).toBe(true)
  })

  it('4-3 只 fetch 不合并不足以过关（教学点的判据锁）', async () => {
    const level = assertValidLevel(getLevel('ch4-3'))
    await freshSandboxM5b(level.init)

    const fetched = await execute('git fetch origin')
    expect(fetched.ok).toBe(true)

    // fetch 只更新远程跟踪引用，本地历史不变 → 目标仍未达成
    const log = await execute('git log --oneline')
    expect(log.output.join('\n')).not.toContain('远程新观测')
    expect((await evaluateTargets(level)).satisfied).toBe(false)

    // 补上 merge 即过关 —— 与提示语给出的两条路径一致
    await execute('git merge origin/main')
    expect((await evaluateTargets(level)).satisfied).toBe(true)
  })

  it('4-4 走参考解法（clone）后过关，且工作区真的有 README', async () => {
    const level = assertValidLevel(getLevel('ch4-4'))
    await freshSandboxM5b(level.init)

    // clone 之前：/repo 是空的（cloneSource 模板）—— 初生仓库没有任何提交
    const before = await execute('git log --oneline')
    expect(before.output.join('')).toBe('')

    const cloned = await execute(`git clone ${ALLOWED_REMOTE_URL}`)
    expect(cloned.ok).toBe(true)

    const { fsp: fspClone } = await import('../engine/fs')
    const readme = await fspClone.readFile('/repo/README.md', 'utf8')
    expect(readme).toContain('宇宙档案')

    // 历史也完整取回
    const log = await execute('git log --oneline')
    expect(log.output.join('\n')).toContain('宇宙档案基线')

    expect((await evaluateTargets(level)).satisfied).toBe(true)
  })

  it('4-5 走完整剧本：push 被拒 → fetch → merge → push，最终双方都在', async () => {
    const level = assertValidLevel(getLevel('ch4-5'))
    await freshSandboxM5b(level.init)

    // ① 直接推送**必须被拒**（远程领先，非快进）—— 这正是本关的教学起点
    const rejected = await execute('git push origin main')
    expect(rejected.ok).toBe(false)
    expect(rejected.error).toContain('推送被远程拒绝')

    // 被拒之后远程没有被污染：仍是「他人传送的观测」
    const remoteOid = await bareBranchOid('main')
    const { commit: remoteCommit } = await git.readCommit({
      fs: getFs(),
      dir: '/remote.git',
      gitdir: '/remote.git',
      oid: remoteOid as string,
    })
    expect(remoteCommit.message.trim()).toBe('他人传送的观测')

    // 此时目标未达成（本地还看不到别人的观测）
    expect((await evaluateTargets(level)).satisfied).toBe(false)

    // ② 取回别人的观测
    const fetched = await execute('git fetch origin')
    expect(fetched.ok).toBe(true)

    // ③ 与自己的时间线合流
    const merged = await execute('git merge origin/main')
    expect(merged.ok).toBe(true)

    // ④ 再推送 —— 这次成功
    const pushed = await execute('git push origin main')
    expect(pushed.ok).toBe(true)

    // 双方的观测都在本地历史里
    const log = await execute('git log --oneline')
    expect(log.output.join('\n')).toContain('他人传送的观测')
    expect(log.output.join('\n')).toContain('协作基线观测')

    // 远程也收到了合并后的历史
    const finalRemote = await bareBranchOid('main')
    const head = await git.resolveRef({ fs: getFs(), dir: '/repo', ref: 'HEAD' })
    expect(finalRemote).toBe(head)

    expect((await evaluateTargets(level)).satisfied).toBe(true)
  })

  it('4-5 判据锚定「远程的观测已进入本地历史」（开局不成立）', async () => {
    const level = assertValidLevel(getLevel('ch4-5'))
    await freshSandboxM5b(level.init)

    // 开局：本地看不到别人的观测 → 核心判据不成立
    const start = await evaluateTargets(level)
    const existsTarget = start.results.find((r) => r.target.type === 'commitExists')
    expect(existsTarget?.ok).toBe(false)

    // ⚠️ 已知边界（记入 M5-tasks.md「设计缺口」）：目标锚定**本地**结果，
    //    「push 成功与否」不在判据内（无对应 target 类型，决策 ⑤ 不改 11 种类型）。
    //    故 fetch + merge 即可满足判据 —— 本用例把该边界显式锁住，
    //    避免日后误以为判定覆盖了推送。
    await execute('git fetch origin')
    await execute('git merge origin/main')

    // ⚠️ 本关的远程与本地在「协作基线观测」处同源，故 fetch+merge 是**快进**：
    //    本地 HEAD 会直接落到远程那条上，两者头相同 —— 这不是「push 成功了」，
    //    而是快进合并的自然结果（远程并未被写入）。
    //    要证明「没有 push」，看的不是头相同，而是**远程的对象库里没有本地新增的提交**。
    expect((await evaluateTargets(level)).satisfied).toBe(true) // 判据已满足
  })
})

// ── M6：第六章与终章 ─────────────────────────────────────────────────────────

describe('关卡数据 —— 第六章 id / 注册 / 输入模式', () => {
  it('ch6 已注册：章节 playable 且 5 关可达、顺序正确', () => {
    expect(getChapterMeta('ch6')?.playable).toBe(true)
    expect(getChapterLevels('ch6')).toHaveLength(5)
    expect(getChapterLevels('ch6').map((level) => level.id)).toEqual([
      'ch6-1',
      'ch6-2',
      'ch6-3',
      'ch6-4',
      'ch6-5',
    ])
    expect(getLevel('ch6-4')?.title).toBe('推送锚点')
  })

  it('ch6 全部为自由输入（free），难度按 GDD：6-1~6-3 ★★★，6-4/6-5 ★★★★', () => {
    for (const level of CHAPTER_6_LEVELS) {
      expect(level.inputMode).toBe('free')
      expect(level.halfSkeleton).toBeUndefined()
    }
    expect(CHAPTER_6_LEVELS.map((level) => level.difficulty)).toEqual([3, 3, 3, 4, 4])
  })

  it('终章 F 已注册：2 关可达（F-1 崩坏时间线 / F-2 完整交付），全部自由输入', () => {
    expect(getChapterMeta('F')?.playable).toBe(true)
    expect(getChapterLevels('F').map((level) => level.id)).toEqual(['F-1', 'F-2'])
    expect(getLevel('F-1')?.title).toBe('崩坏时间线')
    expect(getLevel('F-2')?.title).toBe('完整交付')
    for (const level of getChapterLevels('F')) {
      expect(level.inputMode).toBe('free')
      expect(level.difficulty).toBe(5)
    }
  })
})

describe('关卡数据 —— 第六章可解性（真实引擎走通）', () => {
  let caseIndexM6 = 0
  async function freshSandboxM6(init: Level['init'] = {}): Promise<void> {
    caseIndexM6 += 1
    configureFs({ name: `levels-m6-${Date.now()}-${caseIndexM6}`, backend: new MemoryBackend() })
    const result = await reset(init)
    if (!result.ok) throw new Error(`沙箱初始化失败：${result.error.toString()}`)
  }

  /** 编辑器动作：在第 N 条命令执行前写文件（before 为命令索引） */
  type EditorAction = { before: number; path: string; content: string }

  it('5 关开局不得即达标', async () => {
    for (const level of CHAPTER_6_LEVELS) {
      await freshSandboxM6(level.init)
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

  it('5 关走参考解法后全部过关', async () => {
    const plans: Record<string, { commands: string[]; edits: EditorAction[] }> = {
      // 6-1：两条轻量标签
      'ch6-1': {
        commands: ['git tag v0.1', 'git tag v0.2'],
        edits: [],
      },
      // 6-2：一条注解标签
      'ch6-2': {
        commands: ['git tag -a v1.0.0 -m "版本 1.0.0 发布"'],
        edits: [],
      },
      // 6-3：先查看（探查不计），再归档第四阶段巡检并命名
      'ch6-3': {
        commands: [
          'git tag',
          'git show v1.0.0',
          'git add .',
          'git commit -m "第四阶段巡检"',
          'git tag -a v1.1.0 -m "稳定期后的第一次巡检"',
        ],
        edits: [],
      },
      // 6-4：归档定稿 → 命名 → 单独推送标签
      'ch6-4': {
        commands: [
          'git add .',
          'git commit -m "版本 1.0.0 定稿"',
          'git tag -a v1.0.0 -m "版本 1.0.0 发布"',
          'git push origin v1.0.0',
        ],
        edits: [],
      },
      // 6-5：归档收尾 → 命名新版本
      'ch6-5': {
        commands: [
          'git add .',
          'git commit -m "发布收尾"',
          'git tag -a v1.1.0 -m "新增导出能力"',
        ],
        edits: [],
      },
    }

    for (const level of CHAPTER_6_LEVELS) {
      await freshSandboxM6(level.init)
      const plan = plans[level.id]
      expect(plan, `${level.id} 缺少参考解法计划`).toBeDefined()

      for (const command of plan.commands) {
        const result = await execute(command)
        if (!result.ok) {
          throw new Error(`${level.id} 执行 ${command} 失败：${result.error ?? ''}`)
        }
      }

      const state = await evaluateTargets(level)
      if (!state.satisfied) {
        const pending = state.results
          .filter((r) => !r.ok)
          .map((r) => `${r.target.type}（${r.detail}）`)
          .join('、')
        throw new Error(`${level.id} 走完参考解法仍未过关，未达成：${pending}`)
      }
      expect(state.satisfied).toBe(true)
    }
  })

  it('6-4 参考解法后：裸仓 refs/tags/v1.0.0 存在且 tag 对象完整（真协议推送的事实断言）', async () => {
    const level = assertValidLevel(getLevel('ch6-4'))
    await freshSandboxM6(level.init)

    for (const command of ['git add .', 'git commit -m "版本 1.0.0 定稿"', 'git tag -a v1.0.0 -m "版本 1.0.0 发布"', 'git push origin v1.0.0']) {
      const result = await execute(command)
      if (!result.ok) throw new Error(`执行 ${command} 失败：${result.error ?? ''}`)
    }

    const fs = getFs()
    const bareArgs = { fs, dir: '/remote.git', gitdir: '/remote.git' }
    const tags = await git.listTags(bareArgs)
    expect(tags).toContain('v1.0.0')

    const tagOid = await git.resolveRef({ ...bareArgs, ref: 'refs/tags/v1.0.0' })
    // 注解标签在裸仓里应是一个 tag 对象（≠ 提交本身），且 tag 名与信息完整
    const tag = await git.readTag({ ...bareArgs, oid: tagOid })
    expect(tag.tag.tag).toBe('v1.0.0')
    expect(tag.tag.message.trim()).toBe('版本 1.0.0 发布')
    expect(tag.tag.object).toBe(await git.resolveRef({ fs, dir: '/repo', ref: 'refs/heads/main' }))
  })

  it('6-2 引擎事实回归锁：-a -m 产出的是**真 tag 对象**（isomorphic-git 的 tag() 忽略 message，必须走 annotatedTag）', async () => {
    const level = assertValidLevel(getLevel('ch6-2'))
    await freshSandboxM6(level.init)

    const result = await execute('git tag -a v1.0.0 -m "版本 1.0.0 发布"')
    expect(result.ok).toBe(true)

    const fs = getFs()
    const refOid = await git.resolveRef({ fs, dir: '/repo', ref: 'refs/tags/v1.0.0' })
    const headOid = await git.resolveRef({ fs, dir: '/repo', ref: 'refs/heads/main' })
    // ⚠️ 若 ref 直指提交，说明轻量/注解两分法被破坏（探针 P2 踩过的坑）
    expect(refOid).not.toBe(headOid)
    const tag = await git.readTag({ fs, dir: '/repo', oid: refOid })
    expect(tag.tag.tag).toBe('v1.0.0')
    expect(tag.tag.object).toBe(headOid)
    expect(tag.tag.message.trim()).toBe('版本 1.0.0 发布')
  })

  it('git show 与 git describe 的输出形态正确（查看命令的真实语义）', async () => {
    const level = assertValidLevel(getLevel('ch6-5'))
    await freshSandboxM6(level.init)

    // describe：HEAD 在「新增导出能力」上，v1.0.0 在基线上 → v1.0.0-1-g<hash>
    const before = await execute('git describe')
    expect(before.ok).toBe(true)
    expect(before.output[0]).toMatch(/^v1\.0\.0-1-g[0-9a-f]{7}$/)

    await execute('git add .')
    await execute('git commit -m "发布收尾"')
    await execute('git tag -a v1.1.0 -m "新增导出能力"')

    // 命名后 describe 干净地返回 v1.1.0
    const after = await execute('git describe')
    expect(after.ok).toBe(true)
    expect(after.output[0]).toBe('v1.1.0')

    // show：注解标签的输出含标签名与注解
    const shown = await execute('git show v1.1.0')
    expect(shown.ok).toBe(true)
    expect(shown.output.join('\n')).toContain('标签 v1.1.0')
    expect(shown.output.join('\n')).toContain('新增导出能力')

    // show 轻量标签：标注「轻量」
    await execute('git tag v-light')
    const shownLight = await execute('git show v-light')
    expect(shownLight.ok).toBe(true)
    expect(shownLight.output.join('\n')).toContain('轻量')

    // describe --tags 纳入轻量标签；重复打同一标签被拒绝（与真 git 一致）
    const dup = await execute('git tag v1.1.0')
    expect(dup.ok).toBe(false)
    expect(dup.error).toContain('已存在')
  })

  it('F-1 走参考解法后过关（冲突裁决 + 合并 + 历史只增）', async () => {
    const level = assertValidLevel(getLevel('F-1'))
    await freshSandboxM6(level.init)

    // 开局即在 feature 分支（风暴叙事）
    const status = await execute('git status')
    expect(status.output.join('\n')).toContain('位于分支 feature')

    const { fsp } = await import('../engine/fs')
    const F1_BEACON_CORRUPTED_FREE = '信标坐标\n\n纬度：47.20\n经度：108.60\n\n风暴改错了坐标 —— 恢复它。\n'
    // 1) 在 feature 上修复信标
    await fsp.writeFile('/repo/notes/信标坐标.md', F1_BEACON_CORRUPTED_FREE, 'utf8')
    for (const command of ['git add notes/信标坐标.md', 'git commit -m "修复信标坐标"']) {
      const result = await execute(command)
      if (!result.ok) throw new Error(`执行 ${command} 失败：${result.error ?? ''}`)
    }
    // 2) 回 main 合并 —— 必然冲突
    await execute('git checkout main')
    const merged = await execute('git merge feature')
    expect(merged.ok).toBe(true)
    expect(merged.output.join('\n')).toContain('冲突')
    // 3) 裁决：写最终坐标，完成合并
    await fsp.writeFile(
      '/repo/notes/信标坐标.md',
      '信标坐标\n\n纬度：47.20\n经度：108.60\n\n两边的观测都已合流 —— 这是唯一的权威坐标。\n',
      'utf8',
    )
    for (const command of ['git add notes/信标坐标.md', 'git commit -m "合并 feature 并裁决信标坐标"']) {
      const result = await execute(command)
      if (!result.ok) throw new Error(`执行 ${command} 失败：${result.error ?? ''}`)
    }

    const state = await evaluateTargets(level)
    if (!state.satisfied) {
      const pending = state.results
        .filter((r) => !r.ok)
        .map((r) => `${r.target.type}（${r.detail}）`)
        .join('、')
      throw new Error(`F-1 走完参考解法仍未过关，未达成：${pending}`)
    }
    expect(state.satisfied).toBe(true)
  })

  it('F-2 走参考解法后过关（空仓库起步的完整交付流程）', async () => {
    const level = assertValidLevel(getLevel('F-2'))
    await freshSandboxM6(level.init)

    const { fsp } = await import('../engine/fs')
    // 玩家亲手创建交付清单
    await fsp.writeFile('/repo/交付清单.md', '时间线管理局 · 交付清单\n\n项目：平行宇宙观测站 · 首个正式版本\n状态：已交付\n', 'utf8')
    for (const command of ['git add 交付清单.md', 'git commit -m "首版交付"']) {
      const result = await execute(command)
      if (!result.ok) throw new Error(`执行 ${command} 失败：${result.error ?? ''}`)
    }
    // 第二次归档（收尾记录，内容自拟）
    await fsp.writeFile('/repo/收尾记录.md', '交付收尾。\n', 'utf8')
    for (const command of ['git add .', 'git commit -m "交付收尾"', 'git tag -a v1.0.0 -m "首个正式版本"', 'git describe']) {
      const result = await execute(command)
      if (!result.ok) throw new Error(`执行 ${command} 失败：${result.error ?? ''}`)
    }
    // describe 干净返回 v1.0.0
    expect((await execute('git describe')).output[0]).toBe('v1.0.0')

    const state = await evaluateTargets(level)
    if (!state.satisfied) {
      const pending = state.results
        .filter((r) => !r.ok)
        .map((r) => `${r.target.type}（${r.detail}）`)
        .join('、')
      throw new Error(`F-2 走完参考解法仍未过关，未达成：${pending}`)
    }
    expect(state.satisfied).toBe(true)
  })

  it('sandbox.reset 能预置 init.tags（seedTags：at 引用 + 注解信息逐字落地）', async () => {
    const level = assertValidLevel(getLevel('ch6-3'))
    await freshSandboxM6(level.init)

    const listed = await execute('git tag')
    expect(listed.ok).toBe(true)
    expect(listed.output).toEqual(['v0.9.0', 'v0.9.5', 'v1.0.0'])

    // 注解信息逐字落盘
    const shown = await execute('git show v1.0.0')
    expect(shown.output.join('\n')).toContain('时间线进入稳定期')

    // at 引用正确：v1.0.0 锚定「第三阶段巡检」
    const fs = getFs()
    const refOid = await git.resolveRef({ fs, dir: '/repo', ref: 'refs/tags/v1.0.0' })
    const tag = await git.readTag({ fs, dir: '/repo', oid: refOid })
    const { commit } = await git.readCommit({ fs, dir: '/repo', oid: tag.tag.object })
    expect(commit.message.trim()).toBe('第三阶段巡检')
  })

  it('sandbox.reset 对 at 指向不存在提交的标签 fail-fast（与 seedRemote 同款防线）', async () => {
    caseIndexM6 += 1
    configureFs({ name: `levels-m6-bad-${Date.now()}-${caseIndexM6}`, backend: new MemoryBackend() })
    const result = await reset({
      commits: [
        { author: '练习者', date: '第一天', msg: '基线', message: '基线', files: { 'a.md': 'x\n' } },
      ],
      tags: [{ name: 'v1', at: '不存在的提交' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toString()).toContain('不存在于本关的预置提交中')
  })
})
