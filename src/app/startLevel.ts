// 进入关卡的统一入口（development-refinement.md §5 视图状态机、§6.1 沙箱）
//
// 把「进入一关」这条跨三层的流程收成一个命令式函数，供 menu / chapter /
// levelComplete 三处复用：
//   1. `sandbox.reset(level.init)` —— 重建沙箱仓库（§6.1「每关开始：清空虚拟根」）；
//   2. 导出仓库快照 + 记下「正在哪一关」（M5a，刷新恢复的依据）；
//   3. `sessionStore.startLevel(level)` —— 写入真实关卡，并复位上一关的历史 / 输入 / 目标；
//   4. `viewStore.goLevel(levelId)` —— 切到关卡视图。
//
// ⚠️⚠️ 本流程**必须由事件回调调用**（按钮 onClick），**绝不可放进 React effect**：
// StrictMode 下 effect 会执行两次，而 `reset()` 会清空整个虚拟根 ——
// 第二次执行会把玩家刚建立好的关卡仓库抹掉。M1 的 `main.tsx` 就是因此在
// `createRoot().render()` 之前手动调一次 reset。详见 `main.tsx` 顶部注释。
//
// ⚠️ 顺序不可颠倒：`sessionStore.setLevel()` 会把 `targetState` 归零，
// 而 LevelScreen 挂载后立刻会做首次目标检测。若先切视图再 reset，
// 首次检测会采到**上一关残留或空仓库**的快照，1-2 的 `commitCount` 这类目标
// 会瞬间误判成「已达成 / 已失败」。
//
// ⚠️ reset 失败时**不切视图**：让玩家停在菜单并看到错误，
// 好过进到一个空仓库却以为关卡已就绪（§14 禁止伪造）。

import { getLevel } from '../levels/chapters'
import type { Level } from '../game/types'
import { reset } from '../engine/sandbox'
import {
  clearActiveLevel,
  clearSnapshot,
  exportSnapshot,
  hasSnapshot,
  importSnapshot,
  loadActiveLevel,
  saveActiveLevel,
} from '../persistence/snapshot'
import { useSessionStore } from '../store/sessionStore'
import { useProgressStore } from '../store/progressStore'
import { useViewStore } from '../store/viewStore'

/** `startLevel()` 的结果：失败时带一句面向玩家的中文说明 */
export type StartLevelResult = { ok: true; levelId: string } | { ok: false; error: string }

/**
 * 进入指定关卡。
 *
 * @param levelId 形如 `ch1-1` 的关卡 id
 *
 * @example
 * ```tsx
 * <button onClick={() => void startLevel('ch1-1')}>开始</button>
 * ```
 */
