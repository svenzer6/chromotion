import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;
const src = resolve(root, 'src');

export default defineConfig({
  root: src,
  publicDir: resolve(root, 'public'),
  base: '',
  plugins: [react()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(src, 'sidepanel/index.html'),
        options: resolve(src, 'options/index.html'),
        sleep: resolve(src, 'sleep/index.html'),
        background: resolve(src, 'background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    root: root,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
