import { defineConfig } from 'vite'
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
})
