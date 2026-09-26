// 会话状态（development-refinement.md §2 分层职责）：当前关卡、命令历史、输入草稿。
//
// 单一事实来源，但**不放业务逻辑** —— 命令 tokenize / 执行 / 目标比对 / 计分都在
// `src/game/` 的纯函数层完成，这里只负责容纳结果。
//
// ⚠️ 两个「纯状态」约定（M2 引入，刻意与业务逻辑解耦）：
//   1. `targetState` 由**调用方**（`src/ui/hooks/useTargetState.ts`，经
//      `game/validate/targetState`）算好后写入，store 自身不做任何比对；
//   2. `draft` 的拼接规则在 `game/command/fragments.ts` 纯函数里，
//      store 只负责保存结果草稿。

import { create } from 'zustand'
import { EMPTY_DRAFT, type Draft } from '../game/command/fragments'
import type { CommandEntry, Level } from '../game/types'
// ⚠️ 只 import **类型**，不引入 `targetState.ts` 的运行时代码 ——
// 后者依赖 `gitApi`，一旦被 store 反向引用，「store 层不依赖执行层」这条边界就破了（§2）。
// 类型导入在编译期被完全擦除，不产生任何运行时依赖。
// （`fragments.ts` 则是 game service 的**纯函数**，不碰 fs/gitApi，可以正常引用。）
import type { TargetState } from '../game/validate/targetState'

/** `appendEntry` 的入参：`id` 与 `ts` 由 store 统一生成，调用方无需关心 */
export type CommandEntryInput = Omit<CommandEntry, 'id' | 'ts'>

export interface SessionState {
  /** 当前关卡。进入关卡时由调用方写入真实 `Level`；无关卡为 null */
  level: Level | null
  /** 命令历史（时间正序，最新在末尾） */
  history: CommandEntry[]
  /**
   * 拼接式输入的草稿（仅 `inputMode === 'menu'` 使用）。
   *
   * ⚠️ 存的是**槽位数组**而不是输入行文本：文本是有损的，无法反推
   * 「哪一段是玩家点的、属于哪条命令」，详见 `game/command/fragments.ts` 的文件头。
   */
  draft: Draft
  /** 命令条目自增序号，用于生成形如 `cmd-1` 的 id */
  nextEntryId: number
  /**
   * 当前关卡的目标判定结果（`null` = 尚未检测）。
   * `satisfied` 驱动 `level → levelComplete` 的过关判定，`results` 驱动 GoalPanel。
   */
  targetState: TargetState | null
  /**
   * 结算所需的会话侧信息（M3）。
   * `hintsUsed`：本关累计查看的提示条数（Hints 面板每解锁一条记一次）；
   * `firstAttempt`：本关是否首次尝试（重玩 / 重试后为 false）——
   * 由 `startLevel()` 在写入关卡时判定「本次是否是本会话对该关的第一次」。
   */
  settlement: { hintsUsed: number; firstAttempt: boolean; hintCountedLevel: number }

  setLevel: (level: Level | null) => void
  /** 追加一条命令历史；自动补上递增 id（`cmd-<n>`）与时间戳 `ts` */
  appendEntry: (entry: CommandEntryInput) => void
  clearHistory: () => void
  /** 整体替换拼接草稿（点击片段后由 UI 算好新草稿传入） */
  setDraft: (draft: Draft) => void
  /** 清空拼接草稿 */
  resetDraft: () => void
  /** 写入目标检测结果（由 `useTargetState` 调用） */
  setTargetState: (state: TargetState | null) => void
  /**
   * 记「玩家查看了第 level 层提示」（M3 提示扣分）。
   * 按层级去重：StrictMode 重挂会重放「level 1 已解锁」的渲染，
   * 只有 level 超过已计层级才 +1 —— 同层重复上报不重复扣分。
   */
  markHintUsed: (level: number) => void
  /** 整体覆写结算信息（startLevel 在进关时复位用） */
  setSettlement: (settlement: { hintsUsed: number; firstAttempt: boolean }) => void
  /** 退出关卡时清理会话（当前关卡、历史、输入、目标一并复位） */
  resetSession: () => void
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  level: null,
  history: [],
  draft: EMPTY_DRAFT,
  nextEntryId: 1,
  targetState: null,
  settlement: { hintsUsed: 0, firstAttempt: true, hintCountedLevel: 0 },

  // 换关时一并清掉上一关的目标判定结果，避免新关卡首帧闪出旧勾选
  setLevel: (level) => set({ level, targetState: null }),

  appendEntry: (entry) => {
    const id = get().nextEntryId
    set((state) => ({
      // id 为递增序号，既满足 CommandEntry.id 的字符串契约，也便于列表 key
      history: [...state.history, { ...entry, id: `cmd-${id}`, ts: Date.now() }],
      nextEntryId: id + 1,
    }))
  },

  clearHistory: () => set({ history: [] }),

  setDraft: (draft) => set({ draft }),

  resetDraft: () => set({ draft: EMPTY_DRAFT }),

  setTargetState: (state) => set({ targetState: state }),

  markHintUsed: (level) =>
    set((state) => {
      if (level <= state.settlement.hintCountedLevel) return state
      return {
        settlement: {
          ...state.settlement,
          hintsUsed: state.settlement.hintsUsed + 1,
          hintCountedLevel: level,
        },
      }
    }),

  setSettlement: ({ hintsUsed, firstAttempt }) =>
    set((state) => ({ settlement: { hintsUsed, firstAttempt, hintCountedLevel: 0 } })),

  resetSession: () =>
    set({
      level: null,
      history: [],
      draft: EMPTY_DRAFT,
      targetState: null,
      settlement: { hintsUsed: 0, firstAttempt: true, hintCountedLevel: 0 },
    }),
}))
