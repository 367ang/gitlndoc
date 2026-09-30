/**
 * boot 阶段的持久化接线（development-refinement.md §5 boot、§10 持久化）。
 *
 * 把「加载进度」与「恢复关卡中途进度」收成一个模块，供 `main.tsx`（渲染前）与
 * `App.tsx`（分流决策）共用 —— 两处若各自实现一遍，就容易出现
 * 「main 加载了但 App 没读」这类静默不一致。
 *
 * ⚠️ 本模块**不碰 React**：`main.tsx` 在渲染前调用 `hydrateProgress()` 与
 * `resumeInterruptedLevel()`，`App.tsx` 再读 `hasSavedProgress()` 决定进 intro 还是 menu。
 *
 * ── 刷新恢复的产品口径（M5a，用户裁定）────────────────────────────────
 *
 * **「自动恢复关卡中途进度」**：玩家在关卡内刷新浏览器后，应**直接回到那一关**，
 * 且仓库状态与刷新前一致 —— 而不是被丢回菜单从头开始。
 *
 * 实现由三部分构成：
 *   1. **仓库内容**：`persistence/snapshot.ts` 在进关时与每条命令后把虚拟根
 *      **显式导出**进 IndexedDB（`gtp:snapshots:v1`，按 levelId 存取）；
 *   2. **挂起关卡**：`gtp:active-level:v1`（localStorage）记下「正在哪一关」；
 *   3. **恢复**：boot 时若发现挂起关卡，`resumeLevel()` 把快照**导入**虚拟根
 *      （**跳过 `sandbox.reset`** —— 那会按 LevelInit 重建初始仓库）。
 *
 * ⚠️ 三条必须守住的纪律：
 *   - **恢复分支绝不能调 `sandbox.reset()`** —— 它会 `clearSandboxRoot()`，
 *     把刚要恢复的仓库抹掉（这正是「恢复」与「新进关」的唯一区别）；
 *   - **恢复失败必须能降级**：库不存在 / 校验不通过时退回「进菜单」，
 *     绝不能把玩家卡在一个空仓库里；
 *   - **命令历史与拼接草稿不持久化**：它们是「玩家刚才敲了什么」的临时痕迹，
 *     恢复出旧历史反而会让玩家困惑（且 §10 只要求恢复仓库快照）。
 */

import { useProgressStore } from '../store/progressStore';
import { hasProgress } from './progress';
import { loadActiveLevel } from './snapshot';

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

/** `resumeInterruptedLevel()` 的结果 */
export type ResumeOutcome =
  | { resumed: true; levelId: string }
  | { resumed: false; reason: 'none' | 'unknown-level' | 'failed' };

/**
 * 尝试恢复「刷新前正在玩的关卡」（M5a，用户裁定的产品口径）。
 *
 * ⚠️ 必须在 `main.tsx` 里、**沙箱初始化之前**调用，且要区分于 `sandbox.reset()`：
 * 本函数只负责「把 fs 挂到快照库上并切视图」，**不重建仓库**。
 *
 * 与 `startLevel()` 的分工：
 *   - 新进关 → `startLevel()`：`sandbox.reset(level.init)` 重建仓库 + 建快照；
 *   - 刷新恢复 → 本函数：挂载既有快照库 + 跳过 reset。
 *   两者共享「写入会话状态并切视图」这后半段（见 `app/resumeLevel.ts`）。
 *
 * @returns 恢复结果；调用方据此决定是否还要跑常规 boot 流程
 */
export async function resumeInterruptedLevel(): Promise<ResumeOutcome> {
  const pending = loadActiveLevel();
  if (pending === null) return { resumed: false, reason: 'none' };

  // 动态 import：避免 `persistence` → `app` 的静态循环依赖
  // （`app/resumeLevel.ts` 会读 store 与关卡数据，属 UI 编排层）
  const { resumeLevel } = await import('../app/resumeLevel');
  try {
    const result = await resumeLevel(pending.levelId);
    if (result.ok) return { resumed: true, levelId: result.levelId };
    return { resumed: false, reason: result.reason };
  } catch {
    // 恢复途中任何异常都不得阻断 boot —— 退回菜单即可
    return { resumed: false, reason: 'failed' };
  }
}
