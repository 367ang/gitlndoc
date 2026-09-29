// 测试环境引导（Vitest setupFiles）
//
// fake-indexeddb/auto：jsdom 不提供 navigator.locks，也不提供 indexedDB，
// 而 LightningFS 的 DefaultBackend.init() 在无 navigator.locks 时会走
// Mutex 分支（经由 @isomorphic-git/idb-keyval 依赖 indexedDB）。
// 注入内存版 indexedDB 后该分支在 jsdom 下可用。
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom'

// ── localStorage 垫片（M5a）──────────────────────────────────────────────
//
// ⚠️ 本仓库使用的 jsdom（30.x）在此配置下**不提供 `window.localStorage`**
// （实测：`typeof localStorage === 'undefined'`、`window.localStorage` 也是
// undefined —— 既不是抛错，而是压根没有该属性）。而 M5a 的持久化层依赖它。
//
// 这里补一个最小可用的内存实现：只为让 `src/persistence/progress.ts` 的
// 读写路径可在单测里被真实覆盖（含「清空后重读 = 往返一致」这类断言）。
// **行为契约与标准一致**：`getItem` 对不存在的键返回 `null`、
// `setItem` 覆盖写入、`removeItem` / `clear` 按标准语义工作。
//
// ⚠️ 刻意**不**在这里模拟「storage 抛错」的场景 —— 那类用例自己在测试内
// 用 `vi.spyOn` 覆盖（见 persistence.test.ts），以免全局垫片把降级路径掩盖掉。
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>()

  const shim: Storage = {
    get length() {
      return store.size
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value))
    },
    removeItem(key: string): void {
      store.delete(String(key))
    },
    clear(): void {
      store.clear()
    },
  }

  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
    writable: true,
  })
}
