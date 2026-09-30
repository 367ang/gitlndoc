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
import { reset } from '../engine/sandbox'
import {
  clearActiveLevel,
  clearSnapshot,
  exportSnapshot,
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

  // 0) 清掉上一关的快照（M5a，§10「退出关卡清除」）。
  //    本函数既是「进入某关」的入口，也就是「离开上一关」的唯一路径 ——
  //    快照的清理挂在起点而不是各处的返回按钮上，避免遗漏某条退出路径。
  const previousLevel = useSessionStore.getState().level?.id
  if (previousLevel !== undefined && previousLevel !== level.id) {
    await clearSnapshot(previousLevel)
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

  // 3) 写入会话（顺带复位上一关的历史 / 输入 / 目标判定）
  const session = useSessionStore.getState()
  session.setLevel(level)
  session.clearHistory()
  // 复位上一关残留的拼接草稿（否则新关卡一进来就带着上一关拼了一半的命令）
  session.resetDraft()
  // 结算信息复位（M3）：提示计数清零；firstAttempt 按进度库判定 ——
  // 该关已有通关记录（重玩）或本会话内已进过（重试）都算「非首次」。
  // ⚠️ M5a 复核（清偿 M3 遗留 2）：进度已持久化，故**重启浏览器后**重玩某关
  //    依然会读到 cleared 记录 → firstAttempt 为 false，不再被误判为首次尝试。
  const clearedBefore = useProgressStore.getState().levelRecords[level.id]?.cleared === true
  session.setSettlement({ hintsUsed: 0, firstAttempt: !clearedBefore })

  // 4) 切视图
  useViewStore.getState().goLevel(level.id)
  return { ok: true, levelId: level.id }
}

/**
 * 离开关卡（回菜单 / 通关后返回）时的清理（M5a）。
 *
 * 三件事：
 *   1. 清掉 `gtp:active-level:v1` —— 否则下次刷新会**恢复到一个已经离开的关卡**；
 *   2. 删掉该关的快照（§10「退出关卡清除」）；
 *   3. 复位会话（当前关卡 / 历史 / 草稿 / 目标）。
 *
 * ⚠️ 与 `startLevel()` 的「清上一关快照」有重叠但不重复：
 *    `startLevel` 走的是「关卡 A → 关卡 B」的路径（会话里还留着 A）；
 *    本函数走的是「关卡 → 菜单」的路径（会话即将被清空）。
 *    两条路径都必须清理，因为会话状态在其中一条上会被提前复位。
 */
export async function leaveLevel(): Promise<void> {
  const current = useSessionStore.getState().level?.id
  // ⚠️ 先清标记再删快照：即使删快照失败，「挂起标记已清」也能保证
  //    boot 的恢复分支不会被走进来（宁可多占一点空间，不能恢复错状态）。
  clearActiveLevel()
  if (current !== undefined) {
    await clearSnapshot(current)
  }
  useSessionStore.getState().resetSession()
}
