// 进入关卡的统一入口（development-refinement.md §5 视图状态机、§6.1 沙箱）
//
// 把「进入一关」这条跨三层的流程收成一个命令式函数，供 menu / chapter /
// levelComplete 三处复用：
//   1. `sandbox.reset(level.init)` —— 重建沙箱仓库（§6.1「每关开始：清空虚拟根」）；
//   2. `sessionStore.startLevel(level)` —— 写入真实关卡，并复位上一关的历史 / 输入 / 目标；
//   3. `viewStore.goLevel(levelId)` —— 切到关卡视图。
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
import { useSessionStore } from '../store/sessionStore'
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

  // 1) 重建沙箱：清空虚拟根后按 level.init 写入文件与预置提交
  try {
    const result = await reset(level.init)
    if (!result.ok) return { ok: false, error: result.error.toString() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  // 2) 写入会话（顺带复位上一关的历史 / 输入 / 目标判定）
  const session = useSessionStore.getState()
  session.setLevel(level)
  session.clearHistory()
  // 复位上一关残留的拼接草稿（否则新关卡一进来就带着上一关拼了一半的命令）
  session.resetDraft()

  // 3) 切视图
  useViewStore.getState().goLevel(level.id)
  return { ok: true, levelId: level.id }
}
