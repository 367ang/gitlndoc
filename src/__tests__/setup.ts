// 测试环境引导（Vitest setupFiles）
//
// fake-indexeddb/auto：jsdom 不提供 navigator.locks，也不提供 indexedDB，
// 而 LightningFS 的 DefaultBackend.init() 在无 navigator.locks 时会走
// Mutex 分支（经由 @isomorphic-git/idb-keyval 依赖 indexedDB）。
// 注入内存版 indexedDB 后该分支在 jsdom 下可用。
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom'
