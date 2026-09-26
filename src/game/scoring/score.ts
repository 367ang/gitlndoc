/**
 * 计分引擎（development-refinement.md §7「奖励理解、惩罚试错」）。
 *
 * 分层纪律（§2）：本模块属 Game Service 纯函数层 ——
 *   - 不 import React / zustand，不触碰 fs / gitApi；
 *   - 输入是关卡定义 + 命令历史 + 会话侧信息（提示使用、目标达成），
 *     输出是得分明细与星级。UI 与测试都能直接调用，无需沙箱。
 *
 * 与 §7 各小节的对应：
 *   - §7.1 基础分：全部 targets 满足得 baseScore 满分（部分达成不给基础分 ——
 *     §7.1 的原文是「达标即得」，未定义部分给分；而 §4.1 规定必须全部满足才过关，
 *     本引擎据此只区分「达成 / 未达成」两态，不做线性插值）；
 *   - §7.2 惩罚：撤销类（CommandEntry.undoable）、同目标重复提交（redoPenalty）、
 *     提示（hintPenalty，按「已查看的提示条数」计）；
 *   - §7.3 奖励：最优序列（optimalMoves）、一次通过（flawlessBonus）、只读探查（probeBonus，有上限）；
 *   - §7.4 星级：★ 过关；★★ ≥0.8·winScore 且无撤销；★★★ ≥0.95·winScore 且 0 提示 0 撤销。
 *
 * ⚠️ 第一章命令集只有 init/add/commit：
 *   - `undoable` 恒 false（撤销类命令属 M4/M5，executor 预留了该字段），扣分路径
 *     在第一章不可实测，但逻辑完整且被单测覆盖（测试用假 history 驱动）；
 *   - `probeBonus` 的只读命令（status/log/branch）在第一章不可达，同理。
 */

import type { CommandEntry, Level, ScoringParams } from '../types';
import { PROBE_BONUS_MAX_EVENTS } from '../types';

/**
 * probeBonus 计数的只读探查命令（§7.3「探索性只读命令」）。
 * `status` / `log` 属 M1 已支持；`branch` 属 M4 —— 提前列入名单，
 * M4 落地后无需改计分层。`git log` 只计**裸调用**（带 -n 等参数同样算探查）。
 */
const PROBE_VERBS: readonly string[] = ['status', 'log', 'branch'];

/** 一条命令的 verb（`git status --short` → `status`）；非 git 命令返回 null */
function verbOf(entry: CommandEntry): string | null {
  if (entry.tokens.length === 0) return null;
  if (entry.tokens[0] !== 'git') return null;
  return entry.tokens[1] ?? null;
}

/** 从 `git commit -m "xxx"` 提取提交信息；非 commit 命令返回 null */
function commitMessageOf(entry: CommandEntry): string | null {
  if (verbOf(entry) !== 'commit') return null;
  const index = entry.tokens.indexOf('-m');
  if (index < 0) return null;
  // `-m` 之后紧跟消息（tokenize 已按引号规则切分，消息是单个 token）
  return entry.tokens[index + 1] ?? null;
}

/**
 * 从命令历史中统计「同目标重复提交」（redoPenalty 判据，§7.2）。
 *
 * ⚠️ 语义核定（M3 开工前与用户确认的口径）：「同一目标」以**提交信息去重**为准 ——
 * 两次 `commit -m` 的信息完全相同，视为对同一目标的重复提交；信息不同则是新的快照。
 * 第一次提交不计；此后每多一次同信息提交记一次 redo。
 * （§7.2 原文只说「同目标重复提交」未给判据；用信息去重是因为它是玩家唯一可自控、
 * 可预判的信号 —— 「同一文件再次提交」在真实工作流里太常见，会造成误伤。
 * M4 有真实撤销/分支关卡后若发现误判，再复核此口径。）
 */
