// 视图路由状态（development-refinement.md §5 视图状态机）
//
// 本应用不引入 react-router（§1 明确决策）：单页游戏流程线性，路由即本文件的判别联合
// `view`，由根组件 App 订阅后切换界面。store 层只做状态容器，不含任何业务逻辑。

import { create } from 'zustand'
import type { ChapterId } from '../game/types'

/**
 * §5 的视图判别联合。
 * `chapter` 对应章节介绍页，`levelComplete` 对应关卡结算页。
 */
export type View =
  | 'boot'
  | 'intro'
  | 'menu'
  | 'chapter'
  | 'level'
  | 'levelComplete'
  | 'gameComplete'

/** 视图状态机可携带的上下文：当前视图所指向的章节 / 关卡 */
export interface ViewContext {
  chapterId: ChapterId | null
  levelId: string | null
}

export interface ViewState extends ViewContext {
  view: View

  /** boot → intro（首次进入游戏的叙事开场） */
  goIntro: () => void
  /** boot/intro/levelComplete → menu（boot 完成后直接分流至菜单） */
  goMenu: () => void
  /** menu → chapter：进入章节介绍页 */
  goChapter: (chapterId: ChapterId) => void
  /** menu/chapter/levelComplete → level：start 与 retry 都走这里 */
  goLevel: (levelId: string) => void
  /** level → levelComplete：本关达标后的结算页 */
  goLevelComplete: () => void
  /** menu → gameComplete：全部通关后菜单可进入结局 */
  goGameComplete: () => void
}

export const useViewStore = create<ViewState>()((set) => ({
  view: 'boot',
  chapterId: null,
  levelId: null,

  goIntro: () => set({ view: 'intro' }),

  goMenu: () => set({ view: 'menu', chapterId: null, levelId: null }),

  goChapter: (chapterId) => set({ view: 'chapter', chapterId, levelId: null }),

  goLevel: (levelId) => set({ view: 'level', levelId }),

  goLevelComplete: () => set({ view: 'levelComplete' }),

  goGameComplete: () => set({ view: 'gameComplete' }),
}))

// TODO(M1 收尾)：`boot` 的最小实现是「初始化 LightningFS 后进入 intro/menu」，该分流
// 由入口（src/main.tsx + src/app/App.tsx，属 T5）调用 goMenu/goIntro 完成。
// TODO(M5, §10)：boot 还应「加载持久化进度」并据此决定进入 intro 还是 menu；
// 持久化排在 M5（M1-tasks-TODO.md「已确认的决策」第 3 条），届时接入
// src/persistence/progress.ts 读取 `gtp:progress:v1` 后再分流。
