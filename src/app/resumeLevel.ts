// 刷新后恢复关卡中途进度（M5a，用户裁定的产品口径）。
//
// 与 `startLevel.ts` 的分工（两者的**前半段完全不同，后半段一致**）：
//
//   ┌────────────┬──────────────────────────────┬──────────────────────────┐
//   │            │ 新进关 startLevel()          │ 刷新恢复 resumeLevel()   │
//   ├────────────┼──────────────────────────────┼──────────────────────────┤
//   │ 仓库       │ sandbox.reset(level.init)    │ importSnapshot(levelId)  │
//   │            │ 清空虚拟根后按 init 重建     │ 清空虚拟根后按快照写回   │
//   │ 命令历史   │ 清空                         │ 清空（不持久化，见下）   │
//   │ 视图       │ goLevel(id)                  │ goLevel(id)              │
//   └────────────┴──────────────────────────────┴──────────────────────────┘
//
// ⚠️ **恢复分支绝不能调 `sandbox.reset()`**：它会按 `LevelInit` 重建一个**初始**
//    仓库，把玩家做到一半的状态全部抹掉 —— 这是「恢复」与「新进关」的
//    唯一、也是最容易写错的区别。
//
// ⚠️ **命令历史与拼接草稿不恢复**：它们是「玩家刚才敲了什么」的临时痕迹。
//    恢复出旧历史会让玩家看到一堆自己「不记得敲过」的命令，反而困惑；
//    而 §10 要求的恢复对象是**仓库快照**，不含会话痕迹。
//
// ⚠️ **恢复失败必须能降级**：关卡 id 不存在（关卡数据被删/改名）、快照不存在
//    或格式不符 —— 都返回失败让 boot 退回菜单，绝不把玩家卡在空仓库里。

import { getLevel } from '../levels/chapters'
import { importSnapshot } from '../persistence/snapshot'
import { useSessionStore } from '../store/sessionStore'
import { useViewStore } from '../store/viewStore'

/** `resumeLevel()` 的结果 */
export type ResumeLevelResult =
  | { ok: true; levelId: string }
  | { ok: false; reason: 'unknown-level' | 'failed' }

/**
 * 恢复到指定关卡（刷新前的挂起关卡）。
 *
 * @param levelId 形如 `ch5-1`；来自 `gtp:active-level:v1`
 */
export async function resumeLevel(levelId: string): Promise<ResumeLevelResult> {
  const level = getLevel(levelId)
  if (level === null) {
    // 关卡数据已不存在（改版/删关卡）—— 不猜，让 boot 退回菜单
    return { ok: false, reason: 'unknown-level' }
  }

  // 1) 从快照恢复虚拟根（`/repo` + `/remote.git` 刷新前的内容原样写回）。
  //    无快照 / 格式不符 / 快照为空 → 失败降级（boot 据此退回菜单）。
  const restored = await importSnapshot(levelId)
  if (!restored) return { ok: false, reason: 'failed' }

  // 2) 写入会话状态（与 startLevel 的后半段一致）
  const session = useSessionStore.getState()
  session.setLevel(level)
  session.clearHistory()
  session.resetDraft()

  // 结算信息：恢复的会话**不是**首次尝试 —— 玩家已经在这一关里操作过了。
  // （`firstAttempt` 影响 flawlessBonus 与成就判定，恢复时给 false 才是诚实的）
  session.setSettlement({ hintsUsed: 0, firstAttempt: false })

  // 3) 切视图
  useViewStore.getState().goLevel(level.id)
  return { ok: true, levelId: level.id }
}