function countRedundantCommits(history: readonly CommandEntry[]): number {
  const seen = new Set<string>();
  let redo = 0;
  for (const entry of history) {
    if (!entry.ok) continue;
    const message = commitMessageOf(entry);
    if (message === null) continue;
    if (seen.has(message)) redo += 1;
    else seen.add(message);
  }
  return redo;
}

/** 统计撤销类命令条数（§7.2；executor 在 M1 恒记 false，M4/M5 起真实出现） */
function countUndoables(history: readonly CommandEntry[]): number {
  return history.filter((entry) => entry.ok && entry.undoable).length;
}

/** 统计只读探查命令条数（成功执行的才计） */
function countProbes(history: readonly CommandEntry[]): number {
  return history.filter((entry) => {
    if (!entry.ok) return false;
    const verb = verbOf(entry);
    return verb !== null && PROBE_VERBS.includes(verb);
  }).length;
}

/** 计分输入的会话侧信息（无法从 history 推导的部分） */
export interface ScoringInput {
  /** 本关累计查看的提示条数（Hints 面板每解锁一条记一次） */
  hintsUsed: number;
  /** 全部目标是否达成（由 targetState 判定后传入；计分层不重复检测） */
  targetsMet: boolean;
  /** 是否为本关首次尝试（重玩/重试后为 false） */
  firstAttempt: boolean;
}

/** 计分结果明细：每项惩罚 / 奖励单列，供结算页逐条展示 */
export interface ScoreBreakdown {
  /** 基础分（§7.1）：达标即 baseScore 满分，未达标为 0 */
  base: number;
  /** 撤销类命令扣分（正数表示扣掉的量） */
  undoPenalty: number;
  /** 同目标重复提交扣分 */
  redoPenalty: number;
  /** 提示扣分 */
  hintPenalty: number;
  /** 最优序列奖励 */
  optimalBonus: number;
  /** 一次通过奖励 */
  flawlessBonus: number;
  /** 只读探查奖励（已按上限截断） */
  probeBonus: number;
  /** 最终得分 = max(0, 基础 + 奖励 − 惩罚) */
  total: number;
}

/** 星级（§7.4）：0 = 未过关 */
export type Stars = 0 | 1 | 2 | 3;

/** 评分总输出 */
export interface ScoreResult {
  /** 逐项明细（结算页渲染用） */
  breakdown: ScoreBreakdown;
  /** 最终得分（同 breakdown.total，便于直接落 LevelRecord） */
  score: number;
  /** 星级（§7.4） */
  stars: Stars;
}

/** 计算一次惩罚/奖励后的累计值（防负数在最后统一处理，中间值可为负） */
function subtotal(params: ScoringParams, breakdown: Omit<ScoreBreakdown, 'total'>): number {
  return (
    breakdown.base +
    breakdown.optimalBonus +
    breakdown.flawlessBonus +
    breakdown.probeBonus -
    breakdown.undoPenalty -
    breakdown.redoPenalty -
    breakdown.hintPenalty
  );
}

/**
 * 评估一关的得分与星级。
 *
 * @param level   关卡定义（读 winScore / scoring / optimalMoves）
 * @param history 本关命令历史（sessionStore.history，时间正序）
 * @param input   会话侧信息：提示数、目标是否达成、是否首次尝试
 *
 * @example
 * ```ts
 * const result = evaluateScore(level, history, { hintsUsed: 1, targetsMet: true, firstAttempt: true });
 * useProgressStore.getState().setLevelRecord(level.id, { score: result.score, stars: result.stars, cleared: true });
 * ```
 */
