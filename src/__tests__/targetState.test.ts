// 目标状态比对测试（development-refinement.md §11.1、§4.3）—— **真实用例**
//
// 被测对象：`game/validate/targetState.ts`（M2 只实现第一章用到的 5 种 `TargetCondition`）
// 与 `game/validate/stepHints.ts`（按失败次数解锁提示）。
//
// ⚠️ 本文件**不 mock gitApi**：全部断言跑在真实 LightningFS 内存实例 + 真实 git 对象库上
//    （照 `executor.test.ts` 的既有模式）。目标判定读的是仓库真实状态，用桩替换掉
//    就测不到「目录存在性」「CRLF 归一」这类只有真 fs 才暴露的行为。
//
// ⚠️ 后端注入与实例命名（见 `executor.test.ts` 文件头）：
//   `MemoryBackend` 实现的是 LightningFS **内层** `DefaultBackend` 的 `db` 契约，
//   必须经 `configureFs({ name, backend })` 注入；每个用例用**唯一实例名**，
//   否则 lightning-fs 的 superblock 会在实例间串味。
//
// ⚠️ 若干条用例是**回归锁**，注释里记了「当初错在哪」—— 删改前请先读注释，
//   它们是实测踩出来的，不是推测出来的。

import { beforeEach, describe, expect, it } from 'vitest'
import * as LightningFsNS from '@isomorphic-git/lightning-fs'
import { configureFs, fsp, type FsIdb } from '../engine/fs'
import { reset } from '../engine/sandbox'
import { execute } from '../game/command/executor'
import { evaluateTargets, isLevelComplete, readTargetContext } from '../game/validate/targetState'
import { getCurrentHint, getUnlockedHints, hintStateFor } from '../game/validate/stepHints'
import type { HintStep, TargetCondition } from '../game/types'

// ⚠️ 为什么不用 `import { MemoryBackend } from '@isomorphic-git/lightning-fs'`：
// 该包运行时确实导出了 `MemoryBackend`，但自带 `index.d.ts` 是 `export = FS` 的
// namespace 声明，未声明这个具名导出，直接命名导入会报 TS2305。
// 故经命名空间断言取值，并标注为 `FsIdb`（内层 `db` 契约）。
const MemoryBackend = (LightningFsNS as unknown as { MemoryBackend: new () => FsIdb }).MemoryBackend

/** 用例序号：与时间戳共同保证实例名唯一（单进程内多次调用也不会撞名） */
let caseIndex = 0

/** 新建一个干净的内存文件系统实例，并按 `init` 重建沙箱仓库 */
async function freshSandbox(init: Parameters<typeof reset>[0] = {}): Promise<void> {
  caseIndex += 1
  configureFs({ name: `target-${Date.now()}-${caseIndex}`, backend: new MemoryBackend() })
  const result = await reset(init)
  // 前置条件失败就没有必要继续 —— 否则后续断言会以「目标未达成」的假象出现
  if (!result.ok) throw new Error(`沙箱初始化失败：${result.error.toString()}`)
}

/** 在 `/repo` 工作区写入文本文件（自动创建缺失的父目录，对齐 sandbox 的做法） */
async function writeRepoFile(path: string, content: string): Promise<void> {
  const segments = path.split('/').filter((segment) => segment.length > 0)
  for (let i = 1; i < segments.length; i += 1) {
    const dir = `/${segments.slice(0, i).join('/')}`
    try {
      await fsp.mkdir(dir)
    } catch {
      // 目录已存在：忽略
    }
  }
  await fsp.writeFile(path, content, 'utf8')
}

/**
 * 走一遍真实的 add + commit（经 executor，不直接调 gitApi）。
 *
 * @param path 工作区路径，允许带 `/repo/` 前缀（本文件各处混用两种写法）。
 *             ⚠️ 传给 `git add` 的必须是**仓库内相对路径** —— 绝对路径会被底层
 *             拒为 `path should be a path.relative()d string`，故此处统一剥掉前缀。
 */
