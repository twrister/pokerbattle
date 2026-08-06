import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: true },
  build: { target: 'es2022' },
  // @pb/sim 直接以 TS 源码形式被引用，跳过依赖预打包，改动可即时热更新
  optimizeDeps: { exclude: ['@pb/sim'] },
});
