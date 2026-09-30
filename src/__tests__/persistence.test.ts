// 持久化单元测试（M5a，development-refinement.md §10）
//
// 覆盖两类必须成立的性质：
//   1. **往返一致**：写入 → 重新读取得到同一份数据（刷新浏览器后进度不丢的依据）；
//   2. **损坏数据安全降级**：手改 / 旧版本 / 非 JSON 的内容都不会抛异常，
//      而是退化为「空进度 / 默认设置」—— 抛出去会让 boot 中断、整页白屏。
//
// ⚠️ jsdom 自带 `localStorage`（`vite.config.ts` 的 `environment: 'jsdom'`），
//    故本文件无需额外垫片；`src/__tests__/setup.ts` 里的 fake-indexeddb 供
//    LightningFS 使用，与本模块无关。

import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS_KEY,
  DEFAULT_SETTINGS,
  PROGRESS_KEY,
  SETTINGS_KEY,
  clearAll,
  hasProgress,
  loadAchievements,
  loadProgress,
  loadSettings,
  saveAchievements,
  saveProgress,
  saveSettings,
} from '../persistence/progress'
import {
  ACTIVE_LEVEL_KEY,
  clearActiveLevel,
  clearSnapshot,
  exportSnapshot,
  hasSnapshot,
  importSnapshot,
  loadActiveLevel,
  saveActiveLevel,
} from '../persistence/snapshot'
import { hasSavedProgress, resumeInterruptedLevel } from '../persistence/boot'
import { useProgressStore } from '../store/progressStore'
import { useSessionStore } from '../store/sessionStore'

/** 直接往 storage 里塞原始字符串（模拟被手改 / 旧版本写坏的数据） */
function putRaw(key: string, value: string): void {
  localStorage.setItem(key, value)
}

beforeEach(() => {
  localStorage.clear()
  useProgressStore.getState().resetProgress()
})

describe('persistence/progress —— 键约定与往返', () => {
  it('键名与 §10 的约定一致（版本化，便于将来迁移）', () => {
    expect(PROGRESS_KEY).toBe('gtp:progress:v1')
    expect(ACHIEVEMENTS_KEY).toBe('gtp:achievements:v1')
    expect(SETTINGS_KEY).toBe('gtp:settings:v1')
  })

  it('进度写入后能原样读回', () => {
    const records = {
      'ch1-1': { score: 100, stars: 3, cleared: true },
      'ch1-2': { score: 80, stars: 2, cleared: true },
      'ch2-1': { score: 0, stars: 0, cleared: false },
    }
    expect(saveProgress(records)).toBe(true)
    expect(loadProgress()).toEqual(records)
  })

  it('无数据时返回空对象（不是 null / undefined）', () => {
    expect(loadProgress()).toEqual({})
    expect(loadAchievements()).toEqual([])
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('成就列表写入后能原样读回', () => {
    saveAchievements(['first-clear', 'no-hint'])
    expect(loadAchievements()).toEqual(['first-clear', 'no-hint'])
  })

  it('设置写入后能原样读回', () => {
    saveSettings({ hintsEnabled: false })
    expect(loadSettings()).toEqual({ hintsEnabled: false })
  })
})

describe('persistence/progress —— 损坏数据必须安全降级', () => {
  it('进度不是合法 JSON → 返回空对象且不抛异常', () => {
    putRaw(PROGRESS_KEY, '{这不是 JSON')
    expect(() => loadProgress()).not.toThrow()
    expect(loadProgress()).toEqual({})
  })

  it('进度是数组 / 字符串 / null → 返回空对象', () => {
    for (const raw of ['[]', '"文本"', 'null', '42']) {
      putRaw(PROGRESS_KEY, raw)
      expect(loadProgress()).toEqual({})
    }
  })

  it('单条记录结构不符 → 丢弃该条，保留其余合法记录（部分可用优于全丢）', () => {
    putRaw(
      PROGRESS_KEY,
      JSON.stringify({
        'ch1-1': { score: 100, stars: 3, cleared: true },
        'ch1-2': { score: '不是数字', stars: 3, cleared: true },
        'ch1-3': { stars: 3, cleared: true }, // 缺 score
        'ch1-4': { score: 90, stars: 2, cleared: '是' }, // cleared 非布尔
      }),
    )
    const records = loadProgress()
    expect(Object.keys(records)).toEqual(['ch1-1'])
    expect(records['ch1-1']).toEqual({ score: 100, stars: 3, cleared: true })
  })

  it('丢弃损坏条目后会回写一份干净的（避免坏数据反复出现）', () => {
    putRaw(
      PROGRESS_KEY,
      JSON.stringify({ 'ch1-1': { score: 100, stars: 3, cleared: true }, bad: 'xxx' }),
    )
    loadProgress()
    const reparsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) as string)
    expect(Object.keys(reparsed)).toEqual(['ch1-1'])
  })

  it('成就不是数组 → 返回空数组；数组里的非字符串被过滤', () => {
    putRaw(ACHIEVEMENTS_KEY, '{"a":1}')
    expect(loadAchievements()).toEqual([])

    putRaw(ACHIEVEMENTS_KEY, JSON.stringify(['ok', 42, null, 'also-ok']))
    expect(loadAchievements()).toEqual(['ok', 'also-ok'])
  })

  it('设置损坏或缺字段 → 用默认值补齐（前向兼容）', () => {
    putRaw(SETTINGS_KEY, '不是 JSON')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)

    // 旧版本数据缺字段：补齐而不是崩
    putRaw(SETTINGS_KEY, JSON.stringify({}))
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)

    // 类型不符：回落默认值
    putRaw(SETTINGS_KEY, JSON.stringify({ hintsEnabled: 'yes' }))
    expect(loadSettings().hintsEnabled).toBe(DEFAULT_SETTINGS.hintsEnabled)
  })
})

