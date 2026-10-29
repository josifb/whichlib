import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
}))
