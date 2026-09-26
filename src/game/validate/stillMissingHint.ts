/**
 * GoalPanel 的抽象引导语（development-refinement.md §9.1）。
 *
 * ⚠️ 本文件**只负责「还差什么」的抽象引导**，不负责逐项目标的中文描述。
 * 逐项文案由 `game/validate/targetState.ts` 的 `TargetResult.detail` 提供 ——
 * 那里能拿到仓库实际状态，写出的说明（如「暂存区还有尚未提交的内容」）比
 * 仅凭 `TargetCondition` 静态翻译出来的更准确。早期版本在本文件另写了一份
 * `describeTarget()`，接入 detail 后即成死代码，已移除（避免两份文案漂移）。
 *
 * 放在 `game/validate/` 而非组件里：这是**关卡语义**的一部分（M4 的 Hints 面板
 * 会复用同一套分级口径），且是纯函数，可被单测覆盖。
 *
 * ⚠️ 引导语必须保持「抽象」：只说明**该往哪个方向想**，绝不给具体命令。
 * §9.1 明确要求未达标时不给命令 —— 文案里出现 `git init` 这类字样即算泄题。
 * （真正带命令的完整答案在 `Level.hints` 里，按失败次数在 Hints 面板解锁，属 M4。）
 */

/**
 * 未达标时按失败次数递进的抽象引导语。
 *
 * 之所以分三级，是呼应 §9.1 的分级提示口径（方向 → 命令 → 完整答案）中的**第一级**：
 * GoalPanel 只承担「方向」，后两级属 `stepHints.ts` 与 Hints 面板（M4）。
 */
const STILL_MISSING_HINTS: readonly string[] = [
  '时间线尚未锚定。先想清楚：要让它在哪个维度发生变化？',
  '还差一些东西。回看目标描述，注意工作区、暂存区与本地仓库三者的差别。',
  '别急着重来。先观察当前状态，判断上一步把变化留在了哪一层。',
]

/**
 * 按失败次数挑选一条抽象引导语。
 *
 * @param failures 玩家累计失败次数（从 0 开始）。超出层级数后停在最后一条 ——
 *                 不再升级，因为更具体的内容应由 Hints 面板按 `unlockAfterFailures` 给出。
 */
export function stillMissingHint(failures: number): string {
  const index = Math.min(Math.max(failures, 0), STILL_MISSING_HINTS.length - 1)
  return STILL_MISSING_HINTS[index]
}
