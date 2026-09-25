// 应用入口（development-refinement.md §3 `src/main.tsx`；index.html 引用本路径）
//
// 职责（§5 boot 阶段）：
//   1. 初始化 LightningFS 沙箱：`sandbox.reset({ template: 'emptyRepo' })`
//      （内部走 clearSandboxRoot → ensureSandboxRoot → git init）。
//   2. 挂载 React 根组件。
//
// ⚠️ 初始化刻意放在 `createRoot().render()` **之前**，而不是 App 的 effect 里：
//   - StrictMode 下 effect 会执行两次，而 `reset()` 会清空整个虚拟根，
//     重复执行会把玩家建立的仓库抹掉（测试环境的 MockBackend 尤其明显）；
//   - `reset()` 是异步的，未 await 就 render 会让首帧读到「沙箱尚未建立」的中间态。
// 初始化失败不阻断挂载 —— 把错误交给 App 显示，避免整页白屏（M1 验收项 5.2）。
//
// TODO(M5, §10)：boot 还应「加载持久化进度」并据此决定进入 intro 还是 menu；
// 持久化排在 M5（见 TODO/M1-tasks-DONE.md「已确认的决策」第 3 条），
// 届时在下方 reset 之后接入 `src/persistence/progress.ts`。

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
import './styles/tokens.css'
import './styles/global.css'

/** 取得挂载点；index.html 中的 `#root` 缺失属结构性错误，无法在此恢复 */
function mountPoint(): HTMLElement {
  const element = document.getElementById('root')
  if (!element) throw new Error('找不到挂载点 #root，请检查 index.html。')
  return element
}

async function bootstrap(): Promise<void> {
  // 沙箱可能因浏览器无 indexedDB 等原因初始化失败；此处不抛，
  // 转成 bootError 交由 App 呈现，保证页面永远有内容。
  let bootError: string | null = null
  try {
    const result = await reset({ template: 'emptyRepo' })
    if (!result.ok) bootError = result.error.toString()
  } catch (error) {
    bootError = error instanceof Error ? error.message : String(error)
  }

  createRoot(mountPoint()).render(
    <StrictMode>
      <App bootError={bootError} />
    </StrictMode>,
  )
}

void bootstrap()