export function evaluateScore(
  level: Level,
  history: readonly CommandEntry[],
  input: ScoringInput,
): ScoreResult {
  const params = level.scoring;

  // --- §7.1 基础分：全部目标满足才计（未达标时也不给星） ---
  const base = input.targetsMet ? params.baseScore : 0;

  // --- §7.2 惩罚 ---
  const undoCount = countUndoables(history);
  const redoCount = countRedundantCommits(history);
  const undoPenalty = undoCount * params.undoPenalty;
  const redoPenalty = redoCount * params.redoPenalty;
  const hintPenalty = input.hintsUsed * params.hintPenalty;

  // --- §7.3 奖励 ---
  // 最优序列：成功命令数 ≤ optimalMoves（§7.3「与参考方案一致或更短」）。
  // 注意统计的是**成功**命令：失败的尝试已由「多出的命令数」自然反映在判据里，
  // 不重复惩罚（稳定性扣分属 GDD §5.1 的另一维度，本项目未采用该三维模型）。
  const successfulMoves = history.filter((entry) => entry.ok).length;
  const optimalBonus =
    input.targetsMet && successfulMoves <= level.optimalMoves ? params.optimalBonus : 0;

  // 一次通过：0 撤销 0 提示（§7.3 原文口径；与「首次尝试」是两回事 ——
  // firstAttempt 只表示没有重玩本关，与中途是否失败无关）。
  const flawless =
    input.targetsMet && input.firstAttempt && undoCount === 0 && input.hintsUsed === 0;
  const flawlessBonus = flawless ? params.flawlessBonus : 0;

  // 只读探查：小额加分，累计不超过 PROBE_BONUS_MAX_EVENTS 次（§7.3「上限」）。
  // 上限常量在 types.ts，数值待 M7 平衡调参。
  const probes = countProbes(history);
  const probeEvents = Math.min(probes, PROBE_BONUS_MAX_EVENTS);
  const probeBonus = probeEvents * params.probeBonus;

  // --- §7.4 星级 ---
  const partial: Omit<ScoreBreakdown, 'total'> = {
    base,
    undoPenalty,
    redoPenalty,
    hintPenalty,
    optimalBonus,
    flawlessBonus,
    probeBonus,
  };
  // 得分下限为 0：扣分不把总分压成负数（scoring.test.ts 的边界用例）
  const total = Math.max(0, subtotal(params, partial));

  const stars = starsOf(params.baseScore, level.winScore, total, input, undoCount);
  return { breakdown: { ...partial, total }, score: total, stars };
}

/**
 * 星级判定（§7.4，系数基准按用户裁定的口径订正为 baseScore）。
 *
 * ⚠️ 口径订正（M3 实施时发现并与用户确认，2025-06）：§7.4 字面写的是
 * 「★★：得分 ≥ winScore×0.8」「★★★：得分 ≥ winScore×0.95」，但过关前提是
 * 得分 ≥ winScore，而 0.8·winScore < winScore 恒成立 —— 系数线在过关后必然满足，
 * 公式退化（0 撤销 0 提示即恒 3 星），且与 GDD §5.2 的百分比分段
 * （★★★=90–100 / ★★=70–89 / ★=50–69）对不上。§7.4 末句「winScore 默认 = baseScore」
 * 表明系数本意以**满分基准**为参照。故本实现取：
 *   ★  ：targetsMet 且 total ≥ winScore（过关线，仍用 winScore）
 *   ★★ ：total ≥ 0.8·baseScore 且无撤销
 *   ★★★：total ≥ 0.95·baseScore 且 0 提示 0 撤销
 * ch1（baseScore=100）下三档分别为 ≥60 / ≥80 / ≥95，与 GDD 分段一致。
 * 待 M7 平衡调参时若改用别的基准，只需动本函数。
 *
 * 单独提出便于单测直接覆盖边界（=0.8 / =0.95 恰好压线的情况）。
 */
export function starsOf(
  baseScore: number,
  winScore: number,
  total: number,
  input: ScoringInput,
  undoCount: number,
): Stars {
  // ★：过关线（winScore）——未达标（targetsMet=false）时基础分为 0，
  // 但奖励分（probe 等）仍可能凑过线；星级的前提是「过关」，未达标恒 0 星。
  if (!input.targetsMet) return 0;
  if (total < winScore) return 0;

  if (undoCount > 0) return 1;

  const hintsUsed = input.hintsUsed;
  if (total >= baseScore * 0.95 && hintsUsed === 0) return 3;
  if (total >= baseScore * 0.8) return 2;
  return 1;
}
