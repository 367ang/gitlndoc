// 应用入口（development-refinement.md §3 `src/main.tsx`；index.html 引用本路径）
//
// 职责（§5 boot 阶段）：
//   1. 加载持久化进度（M5a，§10）—— 必须在渲染前完成，否则首帧会按「新玩家」处理；
//   2. 初始化 LightningFS 沙箱：`sandbox.reset({ template: 'emptyRepo' })`
//      （内部走 clearSandboxRoot → ensureSandboxRoot → git init）；
//   3. 挂载 React 根组件。
//
// ⚠️ 初始化刻意放在 `createRoot().render()` **之前**，而不是 App 的 effect 里：
//   - StrictMode 下 effect 会执行两次，而 `reset()` 会清空整个虚拟根，
//     重复执行会把玩家建立的仓库抹掉（测试环境的 MockBackend 尤其明显）；
//   - `reset()` 是异步的，未 await 就 render 会让首帧读到「沙箱尚未建立」的中间态。
// 初始化失败不阻断挂载 —— 把错误交给 App 显示，避免整页白屏（M1 验收项 5.2）。

// ⚠️ 必须在**任何 engine/git 代码之前**执行：为浏览器补上 Node 的 `Buffer` 全局。
// 原因：isomorphic-git 的 `hashBlob`（经 `sha.js`）与 `readable-stream` 在浏览器下会
// 裸用 `Buffer`，而 Vite 不会自动为 npm 包注入 Node polyfill。缺它时 `git status`
// 会直接抛 `ReferenceError: Buffer is not defined`（实测：jsdom 测试**不会**暴露此问题，
// 因为 Vitest 的 jsdom 环境带有 Node 全局垫片；只有真实浏览器才会崩）。
// 故此处显式把 `buffer` 包的实现挂到 `globalThis`。
import { Buffer as NodeBuffer } from 'buffer'

if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  ;(globalThis as { Buffer?: unknown }).Buffer = NodeBuffer
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { reset } from './engine/sandbox'
import { hydrateProgress, resumeInterruptedLevel } from './persistence/boot'
import './styles/tokens.css'
import './styles/global.css'

/** 取得挂载点；index.html 中的 `#root` 缺失属结构性错误，无法在此恢复 */
function mountPoint(): HTMLElement {
  const element = document.getElementById('root')
  if (!element) throw new Error('找不到挂载点 #root，请检查 index.html。')
  return element
}

async function bootstrap(): Promise<void> {
  // 1) 加载持久化进度（M5a）：必须在 render 之前，否则 App 首帧会按「新玩家」
  //    走 intro，玩家刷新后会看到开场引导而不是自己的进度。
  //    本函数自身容错（storage 不可用 / 数据损坏都返回空进度），不抛异常。
  hydrateProgress()

  // 2) 刷新恢复（M5a，用户裁定的产品口径「自动恢复关卡中途进度」）：
  //    若上次离开时正在某关内，则把沙箱挂到该关的快照库上并直接回到那一关。
  //    ⚠️ 恢复分支**不能**再跑下面的 `reset()` —— 那会清空虚拟根、
  //    把刚要恢复的仓库抹掉。两条路径互斥，故用 `resumed` 标记分流。
  //
  //    ⚠️ 顺带说明一处未来会变的行为：M5a 之前每次 boot 都 `reset({ template: 'emptyRepo' })`，
  //    即「启动即得到一个空仓库」；现在正常启动（无挂起关卡）时**仍需**它 ——
  //    后续流程是「进菜单 → 玩家点进某关」，进关时会由 `startLevel()` 再 reset 一次。
  //    这里的 boot reset 只是保证「任何时刻沙箱都处于已初始化的可用状态」。
  let bootError: string | null = null
  let resumed = false
  try {
    const outcome = await resumeInterruptedLevel()
    resumed = outcome.resumed
    if (!outcome.resumed && outcome.reason !== 'none') {
      // 恢复失败不是致命错误：退回菜单即可，但要留下线索便于排查
      console.warn(`[boot] 未能恢复挂起关卡（${outcome.reason}），改从菜单开始。`)
    }
  } catch (error) {
    // 恢复流程绝不允许阻断 boot
    console.warn('[boot] 恢复挂起关卡时异常：', error)
  }

  // 3) 未恢复时才初始化空沙箱；沙箱可能因浏览器无 indexedDB 等原因失败；
  //    此处不抛，转成 bootError 交由 App 呈现，保证页面永远有内容。
  if (!resumed) {
    try {
      const result = await reset({ template: 'emptyRepo' })
      if (!result.ok) bootError = result.error.toString()
    } catch (error) {
      bootError = error instanceof Error ? error.message : String(error)
    }
  }

  createRoot(mountPoint()).render(
    <StrictMode>
      <App bootError={bootError} />
    </StrictMode>,
  )
}

void bootstrap()
