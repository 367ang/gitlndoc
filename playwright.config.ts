// Playwright 配置（M7，development-refinement.md §11.4）
//
// 自动起 vite dev server（5199，与 tools/smoke/ 的 CDP 冒烟同端口约定），
// Chromium 从工作区内的 .playwright-browsers/ 取（HOME 缓存目录在本机不可写）。
//
// 与 CDP 冒烟的分工见 e2e/main-flow.spec.ts 文件头。

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false, // 每条用例共享同一个 dev server 的沙箱语义，串行最稳
  workers: 1, // 同上 —— fullyParallel:false 只关 per-file 并行，workers 仍默认多核
  retries: 0,
  use: {
    baseURL: 'http://localhost:5199',
    headless: true,
    // jsdom 教训的反面：真实浏览器必须真的渲染（默认视口足够）
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'pnpm dev --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
