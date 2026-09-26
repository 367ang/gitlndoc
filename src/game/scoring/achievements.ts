/**
 * 成就判定（development-refinement.md §7、GDD §5.3）。
 *
 * 分层纪律（§2）：纯函数，不 import React / zustand —— 何时调用
 * `progressStore.unlockAchievement` 由调用方（结算流程）决定，本模块只算
 * 「本次结算应解锁哪些成就」。
 *
 * 成就清单（M3 开工前与用户确认的口径：GDD 3 个示例 + 2 个进度类）：
 *   1. `no-undo`    零回溯大师   —— 单关 0 撤销类命令（GDD 示例）
 *   2. `first-try`  一次成型     —— 单关首次尝试直接过关（GDD 示例）
 *   3. `no-hint`    无提示通关   —— 单关 0 提示过关（GDD 示例）
 *   4. `first-clear` 初露锋芒    —— 首次通过任意一关（进度类）
 *   5. `perfect-chapter` 完美篇章 —— 一章全部关卡都拿到 ★★★（进度类）
 *
 * ⚠️ 与 GDD 的差异说明：GDD §5.3 的「完美通关：全部关卡 ★★★」是**全游戏**口径，
 * 当前只有第一章 4 关，写成全游戏判定会随章节扩容而含义漂移；按**章节**判定
 * 语义稳定（每章可各得一次），故进度类成就取「单章完美」。
 */

import type { ChapterId } from '../types';

/** 单个成就的展示信息（菜单页成就列表直接渲染本表） */
export interface Achievement {
  /** 稳定 id（存入 progressStore.achievements） */
  id: string;
  /** 展示名 */
  title: string;
  /** 达成条件说明（面向玩家） */
  description: string;
}

/** M3 全部成就的注册表（顺序即菜单页展示顺序） */
export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'no-undo',
    title: '零回溯大师',
    description: '单关不使用任何撤销类命令（reset / revert / checkout -- / stash 丢弃）。',
  },
  {
    id: 'first-try',
    title: '一次成型',
    description: '首次进入一关，不重试直接过关。',
  },
  {
    id: 'no-hint',
    title: '无提示通关',
    description: '单关通关全程未查看任何提示。',
  },
  {
    id: 'first-clear',
    title: '初露锋芒',
    description: '首次通过任意一关。',
  },
  {
    id: 'perfect-chapter',
    title: '完美篇章',
    description: '同一章节的全部关卡都拿到三星。',
  },
];

/** 按 id 查成就；未注册的 id 返回 null（防御脏数据，不抛异常） */
export function achievementById(id: string): Achievement | null {
  return ACHIEVEMENTS.find((achievement) => achievement.id === id) ?? null;
}

/** 成就判定的输入快照（结算时刻的游戏状态） */
export interface AchievementContext {
  /** 本关是否过关（targets 全部满足且得分 ≥ winScore） */
  cleared: boolean;
  /** 本关是否为本会话的首次尝试（重玩 / 重试后为 false） */
  firstAttempt: boolean;
  /** 本关使用的提示条数 */
  hintsUsed: number;
  /** 本关撤销类命令条数 */
  undoCount: number;
  /** 本关所属章节 */
  chapter: ChapterId;
  /** 结算后该章的逐关星级（含本关；未通关的关卡不在表内） */
  chapterStars: Readonly<Record<string, number>>;
  /** 该章的关卡总数（用于「全章三星」的完整性判定） */
  chapterLevelCount: number;
}

/**
 * 计算本次结算应解锁的成就 id 列表。
 *
 * @param alreadyUnlocked 已解锁的成就 id（重复的不会再次出现在结果里）
 *
 * @example
 * ```ts
 * const earned = evaluateAchievements(ctx, useProgressStore.getState().achievements);
 * for (const id of earned) useProgressStore.getState().unlockAchievement(id);
 * ```
 */
export function evaluateAchievements(
  context: AchievementContext,
  alreadyUnlocked: readonly string[],
): string[] {
  const earned: string[] = [];
  const has = (id: string) => alreadyUnlocked.includes(id);

  if (context.cleared) {
    if (!has('no-undo') && context.undoCount === 0) earned.push('no-undo');
    if (!has('first-try') && context.firstAttempt) earned.push('first-try');
    if (!has('no-hint') && context.hintsUsed === 0) earned.push('no-hint');
    if (!has('first-clear')) earned.push('first-clear');
  }

  // 完美篇章：该章每一关都有记录、且全部为 3 星。
  // `chapterStars` 由调用方取「结算后的 progressStore.levelRecords」过滤出本章条目；
  // 以 chapterLevelCount 校验完整性 —— 星级表条数少于关卡数说明还有关未通，不算完美。
  if (!has('perfect-chapter') && context.cleared) {
    const allStars = Object.values(context.chapterStars);
    const perfect =
      context.chapterLevelCount > 0 &&
      allStars.length === context.chapterLevelCount &&
      allStars.every((stars) => stars === 3);
    if (perfect) earned.push('perfect-chapter');
  }

  return earned;
}
