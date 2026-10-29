import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    keepNames: true,
  },
  build: {
    minify: true,
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: 'payments',
    },
  },
})
