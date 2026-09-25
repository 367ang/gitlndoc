// 会话状态（development-refinement.md §2 分层职责）：当前关卡、命令历史、当前输入。
//
// 单一事实来源，但**不放业务逻辑** —— 命令 tokenize / 执行 / 目标比对 / 计分都在
// `src/game/` 的纯函数层完成，这里只负责容纳结果。

import { create } from 'zustand'
import type { CommandEntry, Level } from '../game/types'

/** `appendEntry` 的入参：`id` 与 `ts` 由 store 统一生成，调用方无需关心 */
export type CommandEntryInput = Omit<CommandEntry, 'id' | 'ts'>

export interface SessionState {
  /** 当前关卡。M1 允许为 null（关卡数据属 M2） */
  level: Level | null
  /** 命令历史（时间正序，最新在末尾） */
  history: CommandEntry[]
  /** 终端输入框的当前内容 */
  input: string
  /** 命令条目自增序号，用于生成形如 `cmd-1` 的 id */
  nextEntryId: number

  setLevel: (level: Level | null) => void
  /** 追加一条命令历史；自动补上递增 id（`cmd-<n>`）与时间戳 `ts` */
  appendEntry: (entry: CommandEntryInput) => void
  clearHistory: () => void
  setInput: (input: string) => void
  resetInput: () => void
  /** 退出关卡时清理会话（当前关卡、历史、输入一并复位） */
  resetSession: () => void
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  level: null,
  history: [],
  input: '',
  nextEntryId: 1,

  setLevel: (level) => set({ level }),

  appendEntry: (entry) => {
    const id = get().nextEntryId
    set((state) => ({
      // id 为递增序号，既满足 CommandEntry.id 的字符串契约，也便于列表 key
      history: [...state.history, { ...entry, id: `cmd-${id}`, ts: Date.now() }],
      nextEntryId: id + 1,
    }))
  },

  clearHistory: () => set({ history: [] }),

  setInput: (input) => set({ input }),

  resetInput: () => set({ input: '' }),

  resetSession: () => set({ level: null, history: [], input: '' }),
}))
