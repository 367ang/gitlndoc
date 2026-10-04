/**
 * 章节解锁规则（M4 确立，M5a 修订，M6 收官）。
 *
 * Game Service 纯函数层（§2）：只读 progressStore 的快照做派生，无副作用。
 * 解锁状态**不存 store** —— 它完全是 levelRecords 的派生值，双源只会漂移。
 *
 * 规则：
 *   - 第 1 章恒解锁（游戏入口）；
 *   - 第 N 章（N ≥ 2）解锁 ⇔ **它之前最近一个「有关卡的章节」**全部 cleared；
 *   - 综合挑战（F）解锁 ⇔ **全部六章主线关卡**都 cleared（M6 裁定：
 *     「大统一」是全部知识的汇聚，必须走完全部主线才有资格挑战）。
 *
 * ── M5a 的修订：跳过「尚未实现」的章节 ──────────────────────────────────
 *
 * M4 的原规则是「第 N 章解锁 ⇔ 第 N-1 章全部通关」，逐级相邻。
 * 该规则在「前一章尚未实现」时会**永久锁死后续章节**（详见下方 hasLevels 的用法）。
 * 修订为「回溯到最近一个有关卡的章节」，教学意图（逐步推进，不能跳级）不变。
 * ⚠️ M6 起 ch1~ch6 全部有关卡，「跳章」回溯不再被触发 —— 但机制保留，
 *    以防未来章节扩容（如第七章「法则之书」）时复用。
 */

import { getChapterLevels } from '../levels/chapters';
import type { ChapterId } from './types';
import type { LevelRecord } from '../store/progressStore';

/** 主线章节的顺序（与 `ChapterMeta.order` 同源；F 不参与排序故为 null） */
const CHAPTER_ORDER: Record<ChapterId, number | null> = {
  ch1: 1,
  ch2: 2,
  ch3: 3,
  ch4: 4,
  ch5: 5,
  ch6: 6,
  F: null,
};

/**
 * 某章是否全部通关。
 *
 * ⚠️ 章内无关卡返回 `false` —— 空章节「不算通关」。
 * 这正是 M5a 修订要处理的情形：`ch4` 无关卡时它恒为 false，
 * 故 `isChapterUnlocked` 必须**跳过**它而不是被它挡住。
 */
export function isChapterCleared(
  chapterId: ChapterId,
  levelRecords: Record<string, LevelRecord>,
): boolean {
  const levels = getChapterLevels(chapterId);
  if (levels.length === 0) return false;
  return levels.every((level) => levelRecords[level.id]?.cleared === true);
}

/**
 * 该章是否有可玩关卡（`playable` 的数据侧判据）。
 * 用「关卡数 > 0」而不是读 `ChapterMeta.playable` —— 后者是展示用的静态标记，
 * 而解锁规则应当以**实际数据**为准（两者不一致时应以数据为准）。
 */
function hasLevels(chapterId: ChapterId): boolean {
  return getChapterLevels(chapterId).length > 0;
}

/** 章节是否已解锁 */
export function isChapterUnlocked(
  chapterId: ChapterId,
  levelRecords: Record<string, LevelRecord>,
): boolean {
  // 首章恒解锁
  if (chapterId === 'ch1') return true;

  // 综合挑战（F）：order 为 null，不参与「前一章」回溯 ——
  // 它的解锁条件是**全部六章主线**都通关（M6 裁定，见文件头）。
  if (chapterId === 'F') {
    const mainChapters: ChapterId[] = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'];
    return mainChapters.every((chapter) => isChapterCleared(chapter, levelRecords));
  }

  const currentOrder = CHAPTER_ORDER[chapterId];
  if (currentOrder === null || currentOrder === undefined) return false;
  if (currentOrder <= 1) return true;

  // 从紧邻的前一章往前找**第一个有关卡**的章节，以它作为解锁前置。
  // 一路找到 ch1 之前仍无有关卡的章节（理论上不可能，ch1 恒有卡）→ 视为已满足。
  for (let order = currentOrder - 1; order >= 1; order -= 1) {
    const candidate = `ch${order}` as ChapterId;
    if (!hasLevels(candidate)) continue;
    return isChapterCleared(candidate, levelRecords);
  }
  return true;
}
