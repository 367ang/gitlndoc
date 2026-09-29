// 章节解锁规则单元测试（M4 确立，M5a 修订）
//
// ⚠️ 本文件锁定的是一条**实测发现的产品缺陷**的回归：
//    M4 的规则是「第 N 章解锁 ⇔ 第 N-1 章全部通关」逐级相邻。当中间某章
//    尚未实现（`ch4` 远程属 M5b、关卡数为 0）时，`isChapterCleared('ch4')`
//    恒为 false —— 于是 M5a 已交付的 **ch5 永远无法解锁**（冒烟实测抓到）。
//
//    修订后规则改为「回溯到最近一个**有关卡**的章节」：
//      ch5 解锁 ⇔ ch4 无关卡 ⇒ 继续往前 ⇒ ch3 全部通关。
//    将来 ch4 落地后规则**自动**变回逐级相邻，无需再改代码。

import { describe, expect, it } from 'vitest'
import { isChapterCleared, isChapterUnlocked } from '../game/progression'
import { getChapterLevels } from '../levels/chapters'
import type { ChapterId } from '../game/types'
import type { LevelRecord } from '../store/progressStore'

/** 造「某章全部通关」的记录表 */
function clearRecords(chapter: ChapterId): Record<string, LevelRecord> {
  const records: Record<string, LevelRecord> = {}
  for (const level of getChapterLevels(chapter)) {
    records[level.id] = { score: 100, stars: 3, cleared: true }
  }
  return records
}

const EMPTY: Record<string, LevelRecord> = {}

describe('progression —— 前置事实（这些断言是后续用例的前提）', () => {
  it('ch1~ch3 与 ch5 有关卡；ch4 / ch6 尚未实现（关卡数为 0）', () => {
    expect(getChapterLevels('ch1').length).toBe(4)
    expect(getChapterLevels('ch2').length).toBe(4)
    expect(getChapterLevels('ch3').length).toBe(6)
    // ⚠️ ch4 属 M5b（远程）、ch6 属 M6（标签）—— 本条断言在它们落地后会失败，
    //    届时正是提醒「该复核本文件的解锁规则用例了」。
    expect(getChapterLevels('ch4').length).toBe(0)
    expect(getChapterLevels('ch6').length).toBe(0)
    expect(getChapterLevels('ch5').length).toBe(6)
  })

  it('空章节不算「已通关」（否则空章节会放行后续章节）', () => {
    expect(isChapterCleared('ch4', EMPTY)).toBe(false)
    expect(isChapterCleared('ch6', EMPTY)).toBe(false)
  })
})

describe('progression —— 基础规则', () => {
  it('第 1 章恒解锁（游戏入口）', () => {
    expect(isChapterUnlocked('ch1', EMPTY)).toBe(true)
  })

  it('ch2 未通关 ch1 时锁定，通关后解锁', () => {
    expect(isChapterUnlocked('ch2', EMPTY)).toBe(false)
    expect(isChapterUnlocked('ch2', clearRecords('ch1'))).toBe(true)
  })

  it('ch3 需要 ch2 全通关', () => {
    expect(isChapterUnlocked('ch3', clearRecords('ch1'))).toBe(false)
    expect(isChapterUnlocked('ch3', { ...clearRecords('ch1'), ...clearRecords('ch2') })).toBe(true)
  })

  it('综合挑战 F 恒锁（属 M6）', () => {
    const all = { ...clearRecords('ch1'), ...clearRecords('ch2'), ...clearRecords('ch3') }
    expect(isChapterUnlocked('F', all)).toBe(false)
  })
})

describe('progression —— M5a 修订：跳过尚未实现的章节（回归锁）', () => {
  it('ch4 无关卡时，ch5 解锁取决于 ch3 而非 ch4（实测缺陷的回归锁）', () => {
    // ch1~ch2 通关但 ch3 未通关 → ch5 仍锁（不能跳级）
    const partial = { ...clearRecords('ch1'), ...clearRecords('ch2') }
    expect(isChapterUnlocked('ch5', partial)).toBe(false)

    // ch1~ch3 全通关 → ch5 解锁（ch4 无关卡，规则向前回溯到 ch3）
    const throughCh3 = { ...partial, ...clearRecords('ch3') }
    expect(isChapterUnlocked('ch5', throughCh3)).toBe(true)
  })

  it('ch5 不会因为「ch4 没有关卡」而被永久锁死', () => {
    // ⚠️ 这是修订前必然失败的断言：旧规则要求 isChapterCleared('ch4') 为 true，
    //    而 ch4 无卡时恒为 false —— ch5 因此永远进不去（冒烟实测发现）。
    expect(isChapterCleared('ch4', EMPTY)).toBe(false)
    const throughCh3 = { ...clearRecords('ch1'), ...clearRecords('ch2'), ...clearRecords('ch3') }
    expect(isChapterUnlocked('ch5', throughCh3)).toBe(true)
  })

  it('ch6 未实现（无关卡），但规则上它的解锁同样回溯到最近的有卡章节', () => {
    const throughCh3 = { ...clearRecords('ch1'), ...clearRecords('ch2'), ...clearRecords('ch3') }
    // ch5 未通关 → ch6 锁定（逐级推进的教学意图保持）
    expect(isChapterUnlocked('ch6', throughCh3)).toBe(false)
    // ch5 全通关 → ch6 解锁（ch6 自身无关卡，但解锁状态可被判出）
    expect(isChapterUnlocked('ch6', { ...throughCh3, ...clearRecords('ch5') })).toBe(true)
  })
})