async function commitFile(path: string, content: string, message: string): Promise<void> {
  await writeRepoFile(path.startsWith('/') ? path : `/repo/${path}`, content)
  const relative = path.replace(/^\/repo\//, '').replace(/^\//, '')
  const add = await execute(`git add ${relative}`)
  if (!add.ok) throw new Error(`git add 失败：${add.error ?? ''}`)
  const commit = await execute(`git commit -m "${message}"`)
  if (!commit.ok) throw new Error(`git commit 失败：${commit.error ?? ''}`)
}

/** 便捷断言：单条条件是否达成 */
async function ok(target: TargetCondition): Promise<boolean> {
  return (await evaluateTargets([target])).satisfied
}

describe('targetState —— 文件与工作区（file / workdirClean）', () => {
  beforeEach(async () => {
    await freshSandbox()
  })

  it('file：文件存在且内容匹配时判定通过', async () => {
    await writeRepoFile('/repo/a.txt', 'hello\n')

    const state = await evaluateTargets([
      { type: 'file', path: 'a.txt', content: 'hello\n', exists: true },
    ])
    expect(state.satisfied).toBe(true)
    expect(state.remaining).toBe(0)
    expect(state.results[0].implemented).toBe(true)
    expect(state.results[0].detail).toContain('内容与预期一致')
  })

  it('file：只判存在性（未给 content）时内容无关紧要', async () => {
    await writeRepoFile('/repo/a.txt', '随便什么内容\n')

    expect(await ok({ type: 'file', path: 'a.txt', exists: true })).toBe(true)
    expect(await ok({ type: 'file', path: '不存在.txt', exists: true })).toBe(false)
  })

  it('file：内容不匹配（含首尾空白、大小写差异）时判定失败', async () => {
    await writeRepoFile('/repo/a.txt', 'hello\n')

    // 缺尾换行
    expect(await ok({ type: 'file', path: 'a.txt', content: 'hello', exists: true })).toBe(false)
    // 行首多一个空格 —— 首尾空白属**真实内容差异**，不归一
    expect(await ok({ type: 'file', path: 'a.txt', content: ' hello\n', exists: true })).toBe(false)
    // 大小写差异同理，严格比对
    expect(await ok({ type: 'file', path: 'a.txt', content: 'HELLO\n', exists: true })).toBe(false)
    // 对照组：只差行尾时仍应通过（见下一条用例）
    expect(await ok({ type: 'file', path: 'a.txt', content: 'hello\n', exists: true })).toBe(true)
  })

  it('file：行尾 CRLF 与 LF 视为相同（只归一行尾，别的一律严格）', async () => {
    // ⚠️ 回归锁：不做行尾归一，Windows 上玩家「明明改对了却过不了关」。
    //    只归一行尾是关键 —— 顺带把首尾空白也归一掉，就等于放过了真实的内容差异。
    await writeRepoFile('/repo/a.txt', 'hello\r\n')

    // 先确认工作区里确实是 CRLF（否则本条用例会退化成「测了个寂寞」）
    expect(await fsp.readFile('/repo/a.txt', 'utf8')).toBe('hello\r\n')

    expect(await ok({ type: 'file', path: 'a.txt', content: 'hello\n', exists: true })).toBe(true)
    // 方向反过来同样成立：CRLF 目标 对 LF 工作区
    await writeRepoFile('/repo/a.txt', 'hello\n')
    expect(await ok({ type: 'file', path: 'a.txt', content: 'hello\r\n', exists: true })).toBe(true)
  })

  it('file：exists:false 判「已移除」，与 exists:true 互为反面', async () => {
    await writeRepoFile('/repo/a.txt', 'x\n')

    expect(await ok({ type: 'file', path: 'a.txt', exists: false })).toBe(false)
    expect(await ok({ type: 'file', path: '从未存在.txt', exists: false })).toBe(true)

    const removed = await evaluateTargets([{ type: 'file', path: 'a.txt', exists: false }])
    expect(removed.results[0].detail).toContain('仍存在于工作区')
  })

  it('file：`.git` 这类**目录**必须能判定为存在（用 stat 而非 readFile）', async () => {
    // ⚠️⚠️ 本文件最有价值的回归锁。
    //   `reset()` 内部总是会 `git init`，故 `.git` 必然存在 —— 但这正是要害：
    //   实测 LightningFS 对**目录**调 `readFile` **不抛错，而是返回 `null`**，
    //   若拿 `readFile` 的结果判存在性，「目录存在」会被误判成「不存在」。
    //   实现因此改用 `stat`（见 targetState.ts 的 `pathExists`）。
    //   这里直接断言底层事实，让「别退回 readFile」这件事有据可依。
    expect(await fsp.readFile('/repo/.git', 'utf8')).toBeNull()
    expect((await fsp.stat('/repo/.git')).isDirectory()).toBe(true)

    expect(await ok({ type: 'file', path: '.git', exists: true })).toBe(true)
    expect(await ok({ type: 'file', path: '.git', exists: false })).toBe(false)
    expect(await ok({ type: 'file', path: 'nowhere.txt', exists: true })).toBe(false)
  })

  it('file：指定了 content 却指向目录时，报「不是可读取的文本文件」而非误判通过', async () => {
    const state = await evaluateTargets([
      { type: 'file', path: '.git', content: 'x', exists: true },
    ])
    expect(state.satisfied).toBe(false)
    expect(state.results[0].detail).toContain('不是可读取的文本文件')
  })

  it('workdirClean：初生仓库（无任何提交）判定为干净', async () => {
    // 空仓库里没有可提交的东西，「干净」成立 —— 不能因为无 HEAD 就判失败
    expect(await ok({ type: 'workdirClean', value: true })).toBe(true)
  })

  it('workdirClean：有未追踪 / 未暂存 / 已暂存内容时均判定为不干净', async () => {
    const target: TargetCondition = { type: 'workdirClean', value: true }

    // 未追踪
    await writeRepoFile('/repo/a.txt', 'x\n')
    expect(await ok(target)).toBe(false)

    // 已暂存但未提交 —— 暂存内容尚未归档，工作区仍不算干净
    await execute('git add .')
    expect(await ok(target)).toBe(false)

    // 提交后恢复干净
    await execute('git commit -m "归档 a.txt"')
    expect(await ok(target)).toBe(true)

    // 已暂存 + 工作区再次改写（未暂存）：两者都算「有待处理内容」
    await writeRepoFile('/repo/a.txt', '改过了\n')
    expect(await ok(target)).toBe(false)
  })

  it('workdirClean：value:false 要求「确实存在未归档内容」', async () => {
    expect(await ok({ type: 'workdirClean', value: false })).toBe(false)
    await writeRepoFile('/repo/a.txt', 'x\n')
    expect(await ok({ type: 'workdirClean', value: false })).toBe(true)
  })

  it('workdirClean：未达标时点名具体文件，且提示里不含命令（§9.1 不泄题）', async () => {
    await writeRepoFile('/repo/a.txt', 'x\n')
    await writeRepoFile('/repo/b.txt', 'y\n')

    const state = await evaluateTargets([{ type: 'workdirClean', value: true }])
    const { detail } = state.results[0]
    expect(detail).toContain('a.txt')
    expect(detail).toContain('b.txt')
    expect(detail).not.toContain('git ')
  })
})

describe('targetState —— 提交历史（commitCount / commitMessage / commitExists）', () => {
  it('commitCount：空仓库下 gte:0 与 eq:0 成立，gte:1 与 eq:1 不成立', async () => {
    await freshSandbox()

    expect(await ok({ type: 'commitCount', op: 'gte', value: 0 })).toBe(true)
    expect(await ok({ type: 'commitCount', op: 'eq', value: 0 })).toBe(true)
    expect(await ok({ type: 'commitCount', op: 'gte', value: 1 })).toBe(false)
    expect(await ok({ type: 'commitCount', op: 'eq', value: 1 })).toBe(false)
  })

  it('commitCount：1 次提交后 eq:1 成立、eq:2 不成立，gte 与 eq 分道扬镳', async () => {
    await freshSandbox()
    await commitFile('/repo/a.txt', '1\n', '第一次')

    expect(await ok({ type: 'commitCount', op: 'eq', value: 1 })).toBe(true)
    expect(await ok({ type: 'commitCount', op: 'eq', value: 2 })).toBe(false)
    expect(await ok({ type: 'commitCount', op: 'eq', value: 0 })).toBe(false)
    // `gte:1` 在「恰好 1 个」时成立 —— 这是 gte 与 eq 的关键差别
    expect(await ok({ type: 'commitCount', op: 'gte', value: 1 })).toBe(true)
    expect(await ok({ type: 'commitCount', op: 'gte', value: 2 })).toBe(false)
  })

  it('commitCount：2 次提交后 eq:1 不成立而 gte:1 仍成立', async () => {
    await freshSandbox()
    await commitFile('/repo/a.txt', '1\n', '第一次')
    await commitFile('/repo/b.txt', '2\n', '第二次')

    expect(await ok({ type: 'commitCount', op: 'eq', value: 1 })).toBe(false)
    expect(await ok({ type: 'commitCount', op: 'eq', value: 2 })).toBe(true)
    expect(await ok({ type: 'commitCount', op: 'gte', value: 1 })).toBe(true)
    expect(await ok({ type: 'commitCount', op: 'gte', value: 2 })).toBe(true)
    expect(await ok({ type: 'commitCount', op: 'gte', value: 3 })).toBe(false)
  })

  it('commitMessage：用正则匹配最近一次提交信息', async () => {
    await freshSandbox()

    // 无提交时先给一条可解释的未达成说明
    const empty = await evaluateTargets([{ type: 'commitMessage', match: /快照/ }])
    expect(empty.satisfied).toBe(false)
    expect(empty.results[0].detail).toContain('还没有任何快照')

    await commitFile('/repo/a.txt', '1\n', '第一次快照')
    expect(await ok({ type: 'commitMessage', match: /快照/ })).toBe(true)
    expect(await ok({ type: 'commitMessage', match: /^第一次快照$/ })).toBe(true)
    expect(await ok({ type: 'commitMessage', match: /不存在的词/ })).toBe(false)

    // 只看**最近一次**：再提交一条不含关键词的，前一条不应再让它成立
    await commitFile('/repo/b.txt', '2\n', '随后的一次改动')
    expect(await ok({ type: 'commitMessage', match: /快照/ })).toBe(false)
    expect(await ok({ type: 'commitMessage', match: /随后的一次改动/ })).toBe(true)
  })

  it('commitMessage：带 g / y 标志的正则**连续多次**判定结果必须一致', async () => {
    // ⚠️⚠️ 回归锁，且**只断言一次抓不到这个 bug**：
    //   带 `g` / `y` 的正则，`test()` 会把 `lastIndex` 留在正则对象上 —— 下一次
    //   对**同一输入**再测就会从上次位置继续，于是「同一条件时真时假」。
    //   目标数据里写 `/.../g` 极易发生（作者想表达「含该词」时很自然会加 g）。
    //   实现因此每次重新构造无状态正则；本用例必须**反复断言**才能锁住它。
    await freshSandbox()
    await commitFile('/repo/a.txt', '1\n', '第一次快照')

    const withG: TargetCondition = { type: 'commitMessage', match: /快照/g }
    for (let i = 0; i < 5; i += 1) {
      const state = await evaluateTargets([withG])
      expect(state.satisfied).toBe(true)
    }

    // 同一份正则对象复用、混入 g + y 也应稳定
    const withGY: TargetCondition = { type: 'commitMessage', match: /快照/gy }
    const withY: TargetCondition = { type: 'commitMessage', match: /快照/y }
    for (let i = 0; i < 5; i += 1) {
      expect(await ok(withGY)).toBe(true)
      expect(await ok(withY)).toBe(true)
    }

    // 对照：裸用带 g 的正则 test 确实会残留 lastIndex（说明上面不是空测）
    const raw = /快照/g
    expect([raw.test('第一次快照'), raw.test('第一次快照')]).toEqual([true, false])
  })

  it('commitExists：是**子串包含**，不是全等匹配', async () => {
    // ⚠️ 回归锁：提交信息通常长于目标给出的关键词（「第一环：链条起点」vs「第一环」），
    //   若按全等匹配，玩家「归档成功却过不了关」，且提示无法解释差在哪。
    await freshSandbox()
    await commitFile('/repo/a.txt', '1\n', '第一环：链条起点')

    expect(await ok({ type: 'commitExists', message: '第一环' })).toBe(true)
    // 完整信息同样成立（子串包含的超集情形）
    expect(await ok({ type: 'commitExists', message: '第一环：链条起点' })).toBe(true)
    expect(await ok({ type: 'commitExists', message: '第二环' })).toBe(false)
  })

  it('commitExists：在**全部**历史中查找，不限于最近一次', async () => {
    await freshSandbox()
    await commitFile('/repo/a.txt', '1\n', '第一环')
    await commitFile('/repo/b.txt', '2\n', '第二环')

    // 两条都查得到 —— 「第一环」已不是最近一次提交，仍须命中
    expect(await ok({ type: 'commitExists', message: '第一环' })).toBe(true)
    expect(await ok({ type: 'commitExists', message: '第二环' })).toBe(true)
    expect(await ok({ type: 'commitExists', message: '第三环' })).toBe(false)
  })

  it('空仓库下四种条件全部优雅返回，不抛错', async () => {
    await freshSandbox()

    const state = await evaluateTargets([
      { type: 'commitMessage', match: /快照/ },
      { type: 'commitExists', message: '第一环' },
      { type: 'workdirClean', value: true },
      { type: 'commitCount', op: 'gte', value: 0 },
    ])

    expect(state.results.map((result) => result.ok)).toEqual([false, false, true, true])
    expect(state.satisfied).toBe(false)
    expect(state.remaining).toBe(2)
    // 未达成项都要有面向玩家的中文说明，不能是空串
    for (const result of state.results) {
      expect(result.implemented).toBe(true)
      expect(result.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('targetState —— 尚未实现的类型（§14 明确报「尚未实现」而非静默通过）', () => {
  it('branch / headBranch / tag / merged / logOrder / remote 一律 ok:false 且 implemented:false', async () => {
    await freshSandbox()

    const unimplemented: TargetCondition[] = [
      { type: 'branch', name: 'dev', exists: true },
      { type: 'headBranch', name: 'main' },
      { type: 'tag', name: 'v1.0', exists: true },
      { type: 'merged', branch: 'dev', into: 'main' },
      { type: 'logOrder', order: ['a'], branch: 'main' },
      { type: 'remote', name: 'origin', hasRemote: true },
    ]

    const state = await evaluateTargets(unimplemented)

    expect(state.satisfied).toBe(false)
    expect(state.remaining).toBe(6)
    for (const [index, result] of state.results.entries()) {
      // 即便条件本身「看起来该成立」（如 headBranch 就是 main），也不能静默通过
      expect(result.implemented).toBe(false)
      expect(result.ok).toBe(false)
      expect(result.detail).toContain('尚未实现')
      expect(result.detail).toContain(unimplemented[index].type)
    }
  })

  it('与已实现条件混合时，未实现项会把整关拖成未达成', async () => {
    await freshSandbox()
    await commitFile('/repo/a.txt', '1\n', '第一次快照')

    const state = await evaluateTargets([
      { type: 'commitCount', op: 'gte', value: 1 },
      { type: 'tag', name: 'v1.0', exists: true },
    ])

    expect(state.results[0].ok).toBe(true)
    expect(state.results[1].ok).toBe(false)
    expect(state.satisfied).toBe(false)
    expect(state.remaining).toBe(1)
  })
})

describe('targetState —— 聚合判定', () => {
  beforeEach(async () => {
    await freshSandbox()
  })

  it('全部 TargetCondition 满足才算过关（任一失败即整体失败）', async () => {
    await commitFile('/repo/a.txt', 'hello\n', '初始化时间线')

    const allPass = await evaluateTargets([
      { type: 'commitCount', op: 'gte', value: 1 },
      { type: 'commitMessage', match: /初始化/ },
      { type: 'workdirClean', value: true },
      { type: 'file', path: 'a.txt', content: 'hello\n', exists: true },
    ])
    expect(allPass.satisfied).toBe(true)
    expect(allPass.remaining).toBe(0)

    // 只挑一条改坏，整体就必须失败
    const oneFails = await evaluateTargets([
      { type: 'commitCount', op: 'gte', value: 1 },
      { type: 'commitMessage', match: /初始化/ },
      { type: 'workdirClean', value: true },
      { type: 'file', path: 'a.txt', content: '内容对不上\n', exists: true },
    ])
    expect(oneFails.satisfied).toBe(false)
    expect(oneFails.remaining).toBe(1)

    // `isLevelComplete()` 是同一判定的便捷包装，不应出现两套口径
    expect(await isLevelComplete([{ type: 'commitCount', op: 'gte', value: 1 }])).toBe(true)
    expect(await isLevelComplete([{ type: 'commitCount', op: 'gte', value: 2 }])).toBe(false)
  })

  it('结果包含逐条件的达成明细，顺序与 targets 一致', async () => {
    await writeRepoFile('/repo/a.txt', 'hello\n')

    const targets: TargetCondition[] = [
      { type: 'file', path: 'a.txt', content: 'hello\n', exists: true },
      { type: 'commitCount', op: 'gte', value: 1 },
      { type: 'workdirClean', value: true },
    ]
    const state = await evaluateTargets(targets)

    expect(state.results).toHaveLength(targets.length)
    expect(state.results.map((result) => result.target)).toEqual(targets)
    for (const result of state.results) {
      // GoalPanel 需要 target（类型/路径）、ok（打勾）、detail（文案）、implemented（灰显）
      expect(result.target).toBeDefined()
      expect(typeof result.ok).toBe('boolean')
      expect(typeof result.implemented).toBe('boolean')
      expect(typeof result.detail).toBe('string')
    }
    expect(state.results.map((result) => result.ok)).toEqual([true, false, false])
  })

  it('接受 Level 对象或其 targets 数组，两种入参判定一致', async () => {
    await writeRepoFile('/repo/a.txt', 'hello\n')
    const targets: TargetCondition[] = [{ type: 'file', path: 'a.txt', exists: true }]

    const fromArray = await evaluateTargets(targets)
    const fromObject = await evaluateTargets({ targets })

    expect(fromArray.satisfied).toBe(fromObject.satisfied)
    expect(fromArray.results.map((result) => result.ok)).toEqual(
      fromObject.results.map((result) => result.ok),
    )
  })

  it('targets 为空数组时视为「无待判定条件」→ satisfied 为 true', async () => {
    // 记录既有语义：空目标集不会被判为「未达成」。
    // 关卡数据层面由 `schema.ts` 拦住「targets 为空」（一进关就过关），此处只如实反映实现。
    const state = await evaluateTargets([])
    expect(state.results).toEqual([])
    expect(state.remaining).toBe(0)
    expect(state.satisfied).toBe(true)
  })

  it('仓库不可读时收敛为「未达成」，不抛异常', async () => {
    // 指向不存在的目录：`readTargetContext` 应把执行层失败收成 status:null / 空提交，
    // 各判定函数按「未达成」处理 —— 而不是让异常冒到 UI 变成白屏。
    const context = await readTargetContext({ dir: '/nowhere' })
    expect(context.status).toBeNull()
    expect(context.commits).toEqual([])

    const state = await evaluateTargets([{ type: 'workdirClean', value: true }], { dir: '/nowhere' })
    expect(state.satisfied).toBe(false)
    expect(state.results[0].detail).toBe('无法读取仓库状态。')
  })
})

describe('stepHints —— 按失败次数解锁提示', () => {
  /** 三级提示：0 = 进关即可见，1 = 失败 1 次，3 = 失败 3 次 */
  const HINTS: HintStep[] = [
    { text: '方向提示', unlockAfterFailures: 0 },
    { text: '命令提示', unlockAfterFailures: 1 },
    { text: '完整答案', unlockAfterFailures: 3 },
  ]

  it('unlockAfterFailures 是「大于等于」阈值，0 表示进关即可见', async () => {
    const atZero = getUnlockedHints(HINTS, 0)
    expect(atZero.unlocked.map((hint) => hint.text)).toEqual(['方向提示'])
    expect(atZero.hasMore).toBe(true)
    expect(atZero.failuresUntilNext).toBe(1)

    // 恰好达到阈值即解锁（`>=`，非严格大于）
    const atOne = getUnlockedHints(HINTS, 1)
    expect(atOne.unlocked.map((hint) => hint.text)).toEqual(['方向提示', '命令提示'])
    expect(atOne.failuresUntilNext).toBe(2)

    const atThree = getUnlockedHints(HINTS, 3)
    expect(atThree.unlocked.map((hint) => hint.text)).toEqual(['方向提示', '命令提示', '完整答案'])
    expect(atThree.hasMore).toBe(false)
    expect(atThree.failuresUntilNext).toBeNull()
    // 最后一层标记为完整答案
    expect(atThree.unlocked.map((hint) => hint.isFinal)).toEqual([false, false, true])
  })

  it('未达阈值时保持锁定，失败次数停止增长后不再有新提示', async () => {
    expect(getUnlockedHints(HINTS, 2).unlocked).toHaveLength(2)
    expect(getUnlockedHints(HINTS, 99).unlocked).toHaveLength(3)

    const none = getUnlockedHints([{ text: '只有一条', unlockAfterFailures: 2 }], 0)
    expect(none.unlocked).toEqual([])
    expect(none.hasMore).toBe(true)
    expect(none.failuresUntilNext).toBe(2)
  })

  it('层级序号按关卡定义顺序，从 1 起', async () => {
    expect(getUnlockedHints(HINTS, 3).unlocked.map((hint) => hint.level)).toEqual([1, 2, 3])
    // 只解锁到第二条时，序号仍是 1、2（不因未解锁而跳号）
    expect(getUnlockedHints(HINTS, 1).unlocked.map((hint) => hint.level)).toEqual([1, 2])
  })

  it('负数与 NaN 都不会抛错（内部有 clamp）', async () => {
    // 失败次数理论上不会为负，但 UI 侧的计数可能因状态复位出现瞬时异常值；
    // 这里锁住「不抛异常 + 至少解开 0 阈值那条」这两条底线。
    for (const failures of [-5, -1, NaN, Infinity, -Infinity, 0.4]) {
      const state = getUnlockedHints(HINTS, failures)
      expect(state.unlocked.map((hint) => hint.text)).toEqual(['方向提示'])
      expect(state.hasMore).toBe(true)
    }

    // 小数向下取整：0.9 仍是「失败 0 次」
    expect(getUnlockedHints(HINTS, 0.9).unlocked).toHaveLength(1)
    expect(getUnlockedHints(HINTS, 1.9).unlocked).toHaveLength(2)
  })

  it('getCurrentHint 取最后一条已解锁的提示，未解锁任何提示时为 null', async () => {
    expect(getCurrentHint(HINTS, 0)?.text).toBe('方向提示')
    expect(getCurrentHint(HINTS, 1)?.text).toBe('命令提示')
    expect(getCurrentHint(HINTS, 3)?.text).toBe('完整答案')
    expect(getCurrentHint(HINTS, 100)?.text).toBe('完整答案')

    // 首条阈值 > 0 时，失败 0 次一条都拿不到
    expect(getCurrentHint([{ text: 'x', unlockAfterFailures: 2 }], 0)).toBeNull()
    // 空提示清单（schema 允许）不应抛错
    expect(getCurrentHint([], 5)).toBeNull()
  })

  it('hintStateFor 由关卡对象直接取提示状态', async () => {
    const state = hintStateFor({ hints: HINTS }, 1)
    expect(state.unlocked.map((hint) => hint.text)).toEqual(['方向提示', '命令提示'])
    expect(state.failuresUntilNext).toBe(2)
  })
})
