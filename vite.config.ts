import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    // Tauri expects a fixed port
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  // produce Tauri-compatible output
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    // don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-vue',
              test: /node_modules[\\/](vue|@vue|pinia)[\\/]/,
              priority: 30,
            },
            {
              name: 'vendor-editor',
              test: /node_modules[\\/]@tiptap[\\/]/,
              priority: 25,
            },
            {
              name: 'vendor-markdown',
              test: /node_modules[\\/](marked|dompurify)[\\/]/,
              priority: 20,
            },
            {
              name: 'vendor-tauri',
              test: /node_modules[\\/]@tauri-apps[\\/]/,
              priority: 15,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 1,
              maxSize: 450 * 1024,
            },
          ],
        },
      },
    },
  },
})
