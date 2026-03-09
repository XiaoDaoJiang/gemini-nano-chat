import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    crx({
      manifest: {
        manifest_version: 3,
        name: 'Gemini Nano Chat',
        version: '1.0',
        description: '基于 Chrome 内置 AI (Gemini Nano) 的本地聊天扩展',
        action: {
          default_title: 'Gemini Chat',
        },
        background: {
          service_worker: 'src/background.js',
          type: 'module',
        },
        side_panel: {
          default_path: 'src/popup.html',
        },
        permissions: [
          'storage',
          'sidePanel',
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup.html'),
      },
    },
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
