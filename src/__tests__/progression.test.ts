// 章节解锁规则单元测试（M4 确立，M5a 修订，M5b 复核，M6 收官复核）
//
// ⚠️ 本文件锁定的是一条**实测发现的产品缺陷**的回归：
//    M4 的规则是「第 N 章解锁 ⇔ 第 N-1 章全部通关」逐级相邻。当中间某章
//    尚未实现（M5a 期间 `ch4` 远程属 M5b、关卡数为 0）时，`isChapterCleared('ch4')`
//    恒为 false —— 于是当时已交付的 **ch5 永远无法解锁**（冒烟实测抓到）。
//
//    修订后的规则是「回溯到最近一个**有关卡**的章节」：
//      ch5 解锁 ⇔ ch4 无关卡 ⇒ 继续往前 ⇒ ch3 全部通关。
//    这条规则是**自适应的**：M5b 把 ch4 的 5 关补上之后，ch5 的解锁条件
//    **自动**变回逐级相邻（⇔ ch4 全通关），无需改动任何代码 —— 本文件的
//    「M5b 起」小节正是对该自适应的复核。
//
// ⚠️ M6 起 ch1~ch6 + F 全部有关卡：「跳章」回溯不再被触发（机制保留备用）。
//    F 的解锁规则为「全部六章主线通关」（M6 裁定），见最后的收官小节。

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
  it('ch1~ch6 与 F 全部有关卡（M6 收官：全游戏 27 关）', () => {
    expect(getChapterLevels('ch1').length).toBe(4)
    expect(getChapterLevels('ch2').length).toBe(4)
    expect(getChapterLevels('ch3').length).toBe(6)
    expect(getChapterLevels('ch4').length).toBe(5)
    expect(getChapterLevels('ch5').length).toBe(6)
    // ⚠️ M6 起第六章 5 关 + 终章 2 关落地
    expect(getChapterLevels('ch6').length).toBe(5)
    expect(getChapterLevels('F').length).toBe(2)
  })

  it('空章节不算「已通关」（防御回溯逻辑的核心不变量；M6 后暂无空章节但机制保留）', () => {
    expect(isChapterCleared('ch1', EMPTY)).toBe(false)
    expect(isChapterCleared('F', EMPTY)).toBe(false)
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

  it('综合挑战 F 需要全部六章通关（M6 裁定，替代早前的「恒锁」）', () => {
    const throughCh5 = {
      ...clearRecords('ch1'),
      ...clearRecords('ch2'),
      ...clearRecords('ch3'),
      ...clearRecords('ch4'),
      ...clearRecords('ch5'),
    }
    // 缺 ch6 → 锁
    expect(isChapterUnlocked('F', throughCh5)).toBe(false)
    // 六章全通关 → 解锁
    expect(isChapterUnlocked('F', { ...throughCh5, ...clearRecords('ch6') })).toBe(true)
  })
})

describe('progression —— M5b 复核：ch4 落地后解锁规则自动回到逐级相邻', () => {
  it('ch4 现在需要 ch3 全通关（不再是「无关卡因而可跳过」）', () => {
    const throughCh2 = { ...clearRecords('ch1'), ...clearRecords('ch2') }
    expect(isChapterUnlocked('ch4', throughCh2)).toBe(false)

    const throughCh3 = { ...throughCh2, ...clearRecords('ch3') }
    expect(isChapterUnlocked('ch4', throughCh3)).toBe(true)
  })

  it('ch5 现在需要 ch4 全通关（M5a 期间它跳过 ch4 直取 ch3，M5b 起不再如此）', () => {
    const throughCh3 = {
      ...clearRecords('ch1'),
      ...clearRecords('ch2'),
      ...clearRecords('ch3'),
    }
    // ⚠️ 这是 M5b 带来的**行为变化**：M5a 时该断言为 true（ch4 无卡被跳过），
    //    现在 ch4 有 5 关，未通关则 ch5 锁定 —— 逐级推进的教学意图恢复。
    expect(isChapterUnlocked('ch5', throughCh3)).toBe(false)

    const throughCh4 = { ...throughCh3, ...clearRecords('ch4') }
    expect(isChapterUnlocked('ch5', throughCh4)).toBe(true)
  })

  it('解锁只看**紧邻的前一个有卡章节**，不追溯更早的章节', () => {
    // ⚠️ 这是本规则**刻意的**语义（见 progression.ts 的规则说明）：
    //    只检查紧邻的前一个有卡章节，不校验更早的章节。
    //    因此「只通关 ch1 + ch4」确实能解锁 ch5 —— ch5 的前一个有卡章节是 ch4，
    //    而 ch4 已全通关。
    //
    //    这不是漏洞：正常玩法下 ch4 必须先于 ch5 解锁，而 ch4 又要求 ch3 全通关，
    //    故链条实际是逐级闭锁的。此处的「跳级」只可能由伪造进度数据造成，
    //    而进度是本机单机存档（§10），不需要为它引入全链校验的复杂度。
    const skipped = { ...clearRecords('ch1'), ...clearRecords('ch4') }
    expect(isChapterUnlocked('ch5', skipped)).toBe(true)

    // 真正要防的「跳级」是「没通关紧邻的前一章」——如下
    const notThroughCh4 = {
      ...clearRecords('ch1'),
      ...clearRecords('ch2'),
      ...clearRecords('ch3'),
    }
    expect(isChapterUnlocked('ch5', notThroughCh4)).toBe(false)
  })
})

describe('progression —— M6 收官：ch6 落地后逐级相邻自动闭合', () => {
  it('ch6 现在需要 ch5 全通关（此前它跳过 ch5 直取 ch4，M6 起不再如此）', () => {
    const throughCh4 = {
      ...clearRecords('ch1'),
      ...clearRecords('ch2'),
      ...clearRecords('ch3'),
      ...clearRecords('ch4'),
    }
    // ch5 未通关 → ch6 锁定（逐级推进的教学意图保持）
    expect(isChapterUnlocked('ch6', throughCh4)).toBe(false)

    // ch5 全通关 → ch6 解锁
    expect(isChapterUnlocked('ch6', { ...throughCh4, ...clearRecords('ch5') })).toBe(true)
  })

  it('F 在全部六章通关后解锁（收官前置，见基础规则一节的 M6 裁定）', () => {
    const throughCh6 = {
      ...clearRecords('ch1'),
      ...clearRecords('ch2'),
      ...clearRecords('ch3'),
      ...clearRecords('ch4'),
      ...clearRecords('ch5'),
      ...clearRecords('ch6'),
    }
    expect(isChapterUnlocked('F', throughCh6)).toBe(true)
    // F 自身未通关不影响「已解锁」—— 解锁与通关是两件事
    expect(isChapterCleared('F', throughCh6)).toBe(false)
  })
})
