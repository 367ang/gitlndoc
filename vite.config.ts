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
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
  },
})
