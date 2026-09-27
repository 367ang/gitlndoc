/**
 * 章节解锁规则（M4，用户裁定：通关上一章**全部**关卡后解锁下一章）。
 *
 * Game Service 纯函数层（§2）：只读 progressStore 的快照做派生，无副作用。
 * 解锁状态**不存 store** —— 它完全是 levelRecords 的派生值，双源只会漂移。
 *
 * 规则：
 *   - 第 1 章恒解锁（游戏入口）；
 *   - 第 N 章（N ≥ 2）解锁 ⇔ 第 N-1 章**全部关卡 cleared**；
 *   - 综合挑战（F）属 M6，随其落地再定（当前恒锁）。
 */

import { getChapterLevels } from '../levels/chapters';
import type { ChapterId } from './types';
import type { LevelRecord } from '../store/progressStore';

/** 某章是否全部通关（章内无关卡视为未通关 —— 不让空章节放行） */
export function isChapterCleared(
  chapterId: ChapterId,
  levelRecords: Record<string, LevelRecord>,
): boolean {
  const levels = getChapterLevels(chapterId);
  if (levels.length === 0) return false;
  return levels.every((level) => levelRecords[level.id]?.cleared === true);
}

/** 章节是否已解锁 */
export function isChapterUnlocked(
  chapterId: ChapterId,
  levelRecords: Record<string, LevelRecord>,
): boolean {
  // 首章恒解锁
  if (chapterId === 'ch1') return true;

  const order: Record<ChapterId, number | null> = {
    ch1: 1,
    ch2: 2,
    ch3: 3,
    ch4: 4,
    ch5: 5,
    ch6: 6,
    F: null,
  };
  const currentOrder = order[chapterId];
  if (currentOrder === null || currentOrder === undefined) return false;
  if (currentOrder <= 1) return true;

  // 前一章 id：chN → ch(N-1)
  const previousId = `ch${currentOrder - 1}` as ChapterId;
  return isChapterCleared(previousId, levelRecords);
}
