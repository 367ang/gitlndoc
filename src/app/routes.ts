// 视图枚举（development-refinement.md §3 `app/routes.ts`、§5 视图状态机）
//
// §3 要求 `app/routes.ts` 提供视图枚举，§5 的判别联合由 `viewStore` 承载。
// 为避免出现两处「视图名单」互相漂移，此处**直接复用** `viewStore` 导出的
// `View` 类型与 `ViewContext`，本文件只补上列表化所需的元信息（标题）。

import type { View, ViewContext } from '../store/viewStore'

/** 视图枚举。与 `viewStore` 的判别联合同一来源，不另行定义字面量。 */
export type { View, ViewContext }

/** §5 状态机中视图的固定顺序，供调试与列表化渲染使用 */
export const VIEW_ORDER: readonly View[] = [
  'boot',
  'intro',
  'menu',
  'chapter',
  'level',
  'levelComplete',
  'gameComplete',
] as const

/** 各视图的中文标题（M1 用于占位页与文档提示，M2 起由各视图自行排版） */
export const VIEW_TITLE: Record<View, string> = {
  boot: '正在校准时间线…',
  intro: '开场叙事',
  menu: '主菜单',
  chapter: '章节介绍',
  level: '关卡',
  levelComplete: '关卡结算',
  gameComplete: '结局',
}

/**
 * M1 实现进度：`boot` / `level` 为真实实现，其余为占位（M2 起按 §9.1 补齐）。
 * 供占位组件显示「此视图属后续里程碑」，避免玩家误以为功能缺失。
 */
export const M1_VIEWS: readonly View[] = ['boot', 'level'] as const
