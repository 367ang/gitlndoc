// 目标检测的数据获取（development-refinement.md §9.1 GoalPanel / §2 分层职责）
//
// ⚠️ 本文件必须放在 `src/ui/hooks/`（而非组件目录内），原因有二：
//   1. 组件测试会对 `GoalPanel` 做**模块 mock**，mock 路径必须与其它组件 import 的
//      路径逐字符一致，集中在一处最不容易写歪；
//   2. 检测属于「订阅 + 派生」，与 `useFileTree` / `useCommitHistory` 同类。
//
// UI 层为纯展示：这里不碰 fs / gitApi，仓库读取与比对全部委托给
// `game/validate/targetState`（纯函数层）。
//
// ⚠️ 「还差什么」的抽象引导语还要用到 `Level.hints`，而 hints 属 M4 的提示系统；
// M2 只取第一条（方向级提示），不展示、也不扣分（计分属 M3）。

import { useEffect, useState } from 'react'
import { evaluateTargets, type TargetState } from '../../game/validate/targetState'
import { useSessionStore } from '../../store/sessionStore'

/** `useTargetState()` 的返回值 */
export interface TargetStateView {
  /** 完整的判定结果；尚未检测或本关无 targets 时为 null */
  state: TargetState | null
  /** 是否正在检测（避免 GoalPanel 首帧把已成立的目标画成未达成） */
  checking: boolean
}

const IDLE: TargetStateView = { state: null, checking: false }

/**
 * 读取当前关卡的目标达成情况。
 *
 * @param version 由 Terminal 在每条命令执行后自增的「流水号」（与 `useFileTree` 同一机制）。
 *                首帧的 `0` 也要检测一次 —— 带预置文件的关卡可能一进关就已满足部分目标。
 */
export function useTargetState(version: number): TargetStateView {
  const level = useSessionStore((state) => state.level)
  const setTargetState = useSessionStore((state) => state.setTargetState)

  const [view, setView] = useState<TargetStateView>({ ...IDLE, checking: true })

  useEffect(() => {
    if (level === null) {
      setView(IDLE)
      setTargetState(null)
      return
    }

    // 已触发新一轮检测或组件已卸载时丢弃旧结果，避免过期数据覆盖新状态
    let cancelled = false

    void (async () => {
      // `evaluateTargets` 不抛异常（内部把执行层失败收敛为「未达成」），
      // 此处仍加一层兜底，避免未捕获 rejection 冒到 React 之外变成白屏。
      let result: TargetState
      try {
        result = await evaluateTargets(level)
      } catch (error) {
        if (cancelled) return
        console.error('[useTargetState] 目标检测失败', error)
        setView({ state: null, checking: false })
        return
      }
      if (cancelled) return

      setView({ state: result, checking: false })
      // 同步写回 store：过关判定（切 `levelComplete`）与 GoalPanel 读同一份结果，
      // 避免两处各自检测出现「面板全勾了但没判过关」的错位。
      setTargetState(result)
    })()

    return () => {
      cancelled = true
    }
  }, [level, version, setTargetState])

  return view
}
