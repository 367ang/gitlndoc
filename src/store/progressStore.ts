// 进度 / 得分 / 成就（development-refinement.md §2 分层职责）。
//
// M1 只建立**内存态骨架**：不接持久化（persistence 排在 M5，
// 见 TODO/M1-tasks-TODO.md「已确认的决策」第 3 条）。本文件不含任何 localStorage 代码。

import { create } from 'zustand'

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
}

const EMPTY_ACHIEVEMENTS: string[] = []

export const useProgressStore = create<ProgressState>()((set, get) => ({
  levelRecords: {},
  achievements: EMPTY_ACHIEVEMENTS,

  setLevelRecord: (levelId, record) =>
    set((state) => ({
      levelRecords: { ...state.levelRecords, [levelId]: record },
    })),

  unlockAchievement: (id) => {
    if (get().achievements.includes(id)) return
    set((state) => ({ achievements: [...state.achievements, id] }))
  },

  hasAchievement: (id) => get().achievements.includes(id),
}))

// TODO(M5, §10 持久化设计)：接入 localStorage，键约定为
//   - 进度（每关得分/星级/是否通关）→ `gtp:progress:v1`
//   - 成就                            → `gtp:achievements:v1`
//   - 设置（提示开关等）              → `gtp:settings:v1`
// 关卡内崩溃/刷新恢复所需的仓库快照另存 IndexedDB（`gtp:snapshot:<levelId>`），
// 由 src/persistence/ 负责，M1 不创建该目录。
// TODO(M3)：成就判定本身（何时调用 unlockAchievement）属 game/scoring/achievement.ts，
// 不放在 store 层。