export async function startLevel(levelId: string): Promise<StartLevelResult> {
  const level = getLevel(levelId)
  if (level === null) {
    return { ok: false, error: `找不到关卡 ${levelId}，可能是关卡数据与菜单不同步。` }
  }

  // 0) 清掉**异关**的快照（M9 修订：同关快照改为「续玩」依据，见 1a）。
  //    本函数既是「进入某关」的入口，也就是「换关」时清理旧关快照的唯一路径。
  const previousLevel = useSessionStore.getState().level?.id
  if (previousLevel !== undefined && previousLevel !== level.id) {
    await clearSnapshot(previousLevel)
  }

  // 1a) 续玩恢复（M9）：玩家中途退出过本关（挂起标记与快照都在、未通关）→
  //     原样恢复现场，不 reset、不清历史。这是「进度不能保存」反馈的主修复。
  //     「重玩本关」不会误入此分支：结算页先走 `completeLevel()` 清掉标记与快照，
  //     条件不成立，自然落到下方的新开局。
  //     恢复失败（快照损坏 / 导入异常）→ 静默走新开局，绝不把玩家卡在空仓库。
  {
    const record = useProgressStore.getState().levelRecords[level.id]
    const cleared = record?.cleared === true
    const hasPendingMark = loadActiveLevel()?.levelId === level.id
    if (!cleared && hasPendingMark && (await hasSnapshot(level.id))) {
      try {
        const restored = await importSnapshot(level.id)
        if (restored) {
          return finishEnterLevel(level, { resume: true })
        }
      } catch (error) {
        console.warn(`[startLevel] 续玩恢复 ${level.id} 失败，改走新开局：`, error)
      }
    }
  }

  // 1) 重建沙箱：清空虚拟根后按 level.init 写入文件与预置提交
  try {
    const result = await reset(level.init)
    if (!result.ok) return { ok: false, error: result.error.toString() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  // 2) 固化初始快照 + 记下「正在哪一关」（M5a，刷新恢复的依据）。
  //
  //    ⚠️ 顺序约束：**必须先 exportSnapshot 成功，再写挂起标记**。
  //    反过来则可能出现「标记在而快照不在」—— boot 的恢复分支会以为可以恢复，
  //    实际却拿不到仓库内容（宁可让玩家回菜单重新进关，也不能恢复出空仓库）。
  //    ⚠️ exportSnapshot 失败时**不阻断进关**（快照是体验优化，不是游玩前提），
  //    但**不写挂起标记** —— 这样刷新后走「回菜单」的保守路径，绝不伪造可恢复。
  try {
    await exportSnapshot(level.id)
    saveActiveLevel(level.id)
  } catch (error) {
    console.warn(`[startLevel] 导出 ${level.id} 的初始快照失败，本次刷新将无法恢复：`, error)
    clearActiveLevel()
  }

  return finishEnterLevel(level, { resume: false })
}

/**
 * 进关收尾（M9 从 startLevel 提出的共用后半段）：
 * 写入会话、复位/保留结算信息、切视图。
 *
 * - 新开局：清历史 + 复位草稿 + 结算信息清零（`resume: false`）；
 * - 续玩恢复：保留历史与草稿（现场原样），结算信息按「非首次」处理（`resume: true`）。
 */
function finishEnterLevel(level: Level, options: { resume: boolean }): StartLevelResult {
  const session = useSessionStore.getState()
  session.setLevel(level, { resumed: options.resume })

  if (options.resume) {
    // 续玩：命令历史与拼接草稿是「玩家做到哪了」的一部分，原样保留。
    // 结算信息：本会话已累计的提示次数与首次尝试判定都应延续，不重置。
  } else {
    session.clearHistory()
    // 复位上一关残留的拼接草稿（否则新关卡一进来就带着上一关拼了一半的命令）
    session.resetDraft()
    // 结算信息复位（M3）：提示计数清零；firstAttempt 按进度库判定 ——
    // 该关已有通关记录（重玩）或本会话内已进过（重试）都算「非首次」。
    // ⚠️ M5a 复核（清偿 M3 遗留 2）：进度已持久化，故**重启浏览器后**重玩某关
    //    依然会读到 cleared 记录 → firstAttempt 为 false，不再被误判为首次尝试。
    const clearedBefore = useProgressStore.getState().levelRecords[level.id]?.cleared === true
    session.setSettlement({ hintsUsed: 0, firstAttempt: !clearedBefore })
  }

  // 4) 切视图
  useViewStore.getState().goLevel(level.id)
  return { ok: true, levelId: level.id }
}

/**
 * 离开关卡（回菜单 / 回章节）时的清理（M9 修订）。
 *
 * 原口径（M5a）是「退出即清除快照与挂起标记」，实测反馈「进度不能保存」——
 * 玩家中途退出本想回头继续，结果进度全丢。修订为（用户裁定）：
 *
 *   - **中途退出保留全部现场**：快照、挂起标记、会话（命令历史 / 输入草稿 /
 *     当前关卡对象）都留着 —— 它们是 `startLevel` 续玩恢复的全部依据；
 *     这里只清「目标判定」这类瞬时状态（换关时 `setLevel` 本来就会归零它）。
 *   - **通关离开才清理**：已结算的关卡没有「续玩」语义，照旧删快照、清标记、
 *     复位会话（`completeLevel`），否则刷新会被「恢复」回一个已经通关的关卡。
 *
 * ⚠️ 视图切换仍由调用方（LevelScreen）负责 —— 本函数与 M5a 版一样不管路由。
 */
export async function leaveLevel(): Promise<void> {
  useSessionStore.getState().setTargetState(null)
}

/**
 * 通关后离开（结算页 → 菜单 / 下一关前的收尾）：清快照、挂起标记与会话（M9）。
 *
 * ⚠️ 只有这一条路径才清「续玩现场」：通关关卡再「恢复」没有意义，
 * 且会把结算页误当存档点（M5a 当时的顾虑，在这个路径上依然成立）。
 * 结算页的「重玩本关 / 进入下一关」也先走它 —— 清现场后 startLevel
 * 自然按新开局处理。
 */
export async function completeLevel(): Promise<void> {
  const current = useSessionStore.getState().level?.id
  clearActiveLevel()
  if (current !== undefined) {
    await clearSnapshot(current)
  }
  useSessionStore.getState().resetSession()
}