describe('persistence/progress —— storage 不可用时静默降级', () => {
  it('localStorage 抛错时读写都不抛异常（隐私模式 / 配额）', () => {
    // ⚠️ 必须直接替换 `globalThis.localStorage` 而不是 spy `Storage.prototype`：
    //    测试环境的 localStorage 是 `setup.ts` 注入的**字面量对象**（方法为自有属性），
    //    走不到原型链，spy 原型对它无效（实测：断言会误判为「写入成功」）。
    const original = (globalThis as { localStorage?: Storage }).localStorage
    const throwing = {
      get length(): number {
        throw new Error('SecurityError')
      },
      key(): string | null {
        throw new Error('SecurityError')
      },
      getItem(): string | null {
        throw new Error('SecurityError')
      },
      setItem(): void {
        throw new Error('QuotaExceededError')
      },
      removeItem(): void {
        throw new Error('SecurityError')
      },
      clear(): void {
        throw new Error('SecurityError')
      },
    } as Storage

    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true })
    try {
      expect(() => saveProgress({ 'ch1-1': { score: 1, stars: 1, cleared: true } })).not.toThrow()
      expect(saveProgress({})).toBe(false)
      expect(() => saveAchievements(['x'])).not.toThrow()
      expect(saveAchievements(['x'])).toBe(false)
      expect(() => clearAll()).not.toThrow()
      // 读路径同样降级而不是抛错
      expect(loadProgress()).toEqual({})
      expect(loadAchievements()).toEqual([])
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
      expect(hasProgress()).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })

  it('完全没有 localStorage 时同样降级（SSR / 极端环境）', () => {
    const original = (globalThis as { localStorage?: Storage }).localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    try {
      expect(loadProgress()).toEqual({})
      expect(saveProgress({ a: { score: 1, stars: 1, cleared: true } })).toBe(false)
      expect(hasProgress()).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })
})

describe('persistence/progress —— hasProgress 的口径', () => {
  it('无记录 → false', () => {
    expect(hasProgress()).toBe(false)
  })

  it('只有「进过但没通关」的记录 → false（新玩家仍应看到 intro）', () => {
    saveProgress({ 'ch1-1': { score: 0, stars: 0, cleared: false } })
    expect(hasProgress()).toBe(false)
  })

  it('有任意一关通关 → true', () => {
    saveProgress({
      'ch1-1': { score: 0, stars: 0, cleared: false },
      'ch1-2': { score: 100, stars: 3, cleared: true },
    })
    expect(hasProgress()).toBe(true)
  })
})

