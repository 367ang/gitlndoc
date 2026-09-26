/**
 * 分步提示生成（development-refinement.md §9.1 Hints、GDD §3.3）。
 *
 * GDD §3.3 的三级提示：**方向提示 → 命令提示 → 完整答案**，
 * 由 `Level.hints` 的 `HintStep.unlockAfterFailures` 决定各级何时解锁。
 * 本模块只负责「按失败次数算出该显示哪几条」，**不含计分**（提示扣分属 M3）。
 *
 * 纯函数纪律（§2）：不 import React / zustand，不触碰 fs / gitApi；
 * 输入是关卡数据 + 失败次数 + 当前目标达成情况，输出是提示文本。这样 UI
 * 与测试都能直接调用，无需先建仓库。
 */

import type { HintStep, Level } from '../types';
import type { TargetState } from './targetState';

/** 一条已解锁的提示 */
export interface UnlockedHint {
  /** 层级序号，从 1 起（1 = 方向提示，末层 = 完整答案） */
  level: number;
  /** 提示正文 */
  text: string;
  /** 解锁该提示所需的失败次数 */
  unlockAfterFailures: number;
  /** 是否为本关的最后一层（完整答案） */
  isFinal: boolean;
}

/** `getUnlockedHints()` 的返回值 */
export interface HintState {
  /** 已解锁的提示（按解锁次序，难度渐进） */
  unlocked: UnlockedHint[];
  /**
   * 是否还有尚未解锁的提示。
   * UI 据此决定「继续失败还能再拿到提示」还是「提示已用尽」。
   */
  hasMore: boolean;
  /**
   * 距下一条提示还需失败几次；无下一条时为 null。
   * 用于 GoalPanel 旁的「再失败 N 次可获得提示」，让提示系统可预期。
   */
  failuresUntilNext: number | null;
}

/**
 * 按失败次数取出已解锁的提示（§9.1：解锁即计提示扣分 —— 计分属 M3，此处不算分）。
 *
 * 语义要点：
 *   - `unlockAfterFailures` 是**累计失败次数**阈值，达到即解锁（`>=`，非严格大于）；
 *   - `unlockAfterFailures: 0` 表示进关即可见（用作方向提示）；
 *   - 解锁**按关卡定义的顺序**，而非按阈值排序 —— 关卡作者写下的顺序即提示的递进顺序。
 *     若阈值非递增（如 `[0, 3, 1]`），第 3 条会在第 2 条之前解锁，产生「跳级」观感；
 *     这属关卡数据问题，由 `levels.test.ts` 的校验覆盖，本函数不擅自重排作者意图。
 *
 * @param hints        关卡的分步提示（`Level.hints`）
 * @param failures     玩家累计失败次数（过关判定未达成即计一次）
 */
export function getUnlockedHints(hints: readonly HintStep[], failures: number): HintState {
  const safeFailures = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;

  const unlocked: UnlockedHint[] = hints
    .map((hint, index) => ({ hint, index }))
    .filter(({ hint }) => safeFailures >= hint.unlockAfterFailures)
    .map(({ hint, index }) => ({
      level: index + 1,
      text: hint.text,
      unlockAfterFailures: hint.unlockAfterFailures,
      isFinal: index === hints.length - 1,
    }));

  const next = hints.find((hint) => safeFailures < hint.unlockAfterFailures);

  return {
    unlocked,
    hasMore: next !== undefined,
    failuresUntilNext: next ? next.unlockAfterFailures - safeFailures : null,
  };
}

/**
 * 在已解锁的提示中挑出**当前该显示的那一条**。
 *
 * 取「最后一条已解锁」而非全部：提示是难度递增的台阶（方向 → 命令 → 答案），
 * 玩家失败到第 N 次时，最贴合当下的是最新解锁的那条。UI 若要展示完整提示历史，
 * 可直接渲染 `getUnlockedHints().unlocked`。
 */
export function getCurrentHint(hints: readonly HintStep[], failures: number): UnlockedHint | null {
  const { unlocked } = getUnlockedHints(hints, failures);
  return unlocked.length > 0 ? unlocked[unlocked.length - 1] : null;
}

/**
 * 用目标达成情况生成**抽象提示**（§9.1：不给具体命令）。
 *
 * 与 `hints` 的分工：`hints` 是关卡作者手写的、随失败次数解锁的**递进剧本**；
 * 本函数是**实时**的「还差什么」摘要，随仓库状态变化，不依赖失败次数。
 * 两者都遵守同一条纪律 —— 只描述**哪里不对**，不给出可直接抄的命令。
 *
 * 注：未实现的条件（`implemented: false`）也会出现在列表里，
 * 因为那意味着**关卡配置有误**，静默隐藏会让玩家永远卡住且无从察觉。
 *
 * @param state 目标检测结果（`targetState.evaluateTargets()`）
 */
export function describePendingTargets(state: TargetState): string[] {
  return state.results.filter((result) => !result.ok).map((result) => result.detail);
}

/**
 * 便捷入口：由关卡与失败次数一次性得到提示状态。
 *
 * @param level    关卡定义（只读 `hints`）
 * @param failures 玩家累计失败次数
 */
export function hintStateFor(level: Pick<Level, 'hints'>, failures: number): HintState {
  return getUnlockedHints(level.hints, failures);
}
