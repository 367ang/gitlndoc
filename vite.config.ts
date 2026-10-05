import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // isomorphic-git pulls in node polyfills; ensure it is pre-bundled.
    include: ['isomorphic-git'],
  },
  build: {
    target: 'es2020',
    // M7 code-split（§12 性能）：vendor 依赖与游戏代码分块。总 gzip 基本不变
    // （分块不减少代码量），但 single chunk >500kB 的构建警告消除，且 vendor 块在
    // 版本迭代间有更好的浏览器缓存命中（改游戏代码不再使 isomorphic-git 的缓存失效）。
    rollupOptions: {
      output: {
        manualChunks: {
          // isomorphic-git + LightningFS（含 buffer/sha.js 等 polyfill 依赖）
          'git-engine': ['isomorphic-git', '@isomorphic-git/lightning-fs'],
          // React 运行时
          'react-vendor': ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    // Playwright 用例（e2e/）由 `pnpm e2e` 的 test runner 驱动，不归 Vitest 收集
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