describe('persistence/progress —— 与 progressStore 的接线', () => {
  it('setLevelRecord 会落盘，hydrate 能读回（模拟刷新浏览器）', () => {
    useProgressStore.getState().setLevelRecord('ch1-1', { score: 100, stars: 3, cleared: true })

    // 模拟「刷新」：清空内存态再 hydrate
    useProgressStore.setState({ levelRecords: {}, achievements: [] })
    expect(useProgressStore.getState().levelRecords).toEqual({})

    useProgressStore.getState().hydrate()
    expect(useProgressStore.getState().levelRecords['ch1-1']).toEqual({
      score: 100,
      stars: 3,
      cleared: true,
    })
  })

  it('unlockAchievement 会落盘，hydrate 能读回', () => {
    useProgressStore.getState().unlockAchievement('first-clear')
    useProgressStore.getState().unlockAchievement('first-clear') // 重复解锁不重复写
    expect(useProgressStore.getState().achievements).toEqual(['first-clear'])

    useProgressStore.setState({ achievements: [] })
    useProgressStore.getState().hydrate()
    expect(useProgressStore.getState().achievements).toEqual(['first-clear'])
  })

  it('resetProgress 同时清内存与持久化数据', () => {
    useProgressStore.getState().setLevelRecord('ch1-1', { score: 100, stars: 3, cleared: true })
    useProgressStore.getState().unlockAchievement('first-clear')

    useProgressStore.getState().resetProgress()

    expect(useProgressStore.getState().levelRecords).toEqual({})
    expect(useProgressStore.getState().achievements).toEqual([])
    expect(loadProgress()).toEqual({})
    expect(loadAchievements()).toEqual([])
  })

  it('hydrate 是幂等的（StrictMode 双跑安全）', () => {
    useProgressStore.getState().setLevelRecord('ch1-1', { score: 100, stars: 3, cleared: true })
    useProgressStore.getState().hydrate()
    useProgressStore.getState().hydrate()
    expect(Object.keys(useProgressStore.getState().levelRecords)).toEqual(['ch1-1'])
  })
})

describe('persistence/snapshot —— 存储命名约定', () => {
  it('快照库与对象仓库的键符合 §10 的 gtp: 前缀体系', async () => {
    const { SNAPSHOT_DB_NAME, SNAPSHOT_STORE } = await import('../persistence/snapshot')
    expect(SNAPSHOT_DB_NAME).toBe('gtp:snapshots:v1')
    expect(SNAPSHOT_STORE).toBe('snapshots')
  })
})

// ── M5a：刷新恢复（「自动恢复关卡中途进度」，用户裁定的产品口径）──────────

describe('persistence/snapshot —— 挂起关卡记录（刷新恢复的依据）', () => {
  it('写入后能读回', () => {
    saveActiveLevel('ch5-1')
    expect(loadActiveLevel()).toEqual({ levelId: 'ch5-1' })
  })

  it('未记录时返回 null', () => {
    expect(loadActiveLevel()).toBeNull()
  })

  it('clearActiveLevel 之后读回 null', () => {
    saveActiveLevel('ch5-2')
    clearActiveLevel()
    expect(loadActiveLevel()).toBeNull()
  })

  it('数据损坏时返回 null 而不是抛异常（boot 会据此退回菜单）', () => {
    for (const raw of ['{不是 JSON', '[]', '"文本"', 'null', '42']) {
      localStorage.setItem(ACTIVE_LEVEL_KEY, raw)
      expect(() => loadActiveLevel()).not.toThrow()
      expect(loadActiveLevel()).toBeNull()
    }
  })

  it('levelId 缺失或为空 → null', () => {
    localStorage.setItem(ACTIVE_LEVEL_KEY, JSON.stringify({}))
    expect(loadActiveLevel()).toBeNull()
    localStorage.setItem(ACTIVE_LEVEL_KEY, JSON.stringify({ levelId: '' }))
    expect(loadActiveLevel()).toBeNull()
  })
})

