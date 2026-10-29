import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    minify: true,
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: 'payments',
    },
  },
})
