/**
 * boot 阶段的持久化接线（development-refinement.md §5 boot、§10 持久化）。
 *
 * 把「加载进度」与「分流判断」收成一个模块，供 `main.tsx`（渲染前）与
 * `App.tsx`（分流决策）共用 —— 两处若各自实现一遍，就容易出现
 * 「main 加载了但 App 没读」这类静默不一致。
 *
 * ⚠️ 本模块**不碰 React**：`main.tsx` 在渲染前调用 `hydrateProgress()`，
 * `App.tsx` 再读 `hasSavedProgress()` 决定进 intro 还是 menu。
 */

import { useProgressStore } from '../store/progressStore';
import { hasProgress } from './progress';

/**
 * 从 localStorage 加载进度与成就到 store。
 *
 * ⚠️ 必须幂等且可重复调用：StrictMode 下 React effect 会跑两遍，
 * 而 `main.tsx` 与（可能的）后续调用点都可能触发它。
 * `hydrate()` 是整体覆写，重复执行结果一致。
 */
export function hydrateProgress(): void {
  useProgressStore.getState().hydrate();
}

/**
 * 是否存在可恢复的进度 —— `boot → intro / menu` 的分流依据（§5）。
 *
 * 语义：**只有通关过至少一关**才算「有进度」。
 * 理由：玩家可能只是进过关卡、看过界面但从未通关 —— 那种情况下把他直接丢进
 * 菜单会错过 intro 的世界观引导，而引导本身是游戏体验的一部分。
 *
 * @returns 有通关记录返回 true（进 menu），否则 false（进 intro）
 */
export function hasSavedProgress(): boolean {
  try {
    return hasProgress();
  } catch {
    // 极端环境下 storage 抛错：按「无进度」处理，让玩家照常看到 intro
    return false;
  }
}
