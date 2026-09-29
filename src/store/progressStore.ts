// 进度 / 得分 / 成就（development-refinement.md §2 分层职责）。
//
// ⚠️ M5a 起**已接持久化**（§10）：每次写入都落 localStorage，启动时经
// `hydrate()` 从 localStorage 读回。M1~M4 的内存态骨架已完成使命。
//
// 分层纪律：store 只负责「容纳状态 + 调用 persistence 的读写函数」，
// 不自己拼 JSON、不碰 localStorage 细节（那在 `src/persistence/progress.ts`）。

import { create } from 'zustand'
import {
  loadAchievements,
  loadProgress,
  saveAchievements,
  saveProgress,
} from '../persistence/progress'

/** 单关记录：得分 / 星级 / 是否通关（§7.4 星级为 0~3 星） */
export interface LevelRecord {
  score: number
  stars: number
  cleared: boolean
}

export interface ProgressState {
  /** 关卡 id（`chN-M`）→ 该关记录 */
  levelRecords: Record<string, LevelRecord>
  /** 已获得成就的 id 集合 */
  achievements: string[]

  /** 写回单关记录（结算时调用；星级由 game/scoring 层算好后传入） */
  setLevelRecord: (levelId: string, record: LevelRecord) => void
  /** 解锁成就（已存在则忽略） */
  unlockAchievement: (id: string) => void
  /** 是否已解锁某成就 */
  hasAchievement: (id: string) => boolean
  /**
   * 从持久化存储加载进度与成就（M5a）。
   *
   * ⚠️ **必须在 boot 阶段、渲染之前调用一次**（见 `main.tsx`）。不调用的话
   * store 会以空进度启动，玩家刷新浏览器后进度「看起来丢了」—— 直到下一次
   * 写操作把它覆盖成空。
   */
  hydrate: () => void
  /** 清空进度与成就（含持久化数据）；「重置进度」与测试收尾用 */
  resetProgress: () => void
}

/** 空成就列表的**稳定引用**：避免每次 set 都造新数组，减少无谓的重渲染 */
const EMPTY_ACHIEVEMENTS: string[] = []

export const useProgressStore = create<ProgressState>()((set, get) => ({
  levelRecords: {},
  achievements: EMPTY_ACHIEVEMENTS,

  setLevelRecord: (levelId, record) =>
    set((state) => {
      const levelRecords = { ...state.levelRecords, [levelId]: record }
      // 落盘：失败（隐私模式 / 配额）不影响本次会话继续玩
      saveProgress(levelRecords)
      return { levelRecords }
    }),

  unlockAchievement: (id) => {
    if (get().achievements.includes(id)) return
    set((state) => {
      const achievements = [...state.achievements, id]
      saveAchievements(achievements)
      return { achievements }
    })
  },

  hasAchievement: (id) => get().achievements.includes(id),

  hydrate: () => {
    set({ levelRecords: loadProgress(), achievements: loadAchievements() })
  },

  resetProgress: () => {
    saveProgress({})
    saveAchievements([])
    set({ levelRecords: {}, achievements: EMPTY_ACHIEVEMENTS })
  },
}))

// ⚠️ M5a 已清偿 M1 的 TODO：进度/成就接入 localStorage（键见 persistence/progress.ts）。
// 仍未落地的：`gtp:settings:v1` 有读写函数但尚无 UI 消费方（属 M7 打磨）；
// 仓库快照见 `src/persistence/snapshot.ts`（走 LightningFS 自身的 IndexedDB 持久化）。
//
// ⚠️ M3 遗留 2 的口径复核已完成：`startLevel` 的 `firstAttempt` 判定读的是
// **持久化后的**进度，故「重启浏览器后重玩某关」不再被误判为首次尝试。