describe('persistence/snapshot —— 显式导出/导入（仓库快照的唯一事实来源）', () => {
  it('导出后 hasSnapshot 为 true，importSnapshot 能把虚拟根原样写回', async () => {
    const { reset } = await import('../engine/sandbox')
    const { fsp } = await import('../engine/fs')

    // 造一个有文件、有目录、有子目录内容的仓库（等价于进关预置后的状态）
    const r = await reset({ files: { 'notes/a.md': 'AAA', 'b.txt': 'B' } })
    expect(r.ok).toBe(true)

    await exportSnapshot('chX-1')
    expect(await hasSnapshot('chX-1')).toBe(true)

    // 破坏现场（模拟刷新后的空环境），再导入
    const r2 = await reset({})
    expect(r2.ok).toBe(true)
    const restored = await importSnapshot('chX-1')
    expect(restored).toBe(true)

    // 内容原样回来了（含二进制安全的 .git 内部结构 —— 用文本文件验证读写通路）
    expect(await fsp.readFile('/repo/notes/a.md', 'utf8')).toBe('AAA')
    expect(await fsp.readFile('/repo/b.txt', 'utf8')).toBe('B')
    // .git 目录也被完整导出/导入（目录条目本身在快照里）
    const stat = await fsp.stat('/repo/.git')
    expect(stat.isDirectory()).toBe(true)
    // 清理，避免影响其它用例
    await clearSnapshot('chX-1')
  })

  it('未导出的关卡 hasSnapshot 为 false，importSnapshot 返回 false（恢复降级的依据）', async () => {
    expect(await hasSnapshot('chX-never')).toBe(false)
    expect(await importSnapshot('chX-never')).toBe(false)
  })

  it('clearSnapshot 后不可再恢复', async () => {
    const { reset } = await import('../engine/sandbox')
    await reset({ files: { 'x.md': 'X' } })
    await exportSnapshot('chX-2')
    expect(await hasSnapshot('chX-2')).toBe(true)
    await clearSnapshot('chX-2')
    expect(await hasSnapshot('chX-2')).toBe(false)
    expect(await importSnapshot('chX-2')).toBe(false)
  })

  it('空仓库（虚拟根只有 .git 前身之前的空态）导出后同样可恢复', async () => {
    // ⚠️ 1-1 这类关卡开局是空目录：快照里必须有「目录条目」而不只是文件，
    //    否则恢复时 /repo 整个建不出来（目录条目与文件条目同等重要）。
    const { reset } = await import('../engine/sandbox')
    const { fsp } = await import('../engine/fs')
    await reset({ template: 'emptyRepo' })
    await exportSnapshot('chX-3')
    expect(await hasSnapshot('chX-3')).toBe(true)
    await reset({})
    expect(await importSnapshot('chX-3')).toBe(true)
    // /repo 与 /remote.git 两个目录条目回来了
    expect((await fsp.stat('/repo')).isDirectory()).toBe(true)
    expect((await fsp.stat('/remote.git')).isDirectory()).toBe(true)
    await clearSnapshot('chX-3')
  })

  it('恢复保真：二进制内容（.git 的对象文件）不因编码损坏', async () => {
    const { reset } = await import('../engine/sandbox')
    const { fsp } = await import('../engine/fs')
    // 写一段含高位字节的「伪二进制」内容
    await reset({ files: { 'bin.dat': String.fromCharCode(0x00, 0xff, 0x80, 0x7f) } })
    const original = await fsp.readFile('/repo/bin.dat')
    await exportSnapshot('chX-4')
    await reset({})
    await importSnapshot('chX-4')
    const restored = await fsp.readFile('/repo/bin.dat')
    expect(restored.length).toBe(original.length)
    expect(Array.from(restored)).toEqual(Array.from(original))
    await clearSnapshot('chX-4')
  })
})

describe('persistence/boot —— 恢复流程的降级行为', () => {
  it('无挂起关卡时不恢复（reason: none）', async () => {
    clearActiveLevel()
    const outcome = await resumeInterruptedLevel()
    expect(outcome).toEqual({ resumed: false, reason: 'none' })
  })

  it('挂起的关卡 id 已不存在时不恢复（reason: unknown-level）', async () => {
    saveActiveLevel('ch9-9')
    const outcome = await resumeInterruptedLevel()
    expect(outcome.resumed).toBe(false)
    if (!outcome.resumed) expect(outcome.reason).toBe('unknown-level')
  })

  it('关卡存在但无快照库时不恢复（reason: failed），且不破坏会话', async () => {
    saveActiveLevel('ch5-1')
    useSessionStore.setState({ level: null, history: [] })
    const outcome = await resumeInterruptedLevel()
    expect(outcome.resumed).toBe(false)
    if (!outcome.resumed) expect(outcome.reason).toBe('failed')
    // 关键：恢复失败不得把玩家留在半吊子状态
    expect(useSessionStore.getState().level).toBeNull()
  })
})

describe('persistence/boot —— boot 分流判据', () => {
  it('无进度 → hasSavedProgress 为 false（进 intro）', () => {
    expect(hasSavedProgress()).toBe(false)
  })

  it('有通关记录 → true（进 menu）', () => {
    useProgressStore.getState().setLevelRecord('ch1-1', { score: 100, stars: 3, cleared: true })
    expect(hasSavedProgress()).toBe(true)
  })

  it('storage 抛错时降级为 false 而不是让 boot 中断', () => {
    const original = (globalThis as { localStorage?: Storage }).localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem() {
          throw new Error('SecurityError')
        },
      } as unknown as Storage,
      configurable: true,
    })
    try {
      expect(() => hasSavedProgress()).not.toThrow()
      expect(hasSavedProgress()).toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
    }
  })
})
